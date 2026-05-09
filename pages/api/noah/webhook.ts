/**
 * /pages/api/noah/webhook.ts
 *
 * Receives Helius webhook events for the escrow program.
 * Configure in Helius dashboard:
 *   URL: https://your-domain.vercel.app/api/noah/webhook
 *   Webhook type: Enhanced
 *   Addresses: [your deployed program ID]
 *   Events: ACCOUNT_CHANGE
 *
 * Helius sends a POST with an array of transaction events.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import type { HeliusWebhookEvent } from "../../../src/types";

const WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET;

type WebhookResponse = { ok: boolean; processed?: number; error?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WebhookResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Verify Helius signature
  const authHeader = req.headers["authorization"];
  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const events: HeliusWebhookEvent[] = Array.isArray(req.body)
    ? req.body
    : [req.body];

  let processed = 0;

  for (const event of events) {
    try {
      await processEvent(event);
      processed++;
    } catch (err) {
      console.error("[Noah webhook] Error processing event:", err);
    }
  }

  return res.status(200).json({ ok: true, processed });
}

async function processEvent(event: HeliusWebhookEvent): Promise<void> {
  console.log("[Noah webhook] Received event:", event.type, event.signature);

  // Parse description to identify escrow state changes
  const desc = event.description?.toLowerCase() ?? "";

  if (desc.includes("dispute") || desc.includes("raise_dispute")) {
    await handleDisputeEvent(event);
  } else if (desc.includes("milestone") || desc.includes("complete_milestone")) {
    await handleMilestoneEvent(event);
  } else if (desc.includes("create_escrow")) {
    await handleEscrowCreatedEvent(event);
  }
  // Add more event types as needed
}

async function handleDisputeEvent(event: HeliusWebhookEvent): Promise<void> {
  console.log("[Noah webhook] Dispute raised, scheduling arbitration:", event.signature);
  // In production: extract escrow ID from log data, call /api/noah/dispute
  // Could use a queue (Upstash, etc.) for reliability
}

async function handleMilestoneEvent(event: HeliusWebhookEvent): Promise<void> {
  console.log("[Noah webhook] Milestone event detected:", event.signature);
  // Notify buyer via email/push if configured
}

async function handleEscrowCreatedEvent(event: HeliusWebhookEvent): Promise<void> {
  console.log("[Noah webhook] New escrow created:", event.signature);
  // Index in database, send confirmation notifications
}
