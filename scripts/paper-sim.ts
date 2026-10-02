/**
 * Live PAPER trading simulation for Solana memecoins (no wallet, no orders, no keys required).
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/paper-sim.ts [--minutes 20] [--size 15]
 * Two profiles run side by side on the same feed:
 *   strict   = production filters (market screen + full RugCheck gate)
 *   research = relaxed market screen + only HARD RugCheck vetoes; exists to measure what the strict filters reject.
 *   gmgn     = GMGN trending (1h/5m) -> GMGN field filters -> full RugCheck gate (only if GMGN_API_KEY is set; read-only).
 * GMGN rank snapshots are also stored in .trading-state/gmgn/rank-YYYY-MM-DD.jsonl as a research dataset.
 * Every event goes to .trading-state/paper/ledger.jsonl; Jev answers (if a key is set) are logged for later calibration.
 */
import fs from "fs";
import { marketScreen, SCREEN } from "../src/trading/screenFilters";
import { makeRugCheckGate } from "../src/trading/rugcheckGate";
import { PaperBook, PAPER_DEFAULTS, FillEvent } from "../src/trading/paperBook";
import { askMemeJev } from "../src/trading/memeJev";
import { GmgnClient } from "../src/lib/gmgn";
import { gmgnScreen, gmgnFeatures } from "../src/trading/gmgnFilter";

const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const minutes = arg("--minutes", 0), size = arg("--size", PAPER_DEFAULTS.sizeUsd);
const RESEARCH = { ...SCREEN, minLiquidityUsd: 10_000, minMarketCapUsd: 20_000, minTxns1h: 40, minAgeHours: 0.25 };
const HARD = /authority|rugged|danger|transfer fee|permanent delegate|LP only/i;
const book = new PaperBook({ ...PAPER_DEFAULTS, sizeUsd: size });
const gate = makeRugCheckGate();
fs.mkdirSync(".trading-state/paper", { recursive: true });
const LEDGER = ".trading-state/paper/ledger.jsonl";
const log = (o: object) => fs.appendFileSync(LEDGER, JSON.stringify(o) + "\n");
const get = async (p: string) => { const r = await fetch("https://api.dexscreener.com" + p); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json() as Promise<any>; };
const bestPairs = (pairs: any[]) => { const m = new Map<string, any>(); for (const p of pairs) { const k = p.baseToken?.address; if (k && (!m.has(k) || (p.liquidity?.usd ?? 0) > (m.get(k).liquidity?.usd ?? 0))) m.set(k, p); } return m; };
const seen = new Set<string>();
const gmgn = GmgnClient.fromEnv();
fs.mkdirSync(".trading-state/gmgn", { recursive: true });
let gmgnTick = 0;
const print = (e: FillEvent) => console.log(`${new Date(e.at).toISOString().slice(11, 19)} ${e.profile.padEnd(8)} ${e.type.toUpperCase().padEnd(5)} ${e.symbol.padEnd(10)} px ${e.px.toPrecision(4)} $${e.usd.toFixed(2)} ${e.reason}`);

async function scan() {
  const lists = await Promise.all(["/token-profiles/latest/v1", "/token-boosts/latest/v1", "/token-boosts/top/v1"].map((p) => get(p).catch(() => [])));
  const mints = [...new Set(lists.flat().filter((x: any) => x.chainId === "solana").map((x: any) => x.tokenAddress as string))].filter((m) => !seen.has(m));
  const pairs: any[] = []; for (let i = 0; i < mints.length; i += 30) pairs.push(...(await get(`/tokens/v1/solana/${mints.slice(i, i + 30).join(",")}`).catch(() => [])));
  const best = bestPairs(pairs), now = Date.now();
  for (const [mint, p] of best) {
    seen.add(mint);
    const strictFails = marketScreen(p, now), researchFails = marketScreen(p, now, RESEARCH);
    if (researchFails.length) continue;                       // fails even the relaxed screen
    const rc = await gate(mint);
    const hard = rc.failures.filter((f) => HARD.test(f)), mark = { px: Number(p.priceUsd), liqUsd: p.liquidity?.usd ?? 0, m5: p.txns?.m5 };
    const state = { age_h: +(((now - (p.pairCreatedAt ?? now)) / 36e5).toFixed(2)), liq_usd: Math.round(mark.liqUsd), mcap_usd: Math.round(p.marketCap ?? p.fdv ?? 0),
      chg_m5: p.priceChange?.m5 ?? 0, chg_h1: p.priceChange?.h1 ?? 0, chg_h6: p.priceChange?.h6 ?? 0, buys_h1: p.txns?.h1?.buys ?? 0, sells_h1: p.txns?.h1?.sells ?? 0,
      buys_m5: p.txns?.m5?.buys ?? 0, sells_m5: p.txns?.m5?.sells ?? 0, rugcheck_flags: rc.failures };
    let jev = null; try { jev = await askMemeJev(state); } catch (e) { jev = { error: (e as Error).message }; }
    log({ type: "candidate", at: now, mint, symbol: p.baseToken.symbol, strictFails, rugcheck: rc, state, jev });
    const meta = { jev, rugcheck: rc.failures };
    if (!strictFails.length && rc.pass) { const e = book.open(mint, p.baseToken.symbol, "strict", mark, now, meta); if (e) { log(e); print(e); } }
    if (!hard.length && !rc.error) { const e = book.open(mint, p.baseToken.symbol, "research", mark, now, meta); if (e) { log(e); print(e); } }
  }
}

async function scanGmgn() {
  if (!gmgn) return;
  const interval = gmgnTick++ % 2 ? "5m" : "1h";
  const items = await gmgn.rank("sol", interval);
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  fs.appendFileSync(`.trading-state/gmgn/rank-${day}.jsonl`, items.map((t: any) => JSON.stringify({ ts: now, interval, ...gmgnFeatures(t), fails: gmgnScreen(t, now) })).join("\n") + "\n");
  const pass = items.filter((t: any) => !gmgnScreen(t, now).length && !book.positions.has(`gmgn:${t.address}`));
  // Enter at the SAME source used for marking (DexScreener). Mixing GMGN entry liquidity with DexScreener marks faked rug exits.
  const dexPairs: any[] = [];
  for (let i = 0; i < pass.length; i += 30) dexPairs.push(...(await get(`/tokens/v1/solana/${pass.slice(i, i + 30).map((t: any) => t.address).join(",")}`).catch(() => [])));
  const dex = bestPairs(dexPairs);
  for (const t of pass) {
    const q = dex.get(t.address);
    if (!q) { console.log(`gmgn skip ${t.symbol}: no DexScreener pair to mark against`); continue; }
    const rc = await gate(t.address);
    log({ type: "candidate", source: "gmgn", at: now, mint: t.address, symbol: t.symbol, rugcheck: rc, gmgn: gmgnFeatures(t) });
    if (!rc.pass) { console.log(`gmgn veto ${t.symbol}: ${rc.failures.join(" | ")}`); continue; }
    const e = book.open(t.address, t.symbol, "gmgn", { px: Number(q.priceUsd), liqUsd: q.liquidity?.usd ?? 0, m5: q.txns?.m5 }, now, { gmgn: gmgnFeatures(t) });
    if (e) { log(e); print(e); }
  }
  console.log(`gmgn ${interval}: ${items.length} ranked, ${pass.length} passed GMGN filters`);
}

async function markAll() {
  const open = [...book.positions.values()].filter((p) => !p.closedAt); if (!open.length) return;
  const mints = [...new Set(open.map((p) => p.mint))], pairs: any[] = [];
  for (let i = 0; i < mints.length; i += 30) pairs.push(...(await get(`/tokens/v1/solana/${mints.slice(i, i + 30).join(",")}`).catch(() => [])));
  const best = bestPairs(pairs), now = Date.now();
  for (const p of open) { const q = best.get(p.mint); if (!q) continue; for (const e of book.mark(p.id, { px: Number(q.priceUsd), liqUsd: q.liquidity?.usd ?? 0, m5: q.txns?.m5 }, now)) { log(e); print(e); } }
}

const report = () => { for (const prof of ["strict", "research", "gmgn"]) console.log(`[${prof}] ${JSON.stringify(book.summary(prof))}`); };
(async () => {
  console.log(`paper-sim: size $${size}, costs ${PAPER_DEFAULTS.feePct + PAPER_DEFAULTS.slippagePct}%/side, stop -${PAPER_DEFAULTS.stopPct}%, TP +25%/+60%, time stop ${PAPER_DEFAULTS.timeStopMin}m, Jev ${process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY ? "on (log only)" : "off"}, GMGN ${gmgn ? "on (read-only)" : "off"}`);
  const end = minutes ? Date.now() + minutes * 60_000 : Infinity;
  let lastScan = 0, lastReport = Date.now();
  while (Date.now() < end) {
    try { if (Date.now() - lastScan > 180_000) { lastScan = Date.now(); await scan(); await scanGmgn().catch((e) => console.log("gmgn error:", (e as Error).message)); } await markAll(); } catch (e) { console.log("loop error:", (e as Error).message); }
    if (Date.now() - lastReport > 300_000) { lastReport = Date.now(); report(); }
    await new Promise((r) => setTimeout(r, 20_000));
  }
  report();
})();
