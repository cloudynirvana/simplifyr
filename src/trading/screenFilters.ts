/** Market-data screen for a DexScreener pair (no holder data). Returns failure reasons; empty = pass. */
export interface DexPairLike {
  liquidity?: { usd?: number }; volume?: { h24?: number }; marketCap?: number; fdv?: number; pairCreatedAt?: number;
  txns?: Record<string, { buys: number; sells: number }>; priceChange?: Record<string, number>;
}

export const SCREEN = {
  minLiquidityUsd: 25_000, minAgeHours: 0.5, maxAgeHours: 48, minMarketCapUsd: 50_000,
  maxVolLiq: 15, honeypotMinBuys: 20, maxSellBuy5m: 1.5, maxChange1hPct: 300, minTxns1h: 100,
  maxBuySellRatio1h: 8, // lopsided flow (e.g. 545 buys vs 26 sells) suggests bot-driven buying; hypothesis, tune from logs
};

export function marketScreen(p: DexPairLike, now = Date.now(), c = SCREEN): string[] {
  const liq = p.liquidity?.usd ?? 0, vol = p.volume?.h24 ?? 0, mc = p.marketCap ?? p.fdv ?? 0;
  const ageH = p.pairCreatedAt ? (now - p.pairCreatedAt) / 36e5 : NaN;
  const h1 = p.txns?.h1 ?? { buys: 0, sells: 0 }, m5 = p.txns?.m5 ?? { buys: 0, sells: 0 };
  const f: string[] = [];
  if (!(liq >= c.minLiquidityUsd)) f.push("liq<25k");
  if (!(ageH >= c.minAgeHours)) f.push("age<30m"); else if (ageH > c.maxAgeHours) f.push("age>48h");
  if (!(mc >= c.minMarketCapUsd)) f.push("mcap<50k");
  if (liq > 0 && vol / liq > c.maxVolLiq) f.push("vol/liq>15");
  if (h1.sells === 0 && h1.buys >= c.honeypotMinBuys) f.push("no sells");
  if (h1.sells > 0 && h1.buys >= c.minTxns1h / 2 && h1.buys / h1.sells > c.maxBuySellRatio1h) f.push("lopsided flow");
  if (m5.buys > 0 && m5.sells / m5.buys > c.maxSellBuy5m) f.push("sell pressure");
  if ((p.priceChange?.h1 ?? 0) > c.maxChange1hPct) f.push("late +300%");
  if (h1.buys + h1.sells < c.minTxns1h) f.push("thin flow");
  return f;
}
