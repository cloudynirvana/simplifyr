---
name: paper-review
description: Evaluate paper-trading results and filter behaviour (expectancy after costs, profit factor, exit reasons, Jev calibration, veto histogram) and decide whether any go-live gate is met. Use when asked how the bot is doing, whether it is profitable, or whether to tune filters.
---
# Paper review

1. `npx tsx scripts/paper-report.ts` → per profile: win rate, avg win/loss, **expectancy per trade after costs**, profit factor, exit reasons, Jev Brier vs base rate.
2. Scanner funnel: `cat /opt/pumpbot/state/heartbeat.json` → `checked → passedMarket → candidates` and the `fails` histogram (which rule rejects most).
3. Read `strict` vs `research`: if `research` makes money after costs and `strict` rejects those trades, consider ONE filter change, written down before the next run (pre-registered). Never tune on the same data you judge with.

## Go-live gates (all required; may never be met)
- ≥ 100 closed paper trades or ≥ 4 weeks, whichever is later.
- Positive expectancy after pessimistic costs; profit factor ≥ 1.3; max drawdown ≤ 15%.
- Rug-exit triggers fired correctly in the ledger.
- If Jev is used for gating: Brier beats the base rate on ≥ 100 decisions.
- Explicit written approval from the owner.

## Honesty
Paper fills use DexScreener marks plus fixed costs (1% fee + 3% slippage per side); real fills on thin pools are usually worse, so paper results are an upper bound. Small samples (< 30 trades) prove nothing; say so.
