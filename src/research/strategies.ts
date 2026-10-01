/**
 * Candidate perp strategies. Each returns raw weights W[t][coin] (gross <= 1) using ONLY data up to and including day t.
 * Selected for an economic rationale, not mined from a catalogue. Every config tried counts towards the multiple-testing penalty.
 */
import type { Panel } from "./panel";
import { normaliseGross, WeightFn } from "./engine";

export interface Candidate { name: string; thesis: string; params: Record<string, number>; weights: WeightFn }

const nan = Number.NaN;
function vol30(p: Panel, c: number, t: number): number {
  const xs: number[] = []; for (let i = t - 29; i <= t; i++) { const r = i > 0 ? p.ret[c][i] : nan; if (Number.isFinite(r)) xs.push(r); }
  if (xs.length < 20) return nan; const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
const zeros = (p: Panel) => p.dates.map(() => new Array<number>(p.coins.length).fill(0));
const has = (x: number) => Number.isFinite(x);

function tsmom(L: number): WeightFn {
  return (p) => { const W = zeros(p); for (let t = L; t < p.dates.length; t++) { const row = p.coins.map((_, c) => { const a = p.close[c][t], b = p.close[c][t - L], v = vol30(p, c, t); return has(a) && has(b) && has(v) && v > 0 ? Math.sign(a / b - 1) / v : 0; }); W[t] = normaliseGross(row); } return W; };
}
function donchian(N: number): WeightFn {
  return (p) => { const W = zeros(p), pos = new Array<number>(p.coins.length).fill(0);
    for (let t = N; t < p.dates.length; t++) { const row = p.coins.map((_, c) => {
      const cl = p.close[c][t]; if (!has(cl)) { pos[c] = 0; return 0; }
      let hi = -Infinity, lo = Infinity; for (let i = t - N; i < t; i++) { if (has(p.high[c][i])) hi = Math.max(hi, p.high[c][i]); if (has(p.low[c][i])) lo = Math.min(lo, p.low[c][i]); }
      if (cl > hi) pos[c] = 1; else if (cl < lo) pos[c] = -1;
      const v = vol30(p, c, t); return has(v) && v > 0 ? pos[c] / v : 0; }); W[t] = normaliseGross(row); } return W; };
}
function ranked(p: Panel, t: number, score: (c: number) => number): number[] { // coin indices sorted by score ascending, valid only
  return p.coins.map((_, c) => c).filter((c) => has(score(c))).sort((a, b) => score(a) - score(b)); }
function longShort(p: Panel, order: number[], q: number, sign: 1 | -1): number[] {
  const k = Math.max(2, Math.floor(order.length * q)), w = new Array<number>(p.coins.length).fill(0);
  if (order.length < 6) return w; order.slice(-k).forEach((c) => (w[c] += sign / (2 * k))); order.slice(0, k).forEach((c) => (w[c] -= sign / (2 * k))); return w; }
function xsMomentum(L: number, R: number): WeightFn {
  return (p) => { const W = zeros(p); let cur = new Array<number>(p.coins.length).fill(0);
    for (let t = L; t < p.dates.length; t++) { if (t % R === 0) cur = longShort(p, ranked(p, t, (c) => p.close[c][t] / p.close[c][t - L] - 1), 0.2, 1); W[t] = cur.slice(); } return W; };
}
function xsReversal(L: number): WeightFn {
  return (p) => { const W = zeros(p); let cur = new Array<number>(p.coins.length).fill(0);
    for (let t = L; t < p.dates.length; t++) { if (t % L === 0) cur = longShort(p, ranked(p, t, (c) => p.close[c][t] / p.close[c][t - L] - 1), 0.2, -1); W[t] = cur.slice(); } return W; };
}
function fundingTilt(lb: number): WeightFn { // short the highest-funding coins, long the lowest (collects funding; direction is unhedged)
  return (p) => { const W = zeros(p);
    for (let t = lb; t < p.dates.length; t++) { const f = (c: number) => { let s = 0, n = 0; for (let i = t - lb + 1; i <= t; i++) if (has(p.funding[c][i])) { s += p.funding[c][i]; n++; } return n >= lb * 0.8 ? s / n : nan; };
      W[t] = longShort(p, ranked(p, t, f), 0.2, -1); } return W; };
}
function pairsEthBtc(lb: number): WeightFn {
  return (p) => { const W = zeros(p), e = p.coins.indexOf("ETH"), b = p.coins.indexOf("BTC"); if (e < 0 || b < 0) return W; let pos = 0;
    for (let t = lb; t < p.dates.length; t++) { const xs: number[] = []; for (let i = t - lb + 1; i <= t; i++) xs.push(Math.log(p.close[e][i] / p.close[b][i]));
      if (xs.some((x) => !has(x))) continue; const m = xs.reduce((a, c) => a + c, 0) / lb, s = Math.sqrt(xs.reduce((a, c) => a + (c - m) ** 2, 0) / (lb - 1)), z = s > 0 ? (xs[lb - 1] - m) / s : 0;
      if (z > 2) pos = -1; else if (z < -2) pos = 1; else if (Math.abs(z) < 0.5) pos = 0;
      W[t][e] = 0.5 * pos; W[t][b] = -0.5 * pos; } return W; };
}

export function candidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const L of [20, 60, 120]) out.push({ name: "tsmom", thesis: "Coins trending up/down over L days keep trending; inverse-vol sized long/short.", params: { L }, weights: tsmom(L) });
  for (const N of [20, 55, 100]) out.push({ name: "donchian", thesis: "Breakouts of the N-day range start durable trends; hold until the opposite break.", params: { N }, weights: donchian(N) });
  for (const L of [14, 30, 60]) for (const R of [1, 7]) out.push({ name: "xs-momentum", thesis: "Relative winners keep outperforming relative losers (market-neutral).", params: { L, R }, weights: xsMomentum(L, R) });
  for (const lb of [3, 7, 14]) out.push({ name: "funding-tilt", thesis: "Crowded longs (high funding) underperform; also earns funding. Unhedged directional.", params: { lb }, weights: fundingTilt(lb) });
  for (const lb of [30, 60]) out.push({ name: "pairs-eth-btc", thesis: "The ETH/BTC ratio mean-reverts after 2-sigma stretches (dollar-neutral).", params: { lb }, weights: pairsEthBtc(lb) });
  for (const L of [1, 3, 5]) out.push({ name: "xs-reversal", thesis: "Short-term losers rebound vs winners (liquidity provision premium), held L days.", params: { L }, weights: xsReversal(L) });
  return out;
}
