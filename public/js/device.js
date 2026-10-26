// Each browser gets a random, anonymous ID, stored together with a copy of its upload
// record. The backend keeps the authoritative record and enforces the limits; this copy
// lets pages skip ahead instantly instead of waiting on the server.
//
// localStorage "soundPeace.device" = { id, chaosUploads, harmonyUpload }

export const MAX_CHAOS_UPLOADS = 5;

const STORAGE_KEY = 'soundPeace.device';

// Used when storage is blocked (some private modes), so the ID at least holds for the page.
let fallback = null;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(device) {
  fallback = device;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
  } catch {
    // Storage blocked or full; the in-memory fallback still works for this page.
  }
}

// Returns { id, chaosUploads, harmonyUpload }, creating the ID on the first visit.
export function getDevice() {
  const saved = load();
  if (typeof saved?.id === 'string') {
    return {
      id: saved.id,
      chaosUploads: Number(saved.chaosUploads) || 0,
      harmonyUpload: saved.harmonyUpload === true,
    };
  }
  const device = { id: crypto.randomUUID(), chaosUploads: 0, harmonyUpload: false };
  store(device);
  return device;
}

// Replaces the local copy with the record the backend sent back.
export function saveUploadRecord({ chaosUploads, harmonyUpload }) {
  store({ ...getDevice(), chaosUploads, harmonyUpload });
}

// Where "Begin" should lead: straight to /harmony once all chaos clips are uploaded.
// (/harmony itself shows the thank-you if the peace clip is uploaded too.)
export function firstPage(device = getDevice()) {
  return device.chaosUploads < MAX_CHAOS_UPLOADS ? '/chaos' : '/harmony';
}
