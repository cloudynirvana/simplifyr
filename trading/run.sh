#!/usr/bin/env bash
# No-root launcher: starts the bot and the dashboard in a detached tmux session "bot" (idempotent).
# Reboot survival: crontab -e  ->  @reboot /bin/bash -lc '~/simplifyr/trading/run.sh'
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/node/bin:$HOME/.local/bin:$HOME/gmgn/node_modules/.bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
tmux has-session -t bot 2>/dev/null && { echo "already running: tmux attach -t bot"; exit 0; }
mkdir -p logs
tmux new-session -d -s bot "while true; do node trading/bot.mjs 2>&1 | tee -a logs/bot.log; echo 'bot exited, restart in 10s'; sleep 10; done"
tmux new-window -t bot -n dash "node trading/dashboard.mjs 2>&1 | tee -a logs/dash.log"
echo "started: tmux attach -t bot   (detach: Ctrl-b d)"
