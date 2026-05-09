/**
 * /pages/api/noah/dispute.ts
 *
 * Noah AI arbitration engine.
 * Receives a dispute payload, calls the Anthropic API with full context,
 * returns a structured verdict with split BPS for on-chain resolution.
 *
 * Called by:
 *   - Frontend DisputePanel component (buyer/seller can request review)
 *   - webhook.ts when a raise_dispute event is detected
 */

import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import type { NoahDisputePayload, NoahVerdict } from "../../../src/types";

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});

const NOAH_SYSTEM_PROMPT = `You are Noah, an impartial AI arbitrator for Simplify — a Solana escrow protocol.

Your role is to analyse escrow disputes fairly and recommend a settlement split between buyer and seller.

Your analysis must consider:
1. Whether the seller demonstrably completed their obligations
2. Whether the buyer's dispute reason is substantiated
3. The milestone completion ratio as objective evidence
4. The escrow category and typical standards for that category
5. Fairness to both parties

Output ONLY valid JSON with this exact structure (no markdown, no prose):
{
  "sellerSplitBps": <integer 0-10000>,
  "reasoning": "<2-3 sentence explanation>",
  "confidence": <float 0.0-1.0>,
  "recommendedAction": "<RELEASE | REFUND | SPLIT>"
}

Rules:
- sellerSplitBps 10000 = seller receives 100% (full release)
- sellerSplitBps 0 = buyer receives 100% (full refund)
- A split typically reflects partial completion
- Be conservative: when evidence is unclear, prefer a 50/50 split (5000)
- Never favour one party without clear evidence
`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload = req.body as NoahDisputePayload;

  if (!payload.escrowId || !payload.reason) {
    return res.status(400).json({ error: "Missing required fields: escrowId, reason" });
  }

  try {
    const verdict = await arbitrate(payload);
    return res.status(200).json(verdict);
  } catch (err: any) {
    console.error("[Noah dispute] Arbitration failed:", err);
    return res.status(500).json({ error: err?.message ?? "Arbitration failed" });
  }
}

async function arbitrate(payload: NoahDisputePayload): Promise<NoahVerdict> {
  const milestoneRatio = `${payload.milestonesCompleted}/${payload.milestoneCount}`;
  const amountSOL = (Number(payload.amountLamports) / 1e9).toFixed(4);
  const createdDate = new Date(Number(payload.createdAt) * 1000).toISOString();

  const userMessage = `
ESCROW DISPUTE — ID: ${payload.escrowId}

Category: ${payload.category}
Description: ${payload.description}
Amount in escrow: ${amountSOL} SOL
Created: ${createdDate}

Parties:
  Buyer:  ${payload.buyerAddress}
  Seller: ${payload.sellerAddress}

Milestone progress: ${milestoneRatio} completed

Buyer's dispute reason:
"${payload.reason}"

Please analyse this dispute and return your verdict as JSON.
`.trim();

  const message = await openai.chat.completions.create({
    model: "meta/llama-3.1-70b-instruct",
    max_tokens: 512,
    messages: [
      { role: "system", content: NOAH_SYSTEM_PROMPT },
      { role: "user", content: userMessage }
    ],
  });

  const raw = message.choices[0]?.message?.content || "";

  let verdict: NoahVerdict;
  try {
    verdict = JSON.parse(raw);
  } catch {
    // Fallback: conservative 50/50 if parsing fails
    verdict = {
      sellerSplitBps: 5000,
      reasoning:
        "Unable to parse AI verdict. Defaulting to equal split pending manual review.",
      confidence: 0.3,
      recommendedAction: "SPLIT",
    };
  }

  // Validate bounds
  verdict.sellerSplitBps = Math.max(0, Math.min(10000, Math.round(verdict.sellerSplitBps)));
  verdict.confidence = Math.max(0, Math.min(1, verdict.confidence));

  console.log(`[Noah dispute] Escrow ${payload.escrowId} verdict:`, verdict);
  return verdict;
}
