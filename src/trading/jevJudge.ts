/**
 * Jev judge over plain HTTPS (no SDK). One round trip evaluates all five typed questions.
 * Env (server-side only): TYPESAFE_API_KEY (JEV_API_KEY accepted), TYPESAFE_MODEL (default jev-1.13.0, pinned; never a moving alias).
 * Any failure throws, and the agent fails closed.
 */
import type { Judge, JevAnswers } from "./jevPolicy";
import { QUESTIONS } from "./jevQuestions";
import type { Snapshot } from "./state";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function getJudge(opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Judge | null {
  const key = process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY;
  if (!key) return null;
  const model = process.env.TYPESAFE_MODEL ?? "jev-1.13.0";
  const f = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  return async (snap: Snapshot): Promise<JevAnswers> => {
    const res = await f("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ state: snap, questions: QUESTIONS, model }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`Jev ${res.status}`);
    const b = (await res.json()) as { model: string; answers: Record<string, any> };
    const a = b.answers;
    if (!a?.regime || !a?.direction || !a?.toxic_flow || !a?.setup_quality || !a?.risk_state) throw new Error("Jev: incomplete answers");
    return {
      model: b.model,
      regime: { choice: a.regime.choice, confidence: a.regime.confidence },
      direction: { choice: a.direction.choice, confidence: a.direction.confidence, pLong: a.direction.probabilities.long },
      toxic: a.toxic_flow.noul, setupQuality: a.setup_quality.score, riskState: a.risk_state.choice,
    };
  };
}
