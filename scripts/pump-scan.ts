/**
 * Pump.fun PAPER scanner. Watches new launches, tracks each from creation, and every 30s logs tokens that
 * pass ALL hard filters to .trading-state/pump-candidates.jsonl. Places no orders; holds no keys.
 *   npx tsx scripts/pump-scan.ts [solUsd=150]
 * Jev scoring and paper entries plug in next (src/trading/jevPolicy.ts). Needs network access to pumpportal.fun.
 */
import fs from "fs";
import { PumpPortalFeed } from "../src/lib/pumpportal";
import { PumpTracker } from "../src/trading/pumpTracker";
import { evaluateToken } from "../src/trading/pumpFilters";
import { makeRugCheckGate } from "../src/trading/rugcheckGate";

let solUsd = Number(process.argv[2] ?? 150); // fallback; refreshed live below
fs.mkdirSync(".trading-state", { recursive: true });
const out = ".trading-state/pump-candidates.jsonl";
const tracker = new PumpTracker(300);
const seen = new Set<string>();
const rugGate = makeRugCheckGate();
let lastEventAt = 0, candidatesTotal = 0, tradeFeed: "ok" | "denied" | "unknown" = process.env.PUMPPORTAL_API_KEY ? "unknown" : "denied";
const feed: PumpPortalFeed = new PumpPortalFeed((e) => {
  if (e.message) { if (/only available/i.test(e.message) && tradeFeed !== "denied") { tradeFeed = "denied"; console.log("WARNING: PumpPortal denied the trade stream (needs a funded API key). Holder/flow filters have no data; no candidates will be logged."); } return; }
  lastEventAt = Date.now();
  if (e.txType === "buy" || e.txType === "sell") tradeFeed = "ok";
  const r = tracker.handle(e);
  if (r.created) feed.trackTrades(r.created);
  for (const m of r.evicted ?? []) feed.untrackTrades(m);
}, { log: (m) => console.log(m), url: process.env.PUMPPORTAL_API_KEY ? `wss://pumpportal.fun/api/data?api-key=${process.env.PUMPPORTAL_API_KEY}` : undefined });
if (!process.env.PUMPPORTAL_API_KEY) console.log("No PUMPPORTAL_API_KEY: only new-token events are available; the trade stream needs a key funded with >= 0.02 SOL.");

feed.start();
setInterval(async () => {
  let passed = 0;
  for (const mint of tracker.tokens.keys()) {
    const t = tracker.toPumpToken(mint, solUsd);
    if (!t || t.ageMinutes < 15 || tradeFeed === "denied") continue; // without trades every filter would be fed empty data
    const r = evaluateToken(t);
    if (r.pass && !seen.has(mint)) {
      seen.add(mint); // evaluate each token once; RugCheck is the LAST gate and fails closed
      const rc = await rugGate(mint);
      fs.appendFileSync(out, JSON.stringify({ at: Date.now(), token: t, warnings: r.warnings, rugcheck: rc }) + "\n");
      if (rc.pass) { passed++; candidatesTotal++; }
    }
  }
  // Heartbeat for the external watchdog: it alerts if this file goes stale or the feed stops delivering events.
  fs.writeFileSync(".trading-state/heartbeat.json", JSON.stringify({ at: Date.now(), lastEventAt, tracked: tracker.tokens.size, candidatesTotal, solUsd, tradeFeed }));
  console.log(`${new Date().toISOString()} tracking ${tracker.tokens.size}, new candidates ${passed}, sol $${solUsd.toFixed(0)}`);
}, 30_000);

// Keep SOL/USD fresh (DexScreener, best-liquidity SOL pair). Keeps the last value on any failure.
async function refreshSol() {
  try {
    const r = await fetch("https://api.dexscreener.com/token-pairs/v1/solana/So11111111111111111111111111111111111111112");
    const pairs = (await r.json()) as Array<{ priceUsd?: string; quoteToken?: { symbol?: string }; liquidity?: { usd?: number } }>;
    const best = pairs.filter((p) => p.quoteToken?.symbol === "USDC" && Number(p.priceUsd) > 0).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (best) solUsd = Number(best.priceUsd);
  } catch { /* keep previous */ }
}
refreshSol(); setInterval(refreshSol, 5 * 60_000);
