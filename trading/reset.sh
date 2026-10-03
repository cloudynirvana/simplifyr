#!/usr/bin/env bash
# Start a fresh paper run WITHOUT destroying evidence: archives journal + state to archive/<timestamp>/.
# Stop the bot first (tmux kill-session -t gmgn), then run this, then trading/run.sh.
set -euo pipefail
cd "$(dirname "$0")"
d="archive/$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$d"
for f in journal.jsonl state.json; do [ -f "$f" ] && mv "$f" "$d/"; done
echo "archived to trading/$d; next run starts at BANKROLL_USD=${BANKROLL_USD:-100}"
