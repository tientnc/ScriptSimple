# ScriptSimple

Turns a prescription photo into a plain-English medicine guide.

The interface and AI output default to English. Use the language selector to switch to Vietnamese, Spanish, Simplified Chinese, French, or Korean.


## Run locally

For the sample UI, run `python3 -m http.server 8899` and open `http://localhost:8899/scriptsimple/`.

For real analysis, copy `.env.example` to `.env`, add `GEMINI_API_KEY`, then run `netlify dev`.

The default is Gemini through Google AI Studio. Change `GEMINI_VISION_MODEL` in `.env` to test another compatible model locally. Never put an API key in browser code.

## Commands

- `npm test`
- `npm run build`

## API limits

The deployment uses one shared AI Studio key. Only one request is sent at a time from each browser tab. Requests may wait or be rejected when RPM, TPM, or RPD quota is reached. Provider 429 responses become a busy message; the app does not retry automatically.

A browser-only lock cannot enforce a project-wide daily limit across all visitors or serverless instances. Add a shared rate-limit store or gateway before heavy public use.

## Endpoints

- `POST /.netlify/functions/analyze`: English medicine guide.
- `POST /.netlify/functions/extract`: structured transcription for `/?flow=verify`.

Both accept one JPEG, PNG, or WebP data URL in `image`, reject decoded images over 4 MB, and return `Cache-Control: no-store`.

## Safety and privacy

ScriptSimple is an educational aid, not medical advice. Compare every result with the original prescription and confirm it with a pharmacist or doctor. The app does not intentionally store images, but Google receives them for processing.

## Source

[github.com/tientnc/ScriptSimple](https://github.com/tientnc/ScriptSimple)

Contact: [tien.nguyenc23@gmail.com](mailto:tien.nguyenc23@gmail.com)
