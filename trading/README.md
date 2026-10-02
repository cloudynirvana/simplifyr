# Trading workflow: eyes, brain, hands

Idea (from @laoyingkhq): memecoins are lost by noticing a pump late. Watch *people*, not charts:
**catch capital moves -> vet the wallets -> set alerts -> enter before retail.**
(The tweet also pushes referral links for RH Trenches, FOMO Pulse, Hoodwatch; only GMGN is used here.)

| Role | Piece | Status |
|---|---|---|
| Eyes | GMGN skills (`trading/skills/*`, CLI `gmgn-cli`) + `research.mjs` (smart-money/KOL cluster + security vet) | working, read-only |
| Brain | Claude using skills: `gmgn-wallet-score`, `gmgn-token-buy`, `gmgn-contract-dd`, `gmgn-holder-analysis`; flows in `trading/docs/` | working |
| Hands | `hands.mjs`: paper by default, size cap, log; "jev" executor stub | live NOT wired |

Run: `node trading/research.mjs sol` (env `MIN_CLUSTER`, `WINDOW_S`), `node trading/hands.mjs buy <mint> <usd>`.
Keys live in gitignored `.env.local` (`GMGN_API_KEY`). Live needs `LIVE_TRADING=1`, `--confirm`, `MAX_ORDER_USD` cap.
To enable skills in Claude Code: `cp -r trading/skills/* .claude/skills/`.
Not financial advice; most memecoins go to zero.
