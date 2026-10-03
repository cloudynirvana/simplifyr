#!/usr/bin/env node
// 24/7 loop: SCAN smart-money/KOL buys -> cluster (>=3 wallets/1h) -> gates -> WATCHLIST ->
// enter on >=15% pullback -> manage: -35% stop, 1/3 @2x, 1/3 @4x, 25% trail on rest, exit on dev sell.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gmgn } from './lib.mjs';
import { gates } from './filter.mjs';
import { execute } from './hands.mjs';

const CHAIN = process.env.CHAIN ?? 'sol', POLL_MS = Number(process.env.POLL_S ?? 60) * 1000;
const SIZE = Number(process.env.ORDER_USD ?? 10), LIVE = process.env.LIVE_TRADING === '1';
const STATE = new URL('./state.json', import.meta.url).pathname;
const IGNORE = new Set(['So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { watch: {}, pos: {}, rejected: {} };
const save = () => writeFileSync(STATE, JSON.stringify(st, null, 1));

async function notify(msg) {
  console.log(new Date().toISOString(), msg);
  const { TELEGRAM_BOT_TOKEN: t, TELEGRAM_CHAT_ID: c } = process.env;
  if (t && c) await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c, text: msg }) }).catch(() => {});
}
const px = i => Number(i.price?.price);

async function scan() {
  const now = Math.floor(Date.now() / 1000), by = new Map();
  for (const src of ['smartmoney', 'kol']) {
    for (const t of gmgn(['track', src, '--chain', CHAIN, '--limit', '100']).list ?? []) {
      if (IGNORE.has(t.base_address) || t.side !== 'buy' || now - t.timestamp > 3600) continue;
      const c = by.get(t.base_address) ?? { sym: t.base_token?.symbol, w: new Set() };
      c.w.add(t.maker); by.set(t.base_address, c);
    }
  }
  for (const [tok, c] of by) {
    if (c.w.size < 3 || st.watch[tok] || st.pos[tok] || st.rejected[tok]) continue;
    const info = gmgn(['token', 'info', '--chain', CHAIN, '--address', tok]);
    const sec = gmgn(['token', 'security', '--chain', CHAIN, '--address', tok]);
    const fail = gates(sec, info);
    if (fail.length) {
      // retry-able reasons (age/smart wallets) are re-checked later; hard fails are final
      const soft = fail.every(r => ['too_new', 'too_few_smart_wallets'].includes(r));
      if (!soft) st.rejected[tok] = { sym: c.sym, fail, ts: now };
      continue;
    }
    st.watch[tok] = { sym: c.sym, peak: px(info), ts: now, creator: info.dev?.creator_token_balance };
    await notify(`WATCH ${c.sym} ${tok} wallets=${c.w.size} px=${px(info)}`);
  }
}

async function manage() {
  const now = Math.floor(Date.now() / 1000);
  for (const [tok, w] of Object.entries(st.watch)) {
    const info = gmgn(['token', 'info', '--chain', CHAIN, '--address', tok]), p = px(info);
    if (now - w.ts > 7200) { delete st.watch[tok]; continue; }
    w.peak = Math.max(w.peak, p);
    const sec = gmgn(['token', 'security', '--chain', CHAIN, '--address', tok]);
    if (gates(sec, info).some(r => !['too_new', 'too_few_smart_wallets'].includes(r))) {
      st.rejected[tok] = { sym: w.sym, fail: 'regate', ts: now }; delete st.watch[tok]; continue; }
    if (p <= w.peak * 0.85) {
      const r = await execute({ side: 'buy', token: tok, usd: SIZE, px: p }, { live: LIVE });
      st.pos[tok] = { sym: w.sym, entry: p, peak: p, left: 1, tp1: false, tp2: false,
                      creator: Number(info.dev?.creator_token_balance), mode: r.mode };
      delete st.watch[tok];
      await notify(`BUY[${r.mode}] ${w.sym} $${SIZE} @${p} (pullback from ${w.peak})`);
    }
  }
  for (const [tok, q] of Object.entries(st.pos)) {
    const info = gmgn(['token', 'info', '--chain', CHAIN, '--address', tok]), p = px(info);
    q.peak = Math.max(q.peak, p);
    const x = p / q.entry, sell = async (frac, why) => {
      await execute({ side: 'sell', token: tok, usd: SIZE * frac * q.left * x, px: p }, { live: LIVE });
      q.left = +(q.left - frac * q.left).toFixed(4); await notify(`SELL ${q.sym} ${why} x${x.toFixed(2)}`); };
    const devSold = Number(info.dev?.creator_token_balance) < q.creator * 0.9;
    if (devSold) { await sell(1, 'DEV SOLD'); q.left = 0; }
    else if (x <= 0.65) { await sell(1, 'STOP -35%'); q.left = 0; }
    else {
      if (!q.tp1 && x >= 2) { q.tp1 = true; await sell(1 / 3, 'TP1 2x'); }
      if (!q.tp2 && x >= 4) { q.tp2 = true; await sell(0.5, 'TP2 4x'); }
      if (q.tp1 && p <= q.peak * 0.75) { await sell(1, 'TRAIL -25%'); q.left = 0; }
    }
    if (q.left <= 0.001) delete st.pos[tok];
  }
}

async function loop() {
  for (;;) {
    try { await scan(); await manage(); save(); } catch (e) { console.error('cycle error:', e.message); }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
if (process.argv.includes('--once')) { await scan(); await manage(); save(); console.log(JSON.stringify({ watch: st.watch, pos: st.pos, rejected: Object.keys(st.rejected).length }, null, 1)); }
else loop();
