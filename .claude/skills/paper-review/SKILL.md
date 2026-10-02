---
name: paper-review
description: Evaluate the GMGN research ledger and paper results (veto funnel, post-rejection outcomes, per-profile expectancy week by week, Jev calibration) against the pre-registered rules. Use when asked how the bot is doing, whether it is profitable, or whether to change filters or exits.
---
# Paper review (GMGN)

1. `npx tsx scripts/gmgn-research.ts /opt/pumpbot/state/gmgn-paper/ledger.jsonl` (or inside the container: `docker compose exec gmgn tsx scripts/gmgn-research.ts`).
2. Read in this order:
   - Screen histogram: which rules reject most tokens.
   - Outcomes at +60m/+240m by stage: rejected groups should do clearly worse than `entered`; if a reject group does better, that rule may be filtering winners (evidence for a pre-registered change, not an immediate edit).
   - Profiles `base` / `wide` / `trail` (same entries, different exits) and `copy` (LEDGER: smart money/KOL copy signals): expectancy after costs, profit factor, max drawdown, weekly P&L.
   - Copy funnel in the heartbeat `copy` block: wallets scored vs eligible, signals, vetoes ("already pumped vs copied wallets" means we would have been exit liquidity), entries, mirror exits.
   - Jev Brier vs base rate (log-only; Jev may gate entries only after it beats the base rate on ≥ 100 outcomes).
3. Decisions follow `docs/EXPERIMENTS.md`: never edit a running profile; add a new named, dated profile instead.

## "It works" means (all required)
≥ 100 closed trades; expectancy > 0 after costs; profit factor ≥ 1.3; max drawdown ≤ 15% of deployed; positive in ≥ 3 of 4 consecutive weeks; confirmed on a later period. Paper fills are an upper bound on live fills. Say plainly when the data is insufficient or negative.
