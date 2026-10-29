/**
 * Voice pipeline test.  `npm run voice:test`
 *
 * Generates a real spoken Hindi question with Bulbul, then posts it to
 * /api/voice/ask exactly as the browser will. That exercises the whole chain —
 * multipart upload, Saaras transcription, language detection, weather context
 * injection, agricultural reasoning, and Bulbul speaking the answer back.
 *
 * Requires a running dev server.
 */

process.loadEnvFile('.env');

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:5173';
const SARVAM_KEY = process.env.SARVAM_API_KEY ?? '';

let failures = 0;

function report(ok: boolean, label: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`[${ok ? '  ok  ' : ' fail '}] ${label.padEnd(30)} ${detail}`);
}

/** Uses Bulbul to produce realistic spoken input for Saaras to transcribe. */
async function speak(text: string, language: string): Promise<Buffer | null> {
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': SARVAM_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, target_language_code: language, model: 'bulbul:v3' }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { audios?: string[] };
  const audio = body.audios?.[0];
  return audio ? Buffer.from(audio, 'base64') : null;
}

const PUNE = { latitude: 18.5204, longitude: 73.8567, locationLabel: 'Pune, Maharashtra' };

// ── 1. Spoken Hindi question, language explicitly selected ───────────────────
{
  const question = 'मेरी गेहूं की फसल की पत्तियां पीली हो रही हैं, मुझे क्या करना चाहिए?';
  const audio = await speak(question, 'hi-IN');
  report(Boolean(audio), 'Generated spoken question', audio ? `${Math.round(audio.length / 1024)}KB Hindi audio` : 'Bulbul failed');

  if (audio) {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'question.wav');
    form.append('language', 'hi-IN');
    form.append(
      'context',
      JSON.stringify({ crop: 'Wheat', growthStage: 'flowering', ...PUNE }),
    );

    const started = Date.now();
    const response = await fetch(`${BASE}/api/voice/ask`, { method: 'POST', body: form });
    const body = (await response.json()) as any;

    report(
      response.status === 200 && Boolean(body.answer),
      'POST /voice/ask (Hindi)',
      response.status === 200
        ? `${Date.now() - started}ms · stt=${body.provenance?.speech?.provider} · llm=${body.provenance?.intelligence?.model} · tts=${body.provenance?.tts?.provider ?? 'browser'}`
        : `${response.status} ${body?.error?.code}: ${body?.error?.message?.slice(0, 120)}`,
    );

    if (response.status === 200) {
      console.log(`        heard    : ${body.transcript?.text}`);
      console.log(`        answer   : ${body.answer?.slice(0, 260)}`);
      console.log(`        followUps: ${(body.followUps ?? []).join(' | ')}`);
      report(Boolean(body.audio), '  spoken reply returned', body.audio ? `${Math.round(body.audio.length * 0.75 / 1024)}KB audio` : 'none, browser fallback');

      // The answer must be speakable: no markdown artefacts.
      const hasMarkdown = /[*#`]|^\s*[-•]\s/m.test(body.answer ?? '');
      report(!hasMarkdown, '  answer is speakable', hasMarkdown ? 'contains markdown/bullets' : 'clean prose');

      // Devanagari present means it actually answered in Hindi.
      report(/[\u0900-\u097F]/.test(body.answer ?? ''), '  answered in Hindi', 'script check');
    }
  }
}

// ── 2. Code-mixed question with auto language detection ──────────────────────
{
  const question = 'मेरी tomato crop में leaves yellow हो रहे हैं, क्या यह disease है?';
  const audio = await speak(question, 'hi-IN');

  if (audio) {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'q.wav');
    // Deliberately no language field: exercises Saaras auto-detection.
    form.append('context', JSON.stringify({ crop: 'Tomato', ...PUNE }));

    const started = Date.now();
    const response = await fetch(`${BASE}/api/voice/ask`, { method: 'POST', body: form });
    const body = (await response.json()) as any;

    report(
      response.status === 200,
      'POST /voice/ask (code-mixed)',
      response.status === 200
        ? `detected ${body.transcript?.language} · ${Date.now() - started}ms`
        : `${response.status} ${body?.error?.code}`,
    );
    if (response.status === 200) {
      console.log(`        heard    : ${body.transcript?.text}`);
      console.log(`        answer   : ${body.answer?.slice(0, 200)}`);
    }
  }
}

// ── 3. FLAGSHIP: photo + spoken question together ────────────────────────────
{
  const { syntheticDiseasedLeaf } = await import('./lib/testImage.ts');
  const question = 'इस पौधे को क्या हुआ है और मुझे अभी क्या करना चाहिए?';
  const audio = await speak(question, 'hi-IN');

  if (audio) {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'q.wav');
    form.append('image', syntheticDiseasedLeaf().dataUrl);
    form.append('language', 'hi-IN');
    form.append('context', JSON.stringify({ crop: 'Tomato', ...PUNE }));

    const started = Date.now();
    const response = await fetch(`${BASE}/api/voice/ask`, { method: 'POST', body: form });
    const body = (await response.json()) as any;

    report(
      response.status === 200 && Boolean(body.answer),
      'POST /voice/ask (photo + voice)',
      response.status === 200
        ? `${Date.now() - started}ms · ${body.provenance?.intelligence?.model}`
        : `${response.status} ${body?.error?.code}: ${body?.error?.message?.slice(0, 120)}`,
    );

    if (response.status === 200) {
      console.log(`        heard    : ${body.transcript?.text}`);
      console.log(`        answer   : ${body.answer?.slice(0, 300)}`);
      report(Boolean(body.audio), '  answer spoken back', body.audio ? 'audio returned' : 'browser fallback');
      // The answer must show evidence it actually looked at the image.
      const describesLeaf = /पत्त|धब्ब|पीला|भूरा|फंगस|घाव|leaf|spot/i.test(body.answer ?? '');
      report(describesLeaf, '  references the photo', describesLeaf ? 'describes visible symptoms' : 'no visual detail');
    }
  }
}

// ── 4. Typed question — voice must never be the only way in ──────────────────
{
  const form = new FormData();
  form.append('question', 'Should I irrigate my wheat today?');
  form.append('language', 'en-IN');
  form.append('context', JSON.stringify({ crop: 'Wheat', growthStage: 'flowering', ...PUNE }));

  const response = await fetch(`${BASE}/api/voice/ask`, { method: 'POST', body: form });
  const body = (await response.json()) as any;

  report(response.status === 200 && Boolean(body.answer), 'POST /voice/ask (typed)', response.status === 200 ? 'answered without audio' : `${response.status} ${body?.error?.code}`);
  if (response.status === 200) {
    console.log(`        answer   : ${body.answer?.slice(0, 260)}`);
    // Weather context should make this answer reference real conditions.
    const usesWeather = /rain|humid|moist|irrigat|water/i.test(body.answer ?? '');
    report(usesWeather, '  used weather context', usesWeather ? 'references conditions' : 'generic answer');
  }
}

// ── 4. Off-topic guard ───────────────────────────────────────────────────────
{
  const form = new FormData();
  form.append('question', 'Who won the football World Cup in 2022?');
  form.append('language', 'en-IN');
  const response = await fetch(`${BASE}/api/voice/ask`, { method: 'POST', body: form });
  const body = (await response.json()) as any;
  report(response.status === 200 && body.offTopic === true, 'Off-topic question flagged', `offTopic=${body?.offTopic}`);
}

// ── 5. Empty request rejected ────────────────────────────────────────────────
{
  const response = await fetch(`${BASE}/api/voice/ask`, { method: 'POST', body: new FormData() });
  const body = (await response.json()) as any;
  report(response.status === 400 && body?.error?.code === 'invalid_request', 'Empty request rejected', `${response.status} ${body?.error?.code}`);
}

console.log(failures === 0 ? '\nAll voice checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
