#!/usr/bin/env node
// Wallet research for mirroring. `node trading/wallets.mjs discover` (from smart-money/KOL feeds), `vet <addr>`, `add <addr>`, `list`.
// A wallet is mirrored only if it passes vetting. Thresholds are starting points, tune from paper results.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gmgn } from './lib.mjs';

const FILE = new URL('./wallets.json', import.meta.url).pathname, CHAIN = process.env.CHAIN ?? 'sol';
const EXCLUDE_TAGS = (process.env.EXCLUDE_TAGS ?? 'arbitrager,sniper,bundler').split(',');
export const VET = { minWinrate: 0.45, minRealizedUsd: 50, minRoi: 0.05, maxCreated: 20, minBuys: 15, maxBuys: 600 };

export const loadWallets = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {});
const saveWallets = w => writeFileSync(FILE, JSON.stringify(w, null, 1));

export function vetWallet(w, chain = CHAIN) {
  const s = gmgn(['portfolio', 'stats', '--chain', chain, '--wallet', w, '--period', '30d']);
  const n = Number, p = s.pnl_stat ?? {}, tags = s.common?.tags ?? [], why = [];
  if (n(p.winrate) < VET.minWinrate) why.push('low_winrate');
  if (n(s.realized_profit) < VET.minRealizedUsd) why.push('low_profit');
  if (n(s.realized_profit_pnl) < VET.minRoi) why.push('low_roi');
  if (n(s.common?.created_token_count) > VET.maxCreated) why.push('is_dev_or_launcher');
  if (n(s.buy) < VET.minBuys) why.push('too_few_trades');
  if (n(s.buy) > VET.maxBuys) why.push('bot_like_volume');
  if (tags.some(t => EXCLUDE_TAGS.includes(t))) why.push('excluded_tag:' + tags.filter(t => EXCLUDE_TAGS.includes(t)).join('+'));
  return { ok: !why.length, why, ts: Date.now(), tags, winrate: n(p.winrate), profitUsd: n(s.realized_profit),
           roi: n(s.realized_profit_pnl), buys: s.buy, created: n(s.common?.created_token_count) };
}

async function discover() {
  const cnt = new Map();
  for (const src of ['smartmoney', 'kol'])
    for (const t of gmgn(['track', src, '--chain', CHAIN, '--limit', '100']).list ?? []) cnt.set(t.maker, (cnt.get(t.maker) ?? 0) + 1);
  const all = loadWallets();
  for (const [w] of [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    if (all[w]) continue;
    try { all[w] = vetWallet(w); console.log(w, all[w].ok ? 'PASS' : 'fail ' + all[w].why.join(',')); } catch (e) { console.log(w, 'error', e.message); }
  }
  saveWallets(all);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, addr] = process.argv.slice(2);
  if (cmd === 'discover') await discover();
  else if (cmd === 'vet' || cmd === 'add') {
    const v = vetWallet(addr); console.log(JSON.stringify(v, null, 1));
    if (cmd === 'add') { const a = loadWallets(); a[addr] = v; saveWallets(a); }
  } else console.log(Object.entries(loadWallets()).map(([w, v]) => `${v.ok ? 'MIRROR' : 'skip  '} ${w} wr=${v.winrate?.toFixed(2)} profit=$${v.profitUsd?.toFixed(0)} ${v.why?.join(',')}`).join('\n'));
}
