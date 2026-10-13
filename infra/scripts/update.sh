#!/usr/bin/env bash
# Updates the whiteboard to an image tag (PLAN.md 7.5). Run in /opt/whiteboard as root:
#
#   ./update.sh sha-1a2b3c4
#
# Backs up .env, sets WB_IMAGE_TAG, pulls and starts the new image, waits until it is healthy and
# removes old whiteboard images except the three newest (for a quick rollback).
# Rollback: ./update.sh <old tag>  – after a database migration see docs/BETRIEB.md.
set -euo pipefail

cd "$(dirname "$0")"
TAG="${1:-}"
KEEP_IMAGES=3

if [[ ! "${TAG}" =~ ^(sha-[0-9a-f]{7}|latest)$ ]]; then
  echo "Aufruf: $0 sha-<7 Zeichen>   (Tags: GitHub → Iroxx1/whiteboard → Packages)" >&2
  exit 1
fi

current="$(sed -n 's/^WB_IMAGE_TAG=//p' .env)"
echo "Aktuell: ${current:-?}  →  neu: ${TAG}"

backup=".env.bak-$(date +%Y%m%d-%H%M)"
cp -p .env "${backup}"
echo "Gesichert: ${backup}"
sed -i "s/^WB_IMAGE_TAG=.*/WB_IMAGE_TAG=${TAG}/" .env

docker compose pull -q
docker compose up -d

echo -n "Warte auf Status healthy "
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || true)"
  if [ "${status}" = "healthy" ]; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 3
done
if [ "${status:-}" != "healthy" ]; then
  echo
  echo "Die App wurde nicht healthy. Log: docker compose logs --tail=100 app" >&2
  echo "Zurück: $0 ${current}" >&2
  exit 1
fi

# Old images of this app (newest first); the running one is never removed.
running="$(docker inspect --format '{{.Image}}' "$(docker compose ps -q app)")"
mapfile -t old < <(docker images ghcr.io/iroxx1/whiteboard --format '{{.ID}}' | awk '!seen[$0]++' | tail -n +$((KEEP_IMAGES + 1)))
for id in "${old[@]}"; do
  if [[ "${running}" != *"${id}"* ]]; then
    docker rmi "${id}" >/dev/null 2>&1 && echo "Altes Image entfernt: ${id}" || true
  fi
done

docker compose logs --tail=5 app
echo "Fertig: ${TAG}"
