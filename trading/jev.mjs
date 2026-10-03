// BRAIN (optional): TypeSafe Jev scores each candidate that passed the hard gates. It returns typed probabilities,
// not text, and never places trades. JEV_MODE=shadow (default): verdict is journaled only, so paper stats can show
// whether following Jev would have helped. JEV_MODE=veto: also skip entries Jev flags (action=skip or rug >= JEV_RUG_MAX).
import './lib.mjs';
export const JEV_MODE = process.env.JEV_MODE ?? 'shadow', JEV_RUG_MAX = Number(process.env.JEV_RUG_MAX ?? 0.5);

export function jevState(s, i, extra = {}) {
  const st = i.stat ?? {}, p = i.price ?? {}, n = Number;
  return { symbol: i.symbol, age_min: Math.round((Date.now() / 1000 - n(i.creation_timestamp)) / 60), liquidity_usd: Math.round(n(i.liquidity)),
    holders: i.holder_count, top10_holder_rate: n(s.top_10_holder_rate), bundler_pct: n(st.top_bundler_trader_percentage),
    bot_degen_pct: n(st.top_bot_degen_percentage), fresh_wallet_rate: n(st.fresh_wallet_rate), smart_wallets: i.wallet_tags_stat?.smart_wallets,
    sniper_wallets: i.wallet_tags_stat?.sniper_wallets, creator_hold_rate: n(st.creator_hold_rate), creator_created_count: n(st.creator_created_count),
    dev_twitter_token_launches: n(i.dev?.twitter_create_token_count), dev_funded_from: i.dev?.fund_from,
    buys_5m: p.buys_5m, sells_5m: p.sells_5m, price_vs_1h: p.price_1h ? +(n(p.price) / n(p.price_1h)).toFixed(3) : null,
    price_vs_ath: i.ath_price ? +(n(p.price) / n(i.ath_price)).toFixed(3) : null, ...extra };
}

export async function jevAssess(state) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return null;
  const body = { model: 'jev-latest', state, questions: {
    dev_rug_24h: { type: 'noul', instructions: 'Will the developer or insiders rug or dump this Solana memecoin within 24 hours?' },
    action: { type: 'choice', instructions: 'Best action for a patient memecoin trader right now', criteria: {
      enter_now: 'setup is strong and not overextended', wait_for_pullback: 'good token but price is extended',
      skip: 'risk of rug, dump or manipulation is too high' } } } };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 429 || r.status === 529) { await new Promise(res => setTimeout(res, 2000 * 2 ** attempt)); continue; }
      if (!r.ok) return { error: `http ${r.status}` };
      const a = (await r.json()).answers;
      return { rug: a.dev_rug_24h.noul, action: a.action.choice, conf: a.action.confidence, probs: a.action.probabilities };
    } catch (e) { if (attempt === 2) return { error: e.message }; }
  }
  return { error: 'rate_limited' };
}
export const jevVeto = j => JEV_MODE === 'veto' && j && !j.error && (j.action === 'skip' || j.rug >= JEV_RUG_MAX);
