/**
 * GMGN-exclusive 24/7 research + paper simulation. Needs GMGN_API_KEY (read-only). Optional TYPESAFE_API_KEY (Jev, log-only).
 *   npx tsx scripts/gmgn-sim.ts            (server: runs as the `gmgn` compose service)
 * Writes: .trading-state/gmgn-paper/ledger.jsonl (snapshots, candidates, fills, outcomes) and .trading-state/heartbeat.json
 * Pre-registered exit profiles: docs/EXPERIMENTS.md. Evaluate with: npx tsx scripts/gmgn-research.ts
 */
import fs from "fs";
import { GmgnClient } from "../src/lib/gmgn";
import { GmgnEngine } from "../src/trading/gmgnEngine";
import { PAPER_DEFAULTS } from "../src/trading/paperBook";
import { askMemeJev } from "../src/trading/memeJev";

const g = GmgnClient.fromEnv();
if (!g) { console.error("GMGN_API_KEY missing (put it in /etc/pumpbot/env)"); process.exit(1); }
fs.mkdirSync(".trading-state/gmgn-paper", { recursive: true });
const LEDGER = ".trading-state/gmgn-paper/ledger.jsonl";
const log = (o: object) => fs.appendFileSync(LEDGER, JSON.stringify(o) + "\n");
const hasJev = !!(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY);

const PROFILES = { // pre-registered 2026-10-02; see docs/EXPERIMENTS.md before changing anything here
  base:  { ...PAPER_DEFAULTS, stopPct: 12, tp: [{ at: 25, sell: 0.5 }, { at: 60, sell: 0.5 }], timeStopMin: 120 },
  wide:  { ...PAPER_DEFAULTS, stopPct: 20, tp: [{ at: 25, sell: 0.5 }, { at: 60, sell: 0.5 }], timeStopMin: 180 },
  trail: { ...PAPER_DEFAULTS, stopPct: 15, tp: [], trailActivatePct: 20, trailPct: 15, timeStopMin: 240 },
};
const COPY_PROFILES = { // LEDGER copy-trading worker, pre-registered 2026-10-02 (docs/EXPERIMENTS.md)
  copy: { ...PAPER_DEFAULTS, stopPct: 15, tp: [{ at: 50, sell: 0.5 }], trailActivatePct: 30, trailPct: 20, timeStopMin: 360 },
};
const engine = new GmgnEngine({ g, profiles: PROFILES, copyProfiles: COPY_PROFILES, log, jev: hasJev ? (s) => askMemeJev(s) : undefined });
log({ type: "start", at: Date.now(), profiles: PROFILES, copyProfiles: COPY_PROFILES, jev: hasJev });
console.log(`gmgn-sim: paper only, profiles ${Object.keys(PROFILES).join("/")} + copy, Jev ${hasJev ? "log-only" : "off"}`);

let tick = 0, busy = false;
const loop = async () => {
  if (busy) return; busy = true;
  try {
    if (tick % 3 === 0) await engine.discover(tick % 6 === 0 ? "1h" : "5m");   // every ~60 s, alternating windows
    if (tick % 9 === 4) await engine.discoverTrenches();                       // SCOUT: graduating/graduated launches, every ~3 min
    if (tick % 3 === 1) await engine.copyScan();                               // LEDGER: smart money / KOL copy signals, every ~60 s
    for (const e of await engine.markOpen()) console.log(`${new Date(e.at).toISOString().slice(11, 19)} ${e.profile.padEnd(5)} ${e.type.toUpperCase().padEnd(5)} ${e.symbol} $${e.usd.toFixed(2)} ${e.reason}`);
    await engine.label();
  } catch (err) { engine.stats.errors++; console.log("loop error:", (err as Error).message); }
  tick++; busy = false;
  const summaries = Object.fromEntries([...engine.books].map(([k, b]) => [k, b.summary()]));
  fs.writeFileSync(".trading-state/heartbeat.json", JSON.stringify({ at: Date.now(), lastEventAt: Date.now(), tradeFeed: "not-used", source: "gmgn", ...engine.stats, followupsPending: engine.pendingFollowups(), summaries }));
  if (tick % 90 === 0) { console.log(JSON.stringify({ stats: engine.stats, summaries })); log({ type: "summary", at: Date.now(), stats: engine.stats, summaries }); }
};
setInterval(loop, 20_000); loop();
