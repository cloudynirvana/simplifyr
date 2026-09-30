/** Calibration review: did the judge's P(long) match what actually happened? (Brier score + bins.) */
import type { Candle } from "../lib/geckoterminal";
import type { DecisionRecord } from "./agent";

export const HORIZON_BARS = 6;
export const ROUND_TRIP_COST = 0.016; // 2 x (30 bps fee + 50 bps slippage)

export interface CalibrationReport {
  n: number; brier: number; baselineBrier: number; baseRate: number;
  bins: Array<{ lo: number; hi: number; n: number; meanP: number; hitRate: number }>;
  enteredN: number; enteredHitRate: number | null;
  notes: string[];
}

/** Outcome = price rose by more than round-trip costs over the next HORIZON_BARS closed candles. */
export function calibrate(decisions: DecisionRecord[], candles: Candle[]): CalibrationReport {
  const scored: Array<{ p: number; o: 0 | 1; entered: boolean }> = [];
  for (const d of decisions) {
    if (!d.answers) continue;
    const i = candles.findIndex((c) => c.t === d.t);
    if (i < 0 || i + HORIZON_BARS >= candles.length - 1) continue; // outcome not yet known
    const o = candles[i + HORIZON_BARS].c / candles[i].c - 1 > ROUND_TRIP_COST ? 1 : 0;
    scored.push({ p: d.answers.direction.pLong, o, entered: d.action === "enter" });
  }
  const n = scored.length;
  const base = n ? scored.reduce((a, x) => a + x.o, 0) / n : 0;
  const brier = n ? scored.reduce((a, x) => a + (x.p - x.o) ** 2, 0) / n : NaN;
  const baselineBrier = n ? scored.reduce((a, x) => a + (base - x.o) ** 2, 0) / n : NaN;
  const bins = Array.from({ length: 5 }, (_, k) => {
    const lo = k / 5, hi = (k + 1) / 5;
    const xs = scored.filter((x) => x.p >= lo && (k === 4 ? x.p <= hi : x.p < hi));
    return { lo, hi, n: xs.length, meanP: xs.length ? xs.reduce((a, x) => a + x.p, 0) / xs.length : 0, hitRate: xs.length ? xs.reduce((a, x) => a + x.o, 0) / xs.length : 0 };
  });
  const ent = scored.filter((x) => x.entered);
  const notes: string[] = [];
  if (n < 30) notes.push(`Only ${n} scored decisions: too few to trust any calibration conclusion.`);
  else if (brier >= baselineBrier) notes.push("Brier score is no better than always predicting the base rate: the judge adds no calibrated information on this pair.");
  for (const b of bins) if (b.n >= 10 && Math.abs(b.meanP - b.hitRate) > 0.2) notes.push(`Bin ${b.lo.toFixed(1)}-${b.hi.toFixed(1)}: predicted ${b.meanP.toFixed(2)} but hit rate ${b.hitRate.toFixed(2)} (miscalibrated).`);
  return { n, brier, baselineBrier, baseRate: base, bins, enteredN: ent.length, enteredHitRate: ent.length ? ent.reduce((a, x) => a + x.o, 0) / ent.length : null, notes };
}
