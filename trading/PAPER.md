# Paper-trading protocol

Goal: find out, with fake money, whether this filter has an edge *after* real-world friction, before any live key exists.
Paper trading is always optimistic. Everything below exists to shrink that gap, and to judge results with a haircut.

## What the paper engine simulates (`paper.mjs`)
Fills are priced from a **real executable Jupiter quote for your exact size**, fetched after the simulated latency (`src: "jupiter"` in the journal).
It includes the AMM fee and price impact. If no route exists (pool pulled, can't sell), the fill fails, as it would live.
On top: platform fee, tip, and random tx failures. (GMGN's own `order quote` needs a wallet private key, so it is not used.)

**Reality check:** a $10 buy followed by an immediate sell on a live token returned $8.53, about 15% friction before any price move.
At small sizes the fixed tip dominates. Paper-trade at the size you'd really use live, and set `TIP_USD` to your real priority fee.

Older model-based settings (fallback with `QUOTE_SOURCE=model`):
| Friction | Default | Env |
|---|---|---|
| Latency: price is re-fetched after your "tx lands" | 8 s | `LATENCY_S` |
| Slippage: base + constant-product pool impact (2 x size / liquidity) | 1% + impact | `BASE_SLIP_PCT` |
| Platform fee per side + priority tip | 1% + $0.50 | `FEE_PCT`, `TIP_USD` |
| Failed transactions (buys are missed, sells retry next cycle) | 5% | `FAIL_RATE` |
| Position size (same as you'll use live) | $10 | `ORDER_USD` |
| Risk limits: max open positions, daily loss halt | 5, $30 | `MAX_OPEN`, `DAILY_LOSS_USD` |

NOT simulated (so real results will be worse): sandwich/MEV attacks, RPC outages, honeypots that only block *your* sell,
price moving between your polls (stops are checked every `POLL_S`=60 s; a dump inside a minute is filled at the later price).

## Phases (do not skip; do not shorten because early results look good)
1. **Day 0, setup (1h):** deploy per `DEPLOY.md`, set Telegram vars, open the dashboard (below). Run `node trading/bot.mjs --once` and confirm no errors.
2. **Days 1-3, smoke test:** goal is *no bugs*, not profit. Check: every WATCH/BUY/SELL appears in Telegram and `journal.jsonl`; positions close; `state.json` survives a `systemctl restart gmgn-bot`.
3. **Weeks 1-3, evidence:** change NOTHING. Tweaking filters mid-test destroys the sample. Note ideas in a file instead.
4. **Review (end of week 3 or 50 closed trades, whichever is LATER).** If the filter is so strict it produces <50 trades in 3 weeks, keep running; do not loosen it yet.
5. **One change at a time:** use `reject_followup` data to adjust a single gate, then restart the count for that version.
6. **Live pilot** only if the pass criteria hold; see below.

## Watching it live
- Telegram: WATCH, BUY, SELL, CLOSED, MISSED, SELL FAILED, daily-halt messages.
- Dashboard: `node trading/dashboard.mjs` (add a second systemd unit or run in `tmux`). It binds to localhost only, no auth. From your laptop:
  `ssh -L 8787:127.0.0.1:8787 user@your-vps` then open http://localhost:8787 (refreshes every 15 s).
- Report: `node trading/stats.mjs`. Raw data: `trading/journal.jsonl` (one JSON per line; import into a spreadsheet if you like).
- Logs: `journalctl -u gmgn-bot -f`.

## Metrics and how to read them
- `trades` (closed round trips): below ~30 is noise. Win rate alone means nothing, memecoins can win 30% and still profit.
- `expectancyUsd` and `profitFactor`: average profit per trade; gross wins / gross losses.
- `maxDrawdownUsd`: the worst losing streak you'd have had to stomach, relative to your bankroll.
- `pnlIfCostsDoubledUsd`: stress test, profit if friction were twice as bad as simulated. This is your honesty check.
- `byReason`: which exits make/lose money (`dev_sold`, `stop_-35%`, `tp1_2x`, `trail_-25%`).
- `missRate`, `avgSlipPct`: execution realism. Compare to real fills at the live pilot and recalibrate.
- `rejectedFollowup`: for tokens the filter *rejected*: `dumped50` high = the filter is saving you from rugs (good). `pumped2x` high = it is too strict and leaving money behind. Needs 50+ samples per bucket to mean anything.

## Pass criteria for a live pilot (all must hold)
- >= 100 closed trades (50 is the absolute floor) over >= 3 weeks, spanning quiet and busy days. The filter is strict, so this may take longer: extend the run, don't loosen gates to hit the count.
- Fills from real quotes (`src: jupiter`), not the model fallback.
- `expectancyUsd` > 0 AND `pnlIfCostsDoubledUsd` > 0 AND `profitFactor` >= 1.5.
- Profit not dominated by one trade (remove the best trade; expectancy should still be >= 0).
- `maxDrawdownUsd` is less than 30% of the money you'd put in.
- No unexplained bugs, journal matches Telegram, restarts are clean.
If it fails: that is a successful test. It just saved you real money. Adjust one gate and re-run.

## Live pilot (separate decision, after a code change + review: live is hard-disabled today)
Start with the smallest size (e.g. $5), the same filter, `MAX_OPEN=2`, a daily loss cap you can truly afford. Run paper and live
side by side for a week and compare fills; recalibrate `paper.mjs` to the real slippage/latency/fail rate. Only then scale up.

## Two strategies, one journal
- **cluster**: >=3 smart-money/KOL wallets buy the same token -> gates -> watchlist -> enter on a 15% pullback.
- **mirror**: copy fresh buys (<=120 s old, `MIRROR_MAX_LAG_S`) of *vetted* wallets, same gates minus smart-wallet count and with a 5-minute minimum age; no pullback wait. Exit when the source wallet sells, plus the same stop / take-profit / trail / dev-sold rules.
`stats.mjs` splits results under `byStrategy`, so you can see which one has an edge. `mirrorCopyLagPctAvg` = how much worse your fill is than the wallet's own price. If that is large, the wallet is not copyable, however good its record.

### Wallet research (eyes for mirroring)
    node trading/wallets.mjs discover      # pulls active wallets from smart-money/KOL feeds, vets each one
    node trading/wallets.mjs vet <addr>    # vet one wallet
    node trading/wallets.mjs add <addr>    # vet + save (only wallets that PASS are mirrored)
    node trading/wallets.mjs list
Vetting (30d stats): win rate >= 45%, realized profit >= $50 and ROI >= 5%, <= 20 tokens created (not a dev), 15-600 buys (not a bot), no `arbitrager`/`sniper`/`bundler` tag (`EXCLUDE_TAGS`).
In the first discovery run, 1 of 20 wallets passed. Re-run `discover` weekly; wallets drift. Use the `gmgn-wallet-score` skill for a deeper look before trusting a wallet.

## Telegram
1. In Telegram, message @BotFather, send `/newbot`, copy the token.
2. Put `TELEGRAM_BOT_TOKEN=...` in `.env.local` on the VPS, send your new bot any message, then run `node trading/telegram.mjs chatid` and add the printed `TELEGRAM_CHAT_ID=...` too.
3. `node trading/telegram.mjs` sends a test message. The bot also sends a daily summary.

## Jev (TypeSafe) as the brain, shadow mode first
Jev is a decision model, not an execution API: it returns probabilities (rug within 24h, enter/wait/skip), never trades.
Every candidate that passes the hard gates is scored and the verdict is stored on the position. `stats.mjs` -> `byJev`
groups closed trades by Jev's verdict. Only if trades Jev said `skip` (or `+rugHigh`) clearly lose more than the rest, over
a meaningful sample, switch to `JEV_MODE=veto` (and that starts a new evaluation version). Cost is ~550 tokens/call, about $0.00002.

## Bankroll, resets, rate limits
- `BANKROLL_USD` (default 100): virtual cash = bankroll + realized PnL - capital in open positions; no new buy if cash < `ORDER_USD`.
  `stats.mjs` reports `equityUsd`, `returnPct`, `maxDrawdownPctOfBankroll`; the daily Telegram summary leads with equity.
  Suggested for $100: `ORDER_USD=10 MAX_OPEN=3 DAILY_LOSS_USD=20`.
- `TIP_USD` default is now 0.15 (measured: `gmgn-cli gas-price --chain sol` auto ~0.0009 SOL, MEV-protected 0.001 SOL).
- Every start journals a `start` event with a code hash + result-affecting settings (also sent to Telegram). Only compare runs with the same hash and settings.
- Fresh run: stop the bot, `trading/reset.sh` (ARCHIVES journal + state to `trading/archive/<time>/`, never deletes), `trading/run.sh`.
  Every reset starts a new evaluation: don't add numbers across runs that used different settings.
- GMGN rate limits are per account. Use the key on ONE machine only. After a 429 the bot pauses for the stated reset time
  (hammering extends the ban), re-uses reads cached for 20 s, and manages open positions before scanning so exits come first.
