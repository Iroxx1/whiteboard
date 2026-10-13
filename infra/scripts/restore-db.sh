#!/usr/bin/env bash
# Restores the database from a backup (docs/BETRIEB.md, "Datenbank wiederherstellen").
# Run in /opt/whiteboard as root:
#
#   ./restore-db.sh data/backups/db-2026-10-13.sqlite
#
# Stops the app, moves the current database aside (nothing is deleted), copies the backup in place,
# checks it and starts the app again.
set -euo pipefail

cd "$(dirname "$0")"
SOURCE="${1:-}"

if [ -z "${SOURCE}" ] || [ ! -f "${SOURCE}" ]; then
  echo "Aufruf: $0 <Sicherungsdatei>" >&2
  echo "Vorhandene Sicherungen:" >&2
  ls -1t data/backups/*.sqlite 2>/dev/null | head -20 >&2 || echo "  (keine)" >&2
  exit 1
fi
if [ "$(head -c 15 "${SOURCE}")" != "SQLite format 3" ]; then
  echo "${SOURCE} ist keine SQLite-Datenbank." >&2
  exit 1
fi

aside="data/db-vorher-$(date +%Y%m%d-%H%M%S)"
echo "App stoppen …"
docker compose stop app

mkdir -p "${aside}"
if compgen -G "data/db/whiteboard.sqlite*" >/dev/null; then
  mv data/db/whiteboard.sqlite* "${aside}/"
  echo "Bisherige Datenbank verschoben nach ${aside}/"
fi
mkdir -p data/db
cp "${SOURCE}" data/db/whiteboard.sqlite
chown -R 1000:1000 data/db

echo "App starten …"
docker compose up -d
for _ in $(seq 1 40); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || true)"
  [ "${status}" = "healthy" ] && break
  sleep 3
done
if [ "${status:-}" != "healthy" ]; then
  echo "Die App wurde nicht healthy – Log: docker compose logs --tail=100 app" >&2
  echo "Zurück zur vorherigen Datenbank: docker compose stop app && rm data/db/whiteboard.sqlite* && mv ${aside}/whiteboard.sqlite* data/db/ && docker compose up -d" >&2
  exit 1
fi
echo "Wiederhergestellt aus ${SOURCE}. Die vorherige Datenbank liegt in ${aside}/."
