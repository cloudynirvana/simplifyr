/**
 * GMGN-exclusive research + paper engine (no orders; read-only key).
 *   discover: GMGN rank -> gmgnScreen + "no entry after >=10% 5m drawdown" -> security -> holders -> Jev (log only) -> paper entries
 *   mark:     open positions re-priced from GMGN token info (same source as entries' liquidity calibration)
 *   label:    every security/holder-checked candidate (+10% sample of screen rejects) gets its real return at +60m and +240m
 * Multiple pre-registered exit profiles (see docs/EXPERIMENTS.md) trade the SAME entries, so results are paired.
 */
import { gmgnScreen, gmgnFeatures } from "./gmgnFilter";
import { securityScreen, holderScreen, extractMark } from "./gmgnChecks";
import { PaperBook, PaperConfig, FillEvent } from "./paperBook";

export interface GmgnLike {
  rank(chain: string, interval: string): Promise<any[]>;
  tokenSecurity(chain: string, address: string): Promise<any>;
  holders(chain: string, address: string, limit?: number): Promise<any[]>;
  tokenInfo(chain: string, address: string): Promise<any>;
}
export interface EngineDeps { g: GmgnLike; profiles: Record<string, PaperConfig>; log: (o: object) => void; now?: () => number; jev?: (state: Record<string, unknown>) => Promise<unknown>; sampleRejects?: number }

export class GmgnEngine {
  readonly books = new Map<string, PaperBook>();
  readonly stats = { pulls: 0, ranked: 0, passedScreen: 0, passedSecurity: 0, passedHolders: 0, entries: 0, markMiss: 0, outcomes: 0, errors: 0, vetoes: {} as Record<string, number> };
  private seen = new Map<string, number>();               // mint -> last full check (avoid re-checking within 2h)
  private followups: Array<{ mint: string; symbol: string; dueAt: number; horizonMin: number; refPx: number; passed: boolean; stage: string }> = [];
  private schemaLogged = false;
  constructor(private d: EngineDeps) { for (const [k, cfg] of Object.entries(d.profiles)) this.books.set(k, new PaperBook(cfg)); }
  private now() { return this.d.now?.() ?? Date.now(); }
  private veto(reasons: string[]) { for (const k of reasons) this.stats.vetoes[k] = (this.stats.vetoes[k] ?? 0) + 1; }
  private follow(mint: string, symbol: string, refPx: number, passed: boolean, stage: string) {
    const t = this.now(); for (const h of [60, 240]) this.followups.push({ mint, symbol, dueAt: t + h * 60_000, horizonMin: h, refPx, passed, stage });
  }

  async discover(interval: string) {
    const now = this.now(), items = await this.d.g.rank("sol", interval);
    this.stats.pulls++; this.stats.ranked += items.length;
    this.d.log({ type: "snapshot", at: now, interval, n: items.length, items: items.map((t) => ({ ...gmgnFeatures(t), fails: gmgnScreen(t, now) })) });
    for (const t of items) {
      const mint = t.address as string, px = Number(t.price);
      const fails = gmgnScreen(t, now);
      if (fails.length) { this.veto(fails); if (Math.random() < (this.d.sampleRejects ?? 0.1) && !this.seen.has(mint)) { this.seen.set(mint, now); this.follow(mint, t.symbol, px, false, "screen"); } continue; }
      this.stats.passedScreen++;
      if (now - (this.seen.get(mint) ?? 0) < 2 * 3600_000) continue;
      this.seen.set(mint, now);
      const sf = securityScreen(await this.d.g.tokenSecurity("sol", mint).catch(() => null));
      if (sf.length) { this.veto(sf); this.d.log({ type: "candidate", at: now, mint, symbol: t.symbol, stage: "security", fails: sf }); this.follow(mint, t.symbol, px, false, "security"); continue; }
      this.stats.passedSecurity++;
      const hs = holderScreen(await this.d.g.holders("sol", mint, 100).catch(() => []));
      const state = { ...gmgnFeatures(t), holder_stats: hs.stats };
      let jev: unknown = null; if (this.d.jev) jev = await this.d.jev(state).catch((e: Error) => ({ error: e.message }));
      this.d.log({ type: "candidate", at: now, mint, symbol: t.symbol, stage: "holders", fails: hs.failures, holders: hs.stats, gmgn: gmgnFeatures(t), jev });
      this.follow(mint, t.symbol, px, hs.failures.length === 0, hs.failures.length ? "holders" : "entered");
      if (hs.failures.length) { this.veto(hs.failures); continue; }
      this.stats.passedHolders++;
      for (const [name, book] of this.books) { const e = book.open(mint, t.symbol, name, { px, liqUsd: 0 }, now, { jev }); if (e) { this.d.log(e); this.stats.entries++; } }
    }
  }

  async markOpen(): Promise<FillEvent[]> {
    const open = new Set<string>(); for (const b of this.books.values()) for (const p of b.positions.values()) if (!p.closedAt) open.add(p.mint);
    const out: FillEvent[] = [], now = this.now();
    for (const mint of open) {
      const info = await this.d.g.tokenInfo("sol", mint).catch(() => null);
      if (info && !this.schemaLogged) { this.schemaLogged = true; this.d.log({ type: "schema", endpoint: "token/info", keys: Object.keys(info), price: info.price }); }
      const m = extractMark(info);
      if (!m) { this.stats.markMiss++; continue; }
      for (const [name, b] of this.books) for (const e of b.mark(`${name}:${mint}`, m, now)) { this.d.log(e); out.push(e); }
    }
    return out;
  }

  async label() {
    const now = this.now(), due = this.followups.filter((f) => f.dueAt <= now);
    this.followups = this.followups.filter((f) => f.dueAt > now);
    for (const f of due) {
      const m = extractMark(await this.d.g.tokenInfo("sol", f.mint).catch(() => null));
      this.d.log({ type: "outcome", at: now, mint: f.mint, symbol: f.symbol, horizonMin: f.horizonMin, stage: f.stage, passed: f.passed, refPx: f.refPx, px: m?.px ?? null, ret: m ? m.px / f.refPx - 1 : null });
      this.stats.outcomes++;
    }
  }
  pendingFollowups() { return this.followups.length; }
}
