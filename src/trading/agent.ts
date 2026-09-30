/** Autonomous trading loop: signal -> risk gate -> execute, one tick per new candle. */
import type { Candle } from "../lib/geckoterminal";
import { STRATEGIES } from "./strategies";
import { checkEntry, checkHalt, DEFAULT_LIMITS, RiskLimits } from "./risk";
import { Executor, Fill } from "./executor";

export interface AgentState {
  strategy: string;
  params: Record<string, number>;
  cash: number; units: number; entryPrice: number;
  peak: number; dayStart: number; dayKey: string;
  halted: string | null;
  lastCandleT: number;
  fills: Fill[];
  log: string[];
}

export function newState(strategy: string, params: Record<string, number>, cash: number): AgentState {
  return { strategy, params, cash, units: 0, entryPrice: 0, peak: cash, dayStart: cash, dayKey: "", halted: null, lastCandleT: 0, fills: [], log: [] };
}

export const equityOf = (s: AgentState, price: number) => s.cash + s.units * price;

export async function tick(
  s: AgentState, candles: Candle[], liquidityUsd: number, ex: Executor, limits: RiskLimits = DEFAULT_LIMITS
): Promise<AgentState> {
  if (s.halted) return s;
  const strat = STRATEGIES.find((x) => x.name === s.strategy);
  if (!strat) throw new Error(`unknown strategy ${s.strategy}`);
  // Only act on closed candles: drop the still-forming last one.
  const closed = candles.slice(0, -1);
  const last = closed[closed.length - 1];
  if (!last || last.t <= s.lastCandleT) return s;
  s.lastCandleT = last.t;

  const price = last.c, eq = equityOf(s, price);
  const day = new Date(last.t).toISOString().slice(0, 10);
  if (day !== s.dayKey) { s.dayKey = day; s.dayStart = eq; }
  s.peak = Math.max(s.peak, eq);

  const halt = checkHalt(eq, s.peak, s.dayStart, limits);
  if (halt) {
    if (s.units > 0) s.fills.push(await ex.sell(s.units, price, last.t));
    if (s.units > 0) { s.cash += s.fills[s.fills.length - 1].usd; s.units = 0; }
    s.halted = halt; s.log.push(`${day} HALT: ${halt}`);
    return s;
  }

  const pos: 0 | 1 = s.units > 0 ? 1 : 0;
  const stopped = pos === 1 && price < s.entryPrice * (1 - limits.stopLossPct);
  const want = stopped ? 0 : strat.signal(closed, closed.length - 1, s.params, pos);

  if (pos === 0 && want === 1) {
    const usd = Math.min(s.cash, eq * limits.maxPositionPct);
    const veto = checkEntry(usd, eq, liquidityUsd, limits);
    if (veto) { s.log.push(`${day} entry vetoed: ${veto}`); return s; }
    const f = await ex.buy(usd, price, last.t);
    s.cash -= usd; s.units += f.units; s.entryPrice = f.price; s.fills.push(f);
    s.log.push(`${day} BUY ${f.units.toFixed(4)} @ ${f.price}`);
  } else if (pos === 1 && want === 0) {
    const f = await ex.sell(s.units, price, last.t);
    s.cash += f.usd; s.units = 0; s.fills.push(f);
    s.log.push(`${day} SELL @ ${f.price}${stopped ? " (stop-loss)" : ""}`);
  }
  return s;
}
