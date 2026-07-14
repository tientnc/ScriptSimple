# ScriptSimple

ScriptSimple turns a prescription photo into a plain-language medicine guide. It is a mobile-first Netlify prototype with no frontend framework or build step.

## What works

- Phone camera capture and desktop/mobile file upload
- On-device checks for resolution, lighting, and likely blur
- English or Vietnamese output
- Structured medicine cards: name, function, visible directions, side effects, and uncertainty
- Copy, text download, and print-friendly output
- Built-in fictional sample, so the interface can be demonstrated without an API key
- Server-side API key handling through a Netlify Function; images are processed in memory and not intentionally stored

## Run locally

For the interface and sample mode, any static server works:

```bash
python3 -m http.server 8899
```

Then open `http://localhost:8899/scriptsimple/`.

If port 8899 is already in use, run `python3 -m http.server 9000` instead and open `http://localhost:9000/scriptsimple/`. Stop the server with `Ctrl+C`.

To analyze real images, install the Netlify CLI and run from this directory:

```bash
cp .env.example .env
# Add your real OPENROUTER_API_KEY to .env
netlify dev
```

## Deploy to Netlify

1. Create a new Netlify site from this local directory (or drag the folder into Netlify for a manual deploy).
2. Set `OPENROUTER_API_KEY` in **Site configuration → Environment variables**.
3. Optionally set `OPENROUTER_VISION_MODEL` to another model whose OpenRouter metadata lists `image` as an input modality.
4. Deploy. The publish directory is `.` and the function directory is already configured.

Do not put an API key in `app.js`: browser code is public.

## AI model

The default is `google/gemma-4-26b-a4b-it:free`. OpenRouter currently lists it as free, with image, text, and video input; text output; and structured-output support. Free-model availability and rate limits can change, so `OPENROUTER_VISION_MODEL` remains configurable.

## Why GPT-OSS-120B is not the default

OpenRouter currently describes GPT-OSS-120B as a `text → text` model. It cannot inspect the prescription image itself. A future two-stage version could run OCR/vision first and send only the transcription to GPT-OSS for rewriting, but one capable vision call is simpler and avoids compounding OCR errors in this prototype.

## Safety and privacy boundaries

This is an educational aid, not a medication decision-maker. The prompt prevents the model from inventing dosing instructions, calls out unclear text, and asks the user to verify every item with a pharmacist or doctor. A production version should additionally include authentication or abuse controls, request-size/rate limits, a formal privacy policy and retention agreement with the AI provider, accessibility testing, adversarial evaluation on real prescription formats, and clinical/legal review before public use.

Prescription images can contain protected health information. “Not saved” here means the app does not intentionally persist the image; the configured AI provider still receives it for processing, so its current privacy and data-retention terms must be reviewed before real-world use.
