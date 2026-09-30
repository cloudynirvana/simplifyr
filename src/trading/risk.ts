/** Hard risk limits. Every order passes through check(); any breach halts the agent (kill switch). */

export interface RiskLimits {
  maxPositionPct: number;     // max fraction of equity in one position
  stopLossPct: number;        // exit if price falls this far below entry
  maxDailyLossPct: number;    // halt if equity drops this much in a day
  maxDrawdownPct: number;     // halt if equity falls this far from peak
  minLiquidityUsd: number;    // refuse to enter thin pools
  maxOrderPctOfLiquidity: number; // market-impact guard
}

export const DEFAULT_LIMITS: RiskLimits = {
  maxPositionPct: 0.25,
  stopLossPct: 0.12,
  maxDailyLossPct: 0.05,
  maxDrawdownPct: 0.2,
  minLiquidityUsd: 100_000,
  maxOrderPctOfLiquidity: 0.005,
};

export function checkEntry(orderUsd: number, equity: number, liquidityUsd: number, l: RiskLimits): string | null {
  if (liquidityUsd < l.minLiquidityUsd) return `liquidity $${Math.round(liquidityUsd)} below minimum`;
  if (orderUsd > equity * l.maxPositionPct + 1e-9) return "order exceeds max position size";
  if (orderUsd > liquidityUsd * l.maxOrderPctOfLiquidity) return "order too large for pool liquidity";
  return null;
}

export function checkHalt(equity: number, peak: number, dayStart: number, l: RiskLimits): string | null {
  if (equity < peak * (1 - l.maxDrawdownPct)) return "max drawdown breached";
  if (equity < dayStart * (1 - l.maxDailyLossPct)) return "daily loss limit breached";
  return null;
}
