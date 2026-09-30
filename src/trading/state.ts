/**
 * Deterministic state engine. Turns closed candles + account state into ONE compact numeric
 * snapshot (<400 tokens) — the only thing the judgment model sees. Everything is computed in code
 * from candles that are already closed at decision time, so no field can leak the future.
 * NOTE: the data sources here have no order book, so spread/imbalance are not available;
 * microstructure is approximated by candle range and volume flow.
 */
import type { Candle } from "../lib/geckoterminal";

export interface Snapshot {
  t: number;
  px: number;
  ret_1h: number; ret_6h: number; ret_24h: number; // percent
  vol_24h: number;       // stdev of hourly returns, percent
  range_24h: number;     // (high-low)/close over 24 bars, percent
  dist_hi_24h: number;   // percent below 24h high
  dist_lo_24h: number;   // percent above 24h low
  vol_z: number;         // latest volume vs 48-bar mean, in stdevs
  signal: number;        // 1 if the validated strategy wants to enter
  inventory_pct: number; // share of equity held
  drawdown_pct: number;  // from equity peak
  day_pnl_pct: number;
  liq_usd_m: number;     // pool liquidity, $ millions
}

const r = (x: number, d = 2) => (Number.isFinite(x) ? Number(x.toFixed(d)) : 0);
const pct = (a: number, b: number) => (b ? (a / b - 1) * 100 : 0);

export interface AccountView { inventoryPct: number; drawdownPct: number; dayPnlPct: number; liquidityUsd: number; signal: 0 | 1 }

/** `closed` must contain only fully closed candles. */
export function buildSnapshot(closed: Candle[], acct: AccountView): Snapshot {
  const n = closed.length;
  if (n < 50) throw new Error("need >= 50 closed candles");
  const last = closed[n - 1];
  const w24 = closed.slice(n - 24), w48 = closed.slice(n - 48);
  const rets = w24.map((c, i) => (i === 0 ? 0 : pct(c.c, w24[i - 1].c))).slice(1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const hi = Math.max(...w24.map((c) => c.h)), lo = Math.min(...w24.map((c) => c.l));
  const vm = w48.reduce((a, c) => a + c.v, 0) / w48.length;
  const vs = Math.sqrt(w48.reduce((a, c) => a + (c.v - vm) ** 2, 0) / w48.length);
  return {
    t: last.t, px: Number(last.c.toPrecision(5)),
    ret_1h: r(pct(last.c, closed[n - 2].c)), ret_6h: r(pct(last.c, closed[n - 7].c)), ret_24h: r(pct(last.c, closed[n - 25].c)),
    vol_24h: r(sd), range_24h: r(((hi - lo) / last.c) * 100),
    dist_hi_24h: r(pct(hi, last.c)), dist_lo_24h: r(pct(last.c, lo)),
    vol_z: r(vs ? (last.v - vm) / vs : 0),
    signal: acct.signal,
    inventory_pct: r(acct.inventoryPct * 100), drawdown_pct: r(acct.drawdownPct * 100), day_pnl_pct: r(acct.dayPnlPct * 100),
    liq_usd_m: r(acct.liquidityUsd / 1e6, 3),
  };
}

/** Rough token estimate (~3.5 chars/token for numeric JSON) used to enforce the 400-token budget. */
export const approxTokens = (s: Snapshot) => Math.ceil(JSON.stringify(s).length / 3.5);
