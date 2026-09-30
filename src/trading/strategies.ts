/** Long-only spot strategies. Signal at candle i uses data up to and including i only. */
import type { Candle } from "../lib/geckoterminal";

export interface Strategy {
  name: string;
  thesis: string;
  grid: Array<Record<string, number>>;
  /** Returns desired position after candle i given the current position (0/1). */
  signal(c: Candle[], i: number, p: Record<string, number>, pos: 0 | 1): 0 | 1;
}

const highest = (c: Candle[], i: number, n: number) => Math.max(...c.slice(i - n, i).map((x) => x.h));
const lowest = (c: Candle[], i: number, n: number) => Math.min(...c.slice(i - n, i).map((x) => x.l));

function rsi(c: Candle[], i: number, n: number): number {
  let g = 0, l = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const d = c[k].c - c[k - 1].c;
    if (d >= 0) g += d; else l -= d;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function ema(c: Candle[], i: number, n: number): number {
  const k = 2 / (n + 1);
  let e = c[Math.max(0, i - n * 3)].c;
  for (let j = Math.max(1, i - n * 3 + 1); j <= i; j++) e = c[j].c * k + e * (1 - k);
  return e;
}

export const STRATEGIES: Strategy[] = [
  {
    name: "breakout-momentum",
    thesis: "Trends persist in liquid pairs: buy a close above the N-bar high, exit below the M-bar low.",
    grid: [10, 20, 40].flatMap((n) => [5, 10].map((m) => ({ n, m }))),
    signal: (c, i, p, pos) =>
      i < p.n + 1 ? 0 : pos === 0 ? (c[i].c > highest(c, i, p.n) ? 1 : 0) : c[i].c < lowest(c, i, p.m) ? 0 : 1,
  },
  {
    name: "rsi-mean-reversion",
    thesis: "Short-term oversold bounces revert toward the mean: buy RSI below entry, exit above exit level.",
    grid: [20, 30].flatMap((lo) => [50, 60].map((hi) => ({ lo, hi, n: 14 }))),
    signal: (c, i, p, pos) => {
      if (i < p.n + 1) return 0;
      const r = rsi(c, i, p.n);
      return pos === 0 ? (r < p.lo ? 1 : 0) : r > p.hi ? 0 : 1;
    },
  },
  {
    name: "ema-trend",
    thesis: "Fast EMA above slow EMA marks an uptrend worth holding; flat otherwise.",
    grid: [[8, 21], [12, 34], [20, 50]].map(([f, s]) => ({ f, s })),
    signal: (c, i, p) => (i < p.s * 2 ? 0 : ema(c, i, p.f) > ema(c, i, p.s) ? 1 : 0),
  },
];
