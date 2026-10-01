/** Run the perp strategy tournament on cached Hyperliquid data. Fetch first: scripts/fetch-hl.ts */
import fs from "fs";
import { loadPanel } from "../src/research/panel";
import { runTournament, GATES } from "../src/research/tournament";

const p = loadPanel();
console.log(`panel: ${p.coins.length} coins, ${p.dates.length} days (${new Date(p.dates[0]).toISOString().slice(0, 10)} -> ${new Date(p.dates[p.dates.length - 1]).toISOString().slice(0, 10)})`);
const r = runTournament(p);
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const lines = [
  `# Perp strategy tournament ${new Date().toISOString().slice(0, 10)}`,
  `Trials counted for the multiple-testing penalty: ${r.nTrials}. Walk-forward OOS ${r.oosStart} -> ${r.holdoutStart}, then untouched holdout.`,
  `Benchmarks over the OOS window: BTC buy&hold Sharpe ${f(r.benchmarks.btcBuyHold.sharpe)} (ret ${f(r.benchmarks.btcBuyHold.ret * 100, 0)}%), equal-weight long-all Sharpe ${f(r.benchmarks.eqWeightLong.sharpe)} (ret ${f(r.benchmarks.eqWeightLong.ret * 100, 0)}%).`,
  `Gates: ${JSON.stringify(GATES)}`, "",
  "| strategy | WF Sharpe | WF ann.ret | WF maxDD | DSR | holdout Sharpe | holdout ret | 2x-cost Sharpe | result |", "|---|---|---|---|---|---|---|---|---|",
  ...r.reports.map((x) => `| ${x.name} | ${f(x.wf.sharpe)} | ${f(x.wf.annRet * 100, 0)}% | ${f(x.wf.maxDD * 100, 0)}% | ${f(x.dsr)} | ${f(x.holdout.sharpe)} | ${f(x.holdout.ret * 100, 0)}% | ${f(x.stressSharpe)} | ${x.passed ? "PASS" : "fail"} |`),
  "", ...r.reports.filter((x) => !x.passed).map((x) => `- ${x.name}: ${x.failures.join("; ")}`),
  "", "Caveats: universe = today's top-20 by volume (survivorship bias flatters results); fees/slippage are assumptions; a pass permits testnet paper trading, not live capital.",
];
fs.mkdirSync(".trading-state/tournament", { recursive: true });
const out = `.trading-state/tournament/report-${new Date().toISOString().slice(0, 10)}.md`;
fs.writeFileSync(out, lines.join("\n")); console.log(lines.join("\n"), `\n\nWritten to ${out}`);
