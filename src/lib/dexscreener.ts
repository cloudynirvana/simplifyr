/**
 * DexScreener API client (https://docs.dexscreener.com/api/reference).
 * Public, keyless, rate limited (~300 req/min on pair/search endpoints).
 */

const BASE = "https://api.dexscreener.com";

export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  url?: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceNative?: string;
  txns?: Record<string, { buys: number; sells: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`DexScreener ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

export async function searchPairs(query: string): Promise<DexPair[]> {
  const data = await get<{ pairs?: DexPair[] }>(`/latest/dex/search?q=${encodeURIComponent(query)}`);
  return data.pairs ?? [];
}

export async function getPair(chainId: string, pairId: string): Promise<DexPair | null> {
  const data = await get<{ pairs?: DexPair[] | null }>(
    `/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairId)}`
  );
  return data.pairs?.[0] ?? null;
}

export async function getTokenPairs(chainId: string, tokenAddress: string): Promise<DexPair[]> {
  return get<DexPair[]>(
    `/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`
  );
}

export async function getTrendingTokens(): Promise<Array<{ chainId: string; tokenAddress: string; description?: string }>> {
  return get(`/token-boosts/top/v1`);
}
