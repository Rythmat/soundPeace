# A Sound Peace: frontend

This is the static site for *A Sound Peace*. Participants record short voice clips, which are sent to the [backend](../backend) and stored in Google Cloud Storage. There is no framework and no build tooling: plain HTML, CSS and ES modules in `public/`.

## Participant flow

1. **`/`** shows the title, byline, synopsis and **Begin**.
2. **`/chaos`**: the participant records up to five clips of up to 5 s each. They can play the clips back or delete them, then press **Upload** and accept the consent dialog.
3. **`/harmony`**: the participant records one clip of up to 5 s. After uploading, a thank-you tile appears.

Clips stay in the browser until the participant confirms the upload.

## Layout

- `public/index.html`, `public/chaos/index.html`, `public/harmony/index.html`: the three pages. There is one folder per route so that `/chaos` works on any static host.
- `public/js/config.js`: the backend URL. It defaults to `http://localhost:3000`, and `npm run build` rewrites it.
- `public/js/audio.js`: microphone capture, WAV encoding, the record button, and the clip player with its timeline.
- `public/js/capture-processor.js`: the AudioWorklet that copies microphone samples on the audio thread.
- `public/js/upload.js`: the upload request, the consent dialog, and the backend wake-up ping.
- `public/js/chaos.js`, `public/js/harmony.js`, `public/js/landing.js`: the logic for each page.
- `scripts/write-config.mjs`: the build step that writes `config.js` from `API_BASE_URL`.

## Recording

Clips are raw 16-bit mono WAV at the device's sample rate, about 480 KB for 5 s.

- The browser's voice-call processing (noise suppression, echo cancellation and automatic gain) is turned off so that non-speech sound survives.
- The microphone opens once per page, so Record starts capturing immediately.
- Capture stops at exactly 5 s.

## Local development

Start the backend first. It listens on `:3000` and allows `http://localhost:5173` by default. Then run:

```sh
npm run dev   # http://localhost:5173
```

Browsers only allow microphone access on `localhost` or over HTTPS.

## Deploy on Render (Static Site)

1. Push this folder to its own GitHub repo.
2. In Render, choose **New → Static Site** and pick the repo.
3. Use these settings:
   - **Build Command:** `npm run build`
   - **Publish Directory:** `public`
4. Under **Environment**, set `API_BASE_URL` to the backend's Render URL, for example `https://sound-peace-api.onrender.com`. If it's missing, the build fails on purpose.
5. Once the site has a URL, put that URL in the backend's `ALLOWED_ORIGINS`.

If the backend URL ever changes, update `API_BASE_URL` and redeploy the site. The value is written into `config.js` at build time.
