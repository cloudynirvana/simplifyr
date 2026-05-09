import Head from "next/head";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEscrowActions, useEscrowEngine, useWalletBalance } from "../src/hooks/useEscrow";
import { lamportsToSol } from "../src/modules/tradeModules";
import { escrowEngine } from "../src/engine/escrowEngine";
import type { EscrowState, EscrowStateEnum, NoahVerdict } from "../src/types";

// ── Mock data for UI development (replace with real fetch once IDL deployed) ─
const MOCK_ESCROWS: (EscrowState & { id: bigint })[] = [
  {
    id: 17293712n,
    escrowId: 17293712n,
    buyer: { toBase58: () => "7xKXtg2CW..." } as any,
    seller: { toBase58: () => "9mNvQK3vE..." } as any,
    amount: 2_500_000_000n,
    milestoneCount: 3,
    milestonesCompleted: 2,
    state: "Funded",
    category: "Freelance",
    description: "Build landing page with 3 revisions and mobile responsive design",
    createdAt: BigInt(Math.floor(Date.now() / 1000) - 86400 * 3),
    bump: 255,
  },
  {
    id: 17293713n,
    escrowId: 17293713n,
    buyer: { toBase58: () => "7xKXtg2CW..." } as any,
    seller: { toBase58: () => "3tPqRK7wM..." } as any,
    amount: 500_000_000n,
    milestoneCount: 1,
    milestonesCompleted: 0,
    state: "Disputed",
    category: "DigitalProduct",
    description: "Exclusive dataset of 10k labelled images for ML training",
    createdAt: BigInt(Math.floor(Date.now() / 1000) - 86400 * 7),
    bump: 254,
  },
  {
    id: 17293714n,
    escrowId: 17293714n,
    buyer: { toBase58: () => "7xKXtg2CW..." } as any,
    seller: { toBase58: () => "5nMpVL9qK..." } as any,
    amount: 15_000_000_000n,
    milestoneCount: 4,
    milestonesCompleted: 4,
    state: "Released",
    category: "RealEstateDeed",
    description: "Plot 14B Lekki Phase 2 deed NFT transfer",
    createdAt: BigInt(Math.floor(Date.now() / 1000) - 86400 * 14),
    bump: 253,
  },
];

const STATE_COLOR: Record<EscrowStateEnum, string> = {
  Funded: "#14F195",
  Disputed: "#f0a500",
  Released: "#7c86ff",
  Resolved: "#a78bfa",
  Cancelled: "#6b7280",
};

const STATE_LABEL: Record<EscrowStateEnum, string> = {
  Funded: "Active",
  Disputed: "Disputed",
  Released: "Released",
  Resolved: "Resolved",
  Cancelled: "Cancelled",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function EscrowCard({
  escrow,
  walletKey,
  onAction,
}: {
  escrow: EscrowState & { id: bigint };
  walletKey: string;
  onAction: (escrow: EscrowState & { id: bigint }, action: string) => void;
}) {
  const isBuyer = escrow.buyer.toBase58().startsWith(walletKey.slice(0, 8));
  const isSeller = escrow.seller.toBase58().startsWith(walletKey.slice(0, 8));
  const sol = lamportsToSol(escrow.amount);
  const progress = escrow.milestoneCount
    ? Math.round((escrow.milestonesCompleted / escrow.milestoneCount) * 100)
    : 0;
  const age = Math.floor((Date.now() / 1000 - Number(escrow.createdAt)) / 86400);

  return (
    <div className={`escrow-card state-${escrow.state.toLowerCase()}`}>
      <div className="ec-header">
        <div className="ec-meta">
          <span
            className="ec-state"
            style={{ color: STATE_COLOR[escrow.state] }}
          >
            ● {STATE_LABEL[escrow.state]}
          </span>
          <span className="ec-cat">{escrow.category}</span>
        </div>
        <span className="ec-amount">{sol.toFixed(3)} SOL</span>
      </div>

      <p className="ec-desc">{escrow.description}</p>

      <div className="ec-parties">
        <span title="Buyer">B: {escrow.buyer.toBase58().slice(0, 8)}…</span>
        <span title="Seller">S: {escrow.seller.toBase58().slice(0, 8)}…</span>
        <span className="ec-age">{age}d ago</span>
      </div>

      {/* Milestone progress bar */}
      <div className="ec-progress">
        <div className="ec-progress-label">
          <span>Milestones</span>
          <span>{escrow.milestonesCompleted}/{escrow.milestoneCount}</span>
        </div>
        <div className="ec-bar">
          <div className="ec-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Action buttons — visible based on role + state */}
      <div className="ec-actions">
        {isSeller && escrow.state === "Funded" && (
          <button
            className="ec-btn ec-btn-green"
            onClick={() => onAction(escrow, "milestone")}
          >
            Mark Milestone
          </button>
        )}
        {isBuyer && escrow.state === "Funded" && escrow.milestonesCompleted >= escrow.milestoneCount && (
          <button
            className="ec-btn ec-btn-green"
            onClick={() => onAction(escrow, "release")}
          >
            Release Funds
          </button>
        )}
        {isBuyer && escrow.state === "Funded" && (
          <button
            className="ec-btn ec-btn-yellow"
            onClick={() => onAction(escrow, "dispute")}
          >
            Raise Dispute
          </button>
        )}
        {escrow.state === "Disputed" && (
          <button
            className="ec-btn ec-btn-purple"
            onClick={() => onAction(escrow, "noah")}
          >
            Ask Noah AI ✦
          </button>
        )}
        {(isBuyer || isSeller) && (escrow.state === "Funded" || escrow.state === "Disputed") && (
          <button
            className="ec-btn ec-btn-ghost"
            onClick={() => onAction(escrow, "cancel")}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────

function NoahModal({
  escrow,
  onClose,
}: {
  escrow: EscrowState & { id: bigint };
  onClose: () => void;
}) {
  const [verdict, setVerdict] = useState<NoahVerdict | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const playVerdict = async () => {
    if (!verdict) return;
    setAudioLoading(true);
    try {
      const res = await fetch("/api/elevenlabs/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: verdict.reasoning }),
      });
      if (!res.ok) throw new Error("Audio generation failed");
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (err) {
      console.error("Audio error:", err);
      alert("Failed to generate audio verdict. Is ELEVENLABS_API_KEY set?");
    } finally {
      setAudioLoading(false);
    }
  };

  const askNoah = async () => {
    if (!reason.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/noah/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escrowId: escrow.escrowId.toString(),
          buyerAddress: escrow.buyer.toBase58(),
          sellerAddress: escrow.seller.toBase58(),
          amountLamports: escrow.amount.toString(),
          reason,
          milestoneCount: escrow.milestoneCount,
          milestonesCompleted: escrow.milestonesCompleted,
          category: escrow.category,
          description: escrow.description,
          createdAt: escrow.createdAt.toString(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setVerdict(data);
    } catch (e: any) {
      setErr(e?.message ?? "Noah arbitration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>✦ Noah AI Arbitration</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {!verdict ? (
            <>
              <p className="modal-desc">
                Describe the issue. Noah will analyse the escrow evidence and issue a binding settlement.
              </p>
              <textarea
                className="input textarea"
                placeholder="Describe what went wrong with as much detail as possible…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={5}
              />
              {err && <p className="err-msg">{err}</p>}
              <button
                className="btn-primary"
                onClick={askNoah}
                disabled={loading || !reason.trim()}
              >
                {loading ? "Analysing dispute…" : "Submit to Noah"}
              </button>
            </>
          ) : (
            <div className="verdict">
              <div className="verdict-action" data-action={verdict.recommendedAction}>
                {verdict.recommendedAction}
              </div>
              <div className="verdict-split">
                <div className="split-bar">
                  <div
                    className="split-seller"
                    style={{ width: `${verdict.sellerSplitBps / 100}%` }}
                  >
                    <span>Seller {(verdict.sellerSplitBps / 100).toFixed(0)}%</span>
                  </div>
                  <div className="split-buyer">
                    <span>Buyer {((10000 - verdict.sellerSplitBps) / 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
              <p className="verdict-reasoning">{verdict.reasoning}</p>
              <div className="verdict-confidence">
                <span>Confidence</span>
                <span>{(verdict.confidence * 100).toFixed(0)}%</span>
              </div>
              <p className="verdict-note">
                Copy the seller split BPS ({verdict.sellerSplitBps}) and pass it to{" "}
                <code>resolve_dispute</code> via the Noah authority keypair.
              </p>
              <button 
                className="btn-primary" 
                style={{ width: '100%', marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                onClick={playVerdict}
                disabled={audioLoading}
              >
                {audioLoading ? "Generating Audio..." : "🔊 Play Noah's Audio Verdict"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { publicKey } = useWallet();
  const balance = useWalletBalance();
  const { ready } = useEscrowEngine();

  const [escrows] = useState(MOCK_ESCROWS);
  const [activeModal, setActiveModal] = useState<{
    type: string;
    escrow: (EscrowState & { id: bigint }) | null;
  }>({ type: "", escrow: null });
  const [filter, setFilter] = useState<EscrowStateEnum | "All">("All");

  const walletKey = publicKey?.toBase58() ?? "";

  const filtered =
    filter === "All" ? escrows : escrows.filter((e) => e.state === filter);

  const handleAction = useCallback(
    (escrow: EscrowState & { id: bigint }, action: string) => {
      setActiveModal({ type: action, escrow });
    },
    []
  );

  const totals = {
    all: escrows.length,
    active: escrows.filter((e) => e.state === "Funded").length,
    disputed: escrows.filter((e) => e.state === "Disputed").length,
    released: escrows.filter((e) => e.state === "Released").length,
  };

  const totalLocked = escrows
    .filter((e) => e.state === "Funded" || e.state === "Disputed")
    .reduce((sum, e) => sum + lamportsToSol(e.amount), 0);

  return (
    <>
      <Head>
        <title>Dashboard — Simplify</title>
      </Head>

      <div className="page">
        <nav className="nav">
          <Link href="/" className="nav-brand">
            <span className="brand-dot" />
            simplify
          </Link>
          <div className="nav-right">
            <WalletMultiButton className="wallet-btn" />
          </div>
        </nav>

        <main className="dashboard">
          {/* Stats strip */}
          <div className="dash-stats">
            <div className="dstat">
              <span className="dstat-val">{totals.all}</span>
              <span className="dstat-label">Total</span>
            </div>
            <div className="dstat">
              <span className="dstat-val" style={{ color: "#14F195" }}>{totals.active}</span>
              <span className="dstat-label">Active</span>
            </div>
            <div className="dstat">
              <span className="dstat-val" style={{ color: "#f0a500" }}>{totals.disputed}</span>
              <span className="dstat-label">Disputed</span>
            </div>
            <div className="dstat">
              <span className="dstat-val" style={{ color: "#7c86ff" }}>{totals.released}</span>
              <span className="dstat-label">Released</span>
            </div>
            <div className="dstat">
              <span className="dstat-val">{totalLocked.toFixed(2)}</span>
              <span className="dstat-label">SOL Locked</span>
            </div>
            {balance !== null && (
              <div className="dstat">
                <span className="dstat-val">{balance.toFixed(4)}</span>
                <span className="dstat-label">My Balance</span>
              </div>
            )}
          </div>

          {/* Filter tabs */}
          <div className="filter-tabs">
            {(["All", "Funded", "Disputed", "Released", "Resolved", "Cancelled"] as const).map(
              (f) => (
                <button
                  key={f}
                  className={`filter-tab ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f as any)}
                >
                  {f === "Funded" ? "Active" : f}
                </button>
              )
            )}
          </div>

          {/* Escrow grid */}
          {!publicKey ? (
            <div className="empty-state">
              <p>Connect your wallet to see your escrows</p>
              <WalletMultiButton className="wallet-btn" />
              <Link href="/" className="nav-link" style={{ marginTop: '12px' }}>
                ← Go Back to Home
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <p>No escrows found</p>
              <Link href="/" className="btn-primary">
                Create your first escrow →
              </Link>
            </div>
          ) : (
            <div className="escrow-grid">
              {filtered.map((e) => (
                <EscrowCard
                  key={e.id.toString()}
                  escrow={e}
                  walletKey={walletKey}
                  onAction={handleAction}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      {activeModal.type === "noah" && activeModal.escrow && (
        <NoahModal
          escrow={activeModal.escrow}
          onClose={() => setActiveModal({ type: "", escrow: null })}
        />
      )}
    </>
  );
}
