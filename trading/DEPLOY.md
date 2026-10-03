# Run 24/7 on your VPS
1. Needs Node 20+ and IPv4 outbound (gmgn-cli does NOT work over IPv6).
2. `git clone <repo> /opt/simplifyr && cd /opt/simplifyr && git checkout ccr-052bfdf3-sraodn`
3. `npm install -g gmgn-cli`
4. Create `/opt/simplifyr/.env.local` (chmod 600): `GMGN_API_KEY=...`, optional `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ORDER_USD=10`. Do NOT set LIVE_TRADING.
5. Test: `node trading/bot.mjs --once`
6. `cp trading/gmgn-bot.service /etc/systemd/system/ && systemctl enable --now gmgn-bot`
7. Watch: `journalctl -u gmgn-bot -f`; state in `trading/state.json`, paper trades in `trading/trades.log.jsonl`.
Docker alternative: `docker build -f trading/Dockerfile -t gmgn-bot . && docker run -d --restart always --env-file .env.local gmgn-bot`
