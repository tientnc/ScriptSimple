# ScriptSimple

ScriptSimple turns a prescription photo into a plain-language medicine guide. It is a mobile-first Netlify prototype with no frontend framework; a small build step copies the deployable frontend into `dist/`.

## Live deployment

- **App:** [https://scriptsimple.netlify.app](https://scriptsimple.netlify.app)
- **Hosting:** Netlify project `scriptsimple`
- **Production branch:** `main`
- **Frontend publish directory:** `dist/`
- **Serverless function:** `netlify/functions/analyze.mjs`

Netlify reads the build, function, security-header, and camera-permission settings from `netlify.toml`. When continuous deployment is connected, a push to `main` creates a production deployment at the same app URL.

## What works

- Live browser camera capture on desktop, tablet, and phone, plus file upload
- On-device checks for resolution, lighting, and likely blur
- English, Vietnamese, Spanish, Simplified Chinese, French, or Korean interface and output
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

## Accessibility controls

The header remains visible while the page scrolls. Four saved text-size choices are available: A−, A, A+, and A++. The interface uses Be Vietnam Pro for consistent Vietnamese diacritics such as ơ and ư; Vietnamese display headings use Noto Serif. On very narrow screens, the ScriptSimple wordmark condenses to its icon so all size controls remain available.

## Read-aloud behavior

ScriptSimple waits for the browser to load its available speech voices and selects an exact or same-language match for the chosen interface language. It does not deliberately fall back to an English voice for non-English text. If the device has no matching voice, the app explains that a language voice must be added in the device speech settings. Browser speech quality still depends on the voices installed or provided by that device.

A future production version could use a server-side text-to-speech service for consistent multilingual voices across devices, but that would add provider cost, network use, and another service that receives the generated medicine-guide text.

## Camera behavior

**Take a photo** opens a live browser camera window and captures a JPEG directly into the photo-review step. The browser may ask for camera permission the first time. If more than one camera is available, ScriptSimple shows a **Switch camera** button. **Upload image** always remains available as a fallback.

For security, browsers only expose webcams on HTTPS pages or on `localhost`/`127.0.0.1`. If Windows is viewing this Linux server through a forwarded localhost port, the Windows browser can use the Windows webcam. A plain URL such as `http://192.168.x.x:8899` cannot open the camera; use a localhost port forward, Netlify Dev on localhost, or an HTTPS deployment.

## Languages

The language selector controls both:

1. The major interface text, including capture instructions, photo-quality feedback, safety warnings, result labels, errors, and downloaded guides.
2. The language requested from the AI for functions, directions, side effects, uncertainty notes, and other explanatory prose.

The prescription itself may be written in a different language. Medicine names remain as printed so the user can compare them with the original.

The initial supported interface/output languages are English, Vietnamese, Spanish, Simplified Chinese, French, and Korean. The browser language is used on first visit when supported, and the user's choice is saved locally.

Translations live in `i18n.js` as stable message keys. HTML uses `data-i18n` attributes, while dynamic JavaScript calls `t("messageKey")`. This is the same basic pattern used by larger applications, although they often split each locale into a separate JSON file and use a library such as FormatJS or i18next once pluralization, dates, and many contributors make that worthwhile.

To add a language:

1. Add its code and display name to `languages` in `i18n.js`.
2. Add a message dictionary, using English as the complete fallback.
3. Add the option to the selector in `index.html`.
4. Add the code-to-language-name mapping to `OUTPUT_LANGUAGES` in `netlify/functions/analyze.mjs`.
5. Have a fluent speaker review medical and safety wording before release.


## Deploy to Netlify

1. Link the Netlify `scriptsimple` project to the GitHub repository.
2. Set `OPENROUTER_API_KEY` in **Project configuration → Environment variables**.
3. Optionally set `OPENROUTER_VISION_MODEL` to another model whose OpenRouter metadata lists `image` as an input modality.
4. Push to `main`. Netlify runs the build command in `netlify.toml`, publishes `dist/`, and deploys the configured function.

Do not put an API key in `app.js`: browser code is public.

## AI model

The default is `google/gemma-4-26b-a4b-it:free`. OpenRouter currently lists it as free, with image, text, and video input; text output; and structured-output support. Free-model availability and rate limits can change, so `OPENROUTER_VISION_MODEL` remains configurable.

## Safety and privacy boundaries

This is an educational aid, not a medication decision-maker. The prompt prevents the model from inventing dosing instructions, calls out unclear text, and asks the user to verify every item with a pharmacist or doctor. A production version should additionally include authentication or abuse controls, request-size/rate limits, a formal privacy policy and retention agreement with the AI provider, accessibility testing, adversarial evaluation on real prescription formats, and clinical/legal review before public use.

Prescription images can contain protected health information. “Not saved” here means the app does not intentionally persist the image; the configured AI provider still receives it for processing, so its current privacy and data-retention terms must be reviewed before real-world use.

## Contact

Tien Nguyen — [tien.nguyenc23@gmail.com](mailto:tien.nguyenc23@gmail.com)
