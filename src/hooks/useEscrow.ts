import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import toast from "react-hot-toast";
import { escrowEngine } from "../engine/escrowEngine";
import type { EscrowState, CreateEscrowArgs } from "../types";

// ── useEscrowEngine ────────────────────────────────────────────────────────────
/** Initialises the engine when wallet connects. */
export function useEscrowEngine() {
  const anchorWallet = useAnchorWallet();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (anchorWallet) {
      escrowEngine.init(anchorWallet);
      setReady(true);
    } else {
      setReady(false);
    }
  }, [anchorWallet]);

  return { ready, engine: escrowEngine };
}

// ── useEscrow ─────────────────────────────────────────────────────────────────
/** Watches a single escrow, polling every 10s (swap to Helius WS in prod). */
export function useEscrow(escrowId: bigint | null) {
  const [escrow, setEscrow] = useState<EscrowState | null>(null);
  const [vaultBalance, setVaultBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout>();

  const fetch = useCallback(async () => {
    if (!escrowId) return;
    setLoading(true);
    setError(null);
    try {
      const [state, balance] = await Promise.all([
        escrowEngine.fetchEscrow(escrowId),
        escrowEngine.getVaultBalance(escrowId),
      ]);
      setEscrow(state);
      setVaultBalance(balance);
    } catch (e: any) {
      setError(e?.message ?? "Failed to fetch escrow");
    } finally {
      setLoading(false);
    }
  }, [escrowId]);

  useEffect(() => {
    fetch();
    intervalRef.current = setInterval(fetch, 12_000);
    return () => clearInterval(intervalRef.current);
  }, [fetch]);

  return { escrow, vaultBalance, loading, error, refresh: fetch };
}

// ── useCreateEscrow ───────────────────────────────────────────────────────────
export function useCreateEscrow() {
  const { ready } = useEscrowEngine();
  const [pending, setPending] = useState(false);

  const create = useCallback(
    async (args: CreateEscrowArgs): Promise<string | null> => {
      if (!ready) {
        toast.error("Connect your wallet first");
        return null;
      }
      setPending(true);
      const tid = toast.loading("Creating escrow…");
      try {
        const tx = await escrowEngine.createEscrow(args);
        toast.success("Escrow created!", { id: tid });
        return tx;
      } catch (e: any) {
        toast.error(e?.message ?? "Transaction failed", { id: tid });
        return null;
      } finally {
        setPending(false);
      }
    },
    [ready]
  );

  return { create, pending };
}

// ── useEscrowActions ──────────────────────────────────────────────────────────
export function useEscrowActions(
  escrowId: bigint,
  sellerAddress?: string,
  feeCollector?: string
) {
  const { ready } = useEscrowEngine();
  const [pending, setPending] = useState<string | null>(null);

  const withToast = useCallback(
    async (label: string, fn: () => Promise<string>) => {
      if (!ready) { toast.error("Connect wallet"); return; }
      setPending(label);
      const tid = toast.loading(`${label}…`);
      try {
        const tx = await fn();
        toast.success(`${label} — tx: ${tx.slice(0, 8)}…`, { id: tid, duration: 5000 });
      } catch (e: any) {
        toast.error(e?.message ?? "Transaction failed", { id: tid });
      } finally {
        setPending(null);
      }
    },
    [ready]
  );

  const completeMilestone = (index: number) =>
    withToast("Completing milestone", () =>
      escrowEngine.completeMilestone(escrowId, index)
    );

  const releaseFunds = () =>
    withToast("Releasing funds", () =>
      escrowEngine.releaseFunds(
        escrowId,
        sellerAddress!,
        feeCollector || process.env.NEXT_PUBLIC_FEE_COLLECTOR!
      )
    );

  const raiseDispute = (reason: string) =>
    withToast("Raising dispute", () =>
      escrowEngine.raiseDispute(escrowId, reason)
    );

  const cancelEscrow = () =>
    withToast("Cancelling escrow", () =>
      escrowEngine.cancelEscrow(
        escrowId,
        sellerAddress!,
        feeCollector || process.env.NEXT_PUBLIC_FEE_COLLECTOR!
      )
    );

  return { completeMilestone, releaseFunds, raiseDispute, cancelEscrow, pending };
}

// ── useWalletBalance ──────────────────────────────────────────────────────────
export function useWalletBalance() {
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) { setBalance(null); return; }
    let alive = true;
    const poll = async () => {
      const bal = await escrowEngine.conn.getBalance(publicKey);
      if (alive) setBalance(bal / LAMPORTS_PER_SOL);
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [publicKey]);

  return balance;
}
