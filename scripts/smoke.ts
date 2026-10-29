/**
 * End-to-end smoke test against a running dev server.  `npm run smoke`
 *
 * Exercises the real HTTP surface the SPA uses, including the Vite proxy, so it
 * catches wiring mistakes that unit-level checks miss.
 */

import { syntheticDiseasedLeaf } from './lib/testImage.ts';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:5173';

let failures = 0;

function report(ok: boolean, label: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`[${ok ? '  ok  ' : ' fail '}] ${label.padEnd(28)} ${detail}`);
}

/**
 * Waits for the API to be reachable before testing anything.
 *
 * Without this, a `tsx watch` restart mid-run makes the Vite proxy return its own
 * HTML 404, which surfaced as a phantom route failure. A test that cries wolf is
 * worse than no test.
 */
async function waitForApi(attempts = 20): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok && response.headers.get('content-type')?.includes('json')) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log('[ fail ] API never became ready — is `npm run dev` running?');
  process.exit(1);
}

await waitForApi();

async function get(path: string): Promise<[number, any]> {
  const response = await fetch(`${BASE}${path}`);
  return [response.status, await response.json().catch(() => null)];
}

async function post(path: string, body: unknown): Promise<[number, any]> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return [response.status, await response.json().catch(() => null)];
}

// ── health ───────────────────────────────────────────────────────────────────
{
  const [status, body] = await get('/api/health');
  report(status === 200 && body?.ok === true, 'GET /health', `configured: ${body?.intelligence?.filter((p: any) => p.configured).map((p: any) => p.id).join(', ')}`);
}

// ── geocoding ────────────────────────────────────────────────────────────────
let coords = { latitude: 18.52, longitude: 73.86, label: 'Pune' };
{
  const [status, body] = await get('/api/weather/search?q=Pune');
  const found = body?.location;
  report(status === 200 && Boolean(found), 'GET /weather/search', found ? `${found.label} (${found.countryCode})` : 'no result');
  if (found) coords = { latitude: found.latitude, longitude: found.longitude, label: found.label };
}

// ── reverse geocoding ────────────────────────────────────────────────────────
{
  const [status, body] = await get('/api/weather/reverse?latitude=18.52&longitude=73.86');
  const found = body?.location;
  report(status === 200 && Boolean(found?.label), 'GET /weather/reverse', found ? `${found.label}` : 'no result');
}

// ── auto location detection ──────────────────────────────────────────────────
{
  const [status, body] = await get('/api/weather/detect');
  const found = body?.location;
  report(status === 200 && Boolean(found?.latitude), 'GET /weather/detect', found ? `${found.label}` : 'no result');
}

// ── weather + deterministic risk ─────────────────────────────────────────────
{
  const [status, body] = await get(
    `/api/weather?latitude=${coords.latitude}&longitude=${coords.longitude}&label=${encodeURIComponent(coords.label)}`,
  );
  const w = body?.weather;
  const r = body?.risk;
  report(
    status === 200 && w?.forecast?.length === 7,
    'GET /weather',
    w ? `${w.now.temperatureC}°C, ${w.now.humidityPct}% · ${w.forecast?.length} days · fungal risk ${r?.fungal}` : 'no data',
  );
  if (r) console.log(`        irrigation: ${r.irrigationHint}`);
}

// ── weather validation ───────────────────────────────────────────────────────
{
  const [status, body] = await get('/api/weather?latitude=999&longitude=0');
  report(status === 400 && body?.error?.code === 'invalid_request', 'GET /weather (bad coords)', `${status} ${body?.error?.code}`);
}

// ── AI advisory ──────────────────────────────────────────────────────────────
{
  const started = Date.now();
  const [status, body] = await post('/api/ai/advisory', {
    ...coords,
    crop: 'Wheat',
    growthStage: 'flowering',
    language: 'en-IN',
  });
  const a = body?.advisory;
  report(
    status === 200 && Boolean(a?.summary) && a?.days?.length > 0,
    'POST /ai/advisory',
    a ? `${body.provenance?.model} · ${a.days.length} days · risk ${a.diseaseRisk} · ${Date.now() - started}ms` : `${status} ${body?.error?.code}`,
  );
  if (a) {
    console.log(`        summary: ${a.summary.slice(0, 150)}`);
    for (const day of a.days.slice(0, 3)) {
      console.log(`        ${day.date}: ${day.headline} — ${day.detail.slice(0, 90)}`);
    }
    console.log(`        irrigation: ${a.irrigationGuidance.slice(0, 130)}`);
    console.log(`        regenerative: ${a.regenerativePractices[0] ?? '—'}`);
  }
}

// ── soil advisory ────────────────────────────────────────────────────────────
{
  const started = Date.now();
  const [status, body] = await post('/api/ai/soil', {
    soilType: 'black',
    ph: 8.9,
    nitrogen: 'medium',
    phosphorus: 'high',
    potassium: 'low',
    moisturePct: 42,
    organicCarbonPct: 0.4,
    crop: 'Cotton',
    language: 'en-IN',
  });

  const s = body?.soil;
  const a = body?.assessment;
  report(
    status === 200 && Boolean(s?.summary),
    'POST /ai/soil',
    s ? `limiting: ${s.limitingFactor} · pH band: ${a?.phBand} · ${Date.now() - started}ms` : `${status} ${body?.error?.code}`,
  );
  if (s) {
    console.log(`        action: ${s.recommendations[0] ?? '—'}`);
    console.log(`        caution: ${s.cautions[0] ?? '—'}`);
    // Potassium is the only 'low' value, so it must be the identified limitation.
    report(/potassium/i.test(s.limitingFactor ?? ''), '  limiting factor correct', s.limitingFactor);
    // Deterministic pH banding must not drift.
    report(a?.phBand === 'strongly alkaline', '  pH banded deterministically', String(a?.phBand));
    const dosage = [...s.recommendations, ...s.cautions].some((t: string) => /\d\s*(kg|g|ml|l)\b/i.test(t));
    report(!dosage, '  no dosages leaked', dosage ? 'FOUND A DOSAGE' : 'clean');
  }
}

// ── soil validation: empty submission is rejected ────────────────────────────
{
  const [status, body] = await post('/api/ai/soil', { soilType: 'unknown' });
  report(status === 400 && body?.error?.code === 'invalid_request', 'POST /ai/soil (no values)', `${status} ${body?.error?.code}`);
}

// ── crop diagnosis, full chain ───────────────────────────────────────────────
{
  const leaf = syntheticDiseasedLeaf();
  const started = Date.now();
  const [status, body] = await post('/api/ai/diagnose', {
    image: leaf.dataUrl,
    crop: 'Tomato',
    symptoms: 'dark concentric spots on lower leaves after rain',
    language: 'en-IN',
  });
  const d = body?.diagnosis;
  report(
    status === 200 && Boolean(d?.diagnosis),
    'POST /ai/diagnose',
    d ? `${d.diagnosis} · ${d.confidence}% · ${body.provenance?.model} · ${Date.now() - started}ms` : `${status} ${body?.error?.code}`,
  );
  if (d) {
    console.log(`        severity: ${d.severity} · quality: ${d.imageQuality}`);
    console.log(`        action: ${d.recommendations[0] ?? '—'}`);
    console.log(`        organic: ${d.organicRemedies[0] ?? '—'}`);
    console.log(`        chemical: ${d.chemicalOptions[0] ?? '(none)'}`);
    const dosage = d.chemicalOptions.some((o: string) => /\d\s*(ml|g|kg|l)\b/i.test(o));
    report(!dosage, '  no dosages leaked', dosage ? 'FOUND A DOSAGE' : 'clean');
  }

  // Second identical call must be served from cache at zero provider cost.
  const [, cachedBody] = await post('/api/ai/diagnose', {
    image: leaf.dataUrl,
    crop: 'Tomato',
    symptoms: 'dark concentric spots on lower leaves after rain',
    language: 'en-IN',
  });
  report(cachedBody?.provenance?.cached === true, '  cache hit on repeat', `cached=${cachedBody?.provenance?.cached}`);
}

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
