#!/usr/bin/env bash
# One command to finish a server that already ran setup-server.sh. Run as the deploy user from /opt/pumpbot:
#   cd /opt/pumpbot && git pull && bash deploy/finish.sh
# Idempotent. Fixes permissions, builds and starts the GMGN paper service, prints status. (No Telegram/watchdog.)
set -euo pipefail
cd /opt/pumpbot
sudo chgrp docker /etc/pumpbot && sudo chmod 750 /etc/pumpbot
sudo chgrp docker /etc/pumpbot/env && sudo chmod 640 /etc/pumpbot/env
sudo mkdir -p /opt/pumpbot/state && sudo chown 1000:1000 /opt/pumpbot/state && sudo chmod 755 /opt/pumpbot/state
docker compose up -d --build --remove-orphans   # removes the old PumpPortal scanner/paper containers
sudo systemctl disable --now pumpbot-watchdog.timer 2>/dev/null || true   # Telegram watchdog retired
echo "Waiting 60s for the first heartbeat..."; sleep 60
echo "--- containers:"; docker compose ps
echo "--- heartbeat:"; cat /opt/pumpbot/state/heartbeat.json 2>/dev/null || echo "(no heartbeat yet)"
echo; echo "--- last log lines:"; docker compose logs --tail 12 gmgn
echo; echo "Next: sudo reboot  (the scanner restarts by itself afterwards; kernel update pending)"
