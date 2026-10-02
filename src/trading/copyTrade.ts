/**
 * LEDGER worker: copy-trade signals from GMGN Smart Money / KOL trade feeds (read-only data, paper only).
 * Principle (from GMGN's own wallet-score skill): a profitable wallet is not necessarily COPYABLE. We only follow wallets
 * that are profitable AND slow enough to follow (we act tens of seconds after them), and we refuse to buy what they have
 * already pumped. All thresholds are pre-registered in docs/EXPERIMENTS.md; change them only by adding a new dated profile.
 */
export const COPY_RULES = {
  // wallet eligibility (GMGN wallet_stats, 7d)
  minTrades: 10, maxTrades: 400,          // too few = no evidence; too many = bot-speed, not copyable
  minWinrate: 0.45, minRealizedUsd: 0,    // profitable over the period
  minAvgHoldSec: 600,                     // holds >= 10 min, so a 30-60 s copy delay still catches the move
  maxBigLossShare: 0.35,                  // share of tokens lost > 50%
  statsTtlMs: 6 * 3600_000,
  // signal
  windowMin: 30, minWallets: 2, minBuyUsd: 200,  // >= 2 eligible wallets opening/adding within 30 min ("medium"+ per GMGN)
  maxChaseRatio: 1.3,                      // skip if price already >= 1.3x the wallets' average buy price (we'd be exit liquidity)
  mirrorExitShare: 0.5,                    // exit when >= half of the signalling wallets have sold
};

const n = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));

export function walletEligible(st: any, r = COPY_RULES): { ok: boolean; why: string[]; facts: Record<string, number> } {
  const pnl = st?.pnl_stat ?? {};
  const trades = (n(st?.buy ?? st?.buy_count) || 0) + (n(st?.sell ?? st?.sell_count) || 0);
  const tokenNum = n(pnl.token_num) || 0, winrate = n(pnl.winrate), hold = n(pnl.avg_holding_period), realized = n(st?.realized_profit);
  const bigLoss = tokenNum ? (n(pnl.pnl_lt_nd5_num) || 0) / tokenNum : NaN;
  const why: string[] = [];
  if (!st) why.push("no stats");
  if (!(trades >= r.minTrades)) why.push("too few trades"); else if (trades > r.maxTrades) why.push("bot-speed trading");
  if (!(winrate >= r.minWinrate)) why.push("low win rate");
  if (!(realized > r.minRealizedUsd)) why.push("not profitable");
  if (!(hold >= r.minAvgHoldSec)) why.push("holds too briefly to copy");
  if (bigLoss > r.maxBigLossShare) why.push("too many big losses");
  return { ok: why.length === 0, why, facts: { trades, winrate, realized, hold, bigLoss } };
}

export interface TradeRec { maker: string; side: string; token: string; symbol: string; usd: number; px: number; ts: number; source: "smart" | "kol" }
export function normalizeTrades(list: any[], source: "smart" | "kol"): TradeRec[] {
  return list.map((t) => ({ maker: t.maker ?? t.maker_info?.address, side: String(t.side ?? "").toLowerCase(), token: t.base_address, symbol: t.base_token?.symbol ?? "?",
    usd: n(t.amount_usd ?? t.cost_usd), px: n(t.price_usd), ts: n(t.timestamp) * (n(t.timestamp) < 1e12 ? 1000 : 1), source }))
    .filter((t) => t.maker && t.token && (t.side === "buy" || t.side === "sell") && Number.isFinite(t.ts));
}

/** Tracks recent buys/sells per token and emits clustered, eligible, not-yet-chased signals. */
export class CopyTracker {
  private buys = new Map<string, Map<string, { usd: number; px: number; ts: number; source: string }>>(); // token -> maker -> buy
  private sold = new Map<string, Set<string>>();     // token -> makers that sold after buying
  private seenTx = new Set<string>();
  constructor(private r = COPY_RULES) {}
  ingest(trades: TradeRec[], eligible: (maker: string) => boolean | undefined) {
    for (const t of trades) {
      const key = `${t.maker}:${t.token}:${t.side}:${t.ts}`; if (this.seenTx.has(key)) continue; this.seenTx.add(key);
      if (t.side === "buy") {
        if (!(t.usd >= this.r.minBuyUsd) || eligible(t.maker) === false) continue;
        const m = this.buys.get(t.token) ?? new Map(); m.set(t.maker, { usd: t.usd, px: t.px, ts: t.ts, source: t.source }); this.buys.set(t.token, m);
      } else if (this.buys.get(t.token)?.has(t.maker)) { const s = this.sold.get(t.token) ?? new Set(); s.add(t.maker); this.sold.set(t.token, s); }
    }
    if (this.seenTx.size > 50_000) this.seenTx.clear();
  }
  /** Wallets (eligible or not yet scored) that bought this token within the window. */
  cluster(token: string, now: number) {
    const m = this.buys.get(token); if (!m) return [];
    return [...m.entries()].filter(([, b]) => now - b.ts <= this.r.windowMin * 60_000).map(([maker, b]) => ({ maker, ...b }));
  }
  tokens() { return [...this.buys.keys()]; }
  soldShare(token: string, makers: string[]) { const s = this.sold.get(token); return makers.length ? makers.filter((m) => s?.has(m)).length / makers.length : 0; }
  prune(now: number) { for (const [tok, m] of this.buys) { for (const [mk, b] of m) if (now - b.ts > 6 * 3600_000) m.delete(mk); if (!m.size) { this.buys.delete(tok); this.sold.delete(tok); } } }
}
