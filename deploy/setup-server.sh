#!/usr/bin/env bash
# One-time hardening for a fresh Ubuntu 24.04 VPS. Run as root:
#   bash setup-server.sh <new-username> "<ssh-public-key>"
# SAFETY: password login is only disabled after your key is installed and sshd config validates.
# Keep your root session open and test a NEW login as the new user BEFORE closing it.
set -euo pipefail
USER_NAME="${1:?usage: setup-server.sh <username> \"<ssh public key>\"}"
PUBKEY="${2:?provide your SSH public key (starts with ssh-ed25519 or ssh-rsa)}"
case "$PUBKEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;; *) echo "That does not look like a public key"; exit 1;; esac
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y ufw unattended-upgrades docker.io docker-compose-v2 python3 curl ca-certificates

id "$USER_NAME" &>/dev/null || adduser --disabled-password --gecos "" "$USER_NAME"
usermod -aG docker "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
grep -qxF "$PUBKEY" "/home/$USER_NAME/.ssh/authorized_keys" 2>/dev/null || echo "$PUBKEY" >> "/home/$USER_NAME/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"; chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"
[ -s "/home/$USER_NAME/.ssh/authorized_keys" ] || { echo "authorized_keys empty; refusing to disable passwords"; exit 1; }

cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
CONF
sshd -t && systemctl reload ssh

ufw default deny incoming; ufw default allow outgoing; ufw allow 22/tcp; ufw --force enable

install -d -m 750 /etc/pumpbot /opt/pumpbot /opt/pumpbot/state /var/lib/pumpbot
chown -R "$USER_NAME:$USER_NAME" /opt/pumpbot
# Docker's UID for the container user is 1000 (node); make the state dir writable for it
chown 1000:1000 /opt/pumpbot/state
[ -f /etc/pumpbot/env ] || { cp "$(dirname "$0")/env.example" /etc/pumpbot/env; }
chmod 600 /etc/pumpbot/env; chown root:root /etc/pumpbot/env

systemctl enable --now docker
echo "Done. NEXT: (1) from another terminal confirm: ssh $USER_NAME@<server-ip>   (2) only then close the root session."
echo "(3) Edit /etc/pumpbot/env as root. (4) Clone the repo into /opt/pumpbot, then: docker compose up -d --build"
echo "(5) Enable the watchdog: cp /opt/pumpbot/deploy/pumpbot-watchdog.{service,timer} /etc/systemd/system/ && chmod +x /opt/pumpbot/deploy/watchdog.sh && systemctl enable --now pumpbot-watchdog.timer"
