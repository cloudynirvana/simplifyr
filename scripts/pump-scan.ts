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

const solUsd = Number(process.argv[2] ?? 150);
fs.mkdirSync(".trading-state", { recursive: true });
const out = ".trading-state/pump-candidates.jsonl";
const tracker = new PumpTracker(300);
const seen = new Set<string>();
const rugGate = makeRugCheckGate();
const feed: PumpPortalFeed = new PumpPortalFeed((e) => {
  const r = tracker.handle(e);
  if (r.created) feed.trackTrades(r.created);
  for (const m of r.evicted ?? []) feed.untrackTrades(m);
}, { log: (m) => console.log(m) });

feed.start();
setInterval(async () => {
  let passed = 0;
  for (const mint of tracker.tokens.keys()) {
    const t = tracker.toPumpToken(mint, solUsd);
    if (!t || t.ageMinutes < 15) continue;
    const r = evaluateToken(t);
    if (r.pass && !seen.has(mint)) {
      seen.add(mint); // evaluate each token once; RugCheck is the LAST gate and fails closed
      const rc = await rugGate(mint);
      fs.appendFileSync(out, JSON.stringify({ at: Date.now(), token: t, warnings: r.warnings, rugcheck: rc }) + "\n");
      if (rc.pass) passed++;
    }
  }
  console.log(`${new Date().toISOString()} tracking ${tracker.tokens.size}, new candidates ${passed}`);
}, 30_000);
