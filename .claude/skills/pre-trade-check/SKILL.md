---
name: pre-trade-check
description: Run the live pre-trade gate on one Solana token (GO / NO_TRADE / HALT with size, exits and the exact gmgn-cli buy command), or check go-live readiness of the paper record. Use before any live GMGN buy, when asked whether a token is tradeable live, or whether the system is ready for real money.
---
# Pre-trade check (gate for live trading on GMGN)

- Full contract: `docs/LIVE-TRADER-HANDOFF.md`. Rules: `src/trading/tradeGate.ts`. CLI: `scripts/trade-check.ts`.
- Readiness only: `npx tsx scripts/trade-check.ts --readiness --profile <base|wide|trail|copy>`.
- One token: `npx tsx scripts/trade-check.ts <mint> --from <PUBLIC wallet address>` (read key only; the address is used for a quote).
- `GO` → run the printed `gmgnCli` command verbatim before `validUntil`, then poll `gmgn-cli order get` and verify `strategy_order_id`. `NO_TRADE` → skip. `HALT` → stop, report reasons to the owner.
- Phase A (default): the owner runs the swap and types `yes`. Append `--yes` only in Phase B, which the owner enables in writing by setting `GMGN_ALLOW_AUTOMATED_TRADES=1`.
- Never edit thresholds, `APPROVED.json` or `KILL` to get a GO. Never read, print or ask for private keys or seed phrases.
