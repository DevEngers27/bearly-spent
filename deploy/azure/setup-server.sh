#!/usr/bin/env bash
# One-time (idempotent) setup of an Ubuntu 24.04 host for MoneyQuest.
# Run as a sudo-capable user:  bash setup-server.sh <public-hostname>
# Installs Node 22, Caddy (automatic HTTPS), a system user, directories and a systemd unit.
set -euo pipefail
HOST="${1:?usage: setup-server.sh <public-hostname>}"
APP_DIR=/opt/moneyquest
DATA_DIR=/var/lib/moneyquest
ENV_FILE=/etc/moneyquest.env

if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update && sudo apt-get install -y caddy
fi
sudo apt-get install -y rsync >/dev/null

id -u moneyquest >/dev/null 2>&1 || sudo useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin moneyquest
sudo mkdir -p "$APP_DIR" "$DATA_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"          # rsync target owned by the deploying user
sudo chown moneyquest:moneyquest "$DATA_DIR" && sudo chmod 700 "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  sudo tee "$ENV_FILE" >/dev/null <<ENV
NODE_ENV=production
PORT=8787
MQ_DATA_DIR=$DATA_DIR
MQ_DEMO=1
ADVENTURE_SECONDS=60
# Optional integrations — fill in and run: sudo systemctl restart moneyquest
ANTHROPIC_API_KEY=
BUDDY_MODEL=claude-opus-5-5
BUDDY_GUARD_MODEL=claude-haiku-5-5
CARTESIA_API_KEY=
NESSIE_API_KEY=
ENV
  sudo chmod 600 "$ENV_FILE"
fi

sudo tee /etc/systemd/system/moneyquest.service >/dev/null <<UNIT
[Unit]
Description=MoneyQuest API and web app
After=network.target

[Service]
Type=simple
User=moneyquest
Group=moneyquest
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$HOST {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787 {
		flush_interval -1
	}
}
CADDY

sudo systemctl daemon-reload
sudo systemctl enable moneyquest >/dev/null
sudo systemctl enable --now caddy >/dev/null
sudo systemctl reload caddy || sudo systemctl restart caddy
echo "setup done for https://$HOST (service starts after the first deploy)"
