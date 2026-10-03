// The agreed filter. Field names verified against live `gmgn-cli token security|info` output.
export const CFG = {
  maxTop10: 0.30, maxCreatorHold: 0.02, maxCreatorLaunches: 3, maxBundler: 0.20, maxBotDegen: 0.20,
  maxFresh: 0.50, minSmartWallets: 3, minLiquidityUsd: 30000, minAgeS: 900, maxAgeS: 6 * 3600, maxTax: 3,
};

// Returns list of failure reasons ([] = pass).
export function gates(sec, info, now = Math.floor(Date.now() / 1000), c = CFG) {
  const f = [], n = Number, st = info.stat ?? {}, dev = info.dev ?? {}, w = info.wallet_tags_stat ?? {};
  // Gate 1: hard safety
  if (n(sec.honeypot) || sec.is_honeypot) f.push('honeypot');
  if (n(sec.can_not_sell)) f.push('cannot_sell');
  if (n(sec.buy_tax) > c.maxTax || n(sec.sell_tax) > c.maxTax) f.push('tax');
  if (sec.renounced_mint !== true) f.push('mint_not_renounced');
  if (sec.renounced_freeze_account !== true) f.push('freeze_not_renounced');
  if (n(sec.top_10_holder_rate) > c.maxTop10) f.push('top10_holders');
  // Gate 2: dev rug / nuke
  if (n(st.creator_hold_rate) > c.maxCreatorHold) f.push('dev_holds_bag');
  if (n(st.creator_created_count) > c.maxCreatorLaunches) f.push('serial_launcher');
  if (n(dev.twitter_del_post_token_count) > 0) f.push('deleted_token_posts');
  if ((dev.twitter_name_change_history ?? []).length) f.push('twitter_renamed');
  if (n(info.image_dup_count) > 0) f.push('copied_image');
  // Gate 3: holder quality
  if (n(st.top_bundler_trader_percentage) > c.maxBundler) f.push('bundlers');
  if (n(st.top_bot_degen_percentage) > c.maxBotDegen) f.push('bots');
  if (n(st.fresh_wallet_rate) > c.maxFresh) f.push('fresh_wallets');
  if (n(w.smart_wallets) < c.minSmartWallets) f.push('too_few_smart_wallets');
  // Gate 4: liquidity + age
  if (n(info.liquidity) < c.minLiquidityUsd) f.push('low_liquidity');
  const age = now - n(info.creation_timestamp);
  if (age < c.minAgeS) f.push('too_new');
  if (age > c.maxAgeS) f.push('too_old');
  return f;
}
