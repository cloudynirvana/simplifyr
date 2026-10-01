/** Hyperliquid public info API (read-only, keyless). https://api.hyperliquid.xyz/info */
const URL = "https://api.hyperliquid.xyz/info";

export interface HlCandle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface HlMarket { coin: string; maxLeverage: number; vol24: number; openInterestUsd: number }

async function info<T>(body: unknown, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    const res = await fetch(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return res.json() as Promise<T>;
    if ((res.status === 429 || res.status >= 500) && i < attempts - 1) { await new Promise((r) => setTimeout(r, 1500 * 2 ** i)); continue; }
    throw new Error(`Hyperliquid ${res.status}`);
  }
}

export async function getMarkets(): Promise<HlMarket[]> {
  const [meta, ctxs] = await info<[{ universe: Array<{ name: string; maxLeverage: number; isDelisted?: boolean }> }, Array<{ dayNtlVlm: string; openInterest: string; markPx: string }>]>({ type: "metaAndAssetCtxs" });
  return meta.universe
    .map((u, i) => ({ coin: u.name, maxLeverage: u.maxLeverage, vol24: Number(ctxs[i].dayNtlVlm), openInterestUsd: Number(ctxs[i].openInterest) * Number(ctxs[i].markPx), delisted: !!u.isDelisted }))
    .filter((m) => !m.delisted)
    .map(({ delisted: _d, ...m }) => m)
    .sort((a, b) => b.vol24 - a.vol24);
}

/** Candles from startMs to endMs, paged (API returns up to ~5000 per call). */
export async function getCandles(coin: string, interval: "1h" | "4h" | "1d", startMs: number, endMs = Date.now()): Promise<HlCandle[]> {
  const out = new Map<number, HlCandle>();
  let cursor = startMs;
  for (let page = 0; page < 20 && cursor < endMs; page++) {
    const rows = await info<Array<{ t: number; o: string; h: string; l: string; c: string; v: string }>>({ type: "candleSnapshot", req: { coin, interval, startTime: cursor, endTime: endMs } });
    if (!rows.length) break;
    for (const r of rows) out.set(r.t, { t: r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v });
    const last = rows[rows.length - 1].t;
    if (last <= cursor) break;
    cursor = last + 1;
    if (rows.length < 4000) break; // short page = reached the end
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

/** Hourly funding history, paged 500 at a time. Rate is the hourly fraction paid by longs to shorts when positive. */
export async function getFunding(coin: string, startMs: number, endMs = Date.now()): Promise<Array<{ t: number; rate: number }>> {
  const out = new Map<number, number>();
  let cursor = startMs;
  for (let page = 0; page < 200 && cursor < endMs; page++) {
    const rows = await info<Array<{ time: number; fundingRate: string }>>({ type: "fundingHistory", coin, startTime: cursor, endTime: endMs });
    if (!rows.length) break;
    for (const r of rows) out.set(r.time, Number(r.fundingRate));
    const last = rows[rows.length - 1].time;
    if (last <= cursor) break;
    cursor = last + 1;
    if (rows.length < 500) break;
  }
  return [...out.entries()].map(([t, rate]) => ({ t, rate })).sort((a, b) => a.t - b.t);
}
