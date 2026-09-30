/**
 * Execution layer. PaperExecutor simulates fills with slippage and fees.
 * LiveExecutor is intentionally NOT implemented: real-money swaps must only be
 * added after a paper track record and explicit sign-off.
 */
import { DEFAULT_COSTS, CostModel } from "./backtest";

export interface Fill { side: "buy" | "sell"; units: number; price: number; usd: number; fee: number; t: number }

export interface Executor {
  mode: "paper" | "live";
  buy(usd: number, refPrice: number, t: number): Promise<Fill>;
  sell(units: number, refPrice: number, t: number): Promise<Fill>;
}

export class PaperExecutor implements Executor {
  mode = "paper" as const;
  constructor(private costs: CostModel = DEFAULT_COSTS) {}
  async buy(usd: number, ref: number, t: number): Promise<Fill> {
    const price = ref * (1 + this.costs.slippageBps / 1e4);
    const fee = usd * (this.costs.feeBps / 1e4);
    return { side: "buy", units: (usd - fee) / price, price, usd, fee, t };
  }
  async sell(units: number, ref: number, t: number): Promise<Fill> {
    const price = ref * (1 - this.costs.slippageBps / 1e4);
    const gross = units * price, fee = gross * (this.costs.feeBps / 1e4);
    return { side: "sell", units, price, usd: gross - fee, fee, t };
  }
}

export function getExecutor(): Executor {
  if (process.env.TRADING_MODE === "live")
    throw new Error("Live execution is not implemented. Run paper mode and review results first.");
  return new PaperExecutor();
}
