#!/usr/bin/env node
// EYES: "watch people, not charts" (laoyingkhq): catch capital moves -> vet wallets -> alert -> enter before retail.
// Step 1 catch flows: smart-money + KOL buys. Step 2 cluster: >=N distinct wallets on one token.
// Step 3 vet: token security + holder red flags. Output: ranked candidates JSON (no orders placed).
import { gmgn } from './lib.mjs';

const chain = process.argv[2] ?? 'sol';
const MIN_WALLETS = Number(process.env.MIN_CLUSTER ?? 2);
const WINDOW_S = Number(process.env.WINDOW_S ?? 3600);
const IGNORE = new Set(['So11111111111111111111111111111111111111112','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
const now = Math.floor(Date.now() / 1000);

const flows = [];
for (const src of ['smartmoney', 'kol']) {
  const r = gmgn(['track', src, '--chain', chain, '--limit', '100']);
  for (const t of r.list ?? []) flows.push({ ...t, src });
}

const byToken = new Map();
for (const t of flows) {
  if (IGNORE.has(t.base_address) || t.side !== 'buy' || now - t.timestamp > WINDOW_S) continue;
  const c = byToken.get(t.base_address) ??
    { token: t.base_address, symbol: t.base_token?.symbol, wallets: new Set(), usd: 0, srcs: new Set() };
  c.wallets.add(t.maker); c.usd += t.amount_usd ?? 0; c.srcs.add(t.src);
  byToken.set(t.base_address, c);
}

const cands = [...byToken.values()].filter(c => c.wallets.size >= MIN_WALLETS)
  .sort((a, b) => b.wallets.size - a.wallets.size || b.usd - a.usd).slice(0, 10);

const out = [];
for (const c of cands) {
  let sec = null, flags = [];
  try {
    sec = gmgn(['token', 'security', '--chain', chain, '--address', c.token]);
    if (sec.is_honeypot === 1 || sec.is_honeypot === true) flags.push('honeypot');
    if (Number(sec.top_10_holder_rate) > 0.5) flags.push('top10>50%');
    if (Number(sec.rug_ratio) > 0.3) flags.push('rug_ratio>0.3');
  } catch (e) { flags.push('security_check_failed'); }
  out.push({ symbol: c.symbol, token: c.token, wallets: c.wallets.size, usd: Math.round(c.usd),
             sources: [...c.srcs], flags, verdict: flags.length ? 'SKIP' : 'WATCH' });
}
console.log(JSON.stringify({ chain, window_s: WINDOW_S, min_wallets: MIN_WALLETS, candidates: out }, null, 2));
