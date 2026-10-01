/** Aligned daily panel (dates x coins). Missing data is NaN; funding is the summed hourly rate per UTC day. */
import fs from "fs";

export interface Panel {
  dates: number[];            // UTC day start, ms
  coins: string[];
  close: number[][]; high: number[][]; low: number[][]; // [coin][t]
  ret: number[][];            // [coin][t] close-to-close return, NaN if unavailable
  funding: number[][];        // [coin][t] summed hourly funding for day t (fraction; longs pay shorts when > 0)
}

const DAY = 864e5;

export function buildPanel(raw: Array<{ coin: string; candles: Array<{ t: number; h: number; l: number; c: number }>; funding: Array<{ t: number; rate: number }> }>): Panel {
  const t0 = Math.min(...raw.map((r) => r.candles[0]?.t ?? Infinity)), t1 = Math.max(...raw.map((r) => r.candles[r.candles.length - 1]?.t ?? -Infinity));
  const n = Math.round((t1 - t0) / DAY) + 1;
  const dates = Array.from({ length: n }, (_, i) => t0 + i * DAY);
  const mk = () => raw.map(() => new Array<number>(n).fill(NaN));
  const close = mk(), high = mk(), low = mk(), ret = mk(), funding = mk();
  raw.forEach((r, ci) => {
    for (const c of r.candles) { const i = Math.round((c.t - t0) / DAY); close[ci][i] = c.c; high[ci][i] = c.h; low[ci][i] = c.l; }
    for (let i = 1; i < n; i++) if (Number.isFinite(close[ci][i]) && Number.isFinite(close[ci][i - 1])) ret[ci][i] = close[ci][i] / close[ci][i - 1] - 1;
    for (const f of r.funding) { const i = Math.floor((f.t - t0) / DAY); if (i >= 0 && i < n && Number.isFinite(close[ci][i])) funding[ci][i] = (Number.isFinite(funding[ci][i]) ? funding[ci][i] : 0) + f.rate; }
  });
  return { dates, coins: raw.map((r) => r.coin), close, high, low, ret, funding };
}

export function loadPanel(dir = ".trading-state/hl"): Panel {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  return buildPanel(files.map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"))));
}
