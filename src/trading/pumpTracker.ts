/**
 * Builds PumpToken filter inputs from the PumpPortal event stream. Tokens are tracked from their
 * CREATE event, so every trade (and therefore every holder balance) is seen — the holder view is
 * complete except for airdrops/transfers.
 *
 * Approximations (all conservative or flagged; replace with RPC/Helius reads before real money):
 *  - supply assumed 1,000,000,000 tokens (pump.fun standard)
 *  - feesSol ~= 1% of observed SOL volume (derived from trades, not read from chain)
 *  - liquidity ~= real SOL in the curve = virtual SOL - 30 (virtual reserve offset), in USD
 *  - mint/freeze authority ASSUMED revoked (pump.fun default) — verify on-chain
 */
import type { PortalEvent } from "../lib/pumpportal";
import type { PumpToken } from "./pumpFilters";

const SUPPLY = 1_000_000_000;
const VIRTUAL_SOL = 30;
const PROTOCOL_FEE = 0.01;

interface Trade { t: number; trader: string; side: "buy" | "sell"; sol: number; tokens: number; mcapSol: number }
interface TokenState {
  mint: string; name: string; symbol: string; creator: string; bondingCurve: string;
  createdAt: number; devInitialTokens: number; trades: Trade[];
  balances: Map<string, number>; devBalance: number; devSoldTokens: number;
  vSol: number; mcapSol: number; migrated: boolean; lastTradeAt: number;
}

export class PumpTracker {
  readonly tokens = new Map<string, TokenState>();
  constructor(private maxTracked = 300) {}

  /** Returns the mint if a new token was created (caller should subscribe to its trades). */
  handle(e: PortalEvent, now = Date.now()): { created?: string; evicted?: string[] } {
    if (!e.mint) return {};
    if (e.txType === "create") {
      const dev = e.traderPublicKey ?? "";
      const initial = e.initialBuy ?? 0;
      this.tokens.set(e.mint, {
        mint: e.mint, name: e.name ?? "", symbol: e.symbol ?? "", creator: dev,
        bondingCurve: e.bondingCurve ?? e.bondingCurveKey ?? "", createdAt: now,
        devInitialTokens: initial, trades: [], balances: new Map(initial > 0 ? [[dev, initial]] : []),
        devBalance: initial, devSoldTokens: 0, vSol: e.vSolInBondingCurve ?? VIRTUAL_SOL, mcapSol: e.marketCapSol ?? 0,
        migrated: false, lastTradeAt: now,
      });
      const evicted: string[] = [];
      while (this.tokens.size > this.maxTracked) {
        const oldest = [...this.tokens.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
        this.tokens.delete(oldest.mint); evicted.push(oldest.mint);
      }
      return { created: e.mint, evicted };
    }
    const s = this.tokens.get(e.mint);
    if (!s || (e.txType !== "buy" && e.txType !== "sell")) return {};
    const trader = e.traderPublicKey ?? "";
    const tr: Trade = { t: now, trader, side: e.txType, sol: e.solAmount ?? 0, tokens: e.tokenAmount ?? 0, mcapSol: e.marketCapSol ?? s.mcapSol };
    s.trades.push(tr);
    s.lastTradeAt = now;
    if (e.newTokenBalance !== undefined) s.balances.set(trader, e.newTokenBalance);
    if (trader === s.creator) {
      if (e.newTokenBalance !== undefined) s.devBalance = e.newTokenBalance;
      if (e.txType === "sell") s.devSoldTokens += tr.tokens;
    }
    s.vSol = e.vSolInBondingCurve ?? s.vSol;
    s.mcapSol = e.marketCapSol ?? s.mcapSol;
    if (e.pool && e.pool !== "pump") s.migrated = true;
    return {};
  }

  toPumpToken(mint: string, solUsd: number, now = Date.now()): PumpToken | null {
    const s = this.tokens.get(mint);
    if (!s) return null;
    const within = (ms: number) => s.trades.filter((t) => now - t.t <= ms);
    const w5 = within(5 * 60_000), w60 = within(60 * 60_000);
    const count = (ts: Trade[]) => ({ buys: ts.filter((t) => t.side === "buy").length, sells: ts.filter((t) => t.side === "sell").length });
    const mcapAt = (ms: number) => {
      const before = [...s.trades].reverse().find((t) => now - t.t >= ms);
      return before?.mcapSol ?? s.trades[0]?.mcapSol ?? s.mcapSol;
    };
    const chg = (ms: number) => { const p = mcapAt(ms); return p > 0 ? (s.mcapSol / p - 1) * 100 : 0; };
    const volSol = s.trades.reduce((a, t) => a + t.sol, 0);
    const holders = [...s.balances.entries()].filter(([, b]) => b > 0).map(([address, b]) => ({
      address, pct: (b / SUPPLY) * 100, isProtocolAccount: address === s.bondingCurve,
    }));
    return {
      mint, stage: s.migrated ? "migrated" : "bonding",
      ageMinutes: (now - s.createdAt) / 60_000,
      marketCapUsd: s.mcapSol * solUsd,
      liquidityUsd: Math.max(0, s.vSol - VIRTUAL_SOL) * solUsd,
      feesSol: volSol * PROTOCOL_FEE,
      priceChange: { m5: chg(5 * 60_000), h1: chg(60 * 60_000) },
      txns: { m5: count(w5), h1: count(w60) },
      uniqueTraders1h: new Set(w60.map((t) => t.trader)).size,
      holders,
      dev: {
        holdingPct: (s.devBalance / SUPPLY) * 100,
        soldPctOfInitial: s.devInitialTokens > 0 ? Math.min(100, (s.devSoldTokens / s.devInitialTokens) * 100) : s.devSoldTokens > 0 ? 100 : 0,
      },
      mintAuthorityRevoked: true, freezeAuthorityRevoked: true, // ASSUMED; verify on-chain
    };
  }
}
