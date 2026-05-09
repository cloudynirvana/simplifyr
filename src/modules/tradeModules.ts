/**
 * Trade modules — specialized escrow flows for different asset categories.
 * DigitalProduct: delivery via signed URL or IPFS hash stored in description.
 * RealEstateDeed: NFT deed transfer (proxy via mark_fulfilled; full Metaplex CPI is TODO).
 */

import { PublicKey } from "@solana/web3.js";
import { escrowEngine, deriveEscrowPDA, deriveVaultPDA } from "../engine/escrowEngine";
import type { CreateEscrowArgs } from "../types";

// ── Digital product flow ──────────────────────────────────────────────────────

export interface DigitalProductListing {
  productName: string;
  deliveryHash: string;    // IPFS CID or SHA-256 of file
  priceSOL: number;
  sellerAddress: string;
  milestones: string[];    // e.g. ["Deliver file", "Buyer confirms"]
}

export async function createDigitalProductEscrow(
  listing: DigitalProductListing,
  buyerAddress: string
): Promise<{ escrowId: bigint; txSig: string }> {
  const escrowId = BigInt(Date.now());
  const description = JSON.stringify({
    type: "digital",
    product: listing.productName,
    deliveryHash: listing.deliveryHash,
    milestones: listing.milestones,
  }).slice(0, 256);

  const args: CreateEscrowArgs = {
    escrowId,
    amount: BigInt(Math.floor(listing.priceSOL * 1e9)),
    milestoneCount: listing.milestones.length,
    description,
    category: "DigitalProduct",
    sellerAddress: listing.sellerAddress,
  };

  const txSig = await escrowEngine.createEscrow(args);
  return { escrowId, txSig };
}

/**
 * Verify the seller delivered the correct file before buyer releases funds.
 * In production: re-hash the received file and compare.
 */
export function verifyDigitalDelivery(
  receivedHash: string,
  expectedHash: string
): boolean {
  return receivedHash.toLowerCase() === expectedHash.toLowerCase();
}

// ── Real estate deed flow ─────────────────────────────────────────────────────

export interface DeedNFT {
  mintAddress: string;
  propertyId: string;
  titleNumber: string;
  metadataUri: string;
}

export interface RealEstateListing {
  deed: DeedNFT;
  priceSOL: number;
  sellerAddress: string;
  /** Milestones: title search, inspection, settlement, registration */
  milestones: string[];
}

export async function createRealEstateEscrow(
  listing: RealEstateListing
): Promise<{ escrowId: bigint; txSig: string }> {
  const escrowId = BigInt(Date.now());
  const description = JSON.stringify({
    type: "deed",
    mintAddress: listing.deed.mintAddress,
    propertyId: listing.deed.propertyId,
    titleNumber: listing.deed.titleNumber,
    metadataUri: listing.deed.metadataUri,
  }).slice(0, 256);

  const args: CreateEscrowArgs = {
    escrowId,
    amount: BigInt(Math.floor(listing.priceSOL * 1e9)),
    milestoneCount: listing.milestones.length,
    description,
    category: "RealEstateDeed",
    sellerAddress: listing.sellerAddress,
  };

  const txSig = await escrowEngine.createEscrow(args);
  return { escrowId, txSig };
}

/**
 * Transfer the deed NFT from seller to buyer.
 *
 * Current implementation: calls mark_fulfilled (a proxy on-chain).
 * TODO: replace with Metaplex Token Metadata CPI inside lib.rs → transfer_nft instruction.
 *
 * Production path:
 *   1. Add `transfer_nft` instruction in lib.rs using mpl-token-metadata CPI
 *   2. Pass mint, buyer_token_account, seller_token_account, metadata_account
 *   3. Call from here instead of mark_fulfilled
 */
export async function transferDeedNFT(
  escrowId: bigint,
  deedMint: string,
  buyerAddress: string,
  sellerAddress: string
): Promise<{ txSig: string; note: string }> {
  // Placeholder: complete the milestone that represents deed transfer
  const txSig = await escrowEngine.completeMilestone(escrowId, 3); // milestone 3 = "Transfer Deed"
  return {
    txSig,
    note: "Deed transfer proxied via milestone completion. Wire Metaplex CPI for full on-chain transfer.",
  };
}

// ── Generic escrow helper ─────────────────────────────────────────────────────

export function generateEscrowId(): bigint {
  // Combine timestamp + random to avoid collisions
  const ts = BigInt(Date.now()) << 16n;
  const rand = BigInt(Math.floor(Math.random() * 65536));
  return ts | rand;
}

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / 1e9;
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * 1e9));
}
