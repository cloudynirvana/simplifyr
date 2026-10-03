#!/usr/bin/env node
// 24/7 loop: SCAN smart-money/KOL buys -> cluster (>=3 wallets/1h) -> gates -> WATCHLIST ->
// enter on >=15% pullback -> manage: -35% stop, 1/3 @2x, 1/3 @4x, 25% trail on rest, exit on dev sell.
// Every decision and fill is journaled (journal.jsonl); rejected tokens are followed up at +1h/+4h so we can
// measure whether the filter is catching rugs (good) or missing winners (too strict).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gmgn, journal } from './lib.mjs';
import { gates } from './filter.mjs';
import { execute } from './hands.mjs';

const CHAIN = process.env.CHAIN ?? 'sol', POLL_MS = Number(process.env.POLL_S ?? 60) * 1000;
const SIZE = Number(process.env.ORDER_USD ?? 10), LIVE = process.env.LIVE_TRADING === '1';
const MAX_OPEN = Number(process.env.MAX_OPEN ?? 5), DAILY_STOP = Number(process.env.DAILY_LOSS_USD ?? 30);
const SOFT = ['too_new', 'too_few_smart_wallets'];
const STATE = new URL('./state.json', import.meta.url).pathname;
const IGNORE = new Set(['So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { watch: {}, pos: {}, rejected: {}, day: {} };
st.day ??= {};
const save = () => writeFileSync(STATE, JSON.stringify(st, null, 1));
const today = () => new Date().toISOString().slice(0, 10);

async function notify(msg) {
  console.log(new Date().toISOString(), msg);
  const { TELEGRAM_BOT_TOKEN: t, TELEGRAM_CHAT_ID: c } = process.env;
  if (t && c) await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c, text: msg }) }).catch(() => {});
}
const px = i => Number(i.price?.price);
const info = tok => gmgn(['token', 'info', '--chain', CHAIN, '--address', tok]);
const sec = tok => gmgn(['token', 'security', '--chain', CHAIN, '--address', tok]);
const snap = (s, i) => ({ top10: +s.top_10_holder_rate, creatorHold: +i.stat?.creator_hold_rate, bundler: +i.stat?.top_bundler_trader_percentage,
  fresh: +i.stat?.fresh_wallet_rate, smart: i.wallet_tags_stat?.smart_wallets, liq: +i.liquidity, holders: i.holder_count });

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
    const i = info(tok), s = sec(tok), fail = gates(s, i);
    if (fail.length) {
      if (!fail.every(r => SOFT.includes(r))) {          // hard fail: final, but follow its price for calibration
        st.rejected[tok] = { sym: c.sym, fail, ts: now, px0: px(i), done: [] };
        journal({ event: 'reject', token: tok, sym: c.sym, fail, px0: px(i), snap: snap(s, i) });
      }
      continue;
    }
    st.watch[tok] = { sym: c.sym, peak: px(i), ts: now };
    journal({ event: 'signal', token: tok, sym: c.sym, wallets: c.w.size, px: px(i), snap: snap(s, i) });
    await notify(`WATCH ${c.sym} ${tok} wallets=${c.w.size} px=${px(i)}`);
  }
}

async function closeTrip(tok, q, reason) {
  const pnlUsd = q.proceeds - q.cost;
  journal({ event: 'close', token: tok, sym: q.sym, reason, pnlUsd, pnlPct: pnlUsd / q.cost * 100, costsUsd: q.costs,
            holdS: Math.floor(Date.now() / 1000) - q.openedTs, mode: q.mode });
  st.day[today()] = (st.day[today()] ?? 0) + pnlUsd;
  delete st.pos[tok];
  await notify(`CLOSED ${q.sym} ${reason} pnl ${pnlUsd.toFixed(2)} (${(pnlUsd / q.cost * 100).toFixed(0)}%)`);
}

async function sell(tok, q, frac, why) {
  const r = await execute({ side: 'sell', token: tok, units: q.units * frac, px: q.lastPx }, { live: LIVE });
  if (!r.ok) { await notify(`SELL FAILED ${q.sym} ${why} (${r.reason}) — will retry next cycle`); return false; }
  q.units -= r.units; q.proceeds += r.usd; q.costs += r.costUsd;
  await notify(`SELL[${r.mode}] ${q.sym} ${why} fill ${r.fillPx.toPrecision(4)} slip ${r.slipPct.toFixed(1)}%`);
  if (frac >= 1 || q.units < 1e-9) await closeTrip(tok, q, why);
  return true;
}

async function manage() {
  const now = Math.floor(Date.now() / 1000);
  const haltedToday = (st.day[today()] ?? 0) <= -DAILY_STOP;
  for (const [tok, w] of Object.entries(st.watch)) {
    if (now - w.ts > 7200) { delete st.watch[tok]; continue; }
    const i = info(tok), p = px(i);
    w.peak = Math.max(w.peak, p);
    if (gates(sec(tok), i).some(r => !SOFT.includes(r))) {
      st.rejected[tok] = { sym: w.sym, fail: ['regate'], ts: now, px0: p, done: [] }; delete st.watch[tok]; continue; }
    if (p <= w.peak * 0.85) {
      if (haltedToday || Object.keys(st.pos).length >= MAX_OPEN) continue;   // risk limits: skip, keep watching
      const r = await execute({ side: 'buy', token: tok, usd: SIZE, px: p }, { live: LIVE });
      if (!r.ok) { await notify(`BUY MISSED ${w.sym} (${r.reason})`); continue; }
      st.pos[tok] = { sym: w.sym, entryPx: r.fillPx, peak: r.fillPx, lastPx: r.fillPx, units: r.units, cost: SIZE, proceeds: 0,
                      costs: r.costUsd, openedTs: now, creator: Number(i.dev?.creator_token_balance), tp1: false, tp2: false, mode: r.mode };
      delete st.watch[tok];
      await notify(`BUY[${r.mode}] ${w.sym} $${SIZE} fill ${r.fillPx.toPrecision(4)} slip ${r.slipPct.toFixed(1)}% (signal px ${p})`);
    }
  }
  for (const [tok, q] of Object.entries(st.pos)) {
    const i = info(tok), p = px(i), x = p / q.entryPx;
    q.peak = Math.max(q.peak, p); q.lastPx = p;
    if (Number(i.dev?.creator_token_balance) < q.creator * 0.9) { await sell(tok, q, 1, 'dev_sold'); continue; }
    if (x <= 0.65) { await sell(tok, q, 1, 'stop_-35%'); continue; }
    if (!q.tp1 && x >= 2 && await sell(tok, q, 1 / 3, 'tp1_2x')) q.tp1 = true;
    if (st.pos[tok] && !q.tp2 && x >= 4 && await sell(tok, q, 0.5, 'tp2_4x')) q.tp2 = true;
    if (st.pos[tok] && q.tp1 && p <= q.peak * 0.75) await sell(tok, q, 1, 'trail_-25%');
  }
  // calibration: price of hard-rejected tokens at +1h / +4h (did the filter save us, or miss a winner?)
  for (const [tok, r] of Object.entries(st.rejected)) {
    for (const h of [1, 4]) {
      if (r.done?.includes(h) || now - r.ts < h * 3600 || now - r.ts > h * 3600 + 1800) continue;
      try { const p = px(info(tok)); journal({ event: 'reject_followup', token: tok, sym: r.sym, hours: h, x: p / r.px0, fail: r.fail }); } catch { }
      (r.done ??= []).push(h);
    }
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
