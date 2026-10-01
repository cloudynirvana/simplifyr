#!/usr/bin/env bash
# One-time hardening for a fresh Ubuntu 24.04 VPS. Run as root:
#   bash setup-server.sh <new-username> "<ssh-public-key>"
# SAFETY: password login is only disabled after your key is installed and sshd config validates.
# Keep your root session open and test a NEW login as the new user BEFORE closing it.
set -euo pipefail
USER_NAME="${1:?usage: setup-server.sh <username> \"<ssh public key>\"|-   (use - if the user already has working key login)}"
PUBKEY="${2:--}"
if [ "$PUBKEY" != "-" ]; then
  case "$PUBKEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;; *) echo "That does not look like a public key"; exit 1;; esac
fi
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y ufw unattended-upgrades python3 curl ca-certificates git
# Only install Docker if it is not already present (an existing docker-ce would conflict with docker.io)
command -v docker >/dev/null 2>&1 || apt-get install -y docker.io docker-compose-v2

id "$USER_NAME" &>/dev/null || adduser --disabled-password --gecos "" "$USER_NAME"
usermod -aG docker "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
if [ "$PUBKEY" != "-" ]; then
  grep -qxF "$PUBKEY" "/home/$USER_NAME/.ssh/authorized_keys" 2>/dev/null || echo "$PUBKEY" >> "/home/$USER_NAME/.ssh/authorized_keys"
fi
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"; chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"
[ -s "/home/$USER_NAME/.ssh/authorized_keys" ] || { echo "authorized_keys empty; refusing to disable passwords"; exit 1; }

# sshd uses the FIRST value it reads and reads files in name order. Ubuntu/cloud-init ships 50-cloud-init.conf with
# "PasswordAuthentication yes", so our file must sort BEFORE it (00-), otherwise password login stays on.
rm -f /etc/ssh/sshd_config.d/99-hardening.conf
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
CONF
sshd -t && systemctl reload ssh
[ "$(sshd -T | awk '/^passwordauthentication /{print $2}')" = "no" ] || { echo "ERROR: password login is still enabled; check /etc/ssh/sshd_config.d/*"; exit 1; }

ufw default deny incoming; ufw default allow outgoing; ufw allow 22/tcp; ufw --force enable

install -d -m 750 /etc/pumpbot /opt/pumpbot /var/lib/pumpbot
install -d -m 755 /opt/pumpbot/state   # heartbeat/ledger are not secret; the deploy user must be able to read them
chown -R "$USER_NAME:$USER_NAME" /opt/pumpbot
# Docker's UID for the container user is 1000 (node); make the state dir writable for it
chown 1000:1000 /opt/pumpbot/state
[ -f /etc/pumpbot/env ] || { cp "$(dirname "$0")/env.example" /etc/pumpbot/env; }
# docker compose reads env_file as the invoking user, so the docker group needs read access (members are already root-equivalent).
# Nobody else can read it, and it is never in git.
chgrp docker /etc/pumpbot; chmod 750 /etc/pumpbot   # compose runs as a docker-group user and must traverse this dir
chown root:docker /etc/pumpbot/env; chmod 640 /etc/pumpbot/env

systemctl enable --now docker
echo "Done. NEXT: (1) from another terminal confirm: ssh $USER_NAME@<server-ip>   (2) only then close the root session."
echo "(3) Edit /etc/pumpbot/env as root. (4) Clone the repo into /opt/pumpbot, then: docker compose up -d --build"
echo "(5) Enable the watchdog: cp /opt/pumpbot/deploy/pumpbot-watchdog.{service,timer} /etc/systemd/system/ && chmod +x /opt/pumpbot/deploy/watchdog.sh && systemctl enable --now pumpbot-watchdog.timer"
