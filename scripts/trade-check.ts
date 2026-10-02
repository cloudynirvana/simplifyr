/**
 * Pre-trade checker for a LIVE executor agent. Read-only: uses the GMGN read key, never trades, never signs.
 *   npx tsx scripts/trade-check.ts <mint> [--from <public wallet address>] [--profile copy] [--ledger <paper ledger>]
 *   npx tsx scripts/trade-check.ts --readiness [--profile base]          (go-live gates only; no GMGN calls)
 * Live files (written by the human / executor, never committed):
 *   .trading-state/live/APPROVED.json  written approval {profile, approvedBy, approvedAt, expiresAt, lossBudgetUsd, maxTradeUsd, dailyLossUsd}
 *   .trading-state/live/KILL           any content = halt everything
 *   .trading-state/live/state.json     {realizedTodayUsd, realizedTotalUsd, openPositions[], consecutiveLosses, lastLossAt}
 * Prints one JSON verdict. Exit code: 0 GO, 1 NO_TRADE, 2 HALT, 3 error.
 * Executor contract: act only on GO, only before validUntil, only with order.sizeUsd / slippagePct / exits as given.
 */
import fs from "fs";
import { GmgnClient } from "../src/lib/gmgn";
import { extractMark } from "../src/trading/gmgnChecks";
import { askMemeJev } from "../src/trading/memeJev";
import { gmgnFeatures } from "../src/trading/gmgnFilter";
import { preTradeCheck, liveReadiness, infoToRankFields, parseQuoteImpact, LIVE_LIMITS, type AccountState, type Approval, type TokenData } from "../src/trading/tradeGate";

const args = process.argv.slice(2), opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const LIVE = ".trading-state/live", SOL = "So11111111111111111111111111111111111111112";
const readJson = <T>(p: string): T | null => { try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch { return null; } };
const ledgerPath = opt("--ledger") ?? ".trading-state/gmgn-paper/ledger.jsonl";
const rows = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
const approval = readJson<Approval>(`${LIVE}/APPROVED.json`);
const profile = opt("--profile") ?? approval?.profile ?? "base";
const readiness = liveReadiness(rows, profile);

if (args.includes("--readiness")) { console.log(JSON.stringify({ ledger: ledgerPath, rows: rows.length, ...readiness }, null, 2)); process.exit(readiness.ready ? 0 : 1); }

const mint = args.find((a) => !a.startsWith("--") && a !== opt("--from") && a !== opt("--profile") && a !== opt("--ledger"));
if (!mint) { console.error("usage: trade-check.ts <mint> [--from <wallet>] [--profile p] | --readiness"); process.exit(3); }
const g = GmgnClient.fromEnv(); if (!g) { console.error("GMGN_API_KEY missing"); process.exit(3); }

const main = async () => {
  const live = readJson<Partial<AccountState>>(`${LIVE}/state.json`) ?? {};
  const [rank1h, rank5m, info, security, holders] = await Promise.all([
    g.rank("sol", "1h").catch(() => []), g.rank("sol", "5m").catch(() => []),
    g.tokenInfo("sol", mint).catch(() => null), g.tokenSecurity("sol", mint).catch(() => null), g.holders("sol", mint).catch(() => null),
  ]);
  const ranked = [...rank5m, ...rank1h].find((x: any) => x.address === mint);
  const rank = ranked ?? (info ? { ...infoToRankFields(info), ...(security ? { renounced_mint: security.renounced_mint, renounced_freeze_account: security.renounced_freeze_account, is_honeypot: security.is_honeypot ?? security.honeypot } : {}) } : null);
  const m = info ? extractMark(info) : null;
  const mark = m ? { px: m.px, liqUsd: m.liqUsd || Number(rank?.liquidity) || 0 } : null;

  let quote: TokenData["quote"] = null, quoteRaw: unknown = null;
  const from = opt("--from");
  if (from) {
    const solInfo = await g.tokenInfo("sol", SOL).catch(() => null), solPx = solInfo ? extractMark(solInfo)?.px : undefined;
    const usd = Math.min(LIVE_LIMITS.maxTradeUsd, approval?.maxTradeUsd ?? LIVE_LIMITS.maxTradeUsd);
    if (solPx) {
      quoteRaw = await g.quote("sol", from, SOL, mint, String(Math.round((usd / solPx) * 1e9)), LIVE_LIMITS.orderSlippagePct).catch((e) => ({ error: (e as Error).message }));
      quote = { priceImpactPct: parseQuoteImpact(quoteRaw) };
    }
  }
  const jev = rank ? await askMemeJev({ ...gmgnFeatures(rank) }).catch(() => null) : null;

  const account: AccountState = {
    now: Date.now(), killSwitch: fs.existsSync(`${LIVE}/KILL`), approval, readiness,
    realizedTodayUsd: live.realizedTodayUsd ?? 0, realizedTotalUsd: live.realizedTotalUsd ?? 0,
    openPositions: live.openPositions ?? [], consecutiveLosses: live.consecutiveLosses ?? 0, lastLossAt: live.lastLossAt,
  };
  const token: TokenData = { mint, fetchedAt: Date.now(), rank, security, holders, mark, quote, jev: jev ? { rugRisk: jev.rugRisk, pUp: jev.pUp, setup: jev.setup } : null };
  const res = preTradeCheck(account, token);
  console.log(JSON.stringify({ ...res, source: ranked ? "rank" : "token/info", quoteRaw: from ? quoteRaw : "skipped (no --from)" }, null, 2));
  process.exit(res.verdict === "GO" ? 0 : res.verdict === "HALT" ? 2 : 1);
};
main().catch((e) => { console.error("trade-check error:", (e as Error).message); process.exit(3); });
