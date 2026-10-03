#!/usr/bin/env bash
# No-root launcher: starts the bot and the dashboard in a detached tmux session "gmgn" (idempotent).
# Reboot survival: crontab -e  ->  @reboot /bin/bash -lc '~/simplifyr/trading/run.sh'
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
tmux has-session -t gmgn 2>/dev/null && { echo "already running: tmux attach -t gmgn"; exit 0; }
mkdir -p logs
tmux new-session -d -s gmgn "while true; do node trading/bot.mjs 2>&1 | tee -a logs/bot.log; echo 'bot exited, restart in 10s'; sleep 10; done"
tmux new-window -t gmgn -n dash "node trading/dashboard.mjs 2>&1 | tee -a logs/dash.log"
echo "started: tmux attach -t gmgn   (detach: Ctrl-b d)"
