// Memecoin microstructure. Memecoins move in WAVES: a vertical first leg, a pullback where early buyers take profit,
// then either a second leg (fresh buyers absorb the selling) or distribution/rug (insiders keep selling into bids).
// This module turns GMGN candles (gmgn-kline-pattern formulas) + live order flow (token info buy/sell volume)
// into a wave phase, a patient entry trigger, and exit warnings. Pure functions: no API calls here.
const n = Number, mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

// Candles -> the six gmgn-kline-pattern measurements (+ green streak). Division guards return null ("n/a").
// asOf (unix s): drop the still-forming candle. A candle that started less than 60s before asOf is incomplete; its volume
// is a fraction of a minute and made steady tokens read as 'dead' (bug found in run 4: 10 of 13 'dead' at signal time).
export function klineFeatures(list = [], asOf = null) {
  const k = list.map(c => ({ t: n(c.time) > 1e12 ? n(c.time) / 1000 : n(c.time), o: n(c.open), h: n(c.high), l: n(c.low), c: n(c.close), v: n(c.volume) || 0, usd: n(c.amount) || 0 }))
    .filter(c => c.c > 0 && c.h > 0 && c.l > 0 && (asOf === null || c.t <= asOf - 60)).sort((a, b) => a.t - b.t);
  const N = k.length;
  if (N < 10) return { n: N, insufficient: true };
  const C = k.map(c => c.c), V = k.map(c => c.usd || c.v);
  const m9 = mean(C.slice(-9)), m21 = mean(C.slice(-21));
  const base = N >= 24 ? mean(C.slice(-24, -19)) : C[0];
  const slope = base ? (N >= 24 ? (mean(C.slice(-5)) - base) / base : (C[N - 1] - C[0]) / C[0]) : null;
  const hi = Math.max(...k.map(c => c.h)), lo = Math.min(...k.map(c => c.l)), vAvg = mean(V.slice(-23, -3));
  let green = 0; for (let i = N - 1; i >= 0 && k[i].c > k[i].o; i--) green++;
  const last = k[N - 1];
  return {
    n: N, trend: m9 > m21 ? 'up' : m9 < m21 ? 'down' : 'flat', slope,
    volatility: mean(k.slice(-14).map(c => (c.h - c.l) / c.c)),
    drawdown: hi ? (hi - C[N - 1]) / hi : null, upFromLow: lo ? (C[N - 1] - lo) / lo : null,
    retrace: hi > lo ? (hi - C[N - 1]) / (hi - lo) : null,       // share of the whole wave given back (0 = at high, 1 = at low)
    // volRatio: last 3 CLOSED minutes vs the 20 before, so one quiet minute is not 'dead'
    volRatio: vAvg ? mean(V.slice(-3)) / vAvg : null, lastGreen: last.c > last.o, greenStreak: green,
    minsSinceHigh: (last.t - k.reduce((b, c) => (c.h >= b.h ? c : b)).t) / 60,
  };
}

// Live order flow from `token info` price block (USD buy/sell volume, tx counts over 1m/5m/1h).
export function flow(info) {
  const p = info.price ?? {}, r = (b, s) => (n(b) + n(s) > 0 ? n(b) / (n(b) + n(s)) : null);
  return {
    buyRatio1m: r(p.buy_volume_1m, p.sell_volume_1m), buyRatio5m: r(p.buy_volume_5m, p.sell_volume_5m),
    buyRatio1h: r(p.buy_volume_1h, p.sell_volume_1h), netTx5m: n(p.buys_5m) - n(p.sells_5m),
    volAccel: n(p.volume_5m) > 0 ? n(p.volume_1m) / (n(p.volume_5m) / 5) : null,     // >1 = activity accelerating
    vol5mUsd: n(p.volume_5m), liqUsd: n(info.liquidity),
  };
}

// Wave phase. First match wins; thresholds are research starting points, tune them from journaled outcomes.
export function phase(kf, fl) {
  if (!kf || kf.insufficient) return 'unknown';
  const dd = kf.drawdown ?? 0, s = kf.slope ?? 0, b5 = fl.buyRatio5m ?? 0.5;
  if (fl.vol5mUsd < 2000 || (kf.volRatio !== null && kf.volRatio < 0.15)) return 'dead';           // attention gone
  const rt = kf.retrace ?? 0;
  if ((dd > 0.55 && s < -0.10) || rt > 0.8) return 'breakdown';                                      // wave fully given back
  if (dd > 0.35 && Math.abs(s) < 0.08 && b5 < 0.5) return 'distribution';                           // sellers in control at highs
  if (s > 0.25 && dd < 0.12) return 'vertical';                                                      // first leg: don't chase
  // Pullback inside a live wave: 15-50% off the high but holding >= ~35% of the move (retrace <= 0.65, the "0.618 hold"),
  // flow still balanced (5m buy share >= 45%), volume not dried up. The slope is negative here by definition.
  if (dd >= 0.15 && dd <= 0.5 && rt <= 0.65 && b5 >= 0.45 && (kf.volRatio ?? 1) >= 0.4) return 'healthy_pullback';
  if (s > 0.08 && dd < 0.25) return 'uptrend';
  return 'chop';
}

// Patient entry: only in a healthy pullback, and only once buyers visibly return (bounce confirmation).
export function waveEntry(kf, fl) {
  const ph = phase(kf, fl);
  const ok = ph === 'healthy_pullback' && (fl.buyRatio1m ?? 0) >= 0.55 && kf.lastGreen && (fl.volAccel ?? 0) >= 0.8;
  return { ok, phase: ph };
}
export const BAD_PHASES = ['dead', 'breakdown', 'distribution'];
