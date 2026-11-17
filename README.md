# A Sound Peace: frontend

This is the static site for *A Sound Peace*. Participants record short voice clips, which are sent to the [backend](../backend) and stored in Google Cloud Storage. There is no framework and no build tooling: plain HTML, CSS and ES modules in `public/`.

## Participant flow

1. **`/`** shows the title, byline, synopsis and **Begin**.
2. **`/chaos`**: the participant records clips of up to 5 s each. They can play the clips back or delete them, then press **Upload** and accept the consent dialog.
3. **`/harmony`**: the participant records one clip of up to 5 s. After uploading, a thank-you tile appears.

Clips stay in the browser until the participant confirms the upload.

Each visit can upload up to five chaos clips and one peace clip. Nothing is remembered between visits, so anyone can come back and go through both pages again.

## Layout

- `public/index.html`, `public/chaos/index.html`, `public/harmony/index.html`: the three pages. There is one folder per route so that `/chaos` works on any static host.
- `public/js/config.js`: the backend URL. It defaults to `http://localhost:3000`, and `npm run build` rewrites it.
- `public/js/audio.js`: microphone capture, WAV encoding, the record button, and the clip player with its timeline.
- `public/js/capture-processor.js`: the AudioWorklet that copies microphone samples on the audio thread.
- `public/js/upload.js`: the upload request, the consent dialog, and the backend wake-up ping. An upload is abandoned with an error if nothing is sent for 30 s, or if no answer arrives within 60 s of the last byte, so a stalled connection never leaves the dialog stuck. Retrying the same clips sends the same upload ID, so the backend doesn't store an upload twice when only its answer was lost.
- `public/js/chaos.js`, `public/js/harmony.js`, `public/js/landing.js`: the logic for each page.
- `scripts/write-config.mjs`: the build step that writes `config.js` from `API_BASE_URL`.

## Recording

Clips are raw 16-bit mono WAV at the device's sample rate, about 500 KB for a full-length clip.

- The browser's voice-call processing (noise suppression, echo cancellation and automatic gain) is turned off so that non-speech sound survives.
- The microphone opens when `/chaos` or `/harmony` loads, asking for permission if it doesn't have it yet. From then on the capture worklet keeps the last 6 s of audio in a rolling buffer, in memory only. Audio leaves that buffer only when a clip is recorded.
- A clip starts from the moment the button is pressed down, not when it's released, using the event's own timestamp, so a delay in handling the press costs no audio.
- A clip ends when Stop is pressed or 5 s after the press, plus 0.2 s. It also keeps 0.05 s from before the press, so a full-length clip is 5.25 s. These margins cover the time sound takes to travel from the microphone to the capture code. Without them, the first and last moments would be cut off.
- The first press can only start once the microphone is running, so if the permission prompt is still open, the clip starts when it's granted. The same applies if the browser held audio back until the first gesture on the page, which can happen when someone arrives directly on `/chaos` or `/harmony`.