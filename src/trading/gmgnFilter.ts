/**
 * Hard filters on GMGN rank items (fields verified against live /v1/market/rank responses).
 * Vetoes only. Thresholds are starting hypotheses chosen from the live distribution (e.g. bundler_rate median ~0.09,
 * p90 ~0.32; rug_ratio median ~0.14) and must be tuned only from paper results.
 */
export const GMGN_FILTERS = {
  minLiquidityUsd: 25_000, minMarketCapUsd: 50_000, minHolders: 300,
  minAgeMin: 30, maxAgeH: 48,
  maxRugRatio: 0.3, maxBundlerRate: 0.25, maxTop10: 0.30, maxDevHold: 0.05, maxRatTrader: 0.05,
  maxSniperTop70: 0.10, maxEntrapment: 0.10, maxChange1hPct: 300, maxBuySellRatio: 8,
};

const n = (x: unknown) => (x === null || x === undefined || x === "" ? NaN : Number(x));

export function gmgnScreen(t: Record<string, any>, nowMs = Date.now(), f = GMGN_FILTERS): string[] {
  const fail: string[] = [];
  const ageMin = (nowMs / 1000 - n(t.creation_timestamp ?? t.open_timestamp)) / 60;
  if (!(n(t.liquidity) >= f.minLiquidityUsd)) fail.push("liq<25k");
  if (!(n(t.market_cap) >= f.minMarketCapUsd)) fail.push("mcap<50k");
  if (!(n(t.holder_count) >= f.minHolders)) fail.push("holders<300");
  if (!(ageMin >= f.minAgeMin)) fail.push("age<30m"); else if (ageMin > f.maxAgeH * 60) fail.push("age>48h");
  if (n(t.is_honeypot) === 1) fail.push("honeypot");
  if (t.is_wash_trading === true) fail.push("wash trading");
  if (n(t.renounced_mint) !== 1) fail.push("mint not renounced");
  if (n(t.renounced_freeze_account) !== 1) fail.push("freeze not renounced");
  if (n(t.rug_ratio) > f.maxRugRatio) fail.push(`rug_ratio ${n(t.rug_ratio).toFixed(2)}`);
  if (n(t.bundler_rate) > f.maxBundlerRate) fail.push(`bundlers ${(n(t.bundler_rate) * 100).toFixed(0)}%`);
  if (n(t.top_10_holder_rate) > f.maxTop10) fail.push(`top10 ${(n(t.top_10_holder_rate) * 100).toFixed(0)}%`);
  if (n(t.dev_team_hold_rate) > f.maxDevHold) fail.push(`dev holds ${(n(t.dev_team_hold_rate) * 100).toFixed(0)}%`);
  if (n(t.rat_trader_amount_rate) > f.maxRatTrader) fail.push("rat traders");
  if (n(t.top70_sniper_hold_rate) > f.maxSniperTop70) fail.push("snipers hold");
  if (n(t.entrapment_ratio) > f.maxEntrapment) fail.push("entrapment");
  if (n(t.price_change_percent1h) > f.maxChange1hPct) fail.push("late +300% 1h");
  const buys = n(t.buys), sells = n(t.sells);
  if (sells === 0 && buys > 20) fail.push("no sells"); else if (sells > 0 && buys / sells > f.maxBuySellRatio) fail.push("lopsided flow");
  return fail;
}

/** Compact research record (features kept for later outcome analysis). */
export function gmgnFeatures(t: Record<string, any>) {
  const k = ["address", "symbol", "price", "liquidity", "market_cap", "volume", "holder_count", "swaps", "buys", "sells", "price_change_percent1m", "price_change_percent5m", "price_change_percent1h",
    "smart_degen_count", "renowned_count", "rug_ratio", "bundler_rate", "top_10_holder_rate", "dev_team_hold_rate", "rat_trader_amount_rate", "sniper_count", "top70_sniper_hold_rate", "bot_degen_rate",
    "entrapment_ratio", "is_honeypot", "is_wash_trading", "creator_token_status", "launchpad_platform", "exchange", "creation_timestamp", "hot_level", "cto_flag", "twitter_dup", "website_dup"];
  return Object.fromEntries(k.map((x) => [x, t[x]]));
}
