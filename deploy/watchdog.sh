#!/usr/bin/env bash
# Up/down monitor. Runs on the HOST every minute (systemd timer). Sends Telegram messages on state CHANGES only.
# It can only report status. There is no command channel and nothing here can trade.
set -u
ENV_FILE="${ENV_FILE:-/etc/pumpbot/env}"
HEARTBEAT="${HEARTBEAT:-/opt/pumpbot/state/heartbeat.json}"
STATE_FILE="${STATE_FILE:-/var/lib/pumpbot/watchdog.state}"
STALE_PROCESS_S="${STALE_PROCESS_S:-120}"   # heartbeat file age
STALE_FEED_S="${STALE_FEED_S:-300}"         # no PumpPortal events for this long
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
mkdir -p "$(dirname "$STATE_FILE")"

reason=$(python3 - "$HEARTBEAT" "$STALE_PROCESS_S" "$STALE_FEED_S" <<'PY'
import json, os, sys, time
path, sp, sf = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
if not os.path.exists(path): print("no heartbeat file"); sys.exit()
age = time.time() - os.path.getmtime(path)
if age > sp: print(f"process silent for {int(age)}s"); sys.exit()
try: hb = json.load(open(path))
except Exception: print("heartbeat unreadable"); sys.exit()
if hb.get("tradeFeed") == "denied": print("trade stream denied (PumpPortal API key missing/unfunded)"); sys.exit()
le = hb.get("lastEventAt", 0) / 1000
if le == 0 or time.time() - le > sf: print("feed stalled (no PumpPortal events)"); sys.exit()
print("")
PY
)

prev=$(cat "$STATE_FILE" 2>/dev/null || echo "unknown")
if [ -z "$reason" ]; then now="up"; else now="down"; fi

send() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || { echo "telegram not configured: $1"; return 0; }
  curl -sS -m 15 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" || true
}

if [ "$now" != "$prev" ]; then
  if [ "$now" = "down" ]; then send "DOWN: pumpbot scanner — ${reason}"; else send "UP: pumpbot scanner is healthy"; fi
  echo "$now" > "$STATE_FILE"
fi
