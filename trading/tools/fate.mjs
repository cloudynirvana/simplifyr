#!/usr/bin/env node
// Why did each signal (= token that passed every gate) never become a trade? Lives in tools/ so it is NOT part of the
// code hash: analysis-only scripts must not invalidate a running evaluation. Usage: node trading/tools/fate.mjs
import { readJournal } from '../lib.mjs';
const j = readJournal();
// Signal fate: a signal has already passed every gate, so it can only die afterwards by a re-check (regate), a bad wave
// phase (phase_dead / phase_breakdown / phase_distribution) or by the entry trigger never firing (watch_expired, 2h).
const fate = new Map();
for (const r of j) {
  if (r.event === 'signal') { fate.set(r.token, { sym: r.sym, src: r.src ?? 'smart', shadow: r.shadow ?? '', phaseAtSignal: r.phase, fate: 'still watching' }); continue; }
  const f = fate.get(r.token);
  if (!f) continue;
  if (r.event === 'reject' && !r.shadowed) f.fate = 'killed: ' + (r.fail ?? []).join('+');
  if (r.event === 'watch_expired') f.fate = 'expired: entry never fired';
  if (r.event === 'entry') f.fate = 'ENTERED';
  if (r.event === 'buy_missed') f.fate = 'buy missed: ' + r.reason;
}
if (fate.size) {
  const count = {}; for (const f of fate.values()) { const k = f.fate.split(':')[0] === 'killed' ? f.fate : f.fate; count[k] = (count[k] ?? 0) + 1; }
  console.log('Signal fate (' + fate.size + ' signals):', count);
  console.table([...fate.values()]);
}
