import { PublicKey } from "@solana/web3.js";

export type EscrowStateEnum =
  | "Funded"
  | "Disputed"
  | "Released"
  | "Resolved"
  | "Cancelled";

export type EscrowCategory =
  | "DigitalProduct"
  | "RealEstateDeed"
  | "DeSciGrant"
  | "Freelance"
  | "Generic";

export interface EscrowState {
  escrowId: bigint;
  buyer: PublicKey;
  seller: PublicKey;
  amount: bigint;
  milestoneCount: number;
  milestonesCompleted: number;
  state: EscrowStateEnum;
  category: EscrowCategory;
  description: string;
  createdAt: bigint;
  bump: number;
}

export interface CreateEscrowArgs {
  escrowId: bigint;
  amount: bigint;   // in lamports
  milestoneCount: number;
  description: string;
  category: EscrowCategory;
  sellerAddress: string;
}

export interface NoahDisputePayload {
  escrowId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountLamports: string;
  reason: string;
  milestoneCount: number;
  milestonesCompleted: number;
  category: EscrowCategory;
  description: string;
  createdAt: string;
}

export interface NoahVerdict {
  sellerSplitBps: number;  // 0–10000
  reasoning: string;
  confidence: number;      // 0–1
  recommendedAction: "RELEASE" | "REFUND" | "SPLIT";
}

export interface HeliusWebhookEvent {
  signature: string;
  type: string;
  timestamp: number;
  slot: number;
  description: string;
  accountData: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: unknown[];
  }>;
  events?: {
    nft?: unknown;
    compressed?: unknown;
    swap?: unknown;
  };
}
