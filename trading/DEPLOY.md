# Deploy (VPS, no root)
Paper only. Live trading is hard-disabled in `hands.mjs` (`LIVE_ENABLED = false`), and no wallet private key is needed or wanted.

1. Node 22 + `gmgn-cli` installed for this user; IPv4 outbound (`curl -4 -s https://icanhazip.com`).
2. `git clone -b ccr-052bfdf3-sraodn https://github.com/cloudynirvana/simplifyr ~/simplifyr` (read-only token if the repo is private).
3. `~/simplifyr/.env.local`, `chmod 600`: `GMGN_API_KEY=...`, optional `TYPESAFE_API_KEY` (Jev scoring), later `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Optional: `ORDER_USD`, `TIP_USD`.
4. `cd ~/simplifyr && node trading/bot.mjs --once` (must finish without errors), `node trading/wallets.mjs discover`.
5. `trading/run.sh` starts the bot and dashboard in tmux; `crontab -e` and add `@reboot /bin/bash -lc '~/simplifyr/trading/run.sh'`.
6. Stats: `node trading/stats.mjs`. Dashboard: `ssh -L 8787:127.0.0.1:8787 gmgn@<server>` and open http://localhost:8787.

## What the code sends out (audit summary)
| Destination | What | When |
|---|---|---|
| `gmgn-cli` (GMGN API) | read-only queries: track, token info/security, portfolio stats/activity | every cycle |
| `lite-api.jup.ag` | quote + SOL price: token mints and amounts only, no wallet, no key | each paper fill |
| `api.typesafe.ai` | token snapshot (public on-chain stats) for Jev scoring; no wallet data | each candidate that passes the gates, if `TYPESAFE_API_KEY` is set |
| `api.telegram.org` | alert text | only if TELEGRAM vars are set |
| `127.0.0.1:8787` | dashboard, local only | if `dashboard.mjs` runs |
No code reads a wallet key or calls `swap`. Verify yourself: `grep -n "fetch(\|execFile\|listen(" trading/*.mjs`.
