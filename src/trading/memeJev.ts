/**
 * Jev annotation for young memecoins (token-level state, not hourly candles). LOGGED ONLY, never gates entries,
 * until its probabilities are calibrated against outcomes (Brier score on the paper ledger).
 */
const HELP = "State is a snapshot of one young Solana memecoin: age in hours, liquidity and market cap in USD, percent price changes, buy/sell counts, and RugCheck flags.";
export const MEME_QUESTIONS = {
  rug_risk: { type: "noul", instructions: `${HELP} Is this token likely to be rugged or dumped by insiders within the next 2 hours?` },
  direction: { type: "choice", instructions: `${HELP} Over the next 2 hours, which outcome is most likely?`, criteria: { up: "Price rises more than 10 percent", down: "Price falls more than 10 percent", flat: "Moves less than 10 percent either way" } },
  setup_quality: { type: "score", instructions: `${HELP} How good is a small long entry right now?`, criteria: ["Poor: dangerous or chasing", "Weak", "Good", "Excellent"] },
} as const;

export interface MemeJev { model: string; ms: number; rugRisk: number; direction: string; directionConf: number; pUp: number; setup: number }

export async function askMemeJev(state: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<MemeJev | null> {
  const key = process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY; if (!key) return null;
  const t0 = performance.now();
  const r = await fetchImpl("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ state, questions: MEME_QUESTIONS, model: process.env.TYPESAFE_MODEL ?? "jev-1.13.0" }), signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Jev ${r.status}`);
  const b = (await r.json()) as { model: string; answers: Record<string, any> }; const a = b.answers;
  return { model: b.model, ms: Math.round(performance.now() - t0), rugRisk: a.rug_risk.noul, direction: a.direction.choice, directionConf: a.direction.confidence, pUp: a.direction.probabilities.up, setup: a.setup_quality.score };
}
