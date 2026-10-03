#!/usr/bin/env node
// Memecoin paper bot. Two speeds:
//  FAST (every POS_POLL_S=15s): manage open positions - rugs and dumps happen in minutes, exits come first.
//  SLOW (every POLL_S=60s): scan smart-money/KOL flow, vet candidates, read wave phase, mirror vetted wallets.
// Entry (cluster): >=3 smart/KOL wallets bought in 1h -> hard gates -> WATCHLIST -> enter only on a HEALTHY PULLBACK
//   with buyers returning (dynamics.mjs). ENTRY_MODE=pullback restores the old "15% off the peak" trigger.
// Exits, memecoin-specific first: dev sold, liquidity pulled, smart money/KOLs selling, source wallet sold (mirror),
//   sell wave, hard stop -35%, stale (no move in STALE_MIN), then 1/3 @2x, 1/3 @4x, trail -25% from peak.
// Everything is journaled with features at entry and exit, so the edge can be researched from data, not feelings.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gmgn, journal, RateLimited, rateLimitWaitMs } from './lib.mjs';
import { gates, CFG } from './filter.mjs';
import { execute } from './hands.mjs';
import { notify } from './telegram.mjs';
import { loadWallets } from './wallets.mjs';
import { computeStats } from './stats.mjs';
import { jevAssess, jevState, jevVeto } from './jev.mjs';
import { klineFeatures, flow, phase, waveEntry, BAD_PHASES } from './dynamics.mjs';

const env = (k, d) => Number(process.env[k] ?? d);
const CHAIN = process.env.CHAIN ?? 'sol', ENTRY_MODE = process.env.ENTRY_MODE ?? 'wave';
const POLL_MS = env('POLL_S', 60) * 1000, POS_POLL_MS = env('POS_POLL_S', 15) * 1000;
const SIZE = env('ORDER_USD', 10), MAX_OPEN = env('MAX_OPEN', 5), DAILY_STOP = env('DAILY_LOSS_USD', 30);
const BANKROLL = env('BANKROLL_USD', 100), STALE_MIN = env('STALE_MIN', 45);
const SOFT = ['too_new', 'too_few_smart_wallets'];
const MIRROR_CFG = { minAgeS: 300, minSmartWallets: 0 }, MIRROR_MAX_LAG_S = env('MIRROR_MAX_LAG_S', 120);
const STATE = new URL('./state.json', import.meta.url).pathname;
const IGNORE = new Set(['So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
for (const k of ['watch', 'pos', 'rejected', 'day', 'mirror', 'sells']) st[k] ??= {};
const save = () => writeFileSync(STATE, JSON.stringify(st, null, 1));
const today = () => new Date().toISOString().slice(0, 10);
const nowS = () => Math.floor(Date.now() / 1000);
// Virtual bankroll: cash = bankroll + realized PnL - capital tied up in open positions. No buy if cash < SIZE.
const cash = () => BANKROLL + computeStats().totalPnlUsd - Object.values(st.pos).reduce((a, q) => a + q.cost, 0);
const canBuy = () => Object.keys(st.pos).length < MAX_OPEN && cash() >= SIZE && (st.day[today()] ?? 0) > -DAILY_STOP;

const px = i => Number(i.price?.price);
const info = (tok, ttlMs) => gmgn(['token', 'info', '--chain', CHAIN, '--address', tok], ttlMs === undefined ? {} : { ttlMs });
const sec = tok => gmgn(['token', 'security', '--chain', CHAIN, '--address', tok]);
function candles(tok) {                                        // last 60 x 1m candles; failure is journaled, never silent
  const t = nowS();
  try { return klineFeatures(gmgn(['market', 'kline', '--chain', CHAIN, '--address', tok, '--resolution', '1m', '--from', String(t - 3600), '--to', String(t)], { ttlMs: 50000 }).list); }
  catch (e) { if (e instanceof RateLimited) throw e; journal({ event: 'kline_error', token: tok, err: String(e.message).slice(0, 200) }); return null; }
}
const snap = (s, i) => ({ top10: +s.top_10_holder_rate, creatorHold: +i.stat?.creator_hold_rate, bundler: +i.stat?.top_bundler_trader_percentage,
  fresh: +i.stat?.fresh_wallet_rate, smart: i.wallet_tags_stat?.smart_wallets, liq: +i.liquidity, holders: i.holder_count });
const feats = (kf, fl) => ({ phase: phase(kf, fl), kf, fl });
const reject = (tok, sym, fail, p0, extra = {}) => {
  st.rejected[tok] = { sym, fail, ts: nowS(), px0: p0, done: [] };
  journal({ event: 'reject', token: tok, sym, fail, px0: p0, ...extra });
};

// ---------- SLOW LOOP ----------
async function scan() {
  const now = nowS(), by = new Map();
  for (const src of ['smartmoney', 'kol']) {
    for (const t of gmgn(['track', src, '--chain', CHAIN, '--limit', '100']).list ?? []) {
      if (IGNORE.has(t.base_address) || now - t.timestamp > 3600) continue;
      if (t.side === 'sell') {                               // remember smart/KOL selling: an exit signal for our holdings
        const s = (st.sells[t.base_address] ??= {}); s[t.maker] = Math.max(s[t.maker] ?? 0, t.timestamp); continue;
      }
      if (t.side !== 'buy') continue;
      const c = by.get(t.base_address) ?? { sym: t.base_token?.symbol, w: new Set() };
      c.w.add(t.maker); by.set(t.base_address, c);
    }
  }
  for (const [tok, s] of Object.entries(st.sells)) {          // prune old sell memory
    for (const [m, ts] of Object.entries(s)) if (now - ts > 6 * 3600) delete s[m];
    if (!Object.keys(s).length) delete st.sells[tok];
  }
  for (const [tok, c] of by) {
    if (c.w.size < 3 || st.watch[tok] || st.pos[tok] || st.rejected[tok]) continue;
    const i = info(tok), s = sec(tok), fail = gates(s, i);
    if (fail.length) { if (!fail.every(r => SOFT.includes(r))) reject(tok, c.sym, fail, px(i), { snap: snap(s, i) }); continue; }
    const kf = candles(tok), fl = flow(i), f = feats(kf, fl);
    const jev = await jevAssess(jevState(s, i, { wave_phase: f.phase, drawdown_from_high: kf?.drawdown, slope_20m: kf?.slope,
      buy_ratio_1m: fl.buyRatio1m, buy_ratio_5m: fl.buyRatio5m, volume_accel: fl.volAccel }));
    journal({ event: 'signal', token: tok, sym: c.sym, wallets: c.w.size, px: px(i), snap: snap(s, i), ...f, jev });
    if (jevVeto(jev)) { reject(tok, c.sym, ['jev_veto'], px(i), { jev }); continue; }
    st.watch[tok] = { sym: c.sym, peak: px(i), ts: now, jev, wallets: c.w.size };
    await notify(`WATCH ${c.sym} ${tok} wallets=${c.w.size} phase=${f.phase}${jev && !jev.error ? ` | Jev ${jev.action} ${(jev.conf * 100).toFixed(0)}%, rug ${(jev.rug * 100).toFixed(0)}%` : ''}`);
  }
}

async function watchlist() {
  const now = nowS();
  for (const [tok, w] of Object.entries(st.watch)) {
    if (now - w.ts > 7200) { journal({ event: 'watch_expired', token: tok, sym: w.sym }); delete st.watch[tok]; continue; }
    const i = info(tok), p = px(i);
    w.peak = Math.max(w.peak, p);
    if (gates(sec(tok), i).some(r => !SOFT.includes(r))) { reject(tok, w.sym, ['regate'], p); delete st.watch[tok]; continue; }
    const kf = candles(tok), fl = flow(i), f = feats(kf, fl);
    if (BAD_PHASES.includes(f.phase)) { reject(tok, w.sym, ['phase_' + f.phase], p, f); delete st.watch[tok]; continue; }
    const trigger = ENTRY_MODE === 'pullback' ? p <= w.peak * 0.85 : waveEntry(kf ?? {}, fl).ok;
    if (!trigger || !canBuy()) continue;
    await openPos(tok, { sym: w.sym, strategy: 'cluster', jev: w.jev, i, p, f });
  }
}

async function openPos(tok, { sym, strategy, src, jev, i, p, f }) {
  const r = await execute({ side: 'buy', token: tok, usd: SIZE, px: p });
  if (!r.ok) { journal({ event: 'buy_missed', token: tok, sym, reason: r.reason }); await notify(`BUY MISSED ${sym} (${r.reason})`); return null; }
  st.pos[tok] = { sym, strategy, src, jev, entryPx: r.fillPx, peak: r.fillPx, lastPx: r.fillPx, units: r.units, cost: SIZE, proceeds: 0,
    costs: r.costUsd, openedTs: nowS(), creator: Number(i.dev?.creator_token_balance), entryLiq: Number(i.liquidity), tp1: false, tp2: false,
    entry: f, mode: r.mode };
  delete st.watch[tok];
  journal({ event: 'entry', token: tok, sym, strategy, src, fillPx: r.fillPx, signalPx: p, ...f, jev });
  await notify(`BUY[${r.mode}] ${strategy} ${sym} $${SIZE} fill ${r.fillPx.toPrecision(4)} slip ${r.slipPct.toFixed(1)}% phase=${f.phase}`);
  return r;
}

// Wallet mirroring: copy fresh buys of VETTED wallets; same gates minus smart-wallet count; refuse bad wave phases.
async function mirrorScan() {
  const now = nowS();
  for (const [w, v] of Object.entries(loadWallets())) {
    if (!v.ok) continue;
    const m = (st.mirror[w] ??= { last: now });             // first sight: start from now, never backfill old trades
    const acts = gmgn(['portfolio', 'activity', '--chain', CHAIN, '--wallet', w, '--type', 'buy', '--limit', '20']).activities ?? [];
    for (const a of acts.filter(a => a.timestamp > m.last).sort((x, y) => x.timestamp - y.timestamp)) {
      m.last = Math.max(m.last, a.timestamp);
      const tok = a.token?.address, sym = a.token?.symbol;
      if (!tok || IGNORE.has(tok) || st.pos[tok] || st.rejected[tok]) continue;
      if (now - a.timestamp > MIRROR_MAX_LAG_S) { journal({ event: 'mirror_stale', wallet: w, token: tok, lagS: now - a.timestamp }); continue; }
      if (!canBuy()) continue;
      const i = info(tok), s = sec(tok), fail = gates(s, i, now, { ...CFG, ...MIRROR_CFG });
      if (fail.length) { reject(tok, sym, fail, px(i), { strategy: 'mirror', snap: snap(s, i) }); continue; }
      const kf = candles(tok), fl = flow(i), f = feats(kf, fl);
      if (BAD_PHASES.includes(f.phase)) { reject(tok, sym, ['phase_' + f.phase], px(i), { strategy: 'mirror', ...f }); continue; }
      const jev = await jevAssess(jevState(s, i, { wave_phase: f.phase, buy_ratio_5m: fl.buyRatio5m }));
      if (jevVeto(jev)) { reject(tok, sym, ['jev_veto'], px(i), { strategy: 'mirror', jev }); continue; }
      const r = await openPos(tok, { sym, strategy: 'mirror', src: w, jev, i, p: px(i), f });
      if (r) journal({ event: 'mirror_entry', wallet: w, token: tok, walletPx: Number(a.price_usd), fillPx: r.fillPx,
                       copyLagPct: (r.fillPx / Number(a.price_usd) - 1) * 100, delayS: now - a.timestamp });
    }
  }
}

function followups() {            // calibration: where did rejected tokens go at +1h / +4h?
  const now = nowS();
  for (const [tok, r] of Object.entries(st.rejected)) {
    for (const h of [1, 4]) {
      if (r.done?.includes(h) || now - r.ts < h * 3600 || now - r.ts > h * 3600 + 1800) continue;
      try { const p = px(info(tok)); journal({ event: 'reject_followup', token: tok, sym: r.sym, hours: h, x: p / r.px0, fail: r.fail }); }
      catch (e) { if (e instanceof RateLimited) throw e; }
      (r.done ??= []).push(h);
    }
  }
}

async function dailySummary() {
  if (st.lastSummary === today()) return;
  if (st.lastSummary) { const s = computeStats(); await notify(`DAILY: equity $${(BANKROLL + s.totalPnlUsd).toFixed(2)} of $${BANKROLL} | trades ${s.trades} win ${(s.winRate * 100).toFixed(0)}% pnl $${s.totalPnlUsd.toFixed(2)} (costs x2: $${s.pnlIfCostsDoubledUsd.toFixed(2)}) open ${Object.keys(st.pos).length} watch ${Object.keys(st.watch).length}`); }
  st.lastSummary = today();
}

// ---------- FAST LOOP ----------
async function closeTrip(tok, q, reason, exitF) {
  const pnlUsd = q.proceeds - q.cost;
  journal({ event: 'close', token: tok, sym: q.sym, strategy: q.strategy ?? 'cluster', src: q.src, jev: q.jev, reason, pnlUsd,
    pnlPct: pnlUsd / q.cost * 100, costsUsd: q.costs, holdS: nowS() - q.openedTs, peakX: q.peak / q.entryPx,
    entryPhase: q.entry?.phase, entry: q.entry, exit: exitF, mode: q.mode });
  st.day[today()] = (st.day[today()] ?? 0) + pnlUsd;
  delete st.pos[tok];
  // never re-buy a token we just exited (esp. after a rug signal); its +1h/+4h price is followed up to grade the exit
  st.rejected[tok] = { sym: q.sym, fail: ['exited_' + reason], ts: nowS(), px0: q.lastPx, done: [] };
  await notify(`CLOSED ${q.sym} ${reason} pnl ${pnlUsd.toFixed(2)} (${(pnlUsd / q.cost * 100).toFixed(0)}%), peak ${(q.peak / q.entryPx).toFixed(2)}x`);
}

async function sell(tok, q, frac, why, exitF) {
  const r = await execute({ side: 'sell', token: tok, units: q.units * frac, px: q.lastPx });
  if (!r.ok) { journal({ event: 'sell_failed', token: tok, sym: q.sym, why, reason: r.reason }); await notify(`SELL FAILED ${q.sym} ${why} (${r.reason}), retrying`); return false; }
  q.units -= r.units; q.proceeds += r.usd; q.costs += r.costUsd;
  await notify(`SELL[${r.mode}] ${q.sym} ${why} fill ${r.fillPx.toPrecision(4)} slip ${r.slipPct.toFixed(1)}%`);
  if (frac >= 1 || q.units < 1e-9) await closeTrip(tok, q, why, exitF);
  return true;
}

async function positions() {
  for (const [tok, q] of Object.entries(st.pos)) {
    const i = info(tok, 5000), p = px(i), x = p / q.entryPx, fl = flow(i), held = (nowS() - q.openedTs) / 60;
    q.peak = Math.max(q.peak, p); q.lastPx = p;
    const ex = { x, fromPeak: p / q.peak, heldMin: held, fl };
    const smartSellers = Object.values(st.sells[tok] ?? {}).filter(ts => ts > q.openedTs).length;
    let exit = null;
    if (Number(i.dev?.creator_token_balance) < q.creator * 0.9) exit = 'dev_sold';
    else if (q.entryLiq && fl.liqUsd < q.entryLiq * 0.7) exit = 'liquidity_pulled';                  // LP pull precursor
    else if (x <= 0.65) exit = 'stop_-35%';
    else if (smartSellers >= 2) exit = 'smart_money_selling';
    else if ((fl.buyRatio5m ?? 0.5) <= 0.33 && p <= q.peak * 0.85) exit = 'sell_wave';              // sells 2x buys, off the peak
    else if (!q.tp1 && held >= STALE_MIN && x < 1.1) exit = 'stale';                                // momentum never came
    else if (q.src) {                                                                              // mirror: source wallet sold
      const acts = gmgn(['portfolio', 'activity', '--chain', CHAIN, '--wallet', q.src, '--token', tok, '--type', 'sell', '--limit', '5'], { ttlMs: 45000 }).activities ?? [];
      if (acts.some(a => a.timestamp > q.openedTs)) exit = 'mirror_exit';
    }
    if (exit) { await sell(tok, q, 1, exit, ex); continue; }
    if (!q.tp1 && x >= 2 && await sell(tok, q, 1 / 3, 'tp1_2x', ex)) q.tp1 = true;
    if (st.pos[tok] && !q.tp2 && x >= 4 && await sell(tok, q, 0.5, 'tp2_4x', ex)) q.tp2 = true;
    if (st.pos[tok] && q.tp1 && p <= q.peak * 0.75) await sell(tok, q, 1, 'trail_-25%', ex);
  }
}

// Run fingerprint: hash of the code + result-affecting settings. Compare runs only when both match.
function fingerprint() {
  const dir = new URL('.', import.meta.url).pathname, h = createHash('sha256');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()) h.update(f).update(readFileSync(dir + f));
  const keys = ['CHAIN', 'ENTRY_MODE', 'ORDER_USD', 'MAX_OPEN', 'DAILY_LOSS_USD', 'BANKROLL_USD', 'TIP_USD', 'FEE_PCT', 'LATENCY_S', 'FAIL_RATE',
    'SLIPPAGE_BPS', 'QUOTE_SOURCE', 'POLL_S', 'POS_POLL_S', 'STALE_MIN', 'MIRROR_MAX_LAG_S', 'GATE_OVERRIDE', 'JEV_MODE', 'JEV_RUG_MAX', 'EXCLUDE_TAGS', 'GMGN_TIER'];
  return { codeHash: h.digest('hex').slice(0, 12), settings: Object.fromEntries(keys.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])) };
}

async function step(slow) {
  try { await positions(); if (slow) { await scan(); await watchlist(); await mirrorScan(); followups(); await dailySummary(); } }
  catch (e) { console.error(e instanceof RateLimited ? e.message : 'cycle error: ' + (e.stack ?? e.message)); }
  save();                                                   // always persist partial progress (e.g. after a fill)
}

async function loop() {
  const fp = fingerprint();
  journal({ event: 'start', ...fp });
  await notify(`BOT START code ${fp.codeHash} ${JSON.stringify(fp.settings)}`);
  let lastSlow = 0;
  for (;;) {
    const slow = Date.now() - lastSlow >= POLL_MS;
    if (slow) lastSlow = Date.now();
    await step(slow);
    await new Promise(r => setTimeout(r, Math.max(POS_POLL_MS, rateLimitWaitMs())));
  }
}
if (process.argv.includes('--once')) { await step(true); console.log(JSON.stringify({ watch: st.watch, pos: st.pos, rejected: Object.keys(st.rejected).length }, null, 1)); }
else loop();
