/**
 * Gate policy for the judgment model's typed answers. THIS FILE owns every threshold, size and
 * side effect; the model only supplies calibrated judgments. Keep all constants here so they are
 * easy to review. The model never sees, and cannot change, the risk layer in risk.ts.
 */
import type { Snapshot } from "./state";

export const POLICY = {
  minSetupQuality: 2,          // setup_quality score must be >= 2 (of 0..3)
  minDirectionConfidence: 0.8, // direction confidence must exceed this to enter
  escalateBelow: 0.6,          // below this, hand the decision up (Opus/operator) and take no risk
  maxToxicFlow: 0.5,           // P(toxic flow) must not exceed this
  kellyFraction: 0.25,         // quarter Kelly cap
  payoffRatio: 1.5,            // ASSUMPTION: avg win / avg loss; replace with a value measured in backtests
};

export interface JevAnswers {
  model: string;
  regime: { choice: string; confidence: number };
  direction: { choice: string; confidence: number; pLong: number };
  toxic: number;        // P(toxic flow)
  setupQuality: number; // 0..3
  riskState: string;    // safe | near_limit | reduce
}

/** A judge turns one snapshot into typed answers (one parallel model call). */
export type Judge = (snap: Snapshot) => Promise<JevAnswers>;

export interface Verdict { action: "enter" | "skip" | "escalate"; reason: string; fraction: number }

/** Fractional Kelly: f* = (p*b - (1-p)) / b, scaled by kellyFraction. p is the calibrated P(long). */
export function kellySize(p: number, b = POLICY.payoffRatio, fraction = POLICY.kellyFraction): number {
  const f = (p * b - (1 - p)) / b;
  return Math.max(0, f) * fraction;
}

export function decide(a: JevAnswers, maxPositionPct: number): Verdict {
  const skip = (reason: string): Verdict => ({ action: "skip", reason, fraction: 0 });
  if (a.regime.choice === "crisis") return { action: "escalate", reason: "regime=crisis", fraction: 0 };
  if (a.direction.confidence < POLICY.escalateBelow)
    return { action: "escalate", reason: `direction confidence ${a.direction.confidence.toFixed(2)} < ${POLICY.escalateBelow}`, fraction: 0 };
  if (a.riskState !== "safe") return skip(`risk_state=${a.riskState}`);
  if (a.direction.choice !== "long") return skip(`direction=${a.direction.choice}`); // spot, long-only
  if (a.direction.confidence <= POLICY.minDirectionConfidence)
    return skip(`direction confidence ${a.direction.confidence.toFixed(2)} not > ${POLICY.minDirectionConfidence}`);
  if (a.setupQuality < POLICY.minSetupQuality) return skip(`setup_quality ${a.setupQuality.toFixed(2)} < ${POLICY.minSetupQuality}`);
  if (a.toxic > POLICY.maxToxicFlow) return skip(`toxic_flow ${a.toxic.toFixed(2)} > ${POLICY.maxToxicFlow}`);
  const fraction = Math.min(maxPositionPct, kellySize(a.direction.pLong));
  if (fraction <= 0) return skip("kelly size is zero");
  return { action: "enter", reason: "all gates passed", fraction };
}
