export const MAX_SECONDS = 5;

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

// Opens the microphone once per page and keeps it running, so pressing Record starts
// capturing immediately instead of losing the first moments while the device wakes up.
function openMicrophone() {
  if (micPromise) return micPromise;
  // Created before any await so it's still inside the click's user gesture (Safari).
  const context = new AudioContext();
  micPromise = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      micPromise = null;
    });
    await context.audioWorklet.addModule('/js/capture-processor.js');
    const node = new AudioWorkletNode(context, 'capture-processor');
    context.createMediaStreamSource(stream).connect(node);
    node.connect(context.destination);
    return { stream, context, node };
  })();
  micPromise.catch(() => {
    micPromise = null;
    context.close();
  });
  return micPromise;
}

// Opens the microphone on page load when permission was already granted (e.g. on
// /harmony after /chaos), so even the first recording starts instantly.
export async function prepareMicrophone() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    if (status.state === 'granted') await openMicrophone();
  } catch {
    // No "microphone" permission query in this browser; it opens on the first press.
  }
}

export async function closeMicrophone() {
  const mic = await micPromise?.catch(() => null);
  micPromise = null;
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

// Records one clip. `done` resolves with { blob, url, duration } when stop() is called
// or exactly maxSeconds of audio has been captured, whichever comes first.
export async function startRecording({ maxSeconds = MAX_SECONDS, onProgress } = {}) {
  const { context, node } = await openMicrophone();
  if (context.state !== 'running') await context.resume();

  let ticker = 0;
  const done = new Promise((resolve) => {
    node.port.onmessage = ({ data: samples }) => {
      clearInterval(ticker);
      const blob = encodeWav(samples, context.sampleRate);
      resolve({ blob, url: URL.createObjectURL(blob), duration: samples.length / context.sampleRate });
    };
  });

  node.port.postMessage({ type: 'start', maxSamples: Math.round(maxSeconds * context.sampleRate) });
  const startedAt = performance.now();
  ticker = setInterval(() => {
    onProgress?.(Math.min((performance.now() - startedAt) / 1000, maxSeconds));
  }, 50);

  return { stop: () => node.port.postMessage({ type: 'stop' }), done };
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

  button.addEventListener('click', async () => {
    if (session) return session.stop();
    if (starting) return;

    starting = true;
    label.textContent = 'Starting…';
    try {
      session = await startRecording({ maxSeconds, onProgress: setProgress });
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
