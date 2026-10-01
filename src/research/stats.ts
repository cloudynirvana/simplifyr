/** Performance statistics, including the Deflated Sharpe Ratio (Bailey & Lopez de Prado) to penalise multiple testing. */

export const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
export const std = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1)); };
const ANN = 365; // crypto trades every day

export function sharpe(r: number[]): number { const s = std(r); return s > 0 ? (mean(r) / s) * Math.sqrt(ANN) : 0; }
export function sharpeDaily(r: number[]): number { const s = std(r); return s > 0 ? mean(r) / s : 0; }
export function annReturn(r: number[]): number { return Math.pow(r.reduce((a, b) => a * (1 + b), 1), ANN / Math.max(1, r.length)) - 1; }
export function totalReturn(r: number[]): number { return r.reduce((a, b) => a * (1 + b), 1) - 1; }
export function maxDrawdown(r: number[]): number { let e = 1, p = 1, dd = 0; for (const x of r) { e *= 1 + x; p = Math.max(p, e); dd = Math.max(dd, 1 - e / p); } return dd; }
export function skew(r: number[]) { const m = mean(r), s = std(r); return s ? mean(r.map((x) => ((x - m) / s) ** 3)) : 0; }
export function kurt(r: number[]) { const m = mean(r), s = std(r); return s ? mean(r.map((x) => ((x - m) / s) ** 4)) : 3; }

export function normCdf(x: number): number { // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + (x < 0 ? -y : y));
}
export function normInv(p: number): number { // Acklam
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425; let q: number, r: number;
  if (p < lo) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Deflated Sharpe Ratio: probability the true Sharpe exceeds what the best of `nTrials` skill-less strategies would show.
 * `trialSharpesDaily` are the per-day Sharpe estimates of ALL tried configurations (to estimate their variance).
 */
export function deflatedSharpe(r: number[], nTrials: number, trialSharpesDaily: number[]): number {
  const T = r.length, sr = sharpeDaily(r);
  if (T < 30 || nTrials < 1) return NaN;
  const g = 0.5772156649, v = Math.max(1e-12, std(trialSharpesDaily) ** 2);
  const sr0 = nTrials > 1 ? Math.sqrt(v) * ((1 - g) * normInv(1 - 1 / nTrials) + g * normInv(1 - 1 / (nTrials * Math.E))) : 0;
  const denom = Math.sqrt(Math.max(1e-12, 1 - skew(r) * sr + ((kurt(r) - 1) / 4) * sr * sr));
  return normCdf(((sr - sr0) * Math.sqrt(T - 1)) / denom);
}
