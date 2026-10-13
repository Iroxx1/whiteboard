#!/usr/bin/env bash
# Prepares a fresh Debian 13 machine (VM or LXC container with nesting=1) for the whiteboard
# (PLAN.md 7.1). Run as root. Idempotent: running it again changes nothing that is already set up.
#
#   curl -fsSL https://raw.githubusercontent.com/Iroxx1/whiteboard/main/infra/scripts/setup-vm.sh | bash
#
# What it does:
#   1. Debian updates, unattended security upgrades
#   2. Docker Engine + Compose plugin from Docker's repository, log rotation
#   3. /opt/whiteboard with docker-compose.yml, .env (from .env.example) and update.sh
# The .env still has to be filled in afterwards (see docs/SETUP.md, step 3).
set -euo pipefail

REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/Iroxx1/whiteboard/main}"
APP_DIR="${APP_DIR:-/opt/whiteboard}"

log() { printf '\n==> %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte als root ausführen." >&2
  exit 1
fi
. /etc/os-release
if [ "${ID:-}" != "debian" ]; then
  echo "Nur für Debian gedacht (gefunden: ${PRETTY_NAME:-unbekannt})." >&2
  exit 1
fi

log "Debian-Pakete aktualisieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q full-upgrade
apt-get install -y -q ca-certificates curl unattended-upgrades

log "Automatische Sicherheitsupdates einschalten"
# Default origins of unattended-upgrades on Debian: security updates only.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

if ! command -v docker >/dev/null 2>&1; then
  log "Docker installieren"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
else
  log "Docker ist schon installiert ($(docker --version))"
fi

if [ ! -f /etc/docker/daemon.json ]; then
  log "Log-Rotation für Docker einrichten"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
EOF
  systemctl restart docker
fi

log "Whiteboard-Ordner ${APP_DIR} vorbereiten"
mkdir -p "${APP_DIR}/data"
# The app runs as user "node" (UID 1000) inside its container.
chown 1000:1000 "${APP_DIR}/data"
curl -fsSL "${REPO_RAW}/infra/compose/docker-compose.yml" -o "${APP_DIR}/docker-compose.yml"
curl -fsSL "${REPO_RAW}/infra/scripts/update.sh" -o "${APP_DIR}/update.sh"
curl -fsSL "${REPO_RAW}/infra/scripts/restore-db.sh" -o "${APP_DIR}/restore-db.sh"
chmod 755 "${APP_DIR}/update.sh" "${APP_DIR}/restore-db.sh"
if [ ! -f "${APP_DIR}/.env" ]; then
  curl -fsSL "${REPO_RAW}/infra/compose/.env.example" -o "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
  NEW_ENV=1
fi

log "Fertig"
cat <<EOF
Nächste Schritte (docs/SETUP.md, Schritt 3):
  1. ${APP_DIR}/.env ausfüllen${NEW_ENV:+ (neu angelegt)}: WB_IMAGE_TAG, WB_BIND, PUBLIC_URL, TRUSTED_PROXIES
  2. cd ${APP_DIR} && docker compose pull && docker compose up -d
  3. Einrichtungslink: docker compose logs app | grep -o 'https://[^"]*/setup?token=[^"]*'
EOF
