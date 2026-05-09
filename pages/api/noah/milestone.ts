/**
 * /pages/api/noah/milestone.ts
 *
 * Noah milestone validation endpoint.
 * Seller submits evidence; Noah AI validates whether the milestone
 * is genuinely complete before allowing on-chain completion.
 *
 * POST body:
 *   { escrowId, milestoneIndex, milestoneDescription, evidence: string | string[] }
 */

import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import type { EscrowCategory } from "../../../src/types";

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});

interface MilestoneValidationRequest {
  escrowId: string;
  milestoneIndex: number;
  milestoneDescription: string;
  evidence: string | string[];   // IPFS URLs, GitHub links, delivery hashes, text
  category: EscrowCategory;
  escrowDescription: string;
}

interface MilestoneValidationResponse {
  valid: boolean;
  confidence: number;
  notes: string;
  flagged: boolean;
  flagReason?: string;
}

const VALIDATOR_SYSTEM = `You are Noah, an AI milestone validator for Simplify — a Solana escrow protocol.

Your job is to assess whether a seller has provided sufficient evidence that a milestone is complete.

Output ONLY valid JSON (no markdown):
{
  "valid": <boolean>,
  "confidence": <float 0.0-1.0>,
  "notes": "<1-2 sentences>",
  "flagged": <boolean — true if evidence looks fraudulent or mismatched>,
  "flagReason": "<string or null>"
}

Be objective. If evidence URLs point to real deliverables matching the milestone description, validate positively.
If evidence is vague, circular, or clearly unrelated, flag it.
When uncertain, set confidence < 0.7 and valid: false — better to ask for more evidence than release prematurely.`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body as MilestoneValidationRequest;
  if (!body.escrowId || body.milestoneIndex === undefined || !body.evidence) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await validate(body);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[Noah milestone] Validation error:", err);
    return res.status(500).json({ error: err?.message ?? "Validation failed" });
  }
}

async function validate(
  req: MilestoneValidationRequest
): Promise<MilestoneValidationResponse> {
  const evidenceList = Array.isArray(req.evidence)
    ? req.evidence.join("\n  - ")
    : req.evidence;

  const userMessage = `
MILESTONE VALIDATION REQUEST

Escrow ID: ${req.escrowId}
Category: ${req.category}
Escrow description: ${req.escrowDescription}

Milestone #${req.milestoneIndex + 1}: "${req.milestoneDescription}"

Seller-provided evidence:
  - ${evidenceList}

Is this milestone genuinely complete based on the evidence provided?
`.trim();

  const message = await openai.chat.completions.create({
    model: "meta/llama-3.1-70b-instruct",
    max_tokens: 256,
    messages: [
      { role: "system", content: VALIDATOR_SYSTEM },
      { role: "user", content: userMessage }
    ],
  });

  const raw = message.choices[0]?.message?.content || "";

  try {
    const result = JSON.parse(raw) as MilestoneValidationResponse;
    result.confidence = Math.max(0, Math.min(1, result.confidence));
    return result;
  } catch {
    return {
      valid: false,
      confidence: 0.1,
      notes: "Could not parse validation response. Manual review required.",
      flagged: false,
    };
  }
}
