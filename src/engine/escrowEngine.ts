import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Commitment,
} from "@solana/web3.js";
import { AnchorProvider, Program, BN, web3 } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type {
  EscrowState,
  CreateEscrowArgs,
  EscrowStateEnum,
  EscrowCategory,
} from "../types";

// Replace after `anchor deploy` → `anchor build` generates IDL
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ||
    "11111111111111111111111111111111"
);

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

// ── PDA helpers ───────────────────────────────────────────────────────────────

export function deriveEscrowPDA(escrowId: bigint): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(escrowId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), idBuf],
    PROGRAM_ID
  );
}

export function deriveVaultPDA(escrowId: bigint): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(escrowId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), idBuf],
    PROGRAM_ID
  );
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class EscrowEngine {
  private connection: Connection;
  private provider: AnchorProvider | null = null;
  private program: Program | null = null;

  constructor(commitment: Commitment = "confirmed") {
    this.connection = new Connection(RPC_URL, commitment);
  }

  /** Call once wallet is connected */
  init(wallet: AnchorWallet): void {
    this.provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
    });
    // After `anchor build`, import the IDL and pass it here:
    // this.program = new Program(IDL, PROGRAM_ID, this.provider);
  }

  get conn(): Connection {
    return this.connection;
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  async fetchEscrow(escrowId: bigint): Promise<EscrowState | null> {
    try {
      if (this.program) {
        // Post-IDL path:
        // const data = await (this.program.account as any).escrowState.fetch(pda);
        // return deserialise(data);
      }
      // Pre-IDL fallback — read raw account bytes
      const [pda] = deriveEscrowPDA(escrowId);
      const info = await this.connection.getAccountInfo(pda);
      if (!info) return null;
      return deserialiseEscrowAccount(info.data, pda);
    } catch {
      return null;
    }
  }

  async fetchAllEscrows(wallet: PublicKey): Promise<EscrowState[]> {
    // Filter by buyer or seller memcmp once IDL is available
    // For now, relies on caller to pass known IDs
    return [];
  }

  async getVaultBalance(escrowId: bigint): Promise<number> {
    const [vault] = deriveVaultPDA(escrowId);
    const balance = await this.connection.getBalance(vault);
    return balance / LAMPORTS_PER_SOL;
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  async createEscrow(args: CreateEscrowArgs): Promise<string> {
    this.requireProgram();
    const { escrowId, amount, milestoneCount, description, category, sellerAddress } = args;
    const seller = new PublicKey(sellerAddress);

    const [escrowPDA] = deriveEscrowPDA(escrowId);
    const [vaultPDA] = deriveVaultPDA(escrowId);

    const tx = await (this.program! as any).methods
      .createEscrow(
        new BN(escrowId.toString()),
        new BN(amount.toString()),
        milestoneCount,
        description,
        categoryToAnchor(category)
      )
      .accounts({
        escrowState: escrowPDA,
        vault: vaultPDA,
        buyer: this.provider!.wallet.publicKey,
        seller,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async completeMilestone(escrowId: bigint, milestoneIndex: number): Promise<string> {
    this.requireProgram();
    const [escrowPDA] = deriveEscrowPDA(escrowId);
    return await (this.program! as any).methods
      .completeMilestone(new BN(escrowId.toString()), milestoneIndex)
      .accounts({
        escrowState: escrowPDA,
        signer: this.provider!.wallet.publicKey,
      })
      .rpc();
  }

  async releaseFunds(
    escrowId: bigint,
    sellerAddress: string,
    feeCollectorAddress: string
  ): Promise<string> {
    this.requireProgram();
    const [escrowPDA] = deriveEscrowPDA(escrowId);
    const [vaultPDA] = deriveVaultPDA(escrowId);
    return await (this.program! as any).methods
      .releaseFunds(new BN(escrowId.toString()))
      .accounts({
        escrowState: escrowPDA,
        vault: vaultPDA,
        buyer: this.provider!.wallet.publicKey,
        seller: new PublicKey(sellerAddress),
        feeCollector: new PublicKey(feeCollectorAddress),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async raiseDispute(escrowId: bigint, reason: string): Promise<string> {
    this.requireProgram();
    const [escrowPDA] = deriveEscrowPDA(escrowId);
    return await (this.program! as any).methods
      .raiseDispute(new BN(escrowId.toString()), reason)
      .accounts({
        escrowState: escrowPDA,
        signer: this.provider!.wallet.publicKey,
      })
      .rpc();
  }

  async cancelEscrow(
    escrowId: bigint,
    sellerAddress: string,
    feeCollectorAddress: string
  ): Promise<string> {
    this.requireProgram();
    const [escrowPDA] = deriveEscrowPDA(escrowId);
    const [vaultPDA] = deriveVaultPDA(escrowId);
    return await (this.program! as any).methods
      .cancelEscrow(new BN(escrowId.toString()))
      .accounts({
        escrowState: escrowPDA,
        vault: vaultPDA,
        buyer: this.provider!.wallet.publicKey,
        seller: new PublicKey(sellerAddress),
        feeCollector: new PublicKey(feeCollectorAddress),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  private requireProgram() {
    if (!this.program || !this.provider) {
      throw new Error("EscrowEngine.init(wallet) must be called first");
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Replace with IDL-generated deserialiser after `anchor build` */
function deserialiseEscrowAccount(data: Buffer, _pda: PublicKey): EscrowState {
  // Anchor accounts: first 8 bytes = discriminator
  let offset = 8;
  const escrowId = data.readBigUInt64LE(offset); offset += 8;
  const buyer = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const seller = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const amount = data.readBigUInt64LE(offset); offset += 8;
  const milestoneCount = data.readUInt8(offset); offset += 1;
  const milestonesCompleted = data.readUInt8(offset); offset += 1;
  const stateRaw = data.readUInt8(offset); offset += 1;
  const categoryRaw = data.readUInt8(offset); offset += 1;
  const descLen = data.readUInt32LE(offset); offset += 4;
  const description = data.slice(offset, offset + descLen).toString("utf8"); offset += descLen;
  const createdAt = data.readBigInt64LE(offset); offset += 8;
  const bump = data.readUInt8(offset);

  const states: EscrowStateEnum[] = ["Funded", "Disputed", "Released", "Resolved", "Cancelled"];
  const categories: EscrowCategory[] = ["DigitalProduct", "RealEstateDeed", "DeSciGrant", "Freelance", "Generic"];

  return {
    escrowId,
    buyer,
    seller,
    amount,
    milestoneCount,
    milestonesCompleted,
    state: states[stateRaw] ?? "Funded",
    category: categories[categoryRaw] ?? "Generic",
    description,
    createdAt,
    bump,
  };
}

function categoryToAnchor(cat: EscrowCategory): Record<string, object> {
  const map: Record<EscrowCategory, string> = {
    DigitalProduct: "digitalProduct",
    RealEstateDeed: "realEstateDeed",
    DeSciGrant: "deSciGrant",
    Freelance: "freelance",
    Generic: "generic",
  };
  return { [map[cat]]: {} };
}

// Singleton
export const escrowEngine = new EscrowEngine();
