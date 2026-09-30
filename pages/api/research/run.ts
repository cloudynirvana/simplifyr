/**
 * POST /api/research/run
 * Body: { query: string, chainId?: string, pairId?: string, maxIterations?: number }
 * Runs the trading research team on live DexScreener data.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { runTradingResearch } from "../../../src/agents/tradingResearch";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, chainId, pairId, maxIterations } = req.body ?? {};
  const q = typeof query === "string" && query.trim() ? query.trim() : process.env.DEXSCREENER_DEFAULT_PAIR;
  if (!q) return res.status(400).json({ error: "query is required" });

  try {
    const result = await runTradingResearch({
      query: q,
      chainId: typeof chainId === "string" ? chainId : undefined,
      pairId: typeof pairId === "string" ? pairId : undefined,
      maxIterations: Math.min(Number(maxIterations) || 3, 5),
    });
    return res.status(200).json(result);
  } catch (e) {
    console.error("[research] failed:", (e as Error).message);
    return res.status(500).json({ error: "Research run failed" });
  }
}
