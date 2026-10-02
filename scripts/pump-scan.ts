/**
 * Pump.fun PAPER scanner (no orders, no wallet, no paid key).
 *   Free PumpPortal new-token stream -> wait for 30m/1h/2h/4h/8h checkpoints -> DexScreener market screen -> RugCheck gate
 *   -> candidates appended to .trading-state/pump-candidates.jsonl (every token that passed the market screen is logged,
 *   with its RugCheck verdict, so veto reasons can be reviewed).
 *   npx tsx scripts/pump-scan.ts
 * Env: SCAN_CHECKPOINTS="30,60,120,240,480" (minutes; override only for testing).
 */
import fs from "fs";
import { PumpPortalFeed } from "../src/lib/pumpportal";
import { Discovery, CHECKPOINTS_MIN } from "../src/trading/discovery";
import { makeScanner } from "../src/trading/discoveryScan";
import { makeRugCheckGate } from "../src/trading/rugcheckGate";

fs.mkdirSync(".trading-state", { recursive: true });
const out = ".trading-state/pump-candidates.jsonl";
const checkpoints = process.env.SCAN_CHECKPOINTS ? process.env.SCAN_CHECKPOINTS.split(",").map(Number) : CHECKPOINTS_MIN;
const disc = new Discovery(20000, checkpoints);
let lastEventAt = 0, created = 0;

const feed = new PumpPortalFeed((e) => {
  if (e.message) return; // acks / notices
  lastEventAt = Date.now();
  if (e.txType === "create" && e.mint) { created++; disc.add(e.mint, e.name ?? "", e.symbol ?? ""); }
}, { log: (m) => console.log(m) });

const scanner = makeScanner(disc, {
  gate: makeRugCheckGate(),
  onCandidate: (c) => {
    fs.appendFileSync(out, JSON.stringify(c) + "\n");
    console.log(`${c.rugcheck.pass ? "CANDIDATE" : "vetoed  "} ${c.symbol} ${c.mint} @${c.checkpointMin}m liq $${Math.round(c.market.liquidityUsd ?? 0)}${c.rugcheck.pass ? "" : " — " + c.rugcheck.failures.join(" | ")}`);
  },
});

feed.start();
let busy = false;
setInterval(async () => {
  if (!busy) { busy = true; try { await scanner.tick(); } catch (e) { console.log("tick error:", (e as Error).message); } busy = false; }
  // Heartbeat for the external watchdog: it alerts if this goes stale or the discovery stream stops delivering events.
  fs.writeFileSync(".trading-state/heartbeat.json", JSON.stringify({ at: Date.now(), lastEventAt, tracked: disc.size, createdTotal: created, tradeFeed: "not-used", ...scanner.stats }));
}, 30_000);
setInterval(() => console.log(`${new Date().toISOString()} created ${created} pending ${disc.size} checked ${scanner.stats.checked} noPair ${scanner.stats.noPair} passedMarket ${scanner.stats.passedMarket} candidates ${scanner.stats.candidates} errs ${scanner.stats.errors} fails ${JSON.stringify(scanner.stats.fails)}`), 5 * 60_000);
