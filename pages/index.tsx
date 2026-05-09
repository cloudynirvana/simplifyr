import Head from "next/head";
import Link from "next/link";
import { useState, useCallback } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useCreateEscrow, useWalletBalance, useEscrowEngine } from "../src/hooks/useEscrow";
import { generateEscrowId } from "../src/modules/tradeModules";
import type { EscrowCategory, CreateEscrowArgs } from "../src/types";

const CATEGORIES: EscrowCategory[] = [
  "DigitalProduct",
  "RealEstateDeed",
  "DeSciGrant",
  "Freelance",
  "Generic",
];

const CATEGORY_LABELS: Record<EscrowCategory, string> = {
  DigitalProduct: "Digital Product",
  RealEstateDeed: "Real Estate Deed",
  DeSciGrant: "DeSci Grant",
  Freelance: "Freelance",
  Generic: "Generic",
};

const CATEGORY_DESC: Record<EscrowCategory, string> = {
  DigitalProduct: "Software, files, designs, media",
  RealEstateDeed: "Property transfers with NFT deeds",
  DeSciGrant: "Research grants with IPFS hypotheses",
  Freelance: "Service agreements with milestones",
  Generic: "Any custom escrow arrangement",
};

export default function Home() {
  const { publicKey } = useWallet();
  const balance = useWalletBalance();
  const { create, pending } = useCreateEscrow();
  const { ready } = useEscrowEngine();

  const [form, setForm] = useState({
    sellerAddress: "",
    amountSOL: "",
    milestoneCount: "1",
    description: "",
    category: "Generic" as EscrowCategory,
  });
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [lastId, setLastId] = useState<bigint | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = useCallback(async () => {
    if (!form.sellerAddress || !form.amountSOL) return;
    const escrowId = generateEscrowId();
    const args: CreateEscrowArgs = {
      escrowId,
      amount: BigInt(Math.floor(parseFloat(form.amountSOL) * LAMPORTS_PER_SOL)),
      milestoneCount: Math.max(1, Math.min(10, parseInt(form.milestoneCount))),
      description: form.description.slice(0, 256),
      category: form.category,
      sellerAddress: form.sellerAddress,
    };
    const tx = await create(args);
    if (tx) {
      setLastTx(tx);
      setLastId(escrowId);
    }
  }, [form, create]);

  return (
    <>
      <Head>
        <title>Simplify — AI-Arbitrated Escrow on Solana</title>
        <meta name="description" content="Trustless escrow with AI dispute resolution" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="page">
        {/* Nav */}
        <nav className="nav">
          <div className="nav-brand">
            <span className="brand-dot" />
            simplify
          </div>
          <div className="nav-right">
            {publicKey && (
              <Link href="/dashboard" className="nav-link">
                Dashboard
              </Link>
            )}
            <WalletMultiButton className="wallet-btn" />
          </div>
        </nav>

        {/* Hero */}
        <header className="hero">
          <div className="hero-tag">Solana · AI-Arbitrated · Trustless</div>
          <h1 className="hero-title">
            Escrow that<br />
            <span className="accent">thinks</span> for itself
          </h1>
          <p className="hero-sub">
            Lock funds on-chain. Complete milestones. Noah AI resolves every dispute —
            no lawyers, no waiting, no trust required.
          </p>
          <div className="hero-stats">
            <div className="stat"><span>6</span> Instructions</div>
            <div className="stat"><span>1%</span> Protocol Fee</div>
            <div className="stat"><span>~400ms</span> Finality</div>
          </div>
        </header>

        {/* Create form */}
        <section className="card create-card">
          <div className="card-header">
            <h2>New Escrow</h2>
            {balance !== null && (
              <span className="balance-badge">{balance.toFixed(4)} SOL</span>
            )}
          </div>

          <div className="field">
            <label>Category</label>
            <div className="category-grid">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`cat-btn ${form.category === cat ? "active" : ""}`}
                  onClick={() => setForm((f) => ({ ...f, category: cat }))}
                >
                  <span className="cat-name">{CATEGORY_LABELS[cat]}</span>
                  <span className="cat-desc">{CATEGORY_DESC[cat]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="sellerAddress">Seller Address</label>
              <input
                id="sellerAddress"
                name="sellerAddress"
                className="input"
                placeholder="Enter Solana wallet address"
                value={form.sellerAddress}
                onChange={handleChange}
              />
            </div>
            <div className="field field-sm">
              <label htmlFor="amountSOL">Amount (SOL)</label>
              <input
                id="amountSOL"
                name="amountSOL"
                className="input"
                type="number"
                min="0.001"
                step="0.001"
                placeholder="0.00"
                value={form.amountSOL}
                onChange={handleChange}
              />
            </div>
            <div className="field field-xs">
              <label htmlFor="milestoneCount">Milestones</label>
              <input
                id="milestoneCount"
                name="milestoneCount"
                className="input"
                type="number"
                min="1"
                max="10"
                value={form.milestoneCount}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              className="input textarea"
              placeholder="Describe what's being traded, deliverables, and any relevant links…"
              value={form.description}
              maxLength={256}
              onChange={handleChange}
            />
            <span className="char-count">{form.description.length}/256</span>
          </div>

          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={pending || !ready || !form.sellerAddress || !form.amountSOL}
          >
            {pending ? "Confirming…" : !ready ? "Connect Wallet" : "Create Escrow"}
          </button>

          {lastTx && (
            <div className="success-banner">
              <span className="check">✓</span>
              Escrow created — ID:{" "}
              <code>{lastId?.toString()}</code>
              {" · "}
              <a
                href={`https://explorer.solana.com/tx/${lastTx}?cluster=${
                  process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet"
                }`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Explorer ↗
              </a>
            </div>
          )}
        </section>

        {/* How it works */}
        <section className="how-it-works">
          <h2>How it works</h2>
          <ol className="steps">
            <li><span>01</span> Buyer deposits SOL into a PDA vault on-chain</li>
            <li><span>02</span> Seller completes milestones and submits evidence</li>
            <li><span>03</span> Buyer confirms or raises a dispute</li>
            <li><span>04</span> Noah AI analyses and issues a binding on-chain verdict</li>
            <li><span>05</span> Funds release automatically per the ruling</li>
          </ol>
        </section>

        <footer className="footer">
          <span>Simplify · Built on Solana · Dev3Pack 2026</span>
          <span className="footer-net">
            {process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet"}
          </span>
        </footer>
      </div>
    </>
  );
}
