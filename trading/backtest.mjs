#!/usr/bin/env node
// REPLAY BACKTEST: turn everything the bot has already SEEN into evidence, in minutes instead of weeks.
// For each token in journal.jsonl (rejected, deferred, signalled, entered) fetch GMGN 1m candles from first sight to +6h
// (cached on disk), then replay entry rules x the exit ladder with a round-trip cost. Grouped by cohort (passed all gates,
// failed only one gate, failed several) and by source, so we see WHICH universe and WHICH entry has an edge after costs.
// Limits (be honest): candles only. No order flow, dev-wallet or liquidity exits; intra-candle order assumed worst case
// (stop before take-profit); fills at candle prices +-cost. Treat as a ranking tool, then confirm forward in paper.
// Usage: GMGN_TIER=pro node trading/backtest.mjs [maxTokens]     env: COST_PCT (default 5), CHAIN
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gmgn, readJournal, RateLimited, rateLimitWaitMs } from './lib.mjs';
import { klineFeatures, phase } from './dynamics.mjs';

const CHAIN = process.env.CHAIN ?? 'sol', COST = Number(process.env.COST_PCT ?? 5) / 100;
const MAX = Number(process.argv[2] ?? 3000), CACHE = new URL('./cache/klines/', import.meta.url).pathname;
mkdirSync(CACHE, { recursive: true });
const n = Number, now = Math.floor(Date.now() / 1000);

// 1. Tokens and cohorts from the journal
const tok = new Map();
for (const r of readJournal()) {
  if (!r.token || !['reject', 'deferred', 'signal', 'entry'].includes(r.event)) continue;
  const t = tok.get(r.token) ?? { first: Math.floor(r.ts / 1000), fail: null, pass: false, src: r.src ?? 'smart' };
  t.first = Math.min(t.first, Math.floor(r.ts / 1000));
  if (r.event === 'reject' && r.fail && !t.fail) t.fail = r.fail;
  if ((r.event === 'signal' || r.event === 'entry') && !r.shadow) t.pass = true;
  if (r.src) t.src = r.src;
  tok.set(r.token, t);
}
const cohort = t => t.pass ? 'pass_all' : !t.fail ? 'deferred_only' : t.fail.length === 1 ? 'only:' + t.fail[0] : `fail_${Math.min(t.fail.length, 5)}${t.fail.length >= 5 ? '+' : ''}`;

// 2. Candles (cached; Pro plan paces at 50 weight/s via lib.mjs throttle)
async function candles(addr, from) {
  const f = CACHE + addr + '.json', to = Math.min(now, from + 6 * 3600);
  if (existsSync(f)) { const c = JSON.parse(readFileSync(f, 'utf8')); if (c.to >= to || c.to >= c.from + 6 * 3600) return c.list; }
  for (;;) {
    try {
      const list = (gmgn(['market', 'kline', '--chain', CHAIN, '--address', addr, '--resolution', '1m', '--from', String(from - 3600), '--to', String(to)], { ttlMs: 0 }).list ?? [])
        .map(c => ({ time: n(c.time), open: n(c.open), high: n(c.high), low: n(c.low), close: n(c.close), volume: n(c.volume) || 0, amount: n(c.amount) || 0 }))
        .filter(c => c.close > 0 && c.high > 0 && c.low > 0).sort((a, b) => a.time - b.time);
      writeFileSync(f, JSON.stringify({ from, to, list }));
      return list;
    } catch (e) {
      if (e instanceof RateLimited) { await new Promise(r => setTimeout(r, rateLimitWaitMs() + 500)); continue; }
      return null;
    }
  }
}

// 3. Entry rules (candle-only versions)
const ENTRIES = {
  immediate: (C, i, s) => i === s,                                              // buy at first sight
  pullback15: (C, i, s) => C[i].close <= Math.max(...C.slice(s, i + 1).map(c => c.high)) * 0.85,
  wave: (C, i) => {                                                            // dynamics.mjs healthy pullback, candle proxies for flow
    const w = C.slice(Math.max(0, i - 59), i + 1), kf = klineFeatures(w);
    if (kf.insufficient) return false;
    const v5 = C.slice(Math.max(0, i - 5), i).map(c => c.amount || c.volume * c.close), avg5 = v5.reduce((a, b) => a + b, 0) / (v5.length || 1);
    const cur = C[i].amount || C[i].volume * C[i].close;
    const fl = { buyRatio5m: 0.5, buyRatio1m: kf.lastGreen ? 0.6 : 0.4, volAccel: avg5 ? cur / avg5 : 0, vol5mUsd: v5.reduce((a, b) => a + b, 0) + cur };
    return phase(kf, fl) === 'healthy_pullback' && kf.lastGreen && fl.volAccel >= 0.8;
  },
};

// 4. Exit ladder = live plan: stop 0.65x, 1/3 at 2x, 1/3 at 4x, trail 25% from peak after 2x, stale 45m (<1.1x)
function exitSim(C, e) {
  const entry = C[e].open, t0 = C[e].time, stop = entry * 0.65;
  let left = 1, got = 0, peak = entry, tp1 = false, tp2 = false, reason = 'open_end', k = e;
  for (; k < C.length; k++) {
    const c = C[k];
    if (c.low <= stop && !tp1) { got += left * Math.min(c.open, stop) / entry; left = 0; reason = 'stop'; break; }
    if (tp1 && c.low <= peak * 0.75) { got += left * Math.min(c.open, peak * 0.75) / entry; left = 0; reason = 'trail'; break; }
    if (!tp1 && c.high >= 2 * entry) { got += (1 / 3) * 2; left -= 1 / 3; tp1 = true; }
    if (tp1 && !tp2 && c.high >= 4 * entry) { got += (1 / 3) * 4; left -= 1 / 3; tp2 = true; }
    peak = Math.max(peak, c.high);
    if (!tp1 && c.time - t0 >= 45 * 60 && c.close < 1.1 * entry) { got += left * c.close / entry; left = 0; reason = 'stale'; break; }
  }
  if (left > 0) got += left * C[Math.min(k, C.length - 1)].close / entry;
  return { ret: got - 1 - COST, reason, holdMin: (C[Math.min(k, C.length - 1)].time - t0) / 60, peakX: peak / entry };
}

function simulate(C, first, rule) {
  const s = C.findIndex(c => c.time >= first);
  if (s < 0) return null;
  for (let i = s; i < Math.min(C.length - 1, s + 120); i++) if (ENTRIES[rule](C, i, s)) return exitSim(C, i + 1);   // fill next candle open
  return null;                                                                                           // never triggered in 2h
}

// 5. Run + report
const list = [...tok.entries()].sort((a, b) => b[1].first - a[1].first).slice(0, MAX);
const res = {};
let done = 0, noData = 0;
for (const [addr, t] of list) {
  const C = await candles(addr, t.first);
  if (!C || C.length < 15) { noData++; continue; }
  for (const rule of Object.keys(ENTRIES)) {
    const r = simulate(C, t.first, rule);
    for (const key of [`${rule} | ${cohort(t)}`, `${rule} | src:${t.src}`, `${rule} | ALL`]) {
      const g = (res[key] ??= { seen: 0, trades: [] }); g.seen++; if (r) g.trades.push(r);
    }
  }
  if (++done % 100 === 0) console.error(`replayed ${done}/${list.length}`);
}
const rows = Object.entries(res).filter(([, g]) => g.trades.length >= 5).map(([k, g]) => {
  const R = g.trades.map(t => t.ret), w = R.filter(x => x > 0), l = R.filter(x => x <= 0), sum = a => a.reduce((x, y) => x + y, 0);
  const sorted = [...R].sort((a, b) => a - b);
  return { 'rule | cohort': k, seen: g.seen, trades: R.length, 'win%': +(100 * w.length / R.length).toFixed(0),
    'avg%': +(100 * sum(R) / R.length).toFixed(1), 'median%': +(100 * sorted[Math.floor(R.length / 2)]).toFixed(1),
    'avg_wo_best%': +(100 * (sum(R) - sorted[R.length - 1]) / Math.max(1, R.length - 1)).toFixed(1),
    PF: l.length ? +(sum(w) / -sum(l)).toFixed(2) : null, '$_per_10$_trade': +(10 * sum(R) / R.length).toFixed(2) };
}).sort((a, b) => b['avg%'] - a['avg%']);
console.log(`Replay: ${done} tokens with candles (${noData} without), cost ${COST * 100}% round trip, 1m candles, worst-case intra-candle.`);
console.table(rows);
console.log('Edge candidate = trades >= 30, avg% > 0, avg_wo_best% > 0, PF >= 1.3. Confirm forward in paper before any live change.');
