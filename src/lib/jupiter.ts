/**
 * Jupiter swap API — READ-ONLY quote client. Places no orders and holds no keys.
 * Endpoints (verify against https://dev.jup.ag/docs before relying on them; I could not fetch docs
 * from the build sandbox):
 *   keyless:  https://lite-api.jup.ag/swap/v1/quote
 *   keyed:    https://api.jup.ag/swap/v1/quote   (header x-api-key: JUPITER_API_KEY)
 */

export const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;

export interface JupQuote {
  inputMint: string; outputMint: string;
  inAmount: string; outAmount: string;           // atomic units
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;                        // percent, as a string
  routePlan: Array<{ swapInfo?: { label?: string } }>;
  contextSlot?: number;
}

export interface QuoteParams { inputMint: string; outputMint: string; amount: bigint; slippageBps: number }
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function getQuote(p: QuoteParams, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<JupQuote> {
  const key = process.env.JUPITER_API_KEY;
  const base = key ? "https://api.jup.ag/swap/v1" : "https://lite-api.jup.ag/swap/v1";
  const qs = new URLSearchParams({
    inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount.toString(),
    slippageBps: String(p.slippageBps), restrictIntermediateTokens: "true",
  });
  const res = await fetchImpl(`${base}/quote?${qs}`, { headers: key ? { "x-api-key": key } : {} });
  if (!res.ok) throw new Error(`Jupiter quote ${res.status}`);
  const q = (await res.json()) as JupQuote;
  if (!q?.outAmount || !q?.inAmount) throw new Error("Jupiter quote: no route");
  return q;
}
