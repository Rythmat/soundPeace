export const MAX_SECONDS = 5;

// Sound takes a moment to get from the microphone to the capture code, so a clip keeps a
// little audio either side of the presses that bound it. Without the tail, whatever was
// still on its way when Stop was pressed or time ran out would be lost.
const LEAD_IN_SECONDS = 0.05;
const TAIL_SECONDS = 0.2;

// The browser's voice-call processing (noise suppression, echo cancellation, automatic
// gain) strips out hisses, breaths and other non-speech sound, so record the raw signal.
const MIC_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export function isRecordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== 'undefined';
}

export function formatSeconds(seconds) {
  return `${seconds.toFixed(1)} s`;
}

let micPromise = null;
let micContext = null;

function wakeMicContext() {
  if (micContext && micContext.state !== 'running') micContext.resume();
}

// Browsers can hold an AudioContext suspended until the page sees a gesture, and suspend
// it again later (iOS does during a phone call). No audio is captured while it's suspended,
// so every gesture is a chance to get it running before Record is pressed.
for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) {
  window.addEventListener(type, wakeMicContext, { capture: true });
}

// Opens the microphone once per page and keeps it running, so pressing Record starts
// capturing immediately instead of losing the first moments while the device wakes up.
function openMicrophone() {
  if (micPromise) return micPromise;
  // Created before any await so it's still inside the click's user gesture (Safari).
  const context = new AudioContext();
  micContext = context;
  micPromise = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      micPromise = null;
    });
    await context.audioWorklet.addModule('/js/capture-processor.js');
    const node = new AudioWorkletNode(context, 'capture-processor', {
      // Enough to hold the longest clip, with room to spare for a slow main thread.
      processorOptions: { bufferSeconds: MAX_SECONDS + 1 },
    });
    context.createMediaStreamSource(stream).connect(node);
    node.connect(context.destination);
    // Some browsers let the context run without a gesture once the microphone is open.
    wakeMicContext();
    return { stream, context, node, openedAt: performance.now() };
  })();
  micPromise.catch(() => {
    micPromise = null;
    micContext = null;
    context.close();
  });
  return micPromise;
}

// Opens the microphone when a recording page loads, asking for permission if need be, so
// that it's already running when Record is first pressed.
export async function prepareMicrophone() {
  try {
    await openMicrophone();
  } catch {
    // Permission was refused or dismissed; the next press asks again and reports any error.
  }
}

export async function closeMicrophone() {
  const mic = await micPromise?.catch(() => null);
  micPromise = null;
  micContext = null;
  if (!mic) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.context.close();
}

// 16-bit PCM mono WAV: lossless, and playable by browsers and installation software alike.
function encodeWav(samples, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

// The audio clock's frame at `time` on the performance.now() clock.
function frameAt(context, time) {
  const secondsAgo = (performance.now() - time) / 1000;
  return Math.round((context.currentTime - secondsAgo) * context.sampleRate);
}

// Records one clip starting from `pressedAt`, a performance.now() time that may already
// have passed. `done` resolves with { blob, url, duration } when stop(stoppedAt) is called
// or maxSeconds (at most MAX_SECONDS) has run out, whichever comes first.
export async function startRecording({
  maxSeconds = MAX_SECONDS,
  pressedAt = performance.now(),
  onProgress,
} = {}) {
  const { context, node, openedAt } = await openMicrophone();
  // There's no audio from before the microphone was open and running, so a press that came
  // earlier (while the permission prompt was up, say) starts the clip at that point instead.
  let startedAt = Math.max(pressedAt, openedAt);
  if (context.state !== 'running') {
    await context.resume();
    startedAt = performance.now();
  }

  let ticker = 0;
  const done = new Promise((resolve) => {
    node.port.onmessage = ({ data: samples }) => {
      clearInterval(ticker);
      const blob = encodeWav(samples, context.sampleRate);
      resolve({ blob, url: URL.createObjectURL(blob), duration: samples.length / context.sampleRate });
    };
  });

  const startFrame = frameAt(context, startedAt);
  const tailFrames = Math.round(TAIL_SECONDS * context.sampleRate);
  node.port.postMessage({
    type: 'start',
    startFrame: startFrame - Math.round(LEAD_IN_SECONDS * context.sampleRate),
    endFrame: startFrame + Math.round(maxSeconds * context.sampleRate) + tailFrames,
  });
  ticker = setInterval(() => {
    onProgress?.(Math.min((performance.now() - startedAt) / 1000, maxSeconds));
  }, 50);

  return {
    stop(stoppedAt = performance.now()) {
      clearInterval(ticker);
      node.port.postMessage({ type: 'stop', endFrame: frameAt(context, stoppedAt) + tailFrames });
    },
    done,
  };
}

// Round record/stop button with a progress ring. Calls onClip(clip) with each finished
// recording, and onStateChange(isRecording) when recording starts or stops.
export function createRecordButton({ maxSeconds = MAX_SECONDS, onClip, onError, onStateChange }) {
  const element = document.createElement('div');
  element.className = 'recorder';
  element.innerHTML = `
    <button type="button" class="record-button">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="ring-track" cx="50" cy="50" r="47" />
        <circle class="ring-progress" cx="50" cy="50" r="47" pathLength="1" />
      </svg>
      <span class="record-label">Record</span>
    </button>
    <p class="record-hint" aria-live="polite"></p>
  `;
  const button = element.querySelector('.record-button');
  const label = element.querySelector('.record-label');
  const ring = element.querySelector('.ring-progress');
  const hint = element.querySelector('.record-hint');
  const idleHint = `Up to ${maxSeconds} seconds`;
  hint.textContent = idleHint;

  let session = null;
  let starting = false;

  function setProgress(seconds) {
    ring.style.strokeDashoffset = String(1 - seconds / maxSeconds);
    hint.textContent = `${formatSeconds(seconds)} / ${formatSeconds(maxSeconds)}`;
  }

  async function press(pressedAt) {
    if (session) return session.stop(pressedAt);
    if (starting) return;

    starting = true;
    label.textContent = 'Starting…';
    try {
      session = await startRecording({ maxSeconds, pressedAt, onProgress: setProgress });
    } catch (err) {
      label.textContent = 'Record';
      onError?.(err);
      return;
    } finally {
      starting = false;
    }

    button.classList.add('is-recording');
    label.textContent = 'Stop';
    setProgress(0);
    onStateChange?.(true);

    const clip = await session.done;
    session = null;
    button.classList.remove('is-recording');
    label.textContent = 'Record';
    ring.style.strokeDashoffset = '1';
    hint.textContent = idleHint;
    onClip(clip);
    onStateChange?.(false);
  }

  // A click only fires once the button is released, which is too late to start recording,
  // so a pointer acts on the press itself. Keyboards and screen readers fire only the click.
  let pressedByPointer = false;
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || button.disabled) return;
    pressedByPointer = true;
    press(event.timeStamp);
  });
  button.addEventListener('click', (event) => {
    if (!pressedByPointer) press(event.timeStamp);
    pressedByPointer = false;
  });
  // A pointer released off the button never clicks; that mustn't swallow the next key press.
  button.addEventListener('keydown', () => {
    pressedByPointer = false;
  });

  return {
    element,
    // While disabled, `message` (if given) replaces the hint under the button.
    setDisabled(disabled, message) {
      if (session) return;
      button.disabled = disabled;
      hint.textContent = disabled && message ? message : idleHint;
    },
  };
}

let stopCurrent = null;

// Play/stop button plus a timeline whose playhead follows playback. Starting one clip
// stops any other that is playing. `recordedSeconds` stands in for audio.duration,
// which some browsers report as Infinity for freshly recorded webm.
export function createPlayer(url, recordedSeconds) {
  const element = document.createElement('div');
  element.className = 'player';
  element.innerHTML = `
    <button type="button" class="play-button" aria-label="Play"></button>
    <div class="timeline-wrap">
      <div class="timeline" aria-hidden="true">
        <div class="timeline-progress"></div>
        <div class="playhead"></div>
      </div>
      <div class="timeline-labels">
        <span class="timeline-current"></span>
        <span class="timeline-total"></span>
      </div>
    </div>
  `;
  const button = element.querySelector('.play-button');
  const currentEl = element.querySelector('.timeline-current');
  const totalEl = element.querySelector('.timeline-total');

  const audio = document.createElement('audio');
  audio.preload = 'auto';
  audio.src = url;

  const total = () =>
    Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : recordedSeconds;
  let frame = 0;

  function draw(seconds) {
    const t = Math.min(seconds, total());
    element.style.setProperty('--progress', String(t / total()));
    currentEl.textContent = formatSeconds(t);
    totalEl.textContent = formatSeconds(total());
  }

  function follow() {
    draw(audio.currentTime);
    frame = requestAnimationFrame(follow);
  }

  function showStopped() {
    cancelAnimationFrame(frame);
    element.classList.remove('is-playing');
    button.setAttribute('aria-label', 'Play');
    draw(0);
  }

  function stop() {
    audio.pause();
    // Seeking before metadata has loaded throws in Safari.
    if (audio.readyState > 0) audio.currentTime = 0;
  }

  audio.addEventListener('play', () => {
    element.classList.add('is-playing');
    element.classList.remove('has-error');
    button.setAttribute('aria-label', 'Stop');
    cancelAnimationFrame(frame);
    follow();
  });
  audio.addEventListener('pause', showStopped);
  audio.addEventListener('ended', showStopped);
  // Swap the recorded estimate for the real length once the browser knows it.
  audio.addEventListener('durationchange', () => {
    if (audio.paused) draw(0);
  });

  button.addEventListener('click', async () => {
    if (!audio.paused) return stop();
    if (stopCurrent && stopCurrent !== stop) stopCurrent();
    stopCurrent = stop;
    try {
      await audio.play();
    } catch (err) {
      // Pressing Stop before playback starts rejects play() with AbortError; that's fine.
      if (err.name === 'AbortError') return;
      console.error('Playback failed', err, audio.error);
      showStopped();
      element.classList.add('has-error');
      currentEl.textContent = "Couldn't play this clip";
    }
  });

  draw(0);
  return { element, destroy: stop };
}
