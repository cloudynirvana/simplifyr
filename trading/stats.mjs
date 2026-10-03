#!/usr/bin/env node
// Metrics from journal.jsonl. `node trading/stats.mjs` prints a report; dashboard.mjs reuses computeStats.
import { readJournal } from './lib.mjs';

export function computeStats(j = readJournal()) {
  const trips = j.filter(r => r.event === 'close'), fills = j.filter(r => r.event === 'fill');
  const buys = fills.filter(f => f.side === 'buy'), okBuys = buys.filter(f => f.ok);
  const wins = trips.filter(t => t.pnlUsd > 0), losses = trips.filter(t => t.pnlUsd <= 0);
  const sum = a => a.reduce((s, x) => s + x, 0), avg = a => (a.length ? sum(a) / a.length : 0);
  const gw = sum(wins.map(t => t.pnlUsd)), gl = -sum(losses.map(t => t.pnlUsd));
  let cum = 0, peak = 0, mdd = 0;
  for (const t of trips) { cum += t.pnlUsd; peak = Math.max(peak, cum); mdd = Math.max(mdd, peak - cum); }
  const costs = sum(trips.map(t => t.costsUsd));
  const byReason = {};
  for (const t of trips) { const r = (byReason[t.reason] ??= { n: 0, pnl: 0 }); r.n++; r.pnl += t.pnlUsd; }
  const fu = j.filter(r => r.event === 'reject_followup');
  const fuStat = h => { const a = fu.filter(r => r.hours === h);
    return { n: a.length, pumped2x: a.filter(r => r.x >= 2).length, dumped50: a.filter(r => r.x <= 0.5).length }; };
  const by = {};
  for (const t of trips) { const k = t.strategy ?? 'cluster', r = (by[k] ??= { n: 0, wins: 0, pnl: 0 }); r.n++; r.pnl += t.pnlUsd; if (t.pnlUsd > 0) r.wins++; }
  // Would following Jev have helped? Group closed trades by Jev's verdict at entry (shadow mode = no influence on trades).
  const byJev = {};
  for (const t of trips) { if (!t.jev || t.jev.error) continue;
    const k = `${t.jev.action}${t.jev.rug >= 0.5 ? '+rugHigh' : ''}`, r = (byJev[k] ??= { n: 0, wins: 0, pnl: 0 }); r.n++; r.pnl += t.pnlUsd; if (t.pnlUsd > 0) r.wins++; }
  const lag = j.filter(r => r.event === 'mirror_entry').map(r => r.copyLagPct);
  const bank = Number(process.env.BANKROLL_USD ?? 100);
  return {
    bankrollStartUsd: bank, equityUsd: bank + cum, returnPct: cum / bank * 100, maxDrawdownPctOfBankroll: mdd / bank * 100,
    byStrategy: by, byJev, mirrorCopyLagPctAvg: avg(lag), mirrorStale: j.filter(r => r.event === 'mirror_stale').length,
    trades: trips.length, winRate: trips.length ? wins.length / trips.length : 0,
    avgWinUsd: avg(wins.map(t => t.pnlUsd)), avgLossUsd: avg(losses.map(t => t.pnlUsd)),
    expectancyUsd: avg(trips.map(t => t.pnlUsd)), profitFactor: gl ? gw / gl : null,
    totalPnlUsd: cum, maxDrawdownUsd: mdd, totalCostsUsd: costs,
    pnlIfCostsDoubledUsd: cum - costs, // stress test: would it still make money with 2x the friction?
    medianHoldMin: (() => { const h = trips.map(t => t.holdS / 60).sort((a, b) => a - b); return h[Math.floor(h.length / 2)] ?? 0; })(),
    avgSlipPct: avg(okBuys.map(f => f.slipPct)), missedBuys: buys.length - okBuys.length, missRate: buys.length ? 1 - okBuys.length / buys.length : 0,
    signals: j.filter(r => r.event === 'signal').length, byReason,
    rejectedFollowup: { h1: fuStat(1), h4: fuStat(4) },
  };
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(computeStats(), null, 2));
