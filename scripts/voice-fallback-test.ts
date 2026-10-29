/**
 * Verifies the voice chain degrades instead of failing.
 *
 * Sarvam is pay-per-use after a small signup credit, so the realistic failure on
 * demo day is a spent balance mid-session. These cases check that speech still
 * works via Gemini audio, and that a missing voice falls back to the browser rather
 * than losing the answer.
 */

process.loadEnvFile('.env');

const realSarvam = process.env.SARVAM_API_KEY ?? '';

let failures = 0;

function report(ok: boolean, label: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`[${ok ? '  ok  ' : ' fail '}] ${label.padEnd(32)} ${detail}`);
}

/** Real spoken Hindi, produced while Sarvam credit is still available. */
async function makeAudio(): Promise<Buffer | null> {
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': realSarvam, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'मेरी टमाटर की फसल में पत्तियां मुड़ रही हैं, क्या समस्या है?',
      target_language_code: 'hi-IN',
      model: 'bulbul:v3',
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { audios?: string[] };
  return body.audios?.[0] ? Buffer.from(body.audios[0], 'base64') : null;
}

const audio = await makeAudio();
report(Boolean(audio), 'Test audio generated', audio ? `${Math.round((audio?.length ?? 0) / 1024)}KB` : 'Bulbul unavailable');
if (!audio) process.exit(1);

async function transcribeWith(label: string, mutate: () => void): Promise<void> {
  mutate();

  // Fresh module graph so the lazy env getters see the mutated values.
  const buster = `?v=${Date.now()}${Math.random()}`;
  const { voice } = await import(`../server/providers/voice/registry.ts${buster}`);

  const started = Date.now();
  try {
    const result = await voice.transcribe(
      { bytes: new Uint8Array(audio!), mimeType: 'audio/wav', filename: 'q.wav' },
      'hi-IN',
    );
    report(
      true,
      label,
      `${result.provenance.provider}/${result.provenance.model} · degraded=${result.provenance.degraded} · ${Date.now() - started}ms`,
    );
    console.log(`         heard: ${result.transcript.text.slice(0, 90)}`);
  } catch (cause) {
    report(false, label, cause instanceof Error ? cause.message.slice(0, 130) : String(cause));
  }
}

await transcribeWith('STT: Sarvam healthy', () => {
  process.env.SARVAM_API_KEY = realSarvam;
});

// The realistic failure: credit spent, so Gemini audio must take over.
await transcribeWith('STT: Sarvam credit gone', () => {
  process.env.SARVAM_API_KEY = '';
});

// ── TTS degradation ──────────────────────────────────────────────────────────
async function synthesizeWith(label: string, language: string, mutate: () => void): Promise<void> {
  mutate();
  const buster = `?v=${Date.now()}${Math.random()}`;
  const { voice } = await import(`../server/providers/voice/registry.ts${buster}`);

  const result = await voice.synthesize('आपकी फसल में फंगस का खतरा है।', language);
  const spoken = result.audio ? 'server audio' : result.useBrowserVoice ? 'browser voice' : 'nothing';
  report(Boolean(result.audio) || result.useBrowserVoice, label, spoken);
}

await synthesizeWith('TTS: Sarvam healthy (hi-IN)', 'hi-IN', () => {
  process.env.SARVAM_API_KEY = realSarvam;
});

// Saaras understands 23 languages, Bulbul speaks 11. Sanskrit has no voice.
await synthesizeWith('TTS: language with no voice', 'sa-IN', () => {
  process.env.SARVAM_API_KEY = realSarvam;
});

await synthesizeWith('TTS: Sarvam credit gone', 'hi-IN', () => {
  process.env.SARVAM_API_KEY = '';
});

console.log(failures === 0 ? '\nAll voice fallback checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
