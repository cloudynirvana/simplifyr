#!/usr/bin/env node
// Replay scenarios on REAL 1m candles (GMGN, fetched once 2026-10-05, stored in test/fixtures/; NO network here).
// Two run-4 shadow signals that run 4 killed as phase_dead within 1-2 minutes of signalling:
//   HUMAN   DCPHkFepQeetS5pytaDgkcktQ5M8XL4y2v3dojkWpump  signal 03:09:43 BST, killed 03:11:02 (volRatio 0.0002 in the journal)
//   JETPACK 37vV3bR2ewPZL9CWPn3atGWao3qLD3uUkYAxpLqJpump  signal 04:04:42 BST, killed 04:05:18 (volRatio 0.08 in the journal)
// What these pin down for the run-5 phase code (dynamics.mjs @ ac479ee): completed candles only, 3-min vs 20-min volume,
// PHASE_CONFIRM=3 consecutive bad readings. Order flow is NOT in candles, so flow is neutral (buyRatio 0.5) and vol5m comes
// from candle USD volume; the watchlist cadence is 36s (the gap between the two run-4 JETPACK readings).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { klineFeatures, phase, BAD_PHASES } from '../dynamics.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const load = f => JSON.parse(readFileSync(join(DIR, 'fixtures', f), 'utf8')).map(c => ({ ...c, t: Number(c.time) / 1000 }));
const view = (C, t) => C.filter(c => c.t > t - 3600 && c.t <= t);                       // what `market kline --from t-3600 --to t` returns
const vol5 = (C, t) => C.filter(c => c.t > t - 300 && c.t <= t).reduce((s, c) => s + (c.t > t - 60 ? Number(c.volume) * (t - c.t) / 60 : Number(c.volume)), 0);
const px = (C, t) => { const c = view(C, t).at(-1), f = Math.min(1, (t - c.t) / 60); return Number(c.open) + (Number(c.close) - Number(c.open)) * f; };
const ph = (C, t) => phase(klineFeatures(view(C, t), t), { vol5mUsd: vol5(C, t), buyRatio5m: 0.5, buyRatio1m: 0.5, volAccel: 1 });
// Watch a token like bot.mjs watchlist(): kill on PHASE_CONFIRM consecutive bad readings; ENTRY_MODE=pullback trigger p <= peak*0.85
function watch(C, sig, sigPx, { cad = 36, confirm = 3, noEntry = false } = {}) {
  let bad = 0, peak = sigPx;
  for (let t = sig; t <= sig + 7200; t += cad) {
    const p = px(C, t); peak = Math.max(peak, p);
    const f = ph(C, t);
    if (BAD_PHASES.includes(f)) { if (++bad >= confirm) return { killed: t, phase: f }; continue; }
    bad = 0;
    if (!noEntry && p <= peak * 0.85) return { entry: t, p, peak };
  }
  return { expired: true };
}
const H = load('human-DCPHkF-1m.json'), J = load('jetpack-37vV3b-1m.json');
const HUMAN = { sig: 1791166183, px: 0.00010382883, kill: 1791166262 }, JET = { sig: 1791169482, px: 0.00010304589, kill: 1791169518 };

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } };

test('replay HUMAN: run-4 style reading (forming candle 2s old counted) is dead; run-5 reading at the same moment is not', () => {
  // run-4 formula: forming candle's volume (2s of 60, linear) / mean of the previous 20 candles (V = amount, as run 4 did)
  const t = HUMAN.kill, V = view(H, t).map(c => Number(c.amount)), last = V.at(-1) * 2 / 60;
  const oldRatio = last / (V.slice(-21, -1).reduce((a, b) => a + b, 0) / 20);
  assert.ok(oldRatio < 0.15, 'old volRatio ' + oldRatio);
  assert.ok(!BAD_PHASES.includes(ph(H, t)), 'run-5 phase ' + ph(H, t));
});
test('replay JETPACK: run-5 phase at the run-4 kill time (04:05:18) is not a bad phase', () => {
  assert.ok(!BAD_PHASES.includes(ph(J, JET.kill)), 'run-5 phase ' + ph(J, JET.kill));
});
test('replay JETPACK: run 5 keeps it on watch and the 15% pullback trigger fires at 04:07:42 BST', () => {
  const r = watch(J, JET.sig, JET.px);
  assert.equal(r.entry, 1791169662, JSON.stringify(r));
});
test('replay JETPACK: never 3 consecutive bad readings in the 2h watch window (2 max)', () => {
  const r = watch(J, JET.sig, JET.px, { noEntry: true });                                         // huge peak: trigger can't fire, watch the full 2h
  assert.ok(r.expired, JSON.stringify(r));
});
test('replay HUMAN: run 5 keeps it on watch and the 15% pullback trigger fires (03:15 BST)', () => {
  const r = watch(H, HUMAN.sig, HUMAN.px);
  assert.ok(r.entry >= 1791166500 && r.entry <= 1791166560, JSON.stringify(r));
});
test('replay HUMAN: if never entered, run 5 removes it as breakdown ~03:48 BST (real decline, 3 readings)', () => {
  const r = watch(H, HUMAN.sig, HUMAN.px, { noEntry: true });
  assert.equal(r.phase, 'breakdown'); assert.ok(r.killed >= 1791168400 && r.killed <= 1791168600, JSON.stringify(r));
});
test('replay HUMAN: with PHASE_CONFIRM=1 (run-4 behaviour) the first bad reading would kill it sooner', () => {
  const r = watch(H, HUMAN.sig, HUMAN.px, { confirm: 1, noEntry: true });
  assert.ok(r.killed < 1791168400, JSON.stringify(r));
});
process.exit(failed ? 1 : 0);
