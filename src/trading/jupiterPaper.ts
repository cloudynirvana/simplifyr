/**
 * Paper executor that fills at REAL Jupiter quotes (no order is ever sent). Realised price impact,
 * route and slippage come from the live book, so paper results are not flattered by a flat-slippage guess.
 * Quotes against USDC; token decimals must be supplied. Refuses fills that breach the execution caps.
 */
import { EXECUTION } from "./pumpFilters";
import { getQuote, FetchLike, MINTS } from "../lib/jupiter";
import type { Executor, Fill } from "./executor";

export class JupiterPaperExecutor implements Executor {
  mode = "paper" as const;
  constructor(
    private tokenMint: string,
    private tokenDecimals: number,
    private opts: { slippageBps?: number; txCostUsd?: number; fetchImpl?: FetchLike } = {}
  ) {}

  private get slip() { return Math.min(this.opts.slippageBps ?? 500, EXECUTION.maxSlippagePct * 100); }
  private get txCost() { return this.opts.txCostUsd ?? 0.05; } // priority fee + tip, in USD

  async buy(usd: number, _ref: number, t: number): Promise<Fill> {
    const q = await getQuote({ inputMint: MINTS.USDC, outputMint: this.tokenMint, amount: BigInt(Math.round(usd * 1e6)), slippageBps: this.slip }, this.opts.fetchImpl);
    this.guard(q.priceImpactPct);
    const units = Number(q.outAmount) / 10 ** this.tokenDecimals;
    return { side: "buy", units, price: usd / units, usd, fee: this.txCost, t };
  }

  async sell(units: number, _ref: number, t: number): Promise<Fill> {
    const atomic = BigInt(Math.floor(units * 10 ** this.tokenDecimals));
    const q = await getQuote({ inputMint: this.tokenMint, outputMint: MINTS.USDC, amount: atomic, slippageBps: this.slip }, this.opts.fetchImpl);
    this.guard(q.priceImpactPct);
    const usdOut = Number(q.outAmount) / 1e6;
    return { side: "sell", units, price: usdOut / units, usd: usdOut - this.txCost, fee: this.txCost, t };
  }

  private guard(impactPct: string) {
    const impact = Math.abs(Number(impactPct)) ;
    if (impact > EXECUTION.maxPriceImpactPct) throw new Error(`price impact ${impact.toFixed(2)}% exceeds cap ${EXECUTION.maxPriceImpactPct}%`);
  }
}
