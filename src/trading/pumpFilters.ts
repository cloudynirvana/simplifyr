/**
 * Pump.fun hard filters. Every token must pass ALL of these before the judgment model (Jev) sees it.
 * These are vetoes in code; the model can rank what survives but can never override a failure.
 * All thresholds live in PUMP_FILTERS so they are easy to review and tune.
 *
 * Derived from a retail memecoin playbook, then tightened for an unattended agent:
 *  - keep: dev-holdings check, >=0.1 SOL fees on pre-migration coins (honeypot guard), ~3.5% / 5% single-wallet
 *    caps, identical-size wallet clusters = bundle.
 *  - changed: the playbook buys with 100% slippage; an autonomous agent must not (see EXECUTION caps).
 *  - changed: holder concentration EXCLUDES the bonding curve / LP accounts, which legitimately hold most supply.
 *  - not adopted: copy-trading leaderboard wallets (by the time the alert lands the agent is the exit liquidity).
 *  Thresholds are starting hypotheses, NOT validated edge. Tune them only from paper-trading results.
 */

export interface PumpToken {
  mint: string;
  stage: "bonding" | "migrated";
  ageMinutes: number;
  marketCapUsd: number;
  liquidityUsd: number;
  /** Creator/trading fees paid into the curve so far, in SOL (real activity vs a chart that only grinds up). */
  feesSol: number;
  priceChange: { m5: number; h1: number; h24?: number }; // percent
  txns: { m5: { buys: number; sells: number }; h1: { buys: number; sells: number } };
  uniqueTraders1h: number;
  /** Token holders as fractions of total supply. Curve/LP accounts must be flagged isProtocolAccount. */
  holders: Array<{ address: string; pct: number; isProtocolAccount?: boolean }>;
  dev: { holdingPct: number; soldPctOfInitial: number };
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
}

export const PUMP_FILTERS = {
  minAgeMinutes: 15,           // skip the first-minutes snipe/bundle zone; an agent cannot win that race
  maxAgeHours: 48,
  bonding: { minMarketCapUsd: 10_000, minFeesSol: 0.1, minLiquidityUsd: 8_000 },
  migrated: { minLiquidityUsd: 25_000 },
  maxMarketCapUsd: 3_000_000,
  holders: { maxSingleWarnPct: 3.5, maxSingleFailPct: 5, maxTop10Pct: 30, bundleClusterWallets: 6, bundleSizeTolerance: 0.05 },
  dev: { maxHoldingPct: 5, maxSoldPctOfInitial: 25 },
  flow: { minUniqueTraders1h: 50, maxSellBuyRatio5m: 1.5, honeypotMinBuys: 20, maxPriceChange1hPct: 300 },
};

/** Execution caps for any order placed on these tokens. Replaces the playbook's 100% slippage. */
export const EXECUTION = {
  maxSlippagePct: 15,        // pre-migration curves are volatile, but unbounded slippage invites sandwiching
  maxPriceImpactPct: 5,
  maxOrderPctOfLiquidity: 1,
  maxPriorityFeeSol: 0.005,
  maxTipSol: 0.01,           // a fixed tip is a real % cost on small stacks; size orders so tip < 2% of the order
  maxTipPctOfOrder: 2,
};

export interface FilterResult { pass: boolean; failures: string[]; warnings: string[] }

/** Wallets holding near-identical balances are a classic bundled launch. */
export function bundledWallets(holders: PumpToken["holders"], tol: number): number {
  const sizes = holders.filter((h) => !h.isProtocolAccount).map((h) => h.pct).sort((a, b) => a - b);
  let best = 0;
  for (let i = 0; i < sizes.length; i++) {
    let j = i;
    while (j < sizes.length && sizes[j] <= sizes[i] * (1 + tol)) j++;
    best = Math.max(best, j - i);
  }
  return best;
}

export function evaluateToken(t: PumpToken, f = PUMP_FILTERS): FilterResult {
  const fail: string[] = [], warn: string[] = [];
  const need = (ok: boolean, msg: string) => { if (!ok) fail.push(msg); };

  need(t.ageMinutes >= f.minAgeMinutes, `age ${t.ageMinutes}m < ${f.minAgeMinutes}m`);
  need(t.ageMinutes <= f.maxAgeHours * 60, `age over ${f.maxAgeHours}h`);
  need(t.marketCapUsd <= f.maxMarketCapUsd, "market cap above ceiling");
  if (t.stage === "bonding") {
    need(t.marketCapUsd >= f.bonding.minMarketCapUsd, `mcap $${Math.round(t.marketCapUsd)} < $${f.bonding.minMarketCapUsd}`);
    need(t.feesSol >= f.bonding.minFeesSol, `fees ${t.feesSol} SOL < ${f.bonding.minFeesSol} (possible honeypot / fake volume)`);
    need(t.liquidityUsd >= f.bonding.minLiquidityUsd, "curve liquidity too thin to exit");
  } else {
    need(t.liquidityUsd >= f.migrated.minLiquidityUsd, `pool liquidity $${Math.round(t.liquidityUsd)} < $${f.migrated.minLiquidityUsd}`);
  }

  need(t.mintAuthorityRevoked, "mint authority not revoked");
  need(t.freezeAuthorityRevoked, "freeze authority not revoked");

  const real = t.holders.filter((h) => !h.isProtocolAccount).sort((a, b) => b.pct - a.pct);
  const top1 = real[0]?.pct ?? 0;
  need(top1 <= f.holders.maxSingleFailPct, `top holder ${top1.toFixed(1)}% > ${f.holders.maxSingleFailPct}%`);
  if (top1 > f.holders.maxSingleWarnPct && top1 <= f.holders.maxSingleFailPct) warn.push(`top holder ${top1.toFixed(1)}% above ${f.holders.maxSingleWarnPct}%`);
  const top10 = real.slice(0, 10).reduce((a, h) => a + h.pct, 0);
  need(top10 <= f.holders.maxTop10Pct, `top-10 holders ${top10.toFixed(0)}% > ${f.holders.maxTop10Pct}%`);
  const cluster = bundledWallets(t.holders, f.holders.bundleSizeTolerance);
  need(cluster < f.holders.bundleClusterWallets, `${cluster} wallets with near-identical balances (bundle)`);
  warn.push("whales can split wallets: holder checks lower risk, they do not remove it");

  need(t.dev.holdingPct <= f.dev.maxHoldingPct, `dev holds ${t.dev.holdingPct}% > ${f.dev.maxHoldingPct}%`);
  need(t.dev.soldPctOfInitial <= f.dev.maxSoldPctOfInitial, `dev already sold ${t.dev.soldPctOfInitial}% of initial`);

  const { m5, h1 } = t.txns;
  need(!(h1.sells === 0 && h1.buys >= f.flow.honeypotMinBuys), "buys with zero sells (honeypot pattern)");
  need(m5.buys === 0 ? m5.sells === 0 : m5.sells / m5.buys <= f.flow.maxSellBuyRatio5m, "sell pressure accelerating (5m sells/buys too high)");
  need(t.uniqueTraders1h >= f.flow.minUniqueTraders1h, `only ${t.uniqueTraders1h} unique traders in 1h`);
  need(t.priceChange.h1 <= f.flow.maxPriceChange1hPct, `already +${Math.round(t.priceChange.h1)}% in 1h (late entry)`);

  return { pass: fail.length === 0, failures: fail, warnings: warn };
}

/** Fee/tip cost guard: refuses orders where a fixed tip would eat the trade. */
export function executionOk(orderSol: number, tipSol: number): string | null {
  if (tipSol > EXECUTION.maxTipSol) return "tip above cap";
  if (orderSol > 0 && (tipSol / orderSol) * 100 > EXECUTION.maxTipPctOfOrder) return `tip is ${((tipSol / orderSol) * 100).toFixed(0)}% of the order`;
  return null;
}
