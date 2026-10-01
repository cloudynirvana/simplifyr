/**
 * Second-opinion veto from RugCheck data, applied AFTER the market-data and flow filters.
 * Catches what a clean RugCheck score hides: linked "insider" wallets that individually look small.
 * Thresholds are starting hypotheses; tune from paper results.
 */
import type { RugCheckReport } from "../lib/rugcheck";
import { bundledWallets, PUMP_FILTERS } from "./pumpFilters";

export const RUGCHECK_FILTERS = {
  maxInsiderNetworkPct: 5,   // combined current holding of all linked-wallet networks
  maxCreatorPct: 5,
  minLpLockedPct: 90,
  maxTopHolderPct: 5,        // largest non-protocol holder
};

export function evaluateRugCheck(r: RugCheckReport, f = RUGCHECK_FILTERS): { pass: boolean; failures: string[] } {
  const fail: string[] = [];
  const supply = r.token.supply;

  if (r.rugged) fail.push("flagged as rugged");
  if (r.mintAuthority) fail.push("mint authority not revoked");
  if (r.freezeAuthority) fail.push("freeze authority not revoked");
  if ((r.transferFee?.pct ?? 0) > 0) fail.push(`transfer fee ${r.transferFee?.pct}%`);
  if (r.token_extensions?.permanentDelegate) fail.push("permanent delegate set");
  for (const risk of r.risks ?? []) if (risk.level === "danger") fail.push(`RugCheck danger: ${risk.name}`);

  const insiderPct = (r.insiderNetworks ?? []).reduce((a, n) => a + (n.currentHolding / supply) * 100, 0);
  if (insiderPct > f.maxInsiderNetworkPct) fail.push(`linked insider wallets hold ${insiderPct.toFixed(1)}% combined (> ${f.maxInsiderNetworkPct}%)`);

  if (r.creatorBalance !== undefined && (r.creatorBalance / supply) * 100 > f.maxCreatorPct) fail.push("creator holds too much");

  const protocol = new Set((r.markets ?? []).flatMap((m) => [m.pubkey, m.liquidityA, m.liquidityB]).filter(Boolean) as string[]);
  const holders = (r.topHolders ?? []).map((h) => {
    const address = h.owner ?? h.address ?? "";
    return { address, pct: h.pct, isProtocolAccount: protocol.has(address) };
  });
  const real = holders.filter((h) => !h.isProtocolAccount);
  if (real[0] && real[0].pct > f.maxTopHolderPct) fail.push(`top holder ${real[0].pct.toFixed(1)}% > ${f.maxTopHolderPct}%`);
  const cluster = bundledWallets(holders, PUMP_FILTERS.holders.bundleSizeTolerance);
  if (cluster >= PUMP_FILTERS.holders.bundleClusterWallets) fail.push(`${cluster} wallets with near-identical balances (bundle)`);

  const locked = Math.max(0, ...(r.markets ?? []).map((m) => m.lp?.lpLockedPct ?? 0));
  if (r.markets?.length && locked < f.minLpLockedPct) fail.push(`LP only ${locked.toFixed(0)}% locked`);

  return { pass: fail.length === 0, failures: fail };
}
