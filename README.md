# A Sound Peace: frontend

This is the static site for *A Sound Peace*. Participants record short voice clips, which are sent to the [backend](../backend) and stored in Google Cloud Storage. There is no framework and no build tooling: plain HTML, CSS and ES modules in `public/`.

## Participant flow

1. **`/`** shows the title, byline, synopsis and **Begin**.
2. **`/chaos`**: the participant records clips of up to 5 s each. They can play the clips back or delete them, then press **Upload** and accept the consent dialog.
3. **`/harmony`**: the participant records one clip of up to 5 s. After uploading, a thank-you tile appears.

Clips stay in the browser until the participant confirms the upload.

Each device can upload five chaos clips and one peace clip in total. The browser stores a random ID and its upload record in `localStorage` under `soundPeace.device`, as `{ id, chaosUploads, harmonyUpload }`.
- `/chaos` offers only the clips that are left ("up to three clips"). Once all five have been uploaded, Begin goes straight to `/harmony`, and visiting `/chaos` redirects there.
- Once the peace clip is uploaded, `/harmony` shows the thank-you tile straight away.
- The backend enforces the limits, and every upload response brings back its record. That keeps the local copy in sync even if another tab has uploaded in the meantime.

## Layout

- `public/index.html`, `public/chaos/index.html`, `public/harmony/index.html`: the three pages. There is one folder per route so that `/chaos` works on any static host.
- `public/js/config.js`: the backend URL. It defaults to `http://localhost:3000`, and `npm run build` rewrites it.
- `public/js/audio.js`: microphone capture, WAV encoding, the record button, and the clip player with its timeline.
- `public/js/capture-processor.js`: the AudioWorklet that copies microphone samples on the audio thread.
- `public/js/device.js`: the random device ID and the local copy of its upload record.
- `public/js/upload.js`: the upload request, the consent dialog, and the backend wake-up ping.
- `public/js/chaos.js`, `public/js/harmony.js`, `public/js/landing.js`: the logic for each page.
- `scripts/write-config.mjs`: the build step that writes `config.js` from `API_BASE_URL`.

## Recording

Clips are raw 16-bit mono WAV at the device's sample rate, about 480 KB for 5 s.

- The browser's voice-call processing (noise suppression, echo cancellation and automatic gain) is turned off so that non-speech sound survives.
- The microphone opens once per page, so Record starts capturing immediately.
- Capture stops at exactly 5 s.