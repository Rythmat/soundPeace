import { createPlayer, createRecordButton, isRecordingSupported, prepareMicrophone } from './audio.js';
import { MAX_CHAOS_UPLOADS, getDevice } from './device.js';
import { requestConsent, uploadClips, wakeBackend } from './upload.js';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];

const allowanceEl = document.getElementById('allowance');
const recorderSlot = document.getElementById('recorder');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('clip-count');
const rowsEl = document.getElementById('clip-rows');
const uploadBtn = document.getElementById('upload');

// How many more chaos clips this device may upload (five to begin with).
let maxClips = MAX_CHAOS_UPLOADS - getDevice().chaosUploads;

// Clips live only in the browser until the participant confirms the upload.
const clips = [];
let recording = false;
let leaving = false;

const recorder = createRecordButton({
  onClip(clip) {
    clips.push({ ...clip, player: createPlayer(clip.url, clip.duration) });
    render();
  },
  onError(err) {
    statusEl.textContent = `Couldn't access the microphone: ${err.message}`;
  },
  onStateChange(isRecording) {
    recording = isRecording;
    statusEl.textContent = '';
    render();
  },
});
recorderSlot.append(recorder.element);

function clipsPhrase(n) {
  return `${NUMBER_WORDS[n] ?? n} clip${n === 1 ? '' : 's'}`;
}

function renderAllowance() {
  allowanceEl.textContent = `You can upload up to ${clipsPhrase(maxClips)} of up to five seconds of audio.`;
}

function deleteClip(clip) {
  clip.player.destroy();
  URL.revokeObjectURL(clip.url);
  clips.splice(clips.indexOf(clip), 1);
  render();
}

function renderRow(clip, index) {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td class="clip-num">${index + 1}</td>
    <td class="clip-player"></td>
    <td class="row-actions"></td>
  `;
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'small-button danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => deleteClip(clip));
  row.querySelector('.clip-player').append(clip.player.element);
  row.querySelector('.row-actions').append(deleteBtn);
  return row;
}

function render() {
  countEl.textContent = `${clips.length} / ${maxClips}`;
  if (isRecordingSupported()) {
    // More clips than the allowance only happens if the backend's record turned out to
    // be ahead of ours (e.g. another tab uploaded in the meantime).
    const extra = clips.length - maxClips;
    recorder.setDisabled(
      clips.length >= maxClips,
      extra > 0
        ? `You can upload ${clipsPhrase(maxClips)}. Delete ${extra} to continue.`
        : "That's as many as you can upload. Delete one to record another.",
    );
  }

  if (clips.length === 0) {
    rowsEl.innerHTML = '<tr class="empty-row"><td colspan="3">No clips yet. Press Record to begin.</td></tr>';
  } else {
    rowsEl.replaceChildren(...clips.map(renderRow));
  }

  uploadBtn.disabled = clips.length === 0 || clips.length > maxClips || recording;
}

function goToHarmony() {
  leaving = true;
  location.assign('/harmony');
}

uploadBtn.addEventListener('click', () => {
  requestConsent(async () => {
    try {
      await uploadClips('chaos', clips.map((c) => c.blob));
    } catch (err) {
      // Refused for going over the limit: adopt the backend's count and adjust.
      if (err.record) {
        maxClips = MAX_CHAOS_UPLOADS - err.record.chaosUploads;
        if (maxClips <= 0) return goToHarmony();
        renderAllowance();
        render();
      }
      throw err;
    }
    goToHarmony();
  });
});

// Recorded clips aren't saved anywhere yet, so warn before navigating away.
window.addEventListener('beforeunload', (e) => {
  if (clips.length > 0 && !leaving) e.preventDefault();
});

if (maxClips <= 0) {
  // This device has already uploaded all of its chaos clips.
  location.replace('/harmony');
} else {
  renderAllowance();
  wakeBackend();
  if (isRecordingSupported()) {
    prepareMicrophone();
  } else {
    recorder.setDisabled(true, 'This browser cannot record audio. Try Chrome, Firefox or Safari.');
  }
  render();
}
