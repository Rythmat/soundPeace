import { createPlayer, createRecordButton, isRecordingSupported, prepareMicrophone } from './audio.js';
import { requestConsent, uploadClips, wakeBackend } from './upload.js';

const MAX_CLIPS = 5;

const recorderSlot = document.getElementById('recorder');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('clip-count');
const rowsEl = document.getElementById('clip-rows');
const uploadBtn = document.getElementById('upload');

// Clips live only in the browser until the participant confirms the upload.
const clips = [];
let recording = false;
let uploaded = false;

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
  countEl.textContent = `${clips.length} / ${MAX_CLIPS}`;
  if (isRecordingSupported()) {
    recorder.setDisabled(clips.length >= MAX_CLIPS, 'You have five clips. Delete one to record another.');
  }

  if (clips.length === 0) {
    rowsEl.innerHTML = '<tr class="empty-row"><td colspan="3">No clips yet. Press Record to begin.</td></tr>';
  } else {
    rowsEl.replaceChildren(...clips.map(renderRow));
  }

  uploadBtn.disabled = clips.length === 0 || recording;
}

uploadBtn.addEventListener('click', () => {
  requestConsent(async () => {
    await uploadClips('chaos', clips.map((c) => c.blob));
    uploaded = true;
    location.assign('/harmony');
  });
});

// Recorded clips aren't saved anywhere yet, so warn before navigating away.
window.addEventListener('beforeunload', (e) => {
  if (clips.length > 0 && !uploaded) e.preventDefault();
});

wakeBackend();
if (isRecordingSupported()) {
  prepareMicrophone();
} else {
  recorder.setDisabled(true, 'This browser cannot record audio. Try Chrome, Firefox or Safari.');
}
render();
