/**
 * Paper position book for memecoins. Pessimistic fills: every buy/sell pays fee + slippage (percent of notional).
 * Exit priority on each mark: rug triggers (liquidity drop, 5m sell pressure) -> stop-loss -> take-profit ladder -> time stop.
 * Prices are DexScreener marks, so fills are approximations: real fills on thin pools are usually worse.
 */
export interface PaperConfig {
  sizeUsd: number; feePct: number; slippagePct: number; stopPct: number;
  tp: Array<{ at: number; sell: number }>;   // at = % gain vs entry; sell = fraction of REMAINING units
  timeStopMin: number; liqDropPct: number; sellBuy5m: number; maxOpen: number;
  trailActivatePct?: number; trailPct?: number;   // trailing stop: arms once price is +activate% over entry, fires trailPct below the peak
}
export const PAPER_DEFAULTS: PaperConfig = {
  sizeUsd: 15, feePct: 1.0, slippagePct: 3.0, stopPct: 12,
  tp: [{ at: 25, sell: 0.5 }, { at: 60, sell: 0.5 }],
  timeStopMin: 120, liqDropPct: 20, sellBuy5m: 1.5, maxOpen: 5,
};

export interface Mark { px: number; liqUsd: number; m5?: { buys: number; sells: number } }
export interface Position {
  id: string; mint: string; symbol: string; profile: string; openedAt: number;
  entryPx: number; units: number; costUsd: number; entryLiq: number; tpHit: number; realizedUsd: number;
  lastPx: number; peakPx?: number; closedAt?: number; closeReason?: string; meta?: Record<string, unknown>;
}
export interface FillEvent { type: "open" | "sell" | "close"; at: number; id: string; mint: string; symbol: string; profile: string; px: number; fraction?: number; usd: number; reason: string }

export class PaperBook {
  readonly positions = new Map<string, Position>();
  constructor(readonly cfg: PaperConfig = PAPER_DEFAULTS) {}
  private cost() { return (this.cfg.feePct + this.cfg.slippagePct) / 100; }
  open(mint: string, symbol: string, profile: string, m: Mark, now: number, meta?: Record<string, unknown>): FillEvent | null {
    const id = `${profile}:${mint}`;
    if (this.positions.has(id) || !(m.px > 0)) return null;
    if ([...this.positions.values()].filter((p) => !p.closedAt && p.profile === profile).length >= this.cfg.maxOpen) return null;
    const entryPx = m.px * (1 + this.cost());
    this.positions.set(id, { id, mint, symbol, profile, openedAt: now, entryPx, units: this.cfg.sizeUsd / entryPx, costUsd: this.cfg.sizeUsd,
      entryLiq: m.liqUsd, tpHit: 0, realizedUsd: 0, lastPx: m.px, meta });
    return { type: "open", at: now, id, mint, symbol, profile, px: entryPx, usd: this.cfg.sizeUsd, reason: "entry" };
  }
  private sell(p: Position, fraction: number, px: number, now: number, reason: string): FillEvent {
    const units = p.units * fraction, usd = units * px * (1 - this.cost());
    p.units -= units; p.realizedUsd += usd;
    const done = p.units <= 1e-12 || fraction >= 1;
    if (done) { p.units = 0; p.closedAt = now; p.closeReason = reason; }
    return { type: done ? "close" : "sell", at: now, id: p.id, mint: p.mint, symbol: p.symbol, profile: p.profile, px, fraction, usd, reason };
  }
  mark(id: string, m: Mark, now: number): FillEvent[] {
    const p = this.positions.get(id); if (!p || p.closedAt || !(m.px > 0)) return [];
    p.lastPx = m.px; p.peakPx = Math.max(p.peakPx ?? 0, m.px);
    const c = this.cfg, out: FillEvent[] = [];
    if (p.entryLiq <= 0 && m.liqUsd > 0) p.entryLiq = m.liqUsd; // calibrate on first mark from the SAME source used for marks
    else if (p.entryLiq > 0 && m.liqUsd > 0 && m.liqUsd < p.entryLiq * (1 - c.liqDropPct / 100)) return [this.sell(p, 1, m.px, now, `rug: liquidity -${Math.round((1 - m.liqUsd / p.entryLiq) * 100)}%`)];
    if (m.m5 && m.m5.buys > 0 && m.m5.sells / m.m5.buys > c.sellBuy5m && m.m5.sells >= 10) return [this.sell(p, 1, m.px, now, "rug: 5m sell pressure")];
    if (m.px <= p.entryPx * (1 - c.stopPct / 100)) return [this.sell(p, 1, m.px, now, "stop-loss")];
    if (c.trailPct && p.peakPx! >= p.entryPx * (1 + (c.trailActivatePct ?? 0) / 100) && m.px <= p.peakPx! * (1 - c.trailPct / 100)) return [this.sell(p, 1, m.px, now, `trailing stop -${c.trailPct}% from peak`)];
    while (p.tpHit < c.tp.length && m.px >= p.entryPx * (1 + c.tp[p.tpHit].at / 100)) { out.push(this.sell(p, c.tp[p.tpHit].sell, m.px, now, `take-profit +${c.tp[p.tpHit].at}%`)); p.tpHit++; if (p.closedAt) return out; }
    if (now - p.openedAt >= c.timeStopMin * 60_000) out.push(this.sell(p, 1, m.px, now, "time stop"));
    return out;
  }
  summary(profile?: string) {
    const ps = [...this.positions.values()].filter((p) => !profile || p.profile === profile);
    const closed = ps.filter((p) => p.closedAt), open = ps.filter((p) => !p.closedAt);
    const pnl = (p: Position) => p.realizedUsd + p.units * p.lastPx * (1 - this.cost()) - p.costUsd; // open marked at liquidation value
    const realized = closed.reduce((a, p) => a + pnl(p), 0), unreal = open.reduce((a, p) => a + pnl(p), 0);
    const wins = closed.filter((p) => pnl(p) > 0).length;
    return { trades: ps.length, closed: closed.length, open: open.length, wins, winRate: closed.length ? wins / closed.length : null,
      realizedUsd: +realized.toFixed(2), unrealizedUsd: +unreal.toFixed(2), deployedUsd: ps.reduce((a, p) => a + p.costUsd, 0),
      reasons: closed.reduce((a, p) => ((a[p.closeReason ?? "?"] = (a[p.closeReason ?? "?"] ?? 0) + 1), a), {} as Record<string, number>) };
  }
}
