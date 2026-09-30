/**
 * POST /api/trading/backtest  { network?: "solana", pool: string, timeframe?: "hour"|"day" }
 * Backtests every strategy with costs, OOS split and robustness gates. Research only — places no trades.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getCandles } from "../../../src/lib/geckoterminal";
import { validateAll, buyAndHold, GATES } from "../../../src/trading/backtest";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { network = "solana", pool, timeframe = "hour" } = req.body ?? {};
  if (typeof pool !== "string" || !pool) return res.status(400).json({ error: "pool is required" });
  try {
    const candles = await getCandles(String(network), pool, timeframe === "day" ? "day" : "hour");
    if (candles.length < 300) return res.status(422).json({ error: `Only ${candles.length} candles; need >= 300 for a meaningful test` });
    return res.status(200).json({
      candles: candles.length, buyHoldAll: buyAndHold(candles), gates: GATES, results: validateAll(candles),
      caveat: "Past performance on a single pool is weak evidence; passing gates permits paper trading, not live.",
    });
  } catch (e) {
    console.error("[backtest]", (e as Error).message);
    return res.status(500).json({ error: "Backtest failed" });
  }
}
