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
for (const f of ['lib.mjs', 'stats.mjs', 'paper.mjs']) copyFileSync(join(SRC, f), join(MOD, f));
// Fake gmgn-cli: FAKE_MODE=ratelimit -> 429 with a stated reset; otherwise a minimal `token info` answer.
writeFileSync(join(BIN, 'gmgn-cli'), `#!/usr/bin/env node
if (process.env.FAKE_MODE === 'ratelimit') { console.error('Error: 429 RATE_LIMIT ~7s remaining'); process.exit(1); }
process.stdout.write(JSON.stringify({ symbol: 'T', decimals: 6, liquidity: '80000', price: { price: '0.001' } }));
`);
chmodSync(join(BIN, 'gmgn-cli'), 0o755);
Object.assign(process.env, { PATH: BIN + ':' + process.env.PATH, GMGN_TIER: 'pro', GMGN_API_KEY: 'fake', TYPESAFE_API_KEY: '',
  LATENCY_S: '0', FAIL_RATE: '0', QUOTE_SOURCE: 'jupiter', FEE_PCT: '1', TIP_USD: '0.12' });
const imp = f => import(pathToFileURL(join(MOD, f)).href);
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
  const { gmgn, RateLimited } = await imp('lib.mjs');
  process.env.FAKE_MODE = 'ratelimit';
  assert.throws(() => gmgn(['token', 'info', '--address', 'X'], { ttlMs: 0 }), RateLimited);
  assert.throws(() => gmgn(['token', 'info', '--address', 'Y'], { ttlMs: 0 }), RateLimited);   // still cooling down: no new event
  delete process.env.FAKE_MODE;
  const ev = journalLines().filter(r => r.event === 'rate_limit_pause');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].waitS, 17, 'stated 7s + 10s margin');
});

if (failed) { console.log(`${failed} unit test(s) FAILED`); process.exit(1); }
