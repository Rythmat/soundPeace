import { API_BASE_URL } from './config.js';

// Render's free tier puts idle services to sleep and they take a while to wake. Pinging
// on page load wakes the API while the participant is still recording.
export function wakeBackend() {
  fetch(`${API_BASE_URL}/healthz`).catch(() => {});
}

// Uploads recorded blobs in one request. `category` is "chaos" or "peace" and ends up
// at the start of each object name in the bucket.
export async function uploadClips(category, blobs) {
  const form = new FormData();
  form.append('category', category);
  blobs.forEach((blob, i) => form.append('audio', blob, `${category}-${i + 1}`));

  const res = await fetch(`${API_BASE_URL}/api/clips`, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
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
      errorEl.textContent = `Upload failed: ${err.message}. Please try again.`;
      setUploading(false);
    }
  });

  dialog.showModal();
}
