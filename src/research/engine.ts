/**
 * Vectorised portfolio backtester for perpetual futures.
 * Weights are decided at the close of day t from data up to and including t; they earn day t+1's return.
 * Costs: taker fee + slippage per unit of traded notional. Funding is charged on the held notional (longs pay when rate > 0).
 * Position sizing: gross-1 raw weights are scaled to a volatility target from trailing realised vol (info up to t), capped.
 */
import type { Panel } from "./panel";
import { std } from "./stats";

export interface CostModel { feeBps: number; slippageBps: number }
export const DEFAULT_COSTS: CostModel = { feeBps: 4.5, slippageBps: 5 }; // ASSUMPTIONS: base-tier taker fee; verify current tiers. Slippage is a guess for liquid majors.
export interface RunConfig { costs: CostModel; volTarget: number; maxLeverage: number; volWindow: number }
export const DEFAULT_CONFIG: RunConfig = { costs: DEFAULT_COSTS, volTarget: 0.2, maxLeverage: 3, volWindow: 30 };

export type WeightFn = (p: Panel) => number[][]; // returns W[t][coin], gross ~1 (sum |w| = 1), zeros where no position

export interface RunResult { ret: number[]; turnover: number; avgGross: number }

export function runWeights(p: Panel, raw: number[][], cfg: RunConfig = DEFAULT_CONFIG): RunResult {
  const T = p.dates.length, C = p.coins.length, side = (cfg.costs.feeBps + cfg.costs.slippageBps) / 1e4;
  // 1) unscaled gross returns to estimate realised vol (uses only returns up to t when scaling weights at t)
  const un = new Array<number>(T).fill(0);
  for (let t = 0; t + 1 < T; t++) { let s = 0; for (let c = 0; c < C; c++) { const r = p.ret[c][t + 1]; if (raw[t][c] && Number.isFinite(r)) s += raw[t][c] * r; } un[t + 1] = s; }
  const W: number[][] = raw.map((row) => row.slice());
  for (let t = 0; t < T; t++) {
    const win = un.slice(Math.max(1, t - cfg.volWindow + 1), t + 1);
    const active = win.some((x) => x !== 0);
    const vol = win.length >= cfg.volWindow && active ? std(win) * Math.sqrt(365) : NaN;
    const k = Number.isFinite(vol) && vol > 0 ? Math.min(cfg.maxLeverage, cfg.volTarget / vol) : 0;
    for (let c = 0; c < C; c++) W[t][c] = raw[t][c] * k;
  }
  // 2) apply scaled weights with costs and funding
  const ret = new Array<number>(T).fill(0);
  let turn = 0, gross = 0, n = 0;
  for (let t = 0; t + 1 < T; t++) {
    let pnl = 0, tv = 0, g = 0;
    for (let c = 0; c < C; c++) {
      const w = W[t][c], prev = t > 0 ? W[t - 1][c] : 0;
      tv += Math.abs(w - prev); g += Math.abs(w);
      if (w) { const r = p.ret[c][t + 1]; if (Number.isFinite(r)) pnl += w * r; const f = p.funding[c][t + 1]; if (Number.isFinite(f)) pnl -= w * f; }
    }
    ret[t + 1] = pnl - tv * side; turn += tv; gross += g; n++;
  }
  return { ret, turnover: turn / Math.max(1, n), avgGross: gross / Math.max(1, n) };
}

export function normaliseGross(w: number[]): number[] { const g = w.reduce((a, b) => a + Math.abs(b), 0); return g > 0 ? w.map((x) => x / g) : w.map(() => 0); }
