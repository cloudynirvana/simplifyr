/** GeckoTerminal OHLCV (keyless) — historical candles for backtesting. DexScreener has none. */

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

/** Public API is ~30 req/min; on 429 wait (Retry-After if given) and retry a few times. */
async function fetchWithBackoff(url: string, attempts = 4): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status !== 429 || i >= attempts - 1) {
      if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
      return res;
    }
    const wait = Number(res.headers.get("retry-after")) * 1000 || 15_000 * (i + 1);
    await new Promise((r) => setTimeout(r, wait));
  }
}

export async function getCandles(
  network: string,
  pool: string,
  timeframe: "minute" | "hour" | "day" = "hour",
  limit = 1000
): Promise<Candle[]> {
  // The API caps each page at 1000 candles; page backwards with before_timestamp until `limit` is reached.
  const out = new Map<number, Candle>();
  let before: number | undefined;
  for (let page = 0; page < 10 && out.size < limit; page++) {
    const qs = new URLSearchParams({ aggregate: "1", limit: String(Math.min(1000, limit)), currency: "usd" });
    if (before) qs.set("before_timestamp", String(before));
    const url = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv/${timeframe}?${qs}`;
    const res = await fetchWithBackoff(url);
    const rows: number[][] = (await res.json())?.data?.attributes?.ohlcv_list ?? [];
    if (!rows.length) break;
    for (const [t, o, h, l, c, v] of rows) out.set(t * 1000, { t: t * 1000, o, h, l, c, v });
    const oldest = Math.min(...rows.map((r) => r[0]));
    if (before !== undefined && oldest >= before) break;
    before = oldest;
  }
  return [...out.values()].sort((a, b) => a.t - b.t).slice(-limit);
}
