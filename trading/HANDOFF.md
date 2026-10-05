# HANDOFF (state as of run 5) - read this first

## What is running
- Server 216.128.146.99, user `gmgn`, tmux session `bot`, repo copy in ~/simplifyr. Restarts on reboot via crontab `@reboot`.
- Paper bot: run 5, commit ac479ee, code hash 27fa618ba107 (see trading/VERSION). Real book $100 paper, shadow cohorts on.
- Live Desk (separate, owner-armed via ~/.config/gmgn/owner.env). Owner has accepted the risk of live trading before proof.
- Disarm live: remove the GMGN_ALLOW_AUTOMATED_TRADES line from owner.env, or `touch ~/STOP`. Kill everything: `tmux kill-server`.

## Live sync rules (non-negotiable)
- Live acts ONLY on paper entries with no `shadow` field (never shadow:* research cohorts).
- $73 book: $10/trade, max 2 open, -$15/day, -$22/week, hard stop at $55 equity, keep >= 0.03 SOL for fees.
- Exits on every buy (GMGN condition orders, buy_amount mode): loss_stop "35"/100, profit_stop "100"/33, profit_stop "300"/33,
  profit_stop_trace "100" drawdown "25"/34. Verify with `order strategy list --group-tag STMix`; missing -> sell.
- Bot-side exits also sell live: dev_sold, liquidity_pulled, smart_money_selling, sell_wave, stale.
- Keys never in chat/repo/logs. Profits above $73 are swept by the owner by hand; the bot never transfers out.

## Daily routine (5 minutes)
    cd ~/simplifyr
    node trading/stats.mjs          # equity, trades, byStrategy, byReason, counters (must be 0)
    node trading/tools/fate.mjs     # why signals did / didn't become trades
    node trading/analyze.mjs 1      # funnel + per-gate outcomes of rejects
    tail -50 logs/bot.log
Never change settings mid-run. One change per run: test (`bash trading/test/run.sh`), commit, update VERSION, reset.sh, restart.

## Findings so far
- Run 1-4: zero trades. Causes found and fixed: too-new tokens banned at birth (now deferred), wrong universe (trending source added),
  in-progress candle read as 'dead' (fixed run 5, plus 3-reading confirmation).
- Main remaining problem: the bot finds coins LATE. 9/13 'dead' signals were genuinely dead at signal time (median -37% after 1h).

## Next change (run 6 candidate) - only after run 5 has ~12h of data
"Catch them earlier", as ONE env-configurable change:
- trending source: `--interval 5m`, order by swaps or change5m, `--max-created 2h` (keep min 15m), `--min-price-change-percent 0`.
- smart-money cluster window: 15 min instead of 60 (`now - t.timestamp > 900`).
- Gates and exits unchanged. Judge with fate.mjs (signals that reach entry) and stats (closed trades), not with feelings.
Then run the replay: `GMGN_TIER=plus COST_PCT=5 node trading/backtest.mjs 3000` (and COST_PCT=8) to rank entry rules.

## Pass bar before scaling live (pre-registered)
>= 30 closed trades, avg after costs > 0 (also with costs doubled and without the best trade), PF >= 1.3, live within 10 points of paper.
Edge first, then size. GMGN paid plan ends ~4 weeks after purchase; the bot keeps working on the free tier (GMGN_TIER=free).

## Docs map
ENGINEERING.md (gotchas, security, live checklist) - CALIBRATION.md (risk policy, method) - MEMECOIN.md (market model)
PAPER.md (protocol) - DEPLOY.md (setup) - test/run.sh (28 offline tests)
