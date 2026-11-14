import { API_BASE_URL } from './config.js';
import { getDevice, saveUploadRecord } from './device.js';

// Render's free tier puts idle services to sleep and they take a while to wake. Pinging
// on page load wakes the API while the participant is still recording.
export function wakeBackend() {
  fetch(`${API_BASE_URL}/healthz`).catch(() => {});
}

// An upload is abandoned, so the participant can try again, once it stops making
// progress: nothing sent for this long, or no answer for this long after it's all sent.
// A slow connection that keeps sending is never cut off.
const SEND_STALL_MS = 30_000;
const ANSWER_TIMEOUT_MS = 60_000;

let lastAttempt = { blobs: [], id: null };

// Retrying the same clips reuses their upload ID, so the backend recognises a retry of an
// upload that went through but whose answer never arrived, and doesn't store it twice.
function uploadIdFor(blobs) {
  const same =
    blobs.length === lastAttempt.blobs.length && blobs.every((b, i) => b === lastAttempt.blobs[i]);
  if (!same) lastAttempt = { blobs, id: crypto.randomUUID() };
  return lastAttempt.id;
}

// POSTs a form and resolves with { ok, status, statusText, body }. Uses XMLHttpRequest
// rather than fetch because only it reports upload progress, which is how a stall is
// told apart from a slow connection.
function post(url, form) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer = 0;
    const giveUpAfter = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        xhr.abort();
        reject(new Error('The connection stalled'));
      }, ms);
    };
    xhr.upload.addEventListener('progress', () => giveUpAfter(SEND_STALL_MS));
    xhr.upload.addEventListener('load', () => giveUpAfter(ANSWER_TIMEOUT_MS));
    xhr.addEventListener('load', () => {
      clearTimeout(timer);
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        body: xhr.response ?? {},
      });
    });
    xhr.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error("Couldn't reach the server"));
    });
    xhr.open('POST', url);
    xhr.responseType = 'json';
    xhr.send(form);
    giveUpAfter(SEND_STALL_MS);
  });
}

// Uploads recorded blobs in one request. `category` is "chaos" or "peace" and ends up
// at the start of each object name in the bucket. The backend answers with this
// device's upload record, also when it refuses an upload for going over the limits;
// that record is saved locally and attached to the thrown error as `err.record`.
export async function uploadClips(category, blobs) {
  const form = new FormData();
  form.append('category', category);
  form.append('deviceId', getDevice().id);
  form.append('uploadId', uploadIdFor(blobs));
  blobs.forEach((blob, i) => form.append('audio', blob, `${category}-${i + 1}`));

  const res = await post(`${API_BASE_URL}/api/clips`, form);
  const { body } = res;
  if (body.record) saveUploadRecord(body.record);
  if (!res.ok) {
    const err = new Error(body.error || res.statusText || `The server answered ${res.status}`);
    err.record = body.record;
    throw err;
  }
  return body.ids;
}

// Shows the public-display consent dialog. `onConfirm` runs once the box is ticked and
// Confirm Upload is pressed; if it throws, the error is shown and the dialog stays open.
export function requestConsent(onConfirm) {
  const dialog = document.createElement('dialog');
  dialog.className = 'panel consent';
  dialog.innerHTML = `
    <p class="consent-question">
      Your clips are about to be uploaded. Are you okay with these unlabeled audio clips being
      played in a public setting?
    </p>
    <label class="consent-check">
      <input type="checkbox" />
      <span>I understand that I am providing these clips to be shared in a public art display</span>
    </label>
    <p class="consent-error" role="alert"></p>
    <div class="dialog-actions">
      <button type="button" class="button secondary" data-action="cancel">Cancel</button>
      <button type="button" class="button" data-action="confirm" disabled>Confirm Upload</button>
    </div>
  `;
  document.body.append(dialog);

  const checkbox = dialog.querySelector('input[type="checkbox"]');
  const cancelBtn = dialog.querySelector('[data-action="cancel"]');
  const confirmBtn = dialog.querySelector('[data-action="confirm"]');
  const errorEl = dialog.querySelector('.consent-error');
  let uploading = false;

  function setUploading(value) {
    uploading = value;
    checkbox.disabled = value;
    cancelBtn.disabled = value;
    confirmBtn.disabled = value;
    confirmBtn.textContent = value ? 'Uploading…' : 'Confirm Upload';
  }

  checkbox.addEventListener('change', () => {
    confirmBtn.disabled = !checkbox.checked;
  });
  cancelBtn.addEventListener('click', () => dialog.close());
  // Don't let Escape dismiss the dialog mid-upload.
  dialog.addEventListener('cancel', (e) => {
    if (uploading) e.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove());

  confirmBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    setUploading(true);
    try {
      await onConfirm();
      dialog.close();
    } catch (err) {
      errorEl.textContent = `Upload failed: ${err.message.replace(/\.$/, '')}. Please try again.`;
      setUploading(false);
    }
  });

  dialog.showModal();
}
