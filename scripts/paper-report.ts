/**
 * Performance report for the paper ledger (.trading-state/paper/ledger.jsonl).
 *   npx tsx scripts/paper-report.ts [ledgerPath]
 * Per profile: trades, win rate, average win/loss, expectancy per trade AFTER costs, profit factor, exit reasons.
 * Jev calibration (log-only answers joined to outcomes): Brier score of P(up) vs "trade made money" and of P(rug) vs
 * "exited on a rug trigger or stop", each against a constant base-rate forecast. Small samples are flagged, not trusted.
 */
import fs from "fs";
const path = process.argv[2] ?? ".trading-state/paper/ledger.jsonl";
if (!fs.existsSync(path)) { console.log(`no ledger at ${path}`); process.exit(0); }
const rows = fs.readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const jevByMint = new Map<string, any>(); for (const r of rows) if (r.type === "candidate" && r.jev && !r.jev.error) jevByMint.set(r.mint, r.jev);
type T = { id: string; mint: string; profile: string; cost: number; proceeds: number; closed: boolean; reason?: string };
const trades = new Map<string, T>();
for (const r of rows) {
  if (r.type === "open") trades.set(r.id, { id: r.id, mint: r.mint, profile: r.profile, cost: r.usd, proceeds: 0, closed: false });
  else if ((r.type === "sell" || r.type === "close") && trades.has(r.id)) { const t = trades.get(r.id)!; t.proceeds += r.usd; if (r.type === "close") { t.closed = true; t.reason = r.reason; } }
}
const brier = (xs: Array<[number, number]>) => xs.reduce((a, [p, o]) => a + (p - o) ** 2, 0) / xs.length;
for (const profile of [...new Set([...trades.values()].map((t) => t.profile))]) {
  const all = [...trades.values()].filter((t) => t.profile === profile), closed = all.filter((t) => t.closed);
  const pnl = closed.map((t) => t.proceeds - t.cost), wins = pnl.filter((x) => x > 0), losses = pnl.filter((x) => x <= 0);
  const gw = wins.reduce((a, b) => a + b, 0), gl = -losses.reduce((a, b) => a + b, 0);
  console.log(`\n== ${profile}: ${all.length} trades (${closed.length} closed, ${all.length - closed.length} open)`);
  if (!closed.length) continue;
  console.log(`win rate ${(wins.length / closed.length * 100).toFixed(0)}% | avg win $${(gw / Math.max(1, wins.length)).toFixed(2)} | avg loss $${(-gl / Math.max(1, losses.length)).toFixed(2)} | expectancy/trade $${(pnl.reduce((a, b) => a + b, 0) / closed.length).toFixed(2)} | profit factor ${gl ? (gw / gl).toFixed(2) : "inf"} | net $${pnl.reduce((a, b) => a + b, 0).toFixed(2)}`);
  console.log("exit reasons:", JSON.stringify(closed.reduce((a, t) => ((a[t.reason!] = (a[t.reason!] ?? 0) + 1), a), {} as Record<string, number>)));
  const up: Array<[number, number]> = [], rug: Array<[number, number]> = [];
  for (const t of closed) { const j = jevByMint.get(t.mint); if (!j) continue; up.push([j.pUp, t.proceeds > t.cost ? 1 : 0]); rug.push([j.rugRisk, /rug|stop/.test(t.reason ?? "") ? 1 : 0]); }
  if (up.length) {
    const base = (xs: Array<[number, number]>) => { const b = xs.reduce((a, [, o]) => a + o, 0) / xs.length; return brier(xs.map(([, o]) => [b, o])); };
    console.log(`Jev calibration on ${up.length} trades${up.length < 30 ? " (TOO FEW to conclude anything)" : ""}: Brier P(up) ${brier(up).toFixed(3)} vs base ${base(up).toFixed(3)} | Brier P(rug) ${brier(rug).toFixed(3)} vs base ${base(rug).toFixed(3)} (lower is better; must beat base)`);
  }
  if (closed.length < 100) console.log(`NOTE: ${closed.length} closed trades is below the 100-trade minimum in the go-live gates.`);
}
