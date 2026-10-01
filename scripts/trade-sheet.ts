/**
 * Pre-trade sheet for ONE pump.fun / Solana token (manual execution).
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/trade-sheet.ts <mint> [--size-usd 15] [--capital 1000] [--demo]
 * Runs every filter (market data + RugCheck). Writes a filled sheet ONLY if the token passes.
 * --demo skips the gates and stamps the sheet "DEMO - DO NOT TRADE" (to preview the format).
 * All plan numbers are editable defaults (hypotheses), not validated edge.
 */
import fs from "fs";
import { marketScreen } from "../src/trading/screenFilters";
import { makeRugCheckGate } from "../src/trading/rugcheckGate";

const args = process.argv.slice(2);
const mint = args[0] && !args[0].startsWith("--") ? args[0] : "";
const opt = (k: string, d: number) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const sizeUsd = opt("--size-usd", 15), capital = opt("--capital", 1000), demo = args.includes("--demo");
const PLAN = { slippagePct: 8, stopPct: 12, tp: [{ at: 25, sell: 50 }, { at: 60, sell: 25 }], timeStopH: 2, maxPositionPctCapital: 2, tipPctOfOrder: 2, impactCapPct: 5 };

async function main() {
  if (!mint) { console.error("usage: trade-sheet.ts <mint> [--size-usd N] [--capital N] [--demo]"); process.exit(1); }
  const r = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
  if (!r.ok) throw new Error(`DexScreener ${r.status}`);
  const pairs = ((await r.json()) as any[]).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const p = pairs[0]; if (!p) throw new Error("no pair found for this mint");

  const fails = marketScreen(p);
  const rc = fails.length ? null : await makeRugCheckGate()(mint);
  const pass = fails.length === 0 && !!rc?.pass;
  if (!pass && !demo) {
    console.log(`NO TRADE for ${p.baseToken.symbol}. Failed: ${[...fails, ...(rc?.failures ?? [])].join(" | ")}`);
    return;
  }

  const px = Number(p.priceUsd), liq = p.liquidity?.usd ?? 0, solUsd = p.priceNative && Number(p.priceNative) > 0 ? px / Number(p.priceNative) : NaN;
  const tipMaxSol = Number.isFinite(solUsd) ? (sizeUsd * PLAN.tipPctOfOrder / 100) / solUsd : NaN;
  const sizeChecks = [
    sizeUsd <= (capital * PLAN.maxPositionPctCapital) / 100 ? null : `size exceeds ${PLAN.maxPositionPctCapital}% of capital ($${(capital * PLAN.maxPositionPctCapital / 100).toFixed(2)})`,
    sizeUsd <= liq * 0.01 ? null : "size exceeds 1% of pool liquidity",
  ].filter(Boolean);
  const roundTripCostPct = 1.6, breakeven = px * (1 + roundTripCostPct / 100);
  const f = (n: number, d = 8) => (Number.isFinite(n) ? n.toPrecision(d > 6 ? 6 : d) : "n/a");
  const stamp = new Date().toISOString();
  const md = `# Trade sheet — ${p.baseToken.symbol} ${demo && !pass ? "(DEMO - DO NOT TRADE)" : ""}
Generated ${stamp} · filters: ${pass ? "ALL PASSED (market data + RugCheck; RugCheck pass = no red flag found, not 'safe')" : "NOT PASSED — demo only"}

## Token
- Mint: \`${mint}\`  · DEX: ${p.dexId}  · Pair: ${p.pairAddress}
- Chart: ${p.url}
- Price now: $${f(px)}  · Liquidity: $${Math.round(liq)}  · Mcap: $${Math.round(p.marketCap ?? p.fdv ?? 0)}  · 1h change: ${p.priceChange?.h1}%
- Flow (1h): ${p.txns?.h1?.buys} buys / ${p.txns?.h1?.sells} sells  ·  Re-check price and liquidity right before buying; this is a snapshot.

## Entry (fill in the app)
| Field | Value | Your entry |
|---|---|---|
| Order size (USD) | $${sizeUsd} ${sizeChecks.length ? "⚠ " + sizeChecks.join("; ") : "(ok vs capital and liquidity)"} | ____ |
| Max slippage | ${PLAN.slippagePct}% (never 100%) | ____ |
| Max price impact | ${PLAN.impactCapPct}% — abort if the quote shows more | ____ |
| Priority fee + tip | keep tip ≤ ${Number.isFinite(tipMaxSol) ? tipMaxSol.toFixed(4) + " SOL" : "2% of order"} (2% of order) | ____ |
| Don't pay above | $${f(px * (1 + PLAN.slippagePct / 100))} | ____ |
| Break-even sell price (~1.6% round-trip costs) | $${f(breakeven)} | ____ |
| Test sell | Buy ~$1-2 first, sell a little to confirm you can exit | ☐ done |

## Exit plan — decide NOW, set before you size up
| Rule | Level | Price |
|---|---|---|
| Stop-loss | −${PLAN.stopPct}% from your fill | $${f(px * (1 - PLAN.stopPct / 100))} (recompute from YOUR fill: ____) |
| Take profit 1 | sell ${PLAN.tp[0].sell}% at +${PLAN.tp[0].at}% | $${f(px * (1 + PLAN.tp[0].at / 100))} |
| Take profit 2 | sell ${PLAN.tp[1].sell}% at +${PLAN.tp[1].at}% | $${f(px * (1 + PLAN.tp[1].at / 100))} |
| Remainder | sell on any red flag below, or at time stop | — |
| Time stop | exit if not at TP1 after ${PLAN.timeStopH}h | by ____ |
| Max $ loss on this trade | ≈ $${(sizeUsd * PLAN.stopPct / 100).toFixed(2)} + fees | ____ |

**Pre-set the exits instead of watching:** this token trades on ${p.dexId}, so Jupiter can route it. Check whether Jupiter's limit/trigger orders let you place the take-profits and stop-loss in advance (availability and stop-order support are not verified here). Pump.fun's own page may not support resting orders (verify in the app).

## Abort / sell-everything triggers (any one)
- Dev or a top-10 wallet sells a large part · liquidity drops >20% · sells suddenly >1.5× buys over 5 min · price down ${PLAN.stopPct}% · you can't sell a test amount.

## After the trade (fill in)
Entry time ____ · fill price ____ · tx ____ · exit prices ____ · exit reason ____ · PnL $ ____ · what the filters missed ____
`;
  fs.mkdirSync(".trading-state/sheets", { recursive: true });
  const out = `.trading-state/sheets/${p.baseToken.symbol}-${stamp.replace(/[:.]/g, "-")}${pass ? "" : "-DEMO"}.md`;
  fs.writeFileSync(out, md);
  console.log(md, `\nWritten to ${out}`);
}
main().catch((e) => console.log("ERR", e.message));
