---
name: paper-trading-ops
description: Operate and check the memecoin scanner and paper-trading simulator on the VPS (status, logs, heartbeat, restart, update). Use when asked whether the bot is running, to deploy an update, or to start/stop a paper run.
---
# Paper-trading operations (VPS: /opt/pumpbot, user deploy)

Hard rules (never relax): paper only; `TRADING_MODE=live` stays unimplemented; never print, log, commit or ask for secrets (`/etc/pumpbot/env`, `~/.config/gmgn/`); never put a funded wallet key on this machine; do not install third-party tools or connectors; report failures honestly.

## Status
- `cd /opt/pumpbot && docker compose ps` should show `healthy`.
- `cat /opt/pumpbot/state/heartbeat.json`: `at` within ~60 s; `lastEventAt` recent (feed alive); `checked`, `passedMarket`, `candidates`, `fails` histogram; `tradeFeed: "not-used"` is expected.
- `docker compose logs --tail 30 scanner` shows a 5-minute summary line `created … checked … fails {…}`.
- Watchdog: `systemctl status pumpbot-watchdog.timer`; alerts only on state change (needs TELEGRAM_* in /etc/pumpbot/env).

## Update / restart
- `git pull && docker compose up -d --build` (state in /opt/pumpbot/state survives).
- After a kernel update: `sudo reboot`; the container restarts by itself (`restart: unless-stopped`).

## Paper simulation (live data, no orders)
- `npx tsx scripts/paper-sim.ts --minutes 60 --size 15` (needs Node + `npm i` in /opt/pumpbot, or run inside the container).
- Profiles: `strict` = production filters; `research` = relaxed screen + hard RugCheck vetoes only (measures what strict rejects).
- Ledger: `.trading-state/paper/ledger.jsonl`. Evaluate with the `paper-review` skill.
