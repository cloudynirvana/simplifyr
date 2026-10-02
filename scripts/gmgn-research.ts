/**
 * Research report for the GMGN ledger. Answers: which rules reject what, what happened to tokens afterwards
 * (do rejects really do worse?), how each pre-registered profile performs, week by week, and whether Jev's
 * log-only probabilities carry information (Brier vs base rate).
 *   npx tsx scripts/gmgn-research.ts [.trading-state/gmgn-paper/ledger.jsonl]
 */
import fs from "fs";
const path = process.argv[2] ?? ".trading-state/gmgn-paper/ledger.jsonl";
if (!fs.existsSync(path)) { console.log(`no ledger at ${path}`); process.exit(0); }
const rows = fs.readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`, med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const first = rows.find((r) => r.type === "start")?.at, last = rows[rows.length - 1]?.at ?? first;
console.log(`ledger: ${rows.length} rows, ${first ? new Date(first).toISOString() : "?"} -> ${last ? new Date(last).toISOString() : "?"}`);

// 1) Veto histogram (screen stage, unique tokens per day)
const seen = new Set<string>(), veto: Record<string, number> = {}; let uniq = 0, passed = 0;
for (const r of rows.filter((r) => r.type === "snapshot")) for (const it of r.items ?? []) {
  const k = `${it.address}:${new Date(r.at).toISOString().slice(0, 10)}`; if (seen.has(k)) continue; seen.add(k); uniq++;
  if (!it.fails?.length) passed++; for (const f of it.fails ?? []) veto[f] = (veto[f] ?? 0) + 1;
}
console.log(`\n== screen: ${uniq} unique token-days, ${passed} passed GMGN field filters (${uniq ? pct(passed / uniq) : "-"})`);
for (const [k, v] of Object.entries(veto).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${k.padEnd(28)} ${String(v).padStart(5)}  ${pct(v / uniq)}`);
const cand = rows.filter((r) => r.type === "candidate"), byStage: Record<string, number> = {};
for (const c of cand) { const k = `${c.stage}:${c.fails?.length ? "reject" : "pass"}`; byStage[k] = (byStage[k] ?? 0) + 1; }
console.log("  deeper checks:", JSON.stringify(byStage));

// 2) Outcomes: what happened to each group afterwards (labels have no survivorship: missing price = token unreadable/dead)
const outs = rows.filter((r) => r.type === "outcome");
for (const h of [60, 240]) {
  console.log(`\n== outcomes at +${h}m (return from first sighting; "dead" = no price available)`);
  const groups: Record<string, any[]> = {}; for (const o of outs.filter((o) => o.horizonMin === h)) (groups[o.stage] ??= []).push(o);
  for (const [g, os] of Object.entries(groups)) {
    const rs = os.filter((o) => o.ret !== null).map((o) => o.ret as number), dead = os.length - rs.length;
    console.log(`  ${g.padEnd(9)} n=${String(os.length).padStart(4)} median ${Number.isFinite(med(rs)) ? pct(med(rs)) : "-"}  mean ${rs.length ? pct(rs.reduce((a, b) => a + b, 0) / rs.length) : "-"}  <-50%: ${pct((rs.filter((r) => r < -0.5).length + dead) / Math.max(1, os.length))}  >+50%: ${pct(rs.filter((r) => r > 0.5).length / Math.max(1, os.length))}`);
  }
}

// 3) Paper profiles: overall and per ISO week ("profitable over repeated periods" = positive expectancy in >= 3 of 4 weeks)
const trades = new Map<string, { profile: string; cost: number; proceeds: number; closedAt?: number; reason?: string }>();
for (const r of rows) {
  if (r.type === "open") trades.set(r.id, { profile: r.profile, cost: r.usd, proceeds: 0 });
  else if ((r.type === "sell" || r.type === "close") && trades.has(r.id)) { const t = trades.get(r.id)!; t.proceeds += r.usd; if (r.type === "close") { t.closedAt = r.at; t.reason = r.reason; } }
}
const week = (ms: number) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
for (const profile of [...new Set([...trades.values()].map((t) => t.profile))]) {
  const closed = [...trades.values()].filter((t) => t.profile === profile && t.closedAt);
  const pnl = closed.map((t) => t.proceeds - t.cost), w = pnl.filter((x) => x > 0), l = pnl.filter((x) => x <= 0);
  const gw = w.reduce((a, b) => a + b, 0), gl = -l.reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, dd = 0; for (const x of pnl) { eq += x; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  console.log(`\n== profile ${profile}: ${closed.length} closed | win ${closed.length ? pct(w.length / closed.length) : "-"} | expectancy $${closed.length ? (pnl.reduce((a, b) => a + b, 0) / closed.length).toFixed(2) : "-"}/trade | PF ${gl ? (gw / gl).toFixed(2) : "-"} | net $${pnl.reduce((a, b) => a + b, 0).toFixed(2)} | max DD $${dd.toFixed(2)}`);
  const byWeek: Record<string, number[]> = {}; closed.forEach((t, i) => (byWeek[week(t.closedAt!)] ??= []).push(pnl[i]));
  const wk = Object.entries(byWeek).map(([k, v]) => `${k}: n=${v.length} $${v.reduce((a, b) => a + b, 0).toFixed(2)}`); if (wk.length) console.log("   weeks:", wk.join(" | "));
  console.log("   exits:", JSON.stringify(closed.reduce((a, t) => ((a[t.reason!] = (a[t.reason!] ?? 0) + 1), a), {} as Record<string, number>)));
  if (closed.length < 100) console.log(`   NOT ENOUGH DATA: ${closed.length}/100 closed trades required by the go-live gates.`);
}

// 4) Jev (log-only) calibration against +240m outcomes of entered candidates
const o240 = new Map(outs.filter((o) => o.horizonMin === 240).map((o) => [o.mint, o]));
const pairsUp: Array<[number, number]> = [], pairsRug: Array<[number, number]> = [];
for (const c of cand) { const j = c.jev, o = o240.get(c.mint); if (!j || j.error || !o) continue; const dead = o.ret === null; pairsUp.push([j.pUp, !dead && o.ret > 0.10 ? 1 : 0]); pairsRug.push([j.rugRisk, dead || o.ret < -0.5 ? 1 : 0]); }
const brier = (p: Array<[number, number]>) => p.reduce((a, [x, y]) => a + (x - y) ** 2, 0) / p.length, base = (p: Array<[number, number]>) => { const b = p.reduce((a, [, y]) => a + y, 0) / p.length; return brier(p.map(([, y]) => [b, y])); };
if (pairsUp.length) console.log(`\n== Jev calibration (n=${pairsUp.length}${pairsUp.length < 100 ? ", TOO FEW" : ""}): P(up>10%) Brier ${brier(pairsUp).toFixed(3)} vs base ${base(pairsUp).toFixed(3)} | P(rug) Brier ${brier(pairsRug).toFixed(3)} vs base ${base(pairsRug).toFixed(3)}  (must beat base to be useful)`);
