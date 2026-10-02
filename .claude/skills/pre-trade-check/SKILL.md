---
name: pre-trade-check
description: Run the live pre-trade gate on one Solana token (GO / NO_TRADE / HALT with size and exit plan), or check go-live readiness of the paper record. Use before any live buy, when asked whether a token is tradeable live, or whether the system is ready for real money.
---
# Pre-trade check (gate for live trading)

- Full contract: `docs/LIVE-TRADER-HANDOFF.md`. Code: `src/trading/tradeGate.ts` (rules), `scripts/trade-check.ts` (CLI).
- Readiness only: `npx tsx scripts/trade-check.ts --readiness --profile <base|wide|trail|copy>`.
- One token: `npx tsx scripts/trade-check.ts <mint> --from <PUBLIC wallet address>` (the address is only used for a read-only quote).
- Act only on `"verdict": "GO"`, before `validUntil`, with exactly `order.sizeUsd`, `order.slippagePct` and `order.exits`. NO_TRADE = skip. HALT = stop all trading and tell the owner the reasons.
- Never edit thresholds, the approval file or the kill switch to get a GO. Never ask for, read or print private keys or seed phrases.
