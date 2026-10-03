# Trading workflow: eyes, brain, hands

Idea (from @laoyingkhq): memecoins are lost by noticing a pump late. Watch *people*, not charts:
**catch capital moves -> vet the wallets -> set alerts -> enter before retail.**
(The tweet also pushes referral links for RH Trenches, FOMO Pulse, Hoodwatch; only GMGN is used here.)

| Role | Piece | Status |
|---|---|---|
| Eyes | GMGN (`gmgn-cli`, skills in `trading/skills/`): smart-money/KOL flows, token + wallet data | working, read-only |
| Filter | `filter.mjs` hard gates (safety, dev rug/nuke, holder quality, liquidity/age) + wallet vetting (`wallets.mjs`) | working |
| Brain | TypeSafe **Jev** (`jev.mjs`): typed rug probability + enter/wait/skip verdict per candidate | working, shadow mode |
| Hands | Paper fills from real Jupiter quotes (`paper.mjs`); live hard-disabled in `hands.mjs` | paper only |

Run: `node trading/research.mjs sol` (env `MIN_CLUSTER`, `WINDOW_S`), `node trading/hands.mjs buy <mint> <usd>`.
Keys live in gitignored `.env.local` (`GMGN_API_KEY`). Live needs `LIVE_TRADING=1`, `--confirm`, `MAX_ORDER_USD` cap.
To enable skills in Claude Code: `cp -r trading/skills/* .claude/skills/`.
Not financial advice; most memecoins go to zero.
