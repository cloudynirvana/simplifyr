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
import { CopyTracker, COPY_RULES, normalizeTrades, walletEligible } from "./copyTrade";

export interface GmgnLike {
  rank(chain: string, interval: string): Promise<any[]>;
  tokenSecurity(chain: string, address: string): Promise<any>;
  holders(chain: string, address: string, limit?: number): Promise<any[]>;
  tokenInfo(chain: string, address: string): Promise<any>;
  trenches?(chain: string, types?: string[], limit?: number): Promise<{ new_creation?: any[]; pump?: any[]; completed?: any[] }>;
  smartMoney?(chain: string, limit?: number): Promise<any[]>;
  kol?(chain: string, limit?: number): Promise<any[]>;
  walletStats?(chain: string, wallet: string, period?: string): Promise<any>;
}
export interface EngineDeps { g: GmgnLike; profiles: Record<string, PaperConfig>; copyProfiles?: Record<string, PaperConfig>; walletsPerScan?: number; log: (o: object) => void; now?: () => number; jev?: (state: Record<string, unknown>) => Promise<unknown>; sampleRejects?: number }

export class GmgnEngine {
  readonly books = new Map<string, PaperBook>();
  readonly stats = { pulls: 0, ranked: 0, passedScreen: 0, passedSecurity: 0, passedHolders: 0, entries: 0, markMiss: 0, outcomes: 0, errors: 0, vetoes: {} as Record<string, number>,
    copy: { feedTrades: 0, walletsScored: 0, walletsEligible: 0, signals: 0, entries: 0, mirrorExits: 0, vetoes: {} as Record<string, number> } };
  private copyNames = new Set<string>();
  private tracker = new CopyTracker();
  private wallets = new Map<string, { ok: boolean; at: number; why: string[] }>();
  private copySignals = new Map<string, { at: number; makers: string[] }>();
  private seen = new Map<string, number>();               // mint -> last full check (avoid re-checking within 2h)
  private followups: Array<{ mint: string; symbol: string; dueAt: number; horizonMin: number; refPx: number; passed: boolean; stage: string }> = [];
  private schemaLogged = false;
  constructor(private d: EngineDeps) {
    for (const [k, cfg] of Object.entries(d.profiles)) this.books.set(k, new PaperBook(cfg));
    for (const [k, cfg] of Object.entries(d.copyProfiles ?? {})) { this.books.set(k, new PaperBook(cfg)); this.copyNames.add(k); }
  }
  private now() { return this.d.now?.() ?? Date.now(); }
  private veto(reasons: string[]) { for (const k of reasons) this.stats.vetoes[k] = (this.stats.vetoes[k] ?? 0) + 1; }
  private follow(mint: string, symbol: string, refPx: number, passed: boolean, stage: string) {
    const t = this.now(); for (const h of [60, 240]) this.followups.push({ mint, symbol, dueAt: t + h * 60_000, horizonMin: h, refPx, passed, stage });
  }

  async discover(interval: string) { return this.discoverItems(await this.d.g.rank("sol", interval), interval); }
  /** SCOUT: GMGN Trenches near-completion + completed (graduating / graduated launches), same pipeline. */
  async discoverTrenches() {
    if (!this.d.g.trenches) return;
    const t = await this.d.g.trenches("sol", ["near_completion", "completed"], 80);
    return this.discoverItems([...(t.pump ?? []), ...(t.completed ?? [])], "trenches");
  }
  async discoverItems(items: any[], interval: string) {
    const now = this.now();
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
      for (const [name, book] of this.books) { if (this.copyNames.has(name)) continue; const e = book.open(mint, t.symbol, name, { px, liqUsd: 0 }, now, { jev }); if (e) { this.d.log(e); this.stats.entries++; } }
    }
  }

  /** LEDGER: copy-trade signals from Smart Money + KOL feeds -> eligibility -> cluster -> WARDEN checks -> paper entry; mirror exits. */
  async copyScan() {
    const g = this.d.g, c = this.stats.copy; if (!g.smartMoney || !g.kol || !g.walletStats || !this.copyNames.size) return;
    const now = this.now();
    const trades = [...normalizeTrades(await g.smartMoney("sol", 200).catch(() => []), "smart"), ...normalizeTrades(await g.kol("sol", 200).catch(() => []), "kol")];
    c.feedTrades += trades.length;
    const toScore = [...new Set(trades.filter((t) => t.side === "buy" && t.usd >= COPY_RULES.minBuyUsd).map((t) => t.maker))]
      .filter((m) => now - (this.wallets.get(m)?.at ?? 0) > COPY_RULES.statsTtlMs).slice(0, this.d.walletsPerScan ?? 8);
    for (const m of toScore) {
      const st = await g.walletStats("sol", m).catch(() => null), e = walletEligible(st);
      this.wallets.set(m, { ok: e.ok, at: now, why: e.why }); c.walletsScored++; if (e.ok) c.walletsEligible++;
      this.d.log({ type: "wallet", at: now, maker: m, eligible: e.ok, why: e.why, facts: e.facts });
    }
    this.tracker.ingest(trades, (m) => this.wallets.get(m)?.ok);
    this.tracker.prune(now);
    for (const token of this.tracker.tokens()) {
      if (now - (this.copySignals.get(token)?.at ?? 0) < 6 * 3600_000) continue;
      const cl = this.tracker.cluster(token, now).filter((b) => this.wallets.get(b.maker)?.ok);
      if (cl.length < COPY_RULES.minWallets) continue;
      this.copySignals.set(token, { at: now, makers: cl.map((b) => b.maker) }); c.signals++;
      const fails: string[] = [], m = extractMark(await g.tokenInfo("sol", token).catch(() => null));
      const avgBuy = cl.reduce((a, b) => a + b.px, 0) / cl.length;
      if (!m) fails.push("no price");
      else { if (m.px / avgBuy >= COPY_RULES.maxChaseRatio) fails.push("already pumped vs copied wallets"); if (m.liqUsd > 0 && m.liqUsd < 25_000) fails.push("liq<25k"); }
      if (!fails.length) fails.push(...securityScreen(await g.tokenSecurity("sol", token).catch(() => null)));
      if (!fails.length) fails.push(...holderScreen(await g.holders("sol", token, 100).catch(() => [])).failures);
      let jev: unknown = null;
      if (!fails.length && this.d.jev) jev = await this.d.jev({ copy_wallets: cl.length, sources: cl.map((b) => b.source), chase_ratio: m ? m.px / avgBuy : null, liq_usd: m?.liqUsd }).catch((e: Error) => ({ error: e.message }));
      this.d.log({ type: "candidate", source: "copy", at: now, mint: token, wallets: cl.map((b) => ({ maker: b.maker, source: b.source, usd: b.usd, px: b.px })), chase: m ? m.px / avgBuy : null, fails, jev });
      if (m) this.follow(token, "?", m.px, fails.length === 0, fails.length ? "copy-veto" : "copy-entered");
      if (fails.length) { for (const f of fails) c.vetoes[f] = (c.vetoes[f] ?? 0) + 1; continue; }
      for (const name of this.copyNames) { const e = this.books.get(name)!.open(token, token.slice(0, 6), name, { px: m!.px, liqUsd: 0 }, now, { wallets: cl.length, jev }); if (e) { this.d.log(e); c.entries++; } }
    }
    // mirror exits: the copied wallets have mostly sold
    for (const name of this.copyNames) for (const p of this.books.get(name)!.positions.values()) {
      if (p.closedAt) continue; const sig = this.copySignals.get(p.mint); if (!sig) continue;
      if (this.tracker.soldShare(p.mint, sig.makers) >= COPY_RULES.mirrorExitShare) {
        const m = extractMark(await g.tokenInfo("sol", p.mint).catch(() => null));
        const e = m && this.books.get(name)!.close(p.id, m.px, now, "copied wallets sold"); if (e) { this.d.log(e); c.mirrorExits++; }
      }
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
