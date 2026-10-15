#!/usr/bin/env bash
# Downloads a whisper.cpp model for speech to text (PLAN.md 5.11) into ./models next to this script.
# Run in /opt/whiteboard:
#
#   ./download-whisper-model.sh              # small-q5_1 (about 190 MB, better German)
#   ./download-whisper-model.sh base-q5_1    # smaller and faster, weaker on German
#
# Afterwards set WHISPER_MODEL=<name> in .env (default small-q5_1). Existing files are kept.
set -euo pipefail

cd "$(dirname "$0")"
MODEL="${1:-small-q5_1}"
if [[ ! "${MODEL}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Ungültiger Modellname: ${MODEL}" >&2
  exit 1
fi
FILE="models/ggml-${MODEL}.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin"

mkdir -p models
if [ -s "${FILE}" ]; then
  echo "Schon vorhanden: ${FILE} ($(du -h "${FILE}" | cut -f1))"
  exit 0
fi

echo "Lade ${URL}"
curl -fL --retry 3 --progress-bar -o "${FILE}.part" "${URL}"
# A failed download often leaves a small HTML/error file; real models are at least 50 MB.
if [ "$(stat -c %s "${FILE}.part")" -lt 50000000 ]; then
  echo "Download zu klein – abgebrochen." >&2
  rm -f "${FILE}.part"
  exit 1
fi
mv "${FILE}.part" "${FILE}"
echo "Fertig: ${FILE} ($(du -h "${FILE}" | cut -f1)). WHISPER_MODEL=${MODEL} in .env setzen, falls nicht small-q5_1."
