#!/usr/bin/env node
// Gate calibration from the journal you ALREADY have. For every rejected token we know which gates failed and its price
// at +1h/+4h. Tokens that failed exactly ONE gate isolate that gate's effect: if they mostly dump, the gate earns its keep;
// if they often run, it is costing winners. Buy-and-hold from rejection time, minus a flat round-trip cost (COST_PCT, default 7%).
// Upper-bound style numbers (no entry timing, no exits): use them to choose WHICH gates to test in shadow, not to trade.
import { readJournal } from './lib.mjs';

const H = Number(process.argv[2] ?? 1), COST = Number(process.env.COST_PCT ?? 7) / 100;
const j = readJournal(), fails = new Map();
for (const r of j) if (r.event === 'reject' && r.fail && !fails.has(r.token)) fails.set(r.token, r.fail);
const groups = {};
for (const r of j) {
  if (r.event !== 'reject_followup' || r.hours !== H || !(r.x > 0)) continue;
  const f = fails.get(r.token) ?? r.fail ?? [];
  const keys = f.length === 1 ? ['only:' + f[0]] : ['multi(' + f.length + ')'];
  for (const k of [...keys, 'ALL']) (groups[k] ??= []).push(r.x);
}
const med = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const rows = Object.entries(groups).map(([k, a]) => {
  const capped = a.map(x => Math.min(x, 5));                 // cap lottery tickets so one 37x doesn't fake an edge
  return { cohort: k, n: a.length, median: +med(a).toFixed(2), 'pct>=2x': +(100 * a.filter(x => x >= 2).length / a.length).toFixed(1),
    'pct<=0.5x': +(100 * a.filter(x => x <= 0.5).length / a.length).toFixed(1),
    'evCapped5x_afterCost%': +((capped.reduce((s, x) => s + x, 0) / a.length - 1 - COST) * 100).toFixed(1) };
}).sort((a, b) => b.n - a.n);
console.log(`Rejected-token outcomes at +${H}h (buy-and-hold, cost ${COST * 100}%):`);
console.table(rows);
console.log('Read: a gate whose "only:" cohort has evCapped5x_afterCost% clearly below ALL is protecting you; one near or above\n' +
  'zero with n >= 30 is a candidate to relax -> confirm with its shadow cohort (byStrategy "shadow:<gate>") before changing it.');
