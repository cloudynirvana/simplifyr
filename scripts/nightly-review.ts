/**
 * Nightly review. Reads the saved session, scores the judge's calibration (Brier), and writes a
 * report with PROPOSED changes. It never edits thresholds or schemas itself: the operator approves.
 *   npx tsx scripts/nightly-review.ts <pool> [network=solana]
 */
import fs from "fs";
import { getCandles } from "../src/lib/geckoterminal";
import { calibrate } from "../src/trading/calibration";
import type { AgentState } from "../src/trading/agent";

const [pool, network = "solana"] = process.argv.slice(2);
if (!pool) { console.error("usage: nightly-review.ts <pool> [network]"); process.exit(1); }

async function main() {
  const file = `.trading-state/${network}-${pool}.json`;
  const s: AgentState = JSON.parse(fs.readFileSync(file, "utf8"));
  const rep = calibrate(s.decisions ?? [], await getCandles(network, pool));
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(4) : "n/a");
  const md = [
    `# Nightly review ${new Date().toISOString().slice(0, 10)}`,
    `Strategy: ${s.strategy} ${JSON.stringify(s.params)} | halted: ${s.halted ?? "no"} | fills: ${s.fills.length}`,
    `Scored decisions: ${rep.n} | Brier ${f(rep.brier)} vs base-rate ${f(rep.baselineBrier)} (lower is better; must beat the baseline)`,
    `Entered: ${rep.enteredN}, hit rate ${rep.enteredHitRate === null ? "n/a" : rep.enteredHitRate.toFixed(2)}`,
    "", "| P(long) bin | n | mean P | hit rate |", "|---|---|---|---|",
    ...rep.bins.map((b) => `| ${b.lo.toFixed(1)}-${b.hi.toFixed(1)} | ${b.n} | ${b.meanP.toFixed(2)} | ${b.hitRate.toFixed(2)} |`),
    "", "## Findings", ...(rep.notes.length ? rep.notes.map((n) => `- ${n}`) : ["- No calibration problems detected."]),
    "", "## Proposed changes (operator approval required; nothing is applied automatically)",
    "- Review question wording and thresholds in src/trading/jevPolicy.ts against the bins above.",
    "",
  ].join("\n");
  fs.mkdirSync(".trading-state/reviews", { recursive: true });
  const out = `.trading-state/reviews/${network}-${pool}-${new Date().toISOString().slice(0, 10)}.md`;
  fs.writeFileSync(out, md);
  console.log(md, `\nWritten to ${out}`);
}
main();
