---
name: token-due-diligence
description: Run the full filter stack (market screen + RugCheck insider/bundle/authority gate) on one Solana token mint and produce a pass/no-trade verdict with a manual trade sheet. Use when given a token or mint address to evaluate.
---
# Token due diligence

- `npx tsx scripts/trade-sheet.ts <mint> --size-usd 15 --capital <capital>` → "NO TRADE" with reasons, or a filled entry/exit sheet (slippage cap, stop −12%, TP ladder, time stop, abort triggers). `--demo` previews the format without gates.
- One-shot market scan: `npx tsx scripts/screen-dex.ts`.
- Interpretation: a clean RugCheck *score* is not a pass. Our gate also fails linked insider networks > 5% combined, near-identical wallet clusters (bundles), top holder > 5%, creator > 5%, LP lock < 90%, any authority not revoked.
- Behind an HTTPS proxy (dev sandbox) prefix commands with `NODE_USE_ENV_PROXY=1`.
- Never ask for or handle wallet keys; this skill never trades.
