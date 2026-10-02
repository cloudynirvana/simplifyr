/**
 * Discovery + HTTP enrichment scanner (no paid trade stream needed):
 *   created token --(wait)--> DexScreener market screen --(pass)--> RugCheck gate --(pass)--> candidate
 * Network errors leave a token due for the next tick (never silently skipped). RugCheck fails closed.
 */
import { Discovery, Pending } from "./discovery";
import { marketScreen, DexPairLike } from "./screenFilters";
import type { GateResult } from "./rugcheckGate";

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
interface DexPair extends DexPairLike { baseToken: { address: string }; priceUsd?: string; dexId?: string; url?: string; pairAddress?: string }

export interface Candidate {
  at: number; mint: string; name: string; symbol: string; checkpointMin: number;
  market: { dex?: string; priceUsd?: string; liquidityUsd?: number; marketCap?: number; ageH?: number; h1?: { buys: number; sells: number }; priceChangeH1?: number; url?: string };
  rugcheck: GateResult;
}

export interface ScanStats { checked: number; noPair: number; passedMarket: number; candidates: number; errors: number; fails: Record<string, number> }

export function makeScanner(d: Discovery, deps: { fetchImpl?: FetchLike; gate: (mint: string) => Promise<GateResult>; onCandidate: (c: Candidate) => void; now?: () => number }) {
  const f = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const stats: ScanStats = { checked: 0, noPair: 0, passedMarket: 0, candidates: 0, errors: 0, fails: {} };
  async function tick() {
    const now = deps.now?.() ?? Date.now();
    const due = d.due(now);
    for (let i = 0; i < due.length; i += 30) {
      const batch: Pending[] = due.slice(i, i + 30);
      let pairs: DexPair[];
      try {
        const res = await f(`https://api.dexscreener.com/tokens/v1/solana/${batch.map((b) => b.mint).join(",")}`);
        if (!res.ok) throw new Error(String(res.status));
        pairs = (await res.json()) as DexPair[];
      } catch { stats.errors++; continue; } // leave the batch due; retried next tick
      const best = new Map<string, DexPair>();
      for (const p of pairs) { const k = p.baseToken?.address; if (k && (!best.has(k) || (p.liquidity?.usd ?? 0) > (best.get(k)!.liquidity?.usd ?? 0))) best.set(k, p); }
      for (const t of batch) {
        const checkpointMin = d.checkpoints[t.next];
        d.advance(t.mint); stats.checked++;
        const pair = best.get(t.mint);
        if (!pair) { stats.noPair++; continue; }
        const fails = marketScreen(pair, now);
        if (fails.length) { for (const x of fails) stats.fails[x] = (stats.fails[x] ?? 0) + 1; continue; }
        stats.passedMarket++;
        const rc = await deps.gate(t.mint);
        const ageH = pair.pairCreatedAt ? (now - pair.pairCreatedAt) / 36e5 : undefined;
        deps.onCandidate({ at: now, mint: t.mint, name: t.name, symbol: t.symbol, checkpointMin, rugcheck: rc,
          market: { dex: pair.dexId, priceUsd: pair.priceUsd, liquidityUsd: pair.liquidity?.usd, marketCap: pair.marketCap ?? pair.fdv, ageH, h1: pair.txns?.h1, priceChangeH1: pair.priceChange?.h1, url: pair.url } });
        if (rc.pass) stats.candidates++;
      }
    }
  }
  return { tick, stats };
}
