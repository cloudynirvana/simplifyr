/**
 * Pre-trade gate: the single check a LIVE executor agent must pass before every buy. Pure functions, no I/O.
 * It never trades. It answers GO / NO_TRADE / HALT with reasons, a capped size and the exact exit plan to attach.
 *
 * Layers (all must pass; any missing data fails CLOSED):
 *   0. Account  - written approval present and unexpired, kill switch absent, paper evidence meets the go-live gates,
 *                 daily loss / loss budget / open positions / losing-streak cooldown within limits.
 *   1. Fields   - gmgnScreen (GMGN rank/info fields: liquidity, age, rug ratio, bundlers, top10, dev, snipers, 5m drop...)
 *   2. Security - securityScreen (honeypot, cannot sell, authorities, tax, blacklist)
 *   3. Holders  - holderScreen (top wallet, top10 wallets, insiders, creator, identical-balance clusters)
 *   4. Signal   - entry timing: data freshness, copy-signal age/cluster/chase, no re-entry, recent 1m spike
 *   5. Execution- size <= share of liquidity, quote price impact, round-trip cost vs first take-profit
 *   6. Jev      - advisory unless calibrated (Brier beats base on >= 100 outcomes); then it may veto, never approve
 * Thresholds live in LIVE_LIMITS / GO_LIVE_GATES. Change them only through a dated entry in docs/EXPERIMENTS.md.
 */
import { gmgnScreen } from "./gmgnFilter";
import { securityScreen, holderScreen } from "./gmgnChecks";
import { COPY_RULES } from "./copyTrade";

export const GO_LIVE_GATES = {
  minClosedTrades: 100, minExpectancyUsd: 0, minProfitFactor: 1.3, maxDrawdownShare: 0.15,
  weeksWindow: 4, minPositiveWeeks: 3, holdoutShare: 0.3,   // last 30% of trades (chronological) must be positive on its own
  minRugExitsObserved: 1,                                     // rug triggers seen firing at least once
};

export const LIVE_LIMITS = {
  maxTradeUsd: 5,              // hard ceiling per trade regardless of approval
  maxBudgetShare: 0.02,        // per trade <= 2% of the written loss budget
  maxOpen: 3, maxConsecLosses: 3, cooldownMin: 60,
  maxSizeLiqShare: 0.005,      // our buy <= 0.5% of pool liquidity (~1% CPMM impact)
  maxPriceImpactPct: 2.0, maxRoundTripCostPct: 8,  // fees + impact both ways must leave room under the first take-profit
  orderSlippagePct: 5,         // slippage tolerance to send with the swap
  maxDataAgeMs: 30_000, verdictTtlMs: 20_000,     // executor must re-run the gate if it acts later than this
  maxCopySignalAgeMin: 10, maxSpike1mPct: 15,
  jevVetoRugRisk: 0.5,
};

/** gmgnScreen passes a risk rule when its field is absent; live trading must not. These must be present and numeric. */
export const REQUIRED_FIELDS = ["liquidity", "market_cap", "holder_count", "creation_timestamp", "rug_ratio", "top_10_holder_rate", "price_change_percent5m", "price_change_percent1h", "buys", "sells"];

export interface Approval { profile: string; approvedBy: string; approvedAt: string; expiresAt: string; lossBudgetUsd: number; maxTradeUsd: number; dailyLossUsd: number }
export interface AccountState {
  now: number; killSwitch: boolean; approval: Approval | null;
  readiness: Readiness;                      // from liveReadiness() on the paper ledger
  realizedTodayUsd: number; realizedTotalUsd: number;   // live P&L (negative = loss)
  openPositions: string[];                   // mints currently held live
  consecutiveLosses: number; lastLossAt?: number;
}
export interface TokenData {
  mint: string; fetchedAt: number;
  rank: Record<string, any> | null;          // GMGN rank-shaped fields (rank item, or token/info mapped to it)
  security: Record<string, any> | null;
  holders: any[] | null;
  mark: { px: number; liqUsd: number } | null;
  quote?: { priceImpactPct: number | null; feePct?: number | null } | null;
  copy?: { wallets: number; firstBuyAt: number; avgBuyPx: number } | null;   // present when the trigger is a copy signal
  jev?: { rugRisk: number; pUp: number; setup: number } | null;
}
export type Verdict = "GO" | "NO_TRADE" | "HALT";
export interface GateResult {
  verdict: Verdict; mint: string; checkedAt: number; validUntil: number;
  reasons: string[]; layers: Record<string, string[]>; notes: string[];
  order?: { sizeUsd: number; slippagePct: number; exits: ExitPlan; profile: string };
}
export interface ExitPlan { stopPct: number; tp: Array<{ at: number; sell: number }>; trailActivatePct?: number; trailPct?: number; timeStopMin: number; rugLiqDropPct: number; rugSellBuy5m: number; mirrorExitShare?: number }

/** Exit plans = the pre-registered paper profiles. Live must use the plan of the profile that earned approval. */
export const EXIT_PLANS: Record<string, ExitPlan> = {
  base:  { stopPct: 12, tp: [{ at: 25, sell: 0.5 }, { at: 60, sell: 0.5 }], timeStopMin: 120, rugLiqDropPct: 20, rugSellBuy5m: 1.5 },
  wide:  { stopPct: 20, tp: [{ at: 25, sell: 0.5 }, { at: 60, sell: 0.5 }], timeStopMin: 180, rugLiqDropPct: 20, rugSellBuy5m: 1.5 },
  trail: { stopPct: 15, tp: [], trailActivatePct: 20, trailPct: 15, timeStopMin: 240, rugLiqDropPct: 20, rugSellBuy5m: 1.5 },
  copy:  { stopPct: 15, tp: [{ at: 50, sell: 0.5 }], trailActivatePct: 30, trailPct: 20, timeStopMin: 360, rugLiqDropPct: 20, rugSellBuy5m: 1.5, mirrorExitShare: COPY_RULES.mirrorExitShare },
};

// ---------- go-live readiness from the paper ledger ----------
export interface Readiness { profile: string; ready: boolean; reasons: string[]; stats: Record<string, number | null>; jevCalibrated: boolean }

export function liveReadiness(rows: any[], profile: string, g = GO_LIVE_GATES): Readiness {
  const start = [...rows].reverse().find((r) => r.type === "start");
  const cfg = start?.profiles?.[profile] ?? start?.copyProfiles?.[profile];
  const deployed = cfg ? cfg.sizeUsd * cfg.maxOpen : NaN;
  const t = new Map<string, { cost: number; proceeds: number; closedAt?: number; reason?: string }>();
  for (const r of rows) {
    if (r.profile !== profile) continue;
    if (r.type === "open") t.set(r.id, { cost: r.usd, proceeds: 0 });
    else if ((r.type === "sell" || r.type === "close") && t.has(r.id)) { const x = t.get(r.id)!; x.proceeds += r.usd; if (r.type === "close") { x.closedAt = r.at; x.reason = r.reason; } }
  }
  const closed = [...t.values()].filter((x) => x.closedAt).sort((a, b) => a.closedAt! - b.closedAt!);
  const pnl = closed.map((x) => x.proceeds - x.cost), sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const gw = sum(pnl.filter((v) => v > 0)), gl = -sum(pnl.filter((v) => v <= 0));
  let eq = 0, peak = 0, dd = 0; for (const v of pnl) { eq += v; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const week = (ms: number) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime(); };
  const byWeek = new Map<number, number>(); closed.forEach((x, i) => byWeek.set(week(x.closedAt!), (byWeek.get(week(x.closedAt!)) ?? 0) + pnl[i]));
  const lastWeeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).slice(-g.weeksWindow);
  const posWeeks = lastWeeks.filter(([, v]) => v > 0).length;
  const hold = pnl.slice(Math.floor(pnl.length * (1 - g.holdoutShare)));
  const rugExits = closed.filter((x) => x.reason?.startsWith("rug")).length;
  const stats = { closed: closed.length, expectancyUsd: closed.length ? sum(pnl) / closed.length : null, profitFactor: gl ? gw / gl : null,
    maxDrawdownUsd: dd, deployedUsd: Number.isFinite(deployed) ? deployed : null, weeks: lastWeeks.length, positiveWeeks: posWeeks,
    holdoutExpectancyUsd: hold.length ? sum(hold) / hold.length : null, rugExits };
  const reasons: string[] = [];
  if (closed.length < g.minClosedTrades) reasons.push(`only ${closed.length}/${g.minClosedTrades} closed paper trades`);
  if (!(stats.expectancyUsd! > g.minExpectancyUsd)) reasons.push("expectancy not positive after costs");
  if (!(stats.profitFactor! >= g.minProfitFactor)) reasons.push(`profit factor below ${g.minProfitFactor}`);
  if (!(Number.isFinite(deployed) && dd <= g.maxDrawdownShare * deployed)) reasons.push("max drawdown above 15% of deployed capital");
  if (lastWeeks.length < g.weeksWindow || posWeeks < g.minPositiveWeeks) reasons.push(`positive in ${posWeeks} of last ${lastWeeks.length} weeks (need ${g.minPositiveWeeks} of ${g.weeksWindow})`);
  if (!(stats.holdoutExpectancyUsd! > 0)) reasons.push("latest 30% of trades (holdout) not positive");
  if (rugExits < g.minRugExitsObserved) reasons.push("rug exits never observed firing");
  return { profile, ready: reasons.length === 0, reasons, stats, jevCalibrated: jevCalibrated(rows) };
}

/** Jev may veto only when both its P(up) and P(rug) beat the base-rate Brier score on >= 100 labelled candidates. */
export function jevCalibrated(rows: any[], minN = 100): boolean {
  const o = new Map(rows.filter((r) => r.type === "outcome" && r.horizonMin === 240).map((r) => [r.mint, r]));
  const up: Array<[number, number]> = [], rug: Array<[number, number]> = [];
  for (const c of rows.filter((r) => r.type === "candidate")) { const j = c.jev, x = o.get(c.mint); if (!j || j.error || !x) continue; const dead = x.ret === null; up.push([j.pUp, !dead && x.ret > 0.1 ? 1 : 0]); rug.push([j.rugRisk, dead || x.ret < -0.5 ? 1 : 0]); }
  if (up.length < minN) return false;
  const brier = (p: Array<[number, number]>) => p.reduce((a, [x, y]) => a + (x - y) ** 2, 0) / p.length;
  const base = (p: Array<[number, number]>) => { const b = p.reduce((a, [, y]) => a + y, 0) / p.length; return brier(p.map(([, y]) => [b, y])); };
  return brier(up) < base(up) && brier(rug) < base(rug);
}

// ---------- the per-trade gate ----------
const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));

export function preTradeCheck(a: AccountState, t: TokenData, L = LIVE_LIMITS): GateResult {
  const layers: Record<string, string[]> = { account: [], fields: [], security: [], holders: [], signal: [], execution: [], jev: [] };
  const notes: string[] = [];
  const now = a.now;

  // 0. account (HALT-class: nothing may trade until a human fixes it)
  const ap = a.approval;
  if (a.killSwitch) layers.account.push("kill switch present");
  if (!ap) layers.account.push("no written approval file");
  else {
    if (!(Date.parse(ap.expiresAt) > now)) layers.account.push("approval expired");
    if (ap.profile !== a.readiness.profile) layers.account.push("approval is for a different profile");
    if (!EXIT_PLANS[ap.profile]) layers.account.push("approved profile has no exit plan");
    if (!(ap.lossBudgetUsd > 0 && ap.dailyLossUsd > 0 && ap.maxTradeUsd > 0)) layers.account.push("approval missing budget limits");
    if (-a.realizedTotalUsd >= ap.lossBudgetUsd) layers.account.push("total loss budget used up");
    if (-a.realizedTodayUsd >= ap.dailyLossUsd) layers.account.push("daily loss limit hit");
  }
  if (!a.readiness.ready) layers.account.push(...a.readiness.reasons.map((r) => `not ready: ${r}`));
  const halt = layers.account.length > 0;

  // soft account limits (NO_TRADE, not HALT)
  if (a.openPositions.length >= L.maxOpen) layers.signal.push(`already ${a.openPositions.length} open positions`);
  if (a.openPositions.includes(t.mint)) layers.signal.push("already holding this token");
  if (a.consecutiveLosses >= L.maxConsecLosses && a.lastLossAt && now - a.lastLossAt < L.cooldownMin * 60_000) layers.signal.push("cooling down after losing streak");

  // 1-3. token risk
  if (!t.rank) layers.fields.push("token fields missing");
  else {
    layers.fields.push(...gmgnScreen(t.rank, now));
    for (const k of REQUIRED_FIELDS) if (!Number.isFinite(num(t.rank[k]))) layers.fields.push(`missing ${k}`);
  }
  layers.security.push(...securityScreen(t.security));
  if (!t.holders) layers.holders.push("holder data missing"); else layers.holders.push(...holderScreen(t.holders).failures);

  // 4. signal timing
  if (!(now - t.fetchedAt <= L.maxDataAgeMs)) layers.signal.push("data older than 30s");
  if (!t.mark || !(t.mark.px > 0)) layers.signal.push("no live price");
  if (num(t.rank?.price_change_percent1m) > L.maxSpike1mPct) layers.signal.push("buying into a 1m spike");
  if (ap && (ap.profile === "copy") !== !!t.copy) layers.signal.push(t.copy ? "copy signal, but the approved profile is not copy" : "approved profile is copy, but this is not a copy signal");
  const rankLiq = num(t.rank?.liquidity), markLiq = t.mark?.liqUsd ?? 0;
  if (rankLiq > 0 && markLiq > 0 && Math.max(rankLiq, markLiq) / Math.min(rankLiq, markLiq) > 1.5) layers.signal.push("liquidity sources disagree (>1.5x)");
  if (t.copy) {
    if (t.copy.wallets < COPY_RULES.minWallets) layers.signal.push("copy: too few eligible wallets");
    if (now - t.copy.firstBuyAt > L.maxCopySignalAgeMin * 60_000) layers.signal.push("copy: signal too old");
    if (t.mark && t.copy.avgBuyPx > 0 && t.mark.px / t.copy.avgBuyPx > COPY_RULES.maxChaseRatio) layers.signal.push("copy: already pumped vs copied wallets");
  }

  // 5. execution and size
  const cap = ap ? Math.min(L.maxTradeUsd, ap.maxTradeUsd, ap.lossBudgetUsd * L.maxBudgetShare) : 0;
  const liq = t.mark?.liqUsd ?? 0;
  const size = Math.floor(Math.min(cap, liq * L.maxSizeLiqShare) * 100) / 100;
  if (!(liq > 0)) layers.execution.push("liquidity unknown");
  if (!(size >= 1)) layers.execution.push("size under $1 after caps");
  if (cap > 0 && liq * L.maxSizeLiqShare < cap) notes.push(`size cut to ${L.maxSizeLiqShare * 100}% of liquidity`);
  const impact = t.quote?.priceImpactPct;
  if (impact === null || impact === undefined || !Number.isFinite(impact)) layers.execution.push("no quote / price impact unknown");
  else {
    if (impact > L.maxPriceImpactPct) layers.execution.push(`price impact ${impact.toFixed(2)}% > ${L.maxPriceImpactPct}%`);
    const roundTrip = 2 * (impact + (t.quote?.feePct ?? 1));
    const plan = ap ? EXIT_PLANS[ap.profile] : undefined;
    if (roundTrip > L.maxRoundTripCostPct) layers.execution.push(`round-trip cost ~${roundTrip.toFixed(1)}% > ${L.maxRoundTripCostPct}%`);
    if (plan?.tp[0] && roundTrip > plan.tp[0].at / 3) layers.execution.push("costs eat more than a third of the first take-profit");
  }

  // 6. Jev
  if (!t.jev) notes.push("Jev: no answer (not required)");
  else if (!a.readiness.jevCalibrated) notes.push(`Jev advisory only (uncalibrated): rug ${t.jev.rugRisk.toFixed(2)}, pUp ${t.jev.pUp.toFixed(2)}`);
  else if (t.jev.rugRisk > L.jevVetoRugRisk) layers.jev.push(`Jev rug risk ${t.jev.rugRisk.toFixed(2)}`);

  const reasons = Object.entries(layers).flatMap(([k, v]) => v.map((r) => `${k}: ${r}`));
  const verdict: Verdict = halt ? "HALT" : reasons.length ? "NO_TRADE" : "GO";
  return { verdict, mint: t.mint, checkedAt: now, validUntil: now + L.verdictTtlMs, reasons, layers, notes,
    ...(verdict === "GO" && ap ? { order: { sizeUsd: size, slippagePct: L.orderSlippagePct, exits: EXIT_PLANS[ap.profile], profile: ap.profile } } : {}) };
}

/** Map GMGN `token info` (+ `token security`) to the rank-item names gmgnScreen reads. Field names per GMGN's gmgn-token skill.
 *  Windowed change = price.price vs price.price_{window} (start-of-window price). Unknown fields stay missing -> REQUIRED_FIELDS fails closed. */
export function infoToRankFields(info: any, sec?: any): Record<string, any> {
  const p = info?.price ?? {}, st = info?.stat ?? {}, px = num(p.price);
  const chg = (w: string) => { const o = num(p[`price_${w}`]); return px > 0 && o > 0 ? (px / o - 1) * 100 : undefined; };
  const supply = num(info?.circulating_supply ?? info?.total_supply);
  return {
    address: info?.address, symbol: info?.symbol, liquidity: info?.liquidity ?? info?.pool?.liquidity,
    market_cap: px > 0 && supply > 0 ? px * supply : undefined, holder_count: info?.holder_count ?? st.holder_count,
    creation_timestamp: info?.creation_timestamp ?? info?.open_timestamp,
    price_change_percent1m: chg("1m"), price_change_percent5m: chg("5m"), price_change_percent1h: chg("1h"),
    buys: p.buys_1h, sells: p.sells_1h,
    rug_ratio: sec?.rug_ratio, top_10_holder_rate: st.top_10_holder_rate ?? info?.dev?.top_10_holder_rate,
    dev_team_hold_rate: st.dev_team_hold_rate, bundler_rate: st.top_bundler_trader_percentage,
    rat_trader_amount_rate: st.top_rat_trader_percentage, entrapment_ratio: st.top_entrapment_trader_percentage,
    is_honeypot: sec ? (sec.is_honeypot === "yes" || sec.is_honeypot === true || sec.is_honeypot === 1 ? 1 : 0) : undefined,
    renounced_mint: sec?.renounced_mint === true || sec?.renounced_mint === 1 ? 1 : 0,
    renounced_freeze_account: sec?.renounced_freeze_account === true || sec?.renounced_freeze_account === 1 ? 1 : 0,
  };
}

/**
 * Price impact from a GMGN `order quote` (`/v1/trade/quote`). The quote has no impact field; it returns input_amount,
 * output_amount and min_output_amount in smallest units. Impact = effective price paid vs the current mark:
 *   effPx = inputUsd / (output_amount / 10^decimals);  impact% = (effPx / markPx - 1) * 100   (includes pool fee)
 * Returns null on anything missing, which makes the gate answer NO_TRADE.
 */
export function quoteImpactPct(q: any, o: { inputUsd: number; markPx: number; outDecimals: number }): number | null {
  const out = num(q?.output_amount), dec = num(o.outDecimals);
  if (!(out > 0) || !(o.inputUsd > 0) || !(o.markPx > 0) || !Number.isInteger(dec) || dec < 0 || dec > 18) return null;
  return ((o.inputUsd / (out / 10 ** dec)) / o.markPx - 1) * 100;
}

// ---------- GMGN interface: the exact gmgn-cli order an executor places on GO ----------
export const SOL_MINT = "So11111111111111111111111111111111111111112";   // copied from GMGN's Chain Currencies table
export const SOL_FEES = { priorityFeeSol: "0.00001", tipFeeSol: "0.00001" }; // required by GMGN with --condition-orders on SOL

/** Pre-registered exit plan -> GMGN condition orders (sell-ratio-type hold_amount: each fires on what is held at trigger time). */
export function toConditionOrders(e: ExitPlan) {
  const o: Array<Record<string, string>> = [{ order_type: "loss_stop", side: "sell", price_scale: String(e.stopPct), sell_ratio: "100" }];
  e.tp.forEach((tp, i) => o.push({ order_type: "profit_stop", side: "sell", price_scale: String(tp.at),
    sell_ratio: String(i === e.tp.length - 1 && !e.trailPct ? 100 : Math.round(tp.sell * 100)) }));
  if (e.trailPct) o.push({ order_type: "profit_stop_trace", side: "sell", price_scale: String(e.trailActivatePct ?? 0), drawdown_rate: String(e.trailPct), sell_ratio: "100" });
  return o;
}

/** argv for `gmgn-cli swap` (buy) with exits attached. No --yes: GMGN requires a typed confirmation unless the OWNER sets
 *  GMGN_ALLOW_AUTOMATED_TRADES=1 in their own shell and the executor is allowed to append --yes (Phase B, see handoff). */
export function gmgnBuyArgs(o: { wallet: string; mint: string; sizeUsd: number; solPx: number; slippagePct: number; exits: ExitPlan }): string[] | null {
  const lamports = Math.floor((o.sizeUsd / o.solPx) * 1e9);
  if (!(lamports > 0) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.wallet) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.mint)) return null;
  return ["swap", "--chain", "sol", "--from", o.wallet, "--input-token", SOL_MINT, "--output-token", o.mint, "--amount", String(lamports),
    "--slippage", String(Math.round(o.slippagePct)), "--anti-mev", "--priority-fee", SOL_FEES.priorityFeeSol, "--tip-fee", SOL_FEES.tipFeeSol,
    "--condition-orders", JSON.stringify(toConditionOrders(o.exits)), "--sell-ratio-type", "hold_amount", "--raw"];
}
/** Full exit by the executor (time stop, rug trigger, mirror exit): sell 100% of the token back to SOL. */
export function gmgnSellAllArgs(wallet: string, mint: string, slippagePct = 10): string[] {
  return ["swap", "--chain", "sol", "--from", wallet, "--input-token", mint, "--output-token", SOL_MINT, "--percent", "100",
    "--slippage", String(slippagePct), "--anti-mev", "--raw"];
}
