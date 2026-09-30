/** GeckoTerminal OHLCV (keyless) — historical candles for backtesting. DexScreener has none. */

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

export async function getCandles(
  network: string,
  pool: string,
  timeframe: "minute" | "hour" | "day" = "hour",
  limit = 1000
): Promise<Candle[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv/${timeframe}?aggregate=1&limit=${limit}&currency=usd`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  const body = await res.json();
  const rows: number[][] = body?.data?.attributes?.ohlcv_list ?? [];
  return rows
    .map(([t, o, h, l, c, v]) => ({ t: t * 1000, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t);
}
