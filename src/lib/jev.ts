/**
 * Jev — bounded decision/control model.
 * Used ONLY for: routing, continue-vs-stop, retry, escalation, completion assessment.
 * Never for writing deliverables or analysis.
 *
 * Env (server-side only, never log or commit):
 *   JEV_API_KEY  — bearer key
 *   JEV_API_URL  — decision endpoint (POST). If unset or failing, a rule-based
 *                  fallback decides so the loop still terminates.
 */

export type JevDecision = "CONTINUE" | "RETRY" | "VERIFY" | "ESCALATE" | "COMPLETE";

export interface JevContext {
  goal: string;
  iteration: number;
  maxIterations: number;
  /** Direct, code-verified evidence. Jev must not be asked about what this already settles. */
  evidence: {
    dataFetched: boolean;
    pairsAnalysed: number;
    reviewerIssues: number;
    verificationPassed: boolean;
  };
}

export interface JevResult {
  decision: JevDecision;
  reason: string;
  source: "jev" | "fallback";
}

const VALID: JevDecision[] = ["CONTINUE", "RETRY", "VERIFY", "ESCALATE", "COMPLETE"];

/** Deterministic rules — also the answer whenever evidence already settles the question. */
export function ruleBasedDecision(ctx: JevContext): JevResult {
  const { evidence: e } = ctx;
  if (!e.dataFetched || e.pairsAnalysed === 0)
    return { decision: ctx.iteration >= ctx.maxIterations ? "ESCALATE" : "RETRY", reason: "no market data", source: "fallback" };
  if (e.reviewerIssues > 0)
    return { decision: ctx.iteration >= ctx.maxIterations ? "ESCALATE" : "RETRY", reason: `${e.reviewerIssues} reviewer issues open`, source: "fallback" };
  if (!e.verificationPassed) return { decision: "VERIFY", reason: "verification not passed", source: "fallback" };
  return { decision: "COMPLETE", reason: "review and verification clean", source: "fallback" };
}

export async function jevDecide(ctx: JevContext): Promise<JevResult> {
  const url = process.env.JEV_API_URL;
  const key = process.env.JEV_API_KEY;
  const fallback = ruleBasedDecision(ctx);
  if (!url || !key) return fallback;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        task: "Choose exactly one of CONTINUE, RETRY, VERIFY, ESCALATE, COMPLETE. Reply as JSON {decision, reason}.",
        context: ctx,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ...fallback, reason: `jev ${res.status}; ${fallback.reason}` };
    const body = await res.json();
    const raw = body.decision ?? body.choices?.[0]?.message?.content ?? "";
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const decision = VALID.find((d) => text.toUpperCase().includes(d));
    if (!decision) return fallback;
    // Never accept COMPLETE when direct evidence says otherwise.
    if (decision === "COMPLETE" && fallback.decision !== "COMPLETE") return fallback;
    return { decision, reason: String(body.reason ?? "jev"), source: "jev" };
  } catch {
    return fallback;
  }
}
