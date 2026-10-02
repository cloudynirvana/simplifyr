---
name: paper-trading-ops
description: Operate the GMGN research + paper-trading service on the VPS (status, logs, heartbeat, restart, update). Use when asked whether the bot is running, to deploy an update, or to restart it.
---
# GMGN paper-trading operations (VPS: /opt/pumpbot, user deploy)

Hard rules (never relax): paper only; the GMGN key in /etc/pumpbot/env is READ-ONLY (trading disabled); never add GMGN_PRIVATE_KEY or GMGN_ALLOW_AUTOMATED_TRADES; never print, log, commit or ask for secrets (`/etc/pumpbot/env`, `~/.config/gmgn/`); no PumpPortal, no Telegram, no third-party connectors; report failures honestly.

## Status
- `cd /opt/pumpbot && docker compose ps` → service `gmgn` should be `healthy`.
- `cat /opt/pumpbot/state/heartbeat.json` → `source: "gmgn"`, `at` within ~60 s, funnel counts (`ranked`, `passedScreen`, `passedSecurity`, `passedHolders`, `entries`), `vetoes`, `markMiss`, `outcomes`, `errors`, and per-profile `summaries`.
- `docker compose logs --tail 40 gmgn` → fills and a periodic JSON summary.
- `markMiss` rising means GMGN token-info parsing failed: check the `{"type":"schema"...}` row in the ledger and fix `extractMark` in `src/trading/gmgnChecks.ts`.

## Update / restart
- `git pull && docker compose up -d --build --remove-orphans` (ledger in /opt/pumpbot/state survives).
- After a kernel update: `sudo reboot`; the container restarts by itself.
