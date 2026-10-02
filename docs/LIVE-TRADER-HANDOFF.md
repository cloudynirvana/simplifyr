# Live-trader handoff: the pre-trade checker

This is for the agent that will place **live** trades on GMGN. Read all of it before your first order.

You are the **executor**. You do not choose what to trade or change the rules. Every buy must first get a `GO` from the checker described here, and must then follow the order plan it returns exactly. Everything else (research, filters, exit profiles) is done offline and comes from the paper record.

---

## 1. The contract in five lines

1. Before every buy, run `npx tsx scripts/trade-check.ts <mint> --from <public wallet address>`.
2. **`GO`:** buy exactly `order.sizeUsd` with `order.slippagePct`, attach `order.exits`, and do it before `validUntil` (20 s). If you're late, re-run the check.
3. **`NO_TRADE`:** skip the token. Don't retry it for 10 minutes.
4. **`HALT`:** place no trades at all. Report `reasons` to the owner and wait for a human.
5. Never edit thresholds, the approval file, the live state file or the kill switch to turn a verdict into `GO`.

Exit codes: 0 = GO, 1 = NO_TRADE, 2 = HALT, 3 = error (treat as NO_TRADE; three errors in a row = HALT).

---

## 2. What the checker checks (all must pass; missing data fails closed)

| Layer | Fails when | Source |
|---|---|---|
| **0. Account** (fails as HALT) | Kill switch present. No written approval, it has expired, it's for a different profile, or it lacks limits. Total loss budget used up. Daily loss limit hit. Paper record doesn't meet the go-live gates (section 4). | `.trading-state/live/*`, paper ledger |
| **1. Fields** | Liquidity under $25k. Market cap under $50k. Holders under 300. Age under 30 min or over 48 h. Rug ratio over 0.3. Bundlers over 25%. Top 10 over 30%. Dev over 5%. Rat traders over 5%. Top-70 snipers over 10%. Entrapment over 0.1. Honeypot or wash trading. Mint or freeze not renounced. Up more than 300% in 1 h. Down 10% or more in 5 m. No sells, or buy/sell ratio over 8. | GMGN rank / token info, `gmgnFilter.ts` |
| **2. Security** | Honeypot. Cannot sell. Mint or freeze authority active. Tax over 10%. Blacklist. | GMGN `/v1/token/security`, `gmgnChecks.ts` |
| **3. Holders** (real wallets only) | Top wallet over 5%. Top 10 wallets over 30%. Bundler, rat-trader and sniper wallets together over 10%. Creator over 5%. 6 or more wallets with identical balances. | GMGN `/v1/market/token_top_holders` |
| **4. Signal** | Data older than 30 s. No live price. Up more than 15% in 1 minute. Liquidity readings disagree by more than 1.5×. Already holding the token. 3 or more open positions. Cooling down after 3 losses in a row (60 min). The signal type doesn't match the approved profile. **Copy signals also fail when:** fewer than 2 eligible wallets, signal older than 10 min, or price already more than 1.3× the copied wallets' average buy. | Live state, `copyTrade.ts` rules |
| **5. Execution** | Liquidity unknown. Size under $1 after caps. No usable quote. Price impact over 2%. Round-trip cost over 8%. Costs eat more than a third of the first take-profit. | GMGN `/v1/trade/quote` |
| **6. Jev** | Only once calibrated (Brier score beats the base rate on 100 or more outcomes): veto when rug risk is over 0.5. Before that, Jev is advisory and shows only in `notes`. Jev can never approve a trade. | TypeSafe System One |

**Size:** the smallest of:
- $5, the hard ceiling in code;
- the approval's `maxTradeUsd`;
- 2% of the approval's `lossBudgetUsd`;
- 0.5% of pool liquidity.

**Order slippage tolerance:** 5%.

**Exit plan:** always the pre-registered plan of the approved profile.

| Profile | Stop-loss | Take-profit | Trailing stop | Time limit | Extra exits |
|---|---|---|---|---|---|
| base | −12% | ½ at +25%, ½ at +60% | none | 2 h | rug: liquidity −20%, 5m sells over 1.5× buys |
| wide | −20% | ½ at +25%, ½ at +60% | none | 3 h | same |
| trail | −15% | none | arms at +20%, exits 15% below the peak | 4 h | same |
| copy | −15% | ½ at +50% | arms at +30%, exits 20% below the peak | 6 h | same, plus sell when half the copied wallets have sold |

Attach the stop-loss, take-profit and trailing stop as GMGN strategy orders, so they execute even if you are down. The time stop and rug exits need you to watch the open position every 20 s, using the same marks the paper engine uses.

---

## 3. Files the executor reads and writes (never committed; the repo is public)

| File | Who writes it | Content |
|---|---|---|
| `.trading-state/live/APPROVED.json` | **The owner only** | `{ "profile": "copy", "approvedBy": "...", "approvedAt": "2026-..", "expiresAt": "2026-..", "lossBudgetUsd": 100, "maxTradeUsd": 5, "dailyLossUsd": 10 }` |
| `.trading-state/live/KILL` | Owner or executor | Any content halts everything. The executor creates it on any surprise: unexpected fill, a position it can't find, or a balance mismatch. |
| `.trading-state/live/state.json` | Executor, after every fill | `{ "realizedTodayUsd": -3.2, "realizedTotalUsd": -7.9, "openPositions": ["<mint>"], "consecutiveLosses": 1, "lastLossAt": 1759400000000 }` (UTC day) |
| `.trading-state/live/ledger.jsonl` | Executor | One row per verdict, order, fill and exit: verdict JSON, GMGN order IDs, fill price, fees, realised P&L. |

Get the state right: if `state.json` is missing or stale, the checker assumes no losses and no open positions. Write it after every fill, before anything else.

---

## 4. Go-live gates (account layer: until these pass, every check returns HALT)

Read from the paper ledger (`.trading-state/gmgn-paper/ledger.jsonl`) for the approved profile:
- At least 100 closed paper trades.
- Expectancy above $0 per trade after costs (1% fee and 3% slippage per side).
- Profit factor at least 1.3.
- Maximum drawdown at most 15% of deployed capital.
- Positive in at least 3 of the last 4 weeks.
- The latest 30% of trades (holdout) positive on their own.
- Rug exits observed firing at least once.

Check without touching GMGN: `npx tsx scripts/trade-check.ts --readiness --profile copy`.

**Status on 2026-10-02:** not ready (0/100 closed in the GMGN ledger). The system has not shown it is profitable. The checker returns HALT for every token until this changes.

---

## 5. Live setup prerequisites (owner, once)

1. **GMGN trading key:** a new key with trading enabled, IP-locked to the server, on a **dedicated wallet** funded only with the written loss budget. The signing key lives only on the server (mode 600). It is never pasted into chat, never committed and never given to Claude.
2. **Verify the quote shape:** run one `--from` check and look at `quoteRaw`. Set `IMPACT_UNIT` in `src/trading/tradeGate.ts` to `"percent"` or `"fraction"` to match. Until then every check is NO_TRADE ("price impact unknown"), on purpose.
3. **Verify token-info parsing:** confirm `source` and `mark` look right on 3 known tokens (`extractMark` and `infoToRankFields` are best-effort).
4. **Write the approval:** write `APPROVED.json` with a short expiry (7 days); renew it weekly after reviewing results.
5. **First trade:** one micro-trade ($1–2). Reconcile the fill against `quoteRaw` and the GMGN order history before the next one.

---

## 6. Executor loop (reference)

```
every 20 s:
  if KILL exists -> stop
  update open positions: marks, rug exits, time stops, mirror exits (copy) -> fills -> ledger + state.json
  candidates <- paper engine's discovery (rank / trenches / copy signals) that passed its filters in the last minute
  for each candidate (best first, max 1 new order per loop):
     verdict <- trade-check <mint> --from <wallet>
     log verdict
     GO      -> place GMGN swap (size, slippage) + strategy orders (exits); confirm fill; ledger + state.json
     HALT    -> stop loop; notify owner
     else    -> skip, 10 min cooldown for that mint
```

**Halt immediately (create `KILL`) on any of these:**
- A fill more than 2× worse than the quoted impact.
- An order with no confirmation within 60 s.
- Wallet balance doesn't match the ledger.
- 3 errors in a row.
- Any check you can't explain.

---

## 7. What stays off limits

- Changing filters, thresholds, profiles or gates. Changes go through a dated entry in `docs/EXPERIMENTS.md`, then fresh paper evidence.
- Increasing size beyond the capital policy (`docs/HANDOFF.md` section 8): scale ×1.5 at most per 50 further trades with positive expectancy; any halt resets size to the minimum.
- Topping up the wallet after losses. Skim profit out weekly.
- Third-party agent harnesses or trade-scoped connectors, PumpPortal's private API, and Telegram bots.
- Handling private keys or seed phrases in any form other than the server's key file.

---

## 8. Code map

- `src/trading/tradeGate.ts`: `preTradeCheck`, `liveReadiness`, `jevCalibrated`, `EXIT_PLANS`, `LIVE_LIMITS`, `GO_LIVE_GATES`, `parseQuoteImpact`, `infoToRankFields`.
- `scripts/trade-check.ts`: CLI wrapper (read-only GMGN key and optional Jev; prints one JSON verdict).
- `src/trading/gmgnFilter.ts`, `src/trading/gmgnChecks.ts`, `src/trading/copyTrade.ts`: the filters reused by the checker.
- `.claude/skills/pre-trade-check/SKILL.md`: short version of this contract.
