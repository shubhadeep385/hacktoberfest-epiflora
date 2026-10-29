/**
 * Provider pre-flight check.  `npm run preflight`
 *
 * Run this before a live demo. It answers the only questions that matter on the
 * day: which providers actually respond, which models this key can see, and
 * whether the voice round trip works — without touching the UI.
 *
 * Never prints key material, only whether a key is present and what it returned.
 */

process.loadEnvFile('.env');

const PASS = '  ok  ';
const FAIL = ' fail ';
const SKIP = ' skip ';

function line(status: string, label: string, detail: string): void {
  console.log(`[${status}] ${label.padEnd(26)} ${detail}`);
}

import { syntheticDiseasedLeaf } from './lib/testImage.ts';

async function checkGemini(image: string | null): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return line(SKIP, 'Gemini', 'no GEMINI_API_KEY set');

  try {
    const listed = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': key },
    });
    if (!listed.ok) {
      const body = (await listed.json().catch(() => null)) as { error?: { message?: string } } | null;
      return line(FAIL, 'Gemini auth', `${listed.status} ${body?.error?.message?.slice(0, 90) ?? ''}`);
    }

    const body = (await listed.json()) as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
    };
    const available = new Set(
      (body.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => m.name.replace('models/', '')),
    );
    line(PASS, 'Gemini auth', `${available.size} models support generateContent`);

    // Does every model in our configured chain actually exist for this key?
    const chain = (process.env.AI_MODEL_CHAIN ?? '').split(',').map((m) => m.trim()).filter(Boolean);
    for (const model of chain) {
      line(available.has(model) ? PASS : FAIL, `  chain: ${model}`, available.has(model) ? 'available' : 'NOT available to this key');
    }

    if (!image) return line(SKIP, 'Gemini vision', 'test image unavailable');

    const { GeminiProvider } = await import('../server/providers/intelligence/gemini.ts');
    const { diagnose } = await import('./lib/tasks.ts');
    const startedAt = Date.now();
    const result = await diagnose(new GeminiProvider(), image);

    line(PASS, 'Gemini vision', `${result.model} in ${Date.now() - startedAt}ms`);
    console.log(`        diagnosis: ${result.data.diagnosis}`);
    console.log(
      `        quality: ${result.data.imageQuality} · confidence: ${result.data.confidence} · severity: ${result.data.severity}`,
    );
    console.log(`        organic: ${result.data.organicRemedies[0] ?? '—'}`);
    console.log(`        chemical: ${result.data.chemicalOptions[0] ?? '(none offered)'}`);
  } catch (cause) {
    line(FAIL, 'Gemini vision', cause instanceof Error ? cause.message.slice(0, 140) : String(cause));
  }
}

async function checkOpenRouter(image: string | null): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return line(SKIP, 'OpenRouter', 'no OPENROUTER_API_KEY set');

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) return line(FAIL, 'OpenRouter auth', `HTTP ${response.status}`);

    const body = (await response.json()) as {
      data?: Array<{ id: string; architecture?: { input_modalities?: string[] } }>;
    };
    const free = (body.data ?? []).filter((m) => m.id.endsWith(':free'));
    const freeVision = free.filter((m) => m.architecture?.input_modalities?.includes('image'));

    line(PASS, 'OpenRouter auth', `${free.length} free models, ${freeVision.length} accept images`);
    for (const model of freeVision.slice(0, 5)) {
      console.log(`        ${model.id}  [${model.architecture?.input_modalities?.join(',')}]`);
    }

    if (!image) return line(SKIP, 'OpenRouter vision', 'test image unavailable');

    const { OpenRouterProvider } = await import('../server/providers/intelligence/openrouter.ts');
    const { diagnose } = await import('./lib/tasks.ts');
    const startedAt = Date.now();
    const result = await diagnose(new OpenRouterProvider(), image);
    line(PASS, 'OpenRouter vision', `${result.model} in ${Date.now() - startedAt}ms`);
    console.log(`        diagnosis: ${result.data.diagnosis} (quality ${result.data.imageQuality})`);
  } catch (cause) {
    line(FAIL, 'OpenRouter vision', cause instanceof Error ? cause.message.slice(0, 140) : String(cause));
  }
}

async function checkSarvam(): Promise<void> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return line(SKIP, 'Sarvam', 'no SARVAM_API_KEY set');

  // TTS is the cheapest way to prove auth and get audio we can feed back to STT.
  let audioBase64: string | null = null;
  try {
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'आपकी गेहूं की फसल में नमी के कारण जोखिम है।',
        target_language_code: 'hi-IN',
        model: process.env.SARVAM_TTS_MODEL ?? 'bulbul:v3',
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      line(FAIL, 'Sarvam TTS', `HTTP ${response.status} ${raw.slice(0, 120)}`);
    } else {
      const body = JSON.parse(raw) as { audios?: string[] };
      audioBase64 = body.audios?.[0] ?? null;
      line(
        audioBase64 ? PASS : FAIL,
        'Sarvam TTS',
        audioBase64 ? `bulbul returned ${Math.round(audioBase64.length * 0.75 / 1024)}KB of audio` : 'no audio in response',
      );
    }
  } catch (cause) {
    line(FAIL, 'Sarvam TTS', cause instanceof Error ? cause.message.slice(0, 140) : String(cause));
  }

  if (!audioBase64) return line(SKIP, 'Sarvam STT', 'no audio to transcribe');

  // Round trip: feed Bulbul's own output back through Saaras.
  try {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audioBase64, 'base64')], { type: 'audio/wav' }), 'probe.wav');
    form.append('model', process.env.SARVAM_STT_MODEL ?? 'saaras:v3');
    form.append('mode', process.env.SARVAM_STT_MODE ?? 'codemix');

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': key },
      body: form,
    });

    const raw = await response.text();
    if (!response.ok) return line(FAIL, 'Sarvam STT', `HTTP ${response.status} ${raw.slice(0, 120)}`);

    const body = JSON.parse(raw) as {
      transcript?: string;
      language_code?: string;
      language_probability?: number;
    };
    line(PASS, 'Sarvam STT', `${body.language_code ?? 'unknown'} p=${body.language_probability ?? 'n/a'}`);
    console.log(`        transcript: ${body.transcript}`);
  } catch (cause) {
    line(FAIL, 'Sarvam STT', cause instanceof Error ? cause.message.slice(0, 140) : String(cause));
  }
}

async function checkOpenMeteo(): Promise<void> {
  try {
    const url = new URL('/v1/forecast', process.env.OPEN_METEO_BASE_URL ?? 'https://api.open-meteo.com');
    url.searchParams.set('latitude', '18.52');
    url.searchParams.set('longitude', '73.86');
    url.searchParams.set('current', 'temperature_2m,relative_humidity_2m');
    const response = await fetch(url);
    if (!response.ok) return line(FAIL, 'Open-Meteo', `HTTP ${response.status}`);
    const body = (await response.json()) as {
      current?: { temperature_2m?: number; relative_humidity_2m?: number };
    };
    line(
      PASS,
      'Open-Meteo (keyless)',
      `Pune ${body.current?.temperature_2m}°C, ${body.current?.relative_humidity_2m}% humidity`,
    );
  } catch (cause) {
    line(FAIL, 'Open-Meteo', cause instanceof Error ? cause.message.slice(0, 140) : String(cause));
  }
}

async function checkOllama(): Promise<void> {
  const base = process.env.OLLAMA_BASE_URL;
  if (!base) return line(SKIP, 'Ollama', 'no OLLAMA_BASE_URL set');
  try {
    const response = await fetch(new URL('/api/tags', base), { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return line(SKIP, 'Ollama', `not running (HTTP ${response.status})`);
    const body = (await response.json()) as { models?: Array<{ name: string }> };
    const names = (body.models ?? []).map((m) => m.name);
    line(names.length > 0 ? PASS : SKIP, 'Ollama (local)', names.length > 0 ? names.join(', ') : 'running, no models pulled');
  } catch {
    line(SKIP, 'Ollama (local)', 'not running — cloud providers will be used');
  }
}

const leaf = syntheticDiseasedLeaf();
const image = leaf.dataUrl;
line(PASS, 'Test image', `${Math.round(leaf.bytes / 1024)}KB synthetic lesioned leaf (offline)`);

await checkGemini(image);
await checkOpenRouter(image);
await checkSarvam();
await checkOpenMeteo();
await checkOllama();
