import {
  closeMicrophone,
  createPlayer,
  createRecordButton,
  isRecordingSupported,
  prepareMicrophone,
} from './audio.js';
import { requestConsent, uploadClips, wakeBackend } from './upload.js';

const slot = document.getElementById('clip-slot');
const statusEl = document.getElementById('status');
const uploadBtn = document.getElementById('upload');
const sessionEl = document.getElementById('session');
const thanksEl = document.getElementById('thanks');

// The single recorded clip, kept in the browser until the upload is confirmed.
let clip = null;
let uploaded = false;

const recorder = createRecordButton({
  onClip(recorded) {
    clip = { ...recorded, player: createPlayer(recorded.url, recorded.duration) };
    render();
  },
  onError(err) {
    statusEl.textContent = `Couldn't access the microphone: ${err.message}`;
  },
  onStateChange() {
    statusEl.textContent = '';
  },
});

function deleteClip() {
  clip.player.destroy();
  URL.revokeObjectURL(clip.url);
  clip = null;
  render();
}

// Takes the record button's place once a clip has been recorded.
function renderClipModule() {
  const module = document.createElement('div');
  module.className = 'clip-module';
  module.innerHTML = `
    <div class="clip-module-header">
      <span class="clip-module-title">Your clip</span>
    </div>
  `;
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'small-button danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', deleteClip);
  module.querySelector('.clip-module-header').append(deleteBtn);
  module.append(clip.player.element);
  return module;
}

function render() {
  slot.replaceChildren(clip ? renderClipModule() : recorder.element);
  uploadBtn.disabled = !clip;
}

uploadBtn.addEventListener('click', () => {
  requestConsent(async () => {
    await uploadClips('peace', [clip.blob]);
    uploaded = true;
    clip.player.destroy();
    closeMicrophone();
    sessionEl.hidden = true;
    thanksEl.hidden = false;
    document.body.classList.add('is-finished');
  });
});

window.addEventListener('beforeunload', (e) => {
  if (clip && !uploaded) e.preventDefault();
});

wakeBackend();
if (isRecordingSupported()) {
  prepareMicrophone();
} else {
  recorder.setDisabled(true, 'This browser cannot record audio. Try Chrome, Firefox or Safari.');
}
render();
