#!/usr/bin/env node
// Offline unit tests (plain node asserts, NO network, NO API key, NO real orders).
// Modules under test are copied into a temp dir so the real journal.jsonl / state.json are never touched.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'bot-unit-')), MOD = join(TMP, 'trading'), BIN = join(TMP, 'bin');
mkdirSync(MOD); mkdirSync(BIN);
for (const f of ['lib.mjs', 'stats.mjs', 'paper.mjs', 'dynamics.mjs']) copyFileSync(join(SRC, f), join(MOD, f));
// Fake gmgn-cli: FAKE_MODE=ratelimit -> 429 with a stated reset; otherwise a minimal `token info` answer.
writeFileSync(join(BIN, 'gmgn-cli'), `#!/usr/bin/env node
if (process.env.FAKE_MODE === 'ratelimit') { console.error('Error: 429 RATE_LIMIT ~7s remaining'); process.exit(1); }
process.stdout.write(JSON.stringify({ symbol: 'T', decimals: 6, liquidity: '80000', price: { price: '0.001' } }));
`);
chmodSync(join(BIN, 'gmgn-cli'), 0o755);
Object.assign(process.env, { PATH: BIN + ':' + process.env.PATH, GMGN_TIER: 'pro', GMGN_API_KEY: 'fake', TYPESAFE_API_KEY: '',
  LATENCY_S: '0', FAIL_RATE: '0', QUOTE_SOURCE: 'jupiter', FEE_PCT: '1', TIP_USD: '0.12' });
const imp = (f, tag = '') => import(pathToFileURL(join(MOD, f)).href + tag);   // tag => separate module instance (own cooldown state)
const journalLines = () => existsSync(join(MOD, 'journal.jsonl')) ? readFileSync(join(MOD, 'journal.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

let failed = 0;
async function test(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e.message ?? e)); } }

// ---- report counters -------------------------------------------------------------------------------------------------
await test('stats reports kline_error, source_error, suspect_tick and rate_limit_pause counts', async () => {
  const { computeStats } = await imp('stats.mjs');
  const j = [{ event: 'start', ts: 1 }, { event: 'kline_error' }, { event: 'kline_error' }, { event: 'source_error' },
    { event: 'suspect_tick' }, { event: 'suspect_tick' }, { event: 'suspect_tick' },
    { event: 'rate_limit_pause', waitS: 17 }, { event: 'rate_limit_pause', waitS: 70 }, { event: 'reject' }];
  const s = computeStats(j);
  assert.deepEqual(s.counters, { kline_error: 2, source_error: 1, suspect_tick: 3, rate_limit_pause: 2 });
  assert.equal(s.klineErrors, 2, 'legacy klineErrors field kept');
  assert.deepEqual(computeStats([]).counters, { kline_error: 0, source_error: 0, suspect_tick: 0, rate_limit_pause: 0 });
});

await test('gmgn() journals ONE rate_limit_pause per 429 (not for cooldown re-throws)', async () => {
  const { gmgn, RateLimited } = await imp('lib.mjs', '?isolated');
  process.env.FAKE_MODE = 'ratelimit';
  assert.throws(() => gmgn(['token', 'info', '--address', 'X'], { ttlMs: 0 }), RateLimited);
  assert.throws(() => gmgn(['token', 'info', '--address', 'Y'], { ttlMs: 0 }), RateLimited);   // still cooling down: no new event
  delete process.env.FAKE_MODE;
  const ev = journalLines().filter(r => r.event === 'rate_limit_pause');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].waitS, 17, 'stated 7s + 10s margin');
});

await test('shadow:loose trades never reach the headline numbers (only byStrategy)', async () => {
  const { computeStats } = await imp('stats.mjs');
  const close = (strategy, shadow, pnlUsd) => ({ event: 'close', ts: 1, strategy, shadow, pnlUsd, pnlPct: pnlUsd * 10, costsUsd: 0.7, holdS: 600, reason: 'x', peakX: 1.1 });
  const s = computeStats([close('cluster', null, -1), close('shadow:loose', 'loose', 50), close('shadow:loose', 'loose', 50)]);
  assert.equal(s.trades, 1); assert.equal(s.totalPnlUsd, -1); assert.equal(s.profitFactor, 0);
  assert.equal(s.byStrategy['shadow:loose'].n, 2); assert.equal(s.byStrategy['cluster'].n, 1);
});

// ---- Jupiter / SOL price hardening (paper.mjs) ---------------------------------------------------------------------
const realFetch = globalThis.fetch, realSetTimeout = globalThis.setTimeout;
function mockNet({ quotes, price }) {                       // quotes: array of responders consumed in order (last one repeats)
  const calls = { quote: 0, price: 0 };
  globalThis.fetch = async url => {
    if (String(url).includes('/price/')) { calls.price++; const r = price(calls.price); if (r instanceof Error) throw r; return r; }
    const r = quotes[Math.min(calls.quote++, quotes.length - 1)]; if (r instanceof Error) throw r; return r;
  };
  globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, 0, ...a);   // no real backoff waits
  return calls;
}
const restoreNet = () => { globalThis.fetch = realFetch; globalThis.setTimeout = realSetTimeout; };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const SOLP = () => res(200, { So11111111111111111111111111111111111111112: { usdPrice: 100 } });
const BUY = { side: 'buy', token: 'TESTtokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApump', usd: 10 };

await test('Jupiter quote retries 5xx and network errors, then fills', async () => {
  const { paperFill } = await imp('paper.mjs');
  const calls = mockNet({ quotes: [res(503, {}), new Error('ECONNRESET'), res(200, { outAmount: '5000000', priceImpactPct: '0.01' })], price: SOLP });
  try { const r = await paperFill(BUY, 'sol'); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.src, 'jupiter'); assert.equal(calls.quote, 3); }
  finally { restoreNet(); }
});

await test('Jupiter quote gives up after bounded retries (no_route, no crash, no infinite loop)', async () => {
  const { paperFill } = await imp('paper.mjs');
  const calls = mockNet({ quotes: [res(500, {})], price: SOLP });
  try { const r = await paperFill(BUY, 'sol'); assert.equal(r.ok, false); assert.match(r.reason, /^no_route/); assert.equal(calls.quote, 4); }
  finally { restoreNet(); }
});

await test('Jupiter 4xx (e.g. no route) is NOT retried', async () => {
  const { paperFill } = await imp('paper.mjs');
  const calls = mockNet({ quotes: [res(400, { error: 'no route' })], price: SOLP });
  try { const r = await paperFill(BUY, 'sol'); assert.equal(r.ok, false); assert.equal(calls.quote, 1); }
  finally { restoreNet(); }
});

await test('SOL price: retries once on a bad answer, and a persistently bad price fails the fill (price_error)', async () => {
  const { paperFill } = await imp('paper.mjs');
  let calls = mockNet({ quotes: [res(200, { outAmount: '5000000', priceImpactPct: '0' })], price: n => (n === 1 ? res(200, {}) : SOLP()) });
  try { const r = await paperFill(BUY, 'sol'); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(calls.price, 2); } finally { restoreNet(); }
  calls = mockNet({ quotes: [res(200, { outAmount: '5000000' })], price: () => res(200, { So11111111111111111111111111111111111111112: { usdPrice: 0 } }) });
  try { const r = await paperFill(BUY, 'sol'); assert.equal(r.ok, false); assert.match(r.reason, /^price_error/); assert.equal(calls.price, 3); assert.equal(calls.quote, 0, 'never quote with a bad SOL price'); }
  finally { restoreNet(); }
});

// ---- wave-phase measurement (run-4 bug: in-progress candle read as 'dead') --------------------------------------------
const candleSeries = (asOf, vols) => vols.map((v, k) => ({ time: asOf - (vols.length - k + 1) * 60, open: '1', high: '1.01', low: '0.99', close: '1', volume: String(v), amount: String(v) }));
const FLOW_OK = { vol5mUsd: 50000, buyRatio5m: 0.5 };
await test('phase: a still-forming last candle (tiny partial volume) is dropped, steady token is NOT dead', async () => {
  const { klineFeatures, phase } = await imp('dynamics.mjs');
  const asOf = 1_800_000_000, list = candleSeries(asOf, Array(40).fill(1000));
  list.push({ time: asOf - 10, open: '1', high: '1', low: '1', close: '1', volume: '20', amount: '20' });   // started 10s ago
  const kf = klineFeatures(list, asOf);
  assert.ok(kf.volRatio > 0.9, 'volRatio ' + kf.volRatio); assert.notEqual(phase(kf, FLOW_OK), 'dead');
});
await test('phase: one quiet closed minute among steady ones is not dead (3-minute volume window)', async () => {
  const { klineFeatures, phase } = await imp('dynamics.mjs');
  const asOf = 1_800_000_000, kf = klineFeatures(candleSeries(asOf, [...Array(39).fill(1000), 50]), asOf);
  assert.notEqual(phase(kf, FLOW_OK), 'dead', 'volRatio ' + kf.volRatio);
});
await test('phase: genuinely dead volume (3 near-empty minutes) is still dead', async () => {
  const { klineFeatures, phase } = await imp('dynamics.mjs');
  const asOf = 1_800_000_000, kf = klineFeatures(candleSeries(asOf, [...Array(37).fill(1000), 20, 10, 5]), asOf);
  assert.equal(phase(kf, FLOW_OK), 'dead');
});

if (failed) { console.log(`${failed} unit test(s) FAILED`); process.exit(1); }
