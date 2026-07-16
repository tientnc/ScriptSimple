const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OUTPUT_LANGUAGES = Object.freeze({ en: 'English', vi: 'Vietnamese', es: 'Spanish', zh: 'Simplified Chinese', fr: 'French', ko: 'Korean' });

const schema = {
  name: 'prescription_guide', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      medicines: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string' }, strength: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            function: { type: 'string' }, directions: { type: 'string' }, sideEffects: { type: 'string' }, uncertainty: { type: 'string' }
          },
          required: ['name', 'strength', 'confidence', 'function', 'directions', 'sideEffects', 'uncertainty']
        }
      },
      notes: { type: 'string' }, disclaimer: { type: 'string' }
    },
    required: ['medicines', 'notes', 'disclaimer']
  }
};

export default async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const apiKey = Netlify.env.get('OPENROUTER_API_KEY');
  const model = Netlify.env.get('OPENROUTER_VISION_MODEL') || 'google/gemma-4-26b-a4b-it:free';
  if (!apiKey) return json(503, { error: 'Analysis is not configured yet. Add OPENROUTER_API_KEY, or use the sample guide.' });

  try {
    const { image, locale = 'en' } = await request.json();
    const language = OUTPUT_LANGUAGES[locale] || OUTPUT_LANGUAGES.en;
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(image || '')) return json(400, { error: 'A JPG, PNG, or WebP image is required.' });
    if (image.length > 14_000_000) return json(413, { error: 'The image is too large. Please use one under 10 MB.' });

    const prompt = `Read this prescription image, regardless of the language printed on it, and create a medicine guide in ${language}.

Safety rules:
- Transcribe only what is actually visible. Never invent a medicine name, strength, dose, frequency, duration, or route.
- If handwriting or text is ambiguous, preserve that uncertainty, set confidence to medium/low, and say exactly what must be verified.
- "directions" must primarily reflect the visible prescription. Do not add dosing advice from general knowledge.
- Give a short plain-language general function and a few common side effects plus only the most important urgent warning. Do not diagnose, recommend treatment, or claim the medicine is appropriate for the patient.
- Do not infer the patient's condition, age, identity, or medical history.
- If no medicine can be read reliably, return an empty medicines array and explain why in notes.
- Keep names as printed; write all explanatory prose in ${language}.
- The disclaimer must tell the reader to compare every item to the original and confirm it with a pharmacist or doctor before taking anything.`;

    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': request.headers.get('origin') || 'https://localhost' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image, detail: 'high' } }] }],
        temperature: 0.1,
        max_tokens: 2400,
        response_format: { type: 'json_schema', json_schema: schema }
      })
    });

    const response = await upstream.json();
    if (!upstream.ok) return json(upstream.status, { error: response?.error?.message || 'The AI provider rejected the request.' });
    const content = response?.choices?.[0]?.message?.content;
    if (!content) return json(502, { error: 'The AI provider returned an empty response.' });
    const guide = typeof content === 'string' ? JSON.parse(content) : content;
    if (!Array.isArray(guide.medicines)) throw new Error('Invalid response shape');
    return json(200, guide);
  } catch (error) {
    console.error('Prescription analysis failed:', error);
    return json(500, { error: 'We could not read that prescription safely. Try a clearer photo.' });
  }
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
