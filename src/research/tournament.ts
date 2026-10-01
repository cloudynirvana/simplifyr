/**
 * Strategy tournament: walk-forward selection, untouched holdout, cost stress, and a multiple-testing penalty.
 * Pass criteria (all must hold) are fixed in GATES BEFORE looking at results.
 */
import type { Panel } from "./panel";
import { candidates, Candidate } from "./strategies";
import { runWeights, DEFAULT_CONFIG, RunConfig } from "./engine";
import { sharpe, sharpeDaily, annReturn, maxDrawdown, deflatedSharpe, totalReturn } from "./stats";

export const GATES = { minWfSharpe: 1.0, minDsr: 0.95, maxDrawdown: 0.3, minHoldoutSharpe: 0.5, minStressSharpe: 0.5, minOosDays: 250 };
export const SETTINGS = { trainDays: 365, blockDays: 90, holdoutDays: 180, warmup: 130 };

export interface StratReport {
  name: string; thesis: string; configs: number;
  wf: { sharpe: number; annRet: number; maxDD: number; days: number }; dsr: number;
  holdout: { sharpe: number; ret: number; days: number }; stressSharpe: number; turnover: number;
  chosen: string; passed: boolean; failures: string[];
}

export interface TournamentResult { reports: StratReport[]; nTrials: number; benchmarks: { btcBuyHold: { sharpe: number; ret: number }; eqWeightLong: { sharpe: number; ret: number } }; days: number; oosStart: string; holdoutStart: string }

function cfgWithCosts(mult: number): RunConfig { return { ...DEFAULT_CONFIG, costs: { feeBps: DEFAULT_CONFIG.costs.feeBps * mult, slippageBps: DEFAULT_CONFIG.costs.slippageBps * mult } }; }

export function runTournament(p: Panel, cands: Candidate[] = candidates()): TournamentResult {
  const T = p.dates.length, hold0 = T - SETTINGS.holdoutDays, oos0 = SETTINGS.warmup + SETTINGS.trainDays;
  const runs = cands.map((c) => { const raw = c.weights(p); return { c, base: runWeights(p, raw), stress: runWeights(p, raw, cfgWithCosts(2)) }; });
  const nTrials = runs.length, trialSr = runs.map((r) => sharpeDaily(r.base.ret.slice(SETTINGS.warmup, hold0)));
  const names = [...new Set(cands.map((c) => c.name))];
  const reports: StratReport[] = names.map((name) => {
    const group = runs.filter((r) => r.c.name === name);
    const pick = (t0: number) => { // best config by trailing train-window Sharpe, using only data before t0
      let best = group[0], bs = -Infinity; for (const g of group) { const s = sharpe(g.base.ret.slice(Math.max(SETTINGS.warmup, t0 - SETTINGS.trainDays), t0)); if (s > bs) { bs = s; best = g; } } return best; };
    const stitched: number[] = [], stressStitched: number[] = [], chosenLog: string[] = [];
    for (let t0 = oos0; t0 < hold0; t0 += SETTINGS.blockDays) { const g = pick(t0), t1 = Math.min(hold0, t0 + SETTINGS.blockDays); stitched.push(...g.base.ret.slice(t0, t1)); stressStitched.push(...g.stress.ret.slice(t0, t1)); chosenLog.push(JSON.stringify(g.c.params)); }
    const hg = pick(hold0), holdRet = hg.base.ret.slice(hold0);
    const dsr = deflatedSharpe(stitched, nTrials, trialSr);
    const wf = { sharpe: sharpe(stitched), annRet: annReturn(stitched), maxDD: maxDrawdown(stitched), days: stitched.length };
    const holdout = { sharpe: sharpe(holdRet), ret: totalReturn(holdRet), days: holdRet.length };
    const stressSharpe = sharpe(stressStitched), failures: string[] = [];
    if (wf.days < GATES.minOosDays) failures.push(`only ${wf.days} OOS days`);
    if (wf.sharpe < GATES.minWfSharpe) failures.push(`walk-forward Sharpe ${wf.sharpe.toFixed(2)} < ${GATES.minWfSharpe}`);
    if (!(dsr >= GATES.minDsr)) failures.push(`deflated Sharpe prob ${Number.isFinite(dsr) ? dsr.toFixed(2) : "n/a"} < ${GATES.minDsr}`);
    if (wf.maxDD > GATES.maxDrawdown) failures.push(`max drawdown ${(wf.maxDD * 100).toFixed(0)}% > ${GATES.maxDrawdown * 100}%`);
    if (holdout.sharpe < GATES.minHoldoutSharpe) failures.push(`holdout Sharpe ${holdout.sharpe.toFixed(2)} < ${GATES.minHoldoutSharpe}`);
    if (stressSharpe < GATES.minStressSharpe) failures.push(`2x-cost Sharpe ${stressSharpe.toFixed(2)} < ${GATES.minStressSharpe}`);
    return { name, thesis: group[0].c.thesis, configs: group.length, wf, dsr, holdout, stressSharpe, turnover: group.reduce((a, g) => a + g.base.turnover, 0) / group.length, chosen: chosenLog.join(" > "), passed: failures.length === 0, failures };
  });
  const btc = p.coins.indexOf("BTC"), btcRet = p.ret[btc].map((x) => (Number.isFinite(x) ? x : 0)), eq = p.dates.map((_, t) => { const xs = p.coins.map((_, c) => p.ret[c][t]).filter(Number.isFinite); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; });
  const seg = (r: number[]) => r.slice(oos0, hold0);
  return { reports, nTrials, benchmarks: { btcBuyHold: { sharpe: sharpe(seg(btcRet)), ret: totalReturn(seg(btcRet)) }, eqWeightLong: { sharpe: sharpe(seg(eq)), ret: totalReturn(seg(eq)) } }, days: T, oosStart: new Date(p.dates[oos0]).toISOString().slice(0, 10), holdoutStart: new Date(p.dates[hold0]).toISOString().slice(0, 10) };
}
