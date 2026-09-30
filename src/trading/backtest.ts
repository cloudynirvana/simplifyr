/**
 * Backtester with realistic costs, next-bar-open fills (no lookahead),
 * in-sample/out-of-sample split and parameter-robustness checks.
 */
import type { Candle } from "../lib/geckoterminal";
import { STRATEGIES, Strategy } from "./strategies";

export interface CostModel { feeBps: number; slippageBps: number }
export const DEFAULT_COSTS: CostModel = { feeBps: 30, slippageBps: 50 }; // per side

export interface Metrics {
  totalReturn: number; sharpe: number; sortino: number; maxDrawdown: number;
  winRate: number; profitFactor: number; trades: number; exposure: number;
}

const BARS_PER_YEAR = 24 * 365;

export function backtest(
  c: Candle[], s: Strategy, p: Record<string, number>, costs = DEFAULT_COSTS
): Metrics & { equity: number[] } {
  const side = (costs.feeBps + costs.slippageBps) / 1e4;
  let pos: 0 | 1 = 0, entry = 0, inBars = 0, equity = 1;
  const curve = [1], rets: number[] = [], tradeRets: number[] = [];
  for (let i = 1; i < c.length; i++) {
    // Decide at close of i-1, fill at open of i (no lookahead).
    const want = s.signal(c, i - 1, p, pos);
    let r = 0;
    if (pos === 0 && want === 1) {
      entry = c[i].o * (1 + side);
      r = c[i].c / entry - 1; pos = 1; inBars++;
    } else if (pos === 1 && want === 0) {
      const exit = c[i].o * (1 - side);
      r = exit / c[i - 1].c - 1; tradeRets.push(exit / entry - 1); pos = 0;
    } else if (pos === 1) {
      r = c[i].c / c[i - 1].c - 1; inBars++;
    }
    equity *= 1 + r;
    rets.push(r); curve.push(equity);
  }
  if (pos === 1) tradeRets.push((c[c.length - 1].c * (1 - side)) / entry - 1);
  return { ...summarise(rets, curve, tradeRets, inBars / Math.max(1, c.length - 1)), equity: curve };
}

function summarise(rets: number[], curve: number[], trades: number[], exposure: number): Metrics {
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length));
  const dsd = Math.sqrt(rets.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / Math.max(1, rets.length));
  let peak = 1, mdd = 0;
  for (const e of curve) { peak = Math.max(peak, e); mdd = Math.max(mdd, 1 - e / peak); }
  const wins = trades.filter((t) => t > 0), losses = trades.filter((t) => t <= 0);
  const gl = -losses.reduce((a, b) => a + b, 0);
  return {
    totalReturn: curve[curve.length - 1] - 1,
    sharpe: sd ? (mean / sd) * Math.sqrt(BARS_PER_YEAR) : 0,
    sortino: dsd ? (mean / dsd) * Math.sqrt(BARS_PER_YEAR) : 0,
    maxDrawdown: mdd,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: gl ? wins.reduce((a, b) => a + b, 0) / gl : wins.length ? Infinity : 0,
    trades: trades.length,
    exposure,
  };
}

export function buyAndHold(c: Candle[], costs = DEFAULT_COSTS): number {
  const side = (costs.feeBps + costs.slippageBps) / 1e4;
  return (c[c.length - 1].c * (1 - side)) / (c[0].o * (1 + side)) - 1;
}

export interface Verdict {
  strategy: string; params: Record<string, number>;
  inSample: Metrics; outOfSample: Metrics;
  buyHoldOOS: number; gridMedianOOSSharpe: number;
  passed: boolean; failures: string[];
}

/** Quality gate from the research prompt. Thresholds are deliberately strict for thin-liquidity tokens. */
export const GATES = { minSharpe: 1.0, maxDrawdown: 0.3, minTrades: 10, minGridMedianSharpe: 0 };

export function validateAll(c: Candle[], costs = DEFAULT_COSTS, split = 0.7): Verdict[] {
  const cut = Math.floor(c.length * split);
  const isC = c.slice(0, cut), oosC = c.slice(cut - 60 > 0 ? cut - 60 : 0); // warm-up overlap only
  const warm = cut - Math.max(0, cut - 60);
  return STRATEGIES.map((s) => {
    const scored = s.grid.map((p) => ({ p, m: backtest(isC, s, p, costs) }));
    const best = scored.sort((a, b) => b.m.sharpe - a.m.sharpe)[0];
    const oosAll = (p: Record<string, number>) => {
      const full = backtest(oosC, s, p, costs);
      return { ...full, equity: full.equity.slice(warm) };
    };
    const oos = oosAll(best.p);
    const gridSharpes = s.grid.map((p) => oosAll(p).sharpe).sort((a, b) => a - b);
    const med = gridSharpes[Math.floor(gridSharpes.length / 2)];
    const bh = buyAndHold(c.slice(cut), costs);
    const failures: string[] = [];
    if (oos.sharpe < GATES.minSharpe) failures.push(`OOS Sharpe ${oos.sharpe.toFixed(2)} < ${GATES.minSharpe}`);
    if (oos.maxDrawdown > GATES.maxDrawdown) failures.push(`OOS max drawdown ${(oos.maxDrawdown * 100).toFixed(0)}% > 30%`);
    if (oos.trades < GATES.minTrades) failures.push(`only ${oos.trades} OOS trades`);
    if (oos.totalReturn <= bh) failures.push("does not beat buy & hold after costs");
    if (med < GATES.minGridMedianSharpe) failures.push("parameter-fragile (median neighbour OOS Sharpe < 0)");
    const { equity: _a, ...inSample } = best.m as Metrics & { equity: number[] };
    const { equity: _b, ...outOfSample } = oos;
    return { strategy: s.name, params: best.p, inSample, outOfSample, buyHoldOOS: bh, gridMedianOOSSharpe: med, passed: failures.length === 0, failures };
  });
}
