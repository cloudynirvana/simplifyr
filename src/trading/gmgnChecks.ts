/**
 * GMGN-only security and holder checks (replace RugCheck in the GMGN-exclusive pipeline).
 * Holder semantics follow GMGN's own gmgn-holder-analysis skill: addr_type 0 = wallet, 1 = burn, 2 = DEX pool;
 * maker_token_tags marks bundler / rat_trader / sniper / creator wallets. All thresholds live here.
 */
import { bundledWallets } from "./pumpFilters";

export const HOLDER_FILTERS = { maxTop1: 0.05, maxTop10: 0.30, maxInsiderShare: 0.10, maxCreator: 0.05, clusterWallets: 6, clusterTol: 0.05, clusterMinShare: 0.005 };

const frac = (v: unknown) => { const x = Number(v); return !Number.isFinite(x) ? 0 : x > 1.0001 ? x / 100 : x; }; // accepts fraction or percent
const truthy = (v: unknown) => v === true || v === 1 || v === "1";

export function securityScreen(sec: Record<string, any> | null | undefined): string[] {
  if (!sec) return ["security data missing"];
  const f: string[] = [];
  if (truthy(sec.honeypot) || truthy(sec.is_honeypot)) f.push("honeypot");
  if (truthy(sec.can_not_sell)) f.push("cannot sell");
  if (!truthy(sec.renounced_mint)) f.push("mint not renounced");
  if (!truthy(sec.renounced_freeze_account)) f.push("freeze not renounced");
  if (Number(sec.buy_tax) > 0.10 || Number(sec.sell_tax) > 0.10) f.push("tax > 10%");
  if (truthy(sec.is_blacklist) || truthy(sec.blacklist)) f.push("blacklist");
  return f;
}

export function holderScreen(list: any[], h = HOLDER_FILTERS): { failures: string[]; stats: Record<string, number> } {
  const wallets = list.filter((x) => Number(x.addr_type ?? 0) === 0);
  const share = (x: any) => frac(x.amount_percentage);
  const sorted = wallets.map(share).sort((a, b) => b - a);
  const top1 = sorted[0] ?? 0, top10 = sorted.slice(0, 10).reduce((a, b) => a + b, 0);
  const tag = (x: any, t: string) => (x.maker_token_tags ?? []).includes(t);
  const insider = wallets.filter((x) => tag(x, "bundler") || tag(x, "rat_trader") || tag(x, "sniper")).reduce((a, x) => a + share(x), 0);
  const creator = wallets.filter((x) => tag(x, "creator")).reduce((a, x) => a + share(x), 0);
  const cluster = bundledWallets(wallets.filter((x) => share(x) >= h.clusterMinShare).map((x) => ({ address: x.address, pct: share(x) * 100 })), h.clusterTol);
  const f: string[] = [];
  if (!list.length) f.push("holder data missing");
  if (top1 > h.maxTop1) f.push("top holder > 5%");
  if (top10 > h.maxTop10) f.push("top10 wallets > 30%");
  if (insider > h.maxInsiderShare) f.push("bundler/rat/sniper wallets > 10%");
  if (creator > h.maxCreator) f.push("creator > 5%");
  if (cluster >= h.clusterWallets) f.push("identical-balance cluster");
  return { failures: f, stats: { wallets: wallets.length, top1, top10, insider, creator, cluster } };
}

/** Best-effort mark extraction from /v1/token/info (shape verified only partially; unknown shapes are logged by the engine). */
export function extractMark(info: any): { px: number; liqUsd: number; m5?: { buys: number; sells: number } } | null {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const px = num(info?.price?.price ?? (typeof info?.price !== "object" ? info?.price : undefined) ?? info?.price_usd);
  if (!(px > 0)) return null;
  const liq = num(info?.liquidity ?? info?.pool?.liquidity ?? info?.pool_info?.liquidity);
  const bv = num(info?.price?.buy_volume_5m), sv = num(info?.price?.sell_volume_5m);
  return { px, liqUsd: Number.isFinite(liq) ? liq : 0, ...(bv > 0 && Number.isFinite(sv) ? { m5: { buys: bv, sells: sv } } : {}) };
}
