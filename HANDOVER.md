# Übergabe – weiter mit Phase 9 (Sprachnachrichten → Text)

Stand: 15.10.2026, `main` = `3dc9de6` (alles committet und gepusht). Phasen 0–8 sind fertig und auf CT 118 ausgerollt, Maik hat jede Phase am Handy abgenommen.

## So startest du

1. Lies `CLAUDE.md` (Projekt), `docs/PLAN.md` (verbindlich: Abschnitte 1, 2, 8), `docs/STATUS.md` (Fortschritt, Entscheidungen, Checklisten), `docs/SPIKES.md` und die Homelab-Regeln in `../CLAUDE.md`.
2. Für Phase 9: PLAN.md **5.11** und **Phase 9** (Abschnitt 9), dazu 7.2 (Compose-Skizze mit `whisper`) und 7.7 (RAM-Budget).
3. **Vor dem Bauen Klärungsfragen stellen** (`AskUserQuestion`) und die **Zuversicht in %** angeben – ausdrücklicher Wunsch von Maik.
4. Antworten an Maik auf **Deutsch**; Code, Kommentare und Commits auf Englisch.

## Arbeitsablauf pro Phase (so lief es bisher)

1. Klärungsfragen → bauen → `pnpm lint`, `pnpm typecheck` (prüft auch `e2e/`), `pnpm test`, `pnpm build`, `pnpm e2e`.
2. `docs/STATUS.md` ergänzen: Fortschrittstabelle, Abschnitt „Stand Phase N“, Entscheidungen, Checkliste „Phase N“; bei Bedarf `docs/SETUP.md`, `docs/BETRIEB.md`, `infra/compose/.env.example`.
3. Commit (Englisch, endet mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), `git push origin main`.
4. CI abwarten (kein `gh`; öffentliche API):
   ```bash
   S=$(git rev-parse HEAD); curl -s "https://api.github.com/repos/Iroxx1/whiteboard/actions/runs?head_sha=$S"
   ```
   Fehlerdetails ohne Login nur über Annotations: `…/commits/$S/check-runs` → `output.annotations_url` (Vitest meldet Fehler dort seit Phase 8). Image-Tag = `sha-<7 Zeichen>` des Commits.
5. Zusammenfassung an Maik mit „Was du tun musst“ und Frage „Soll ich ausrollen?“ – **ausrollen nur nach seinem Ja**.

## Ausrollen auf CT 118 (Homelab-Regeln)

- Zugang: `ssh proxmox "sudo pct exec 118 -- …"`, App in `/opt/whiteboard` (Docker Compose, Container `whiteboard-app-1`).
- Vorher Ist-Zustand prüfen; jede verändernde Aktion **einzeln und sichtbar** ausführen.
- `.env` vor Änderungen sichern: `cp -p .env .env.bak-JJJJMMTT-HHMM`; Werte mit `sed -i` ändern. **Geheimnisse nie im Chat ausgeben** (Tokens per Pipe aus Dateien, Anzeige nur mit `sed` maskiert).
- Update: `cd /opt/whiteboard && ./update.sh sha-xxxxxxx` (sichert `.env` selbst, wartet auf healthy, behält 3 Images). Migrationen laufen beim Start mit automatischer DB-Sicherung.
- Prüfen: `docker compose ps`, `curl -s http://127.0.0.1:3000/healthz`, `curl https://board.dittgen.uk/healthz`, Log (`docker compose logs --since 3m app`), Telegram-Bot pollt.
- Änderungsprotokoll: Text als Scratchpad-Datei schreiben und anhängen mit `ssh proxmox "sudo tee -a /root/claude-changes.md >/dev/null" < datei` (Datum, Ursache, Änderung, Test, Rollback).
- Danach: `docs/STATUS.md` (Tag eintragen, Checkliste abhaken) und die CT-118-Zeile in `../CLAUDE.md` aktualisieren, committen, pushen.
- Aktuell: `WB_IMAGE_TAG=sha-a89ac34`, `OCR_ENABLED=true`, `TRANSCRIBE_ENABLED=false`. Rollback-Kandidat: `sha-ebc9e5c`.
- CT 118: 2 Kerne, **3072 MB RAM**, 20 GB Disk (16 % belegt), Docker 29. App `mem_limit: 1g`.

## Phase 9 – was zu bauen ist (PLAN.md 5.11)

- **Whisper-Container** `whisper` (whisper.cpp-Server) im Compose, Profil `transcription`, nur internes Netz, `mem_limit: 1500m`, `cpus: 2`. Image `ghcr.io/ggml-org/whisper.cpp:main` → **auf Version/Digest pinnen**, Binary-Pfad und Optionen im Image prüfen (`whisper-server --host 0.0.0.0 --port 8080 -m /models/ggml-small-q5_1.bin -l de -t 2 --convert`), optional VAD testen.
- **`infra/scripts/download-whisper-model.sh`** lädt das Modell nach `/opt/whiteboard/models` (`small-q5_1` ≈ 190 MB; Alternative `base-q5_1`). In `setup-vm.sh` mit herunterladen lassen bzw. dokumentieren.
- **Job `transcribe_audio`** nach `process_audio` (und für Videos? → Klärungsfrage): `POST` multipart an `WHISPER_URL` (`/inference`, `response_format=json`, `temperature=0`), Timeout 10 × Dauer + 60 s, Parallelität 1 (heavy). Ergebnis → `item_texts(kind='transcript')` via `items.setText(…)` (Kind-Typ dort erweitern), Index und Live-Update laufen dann automatisch.
- **Konfig:** `TRANSCRIBE_ENABLED`, `WHISPER_URL`, `WHISPER_MODEL` in `apps/server/src/config.ts` + `.env.example` (Vorbild: `OCR_ENABLED`).
- **Oberfläche:** Karte zeigt „Transkribiere …“ bzw. Transkript-Auszug (PLAN.md 4.7), Detailansicht „Transkript“ (Text-Label `de.details.texts.transcript` existiert schon).
- **Bestand:** vorhandene Audio-Einträge einmalig nachholen (Muster: `meta.ocrDone` + `items.withoutOcr()` in Phase 8 → analog `transcribed`).
- **`/healthz`** soll laut 7.7 Whisper-Erreichbarkeit prüfen, wenn aktiv; Systemseite (`SystemCard.tsx`) um Whisper-Status ergänzen.
- **Abnahme:** Telegram-Sprachnachricht und WhatsApp-Sprachnachricht (`.opus`) werden deutsch transkribiert; **Dauer auf dem Mini-PC messen** und in `docs/BETRIEB.md` eintragen.
- **Tests:** Job mit gemocktem Whisper-Endpunkt (lokaler HTTP-Server in Vitest, wie die Artikel-Seite in `test/search.test.ts`); echte Transkription nur auf dem Server messen.

### Mögliche Klärungsfragen für Maik

- Modell `small-q5_1` (besser, langsamer) oder `base-q5_1` (schneller)? RAM: CT 118 hat 3 GB, Whisper aktiv 600–900 MB – reicht laut Plan, ggf. RAM erhöhen?
- Auch Tonspuren von Videos transkribieren oder nur Audio?
- Bestand nachträglich transkribieren?
- Whisper ständig laufen lassen oder später auf einen stärkeren Rechner (`WHISPER_URL`) auslagern?

## Wichtige Erfahrungen aus Phase 0–8

- **Bundling:** Server wird mit esbuild gebündelt (`apps/server/scripts/build.mjs`). Pakete mit Laufzeit-Tricks **external** lassen (bisher: better-sqlite3, argon2, sharp, heic-convert, file-type, grammy, mailparser, mailauth). grammY hing gebündelt komplett – neue Bibliotheken nach dem Build mit `node apps/server/dist/index.js` kurz anstarten.
- **Datei-Edits:** Heredocs/`sed` in Bash verschlucken Backslashes in Regex (`\s`, `\+`, `\/`) – für Regex-Code das Edit/Write-Tool nehmen und danach prüfen.
- **Vitest-Zeitlimit** 5 s: langsame Tests (OCR, Whisper) brauchen `{ timeout: 60_000 }`.
- **E2E** `share.spec` war wacklig (Service Worker); seit Phase 5 mit Reload abgesichert. Bei einem einzelnen CI-Fehlschlag Annotations prüfen, ggf. leeren Commit neu anstoßen.
- **CSP** (Phase 6): neue externe Quellen (z. B. Embeds) in `apps/server/src/lib/securityHeaders.ts` freigeben; Verstöße stehen im Log als `csp violation`. Whisper läuft serverseitig, betrifft die CSP nicht.
- **Lokal testen:** `.claude/launch.json` → `whiteboard-prod` (nutzt `.env.local`, `DATA_DIR=data/phase6`); Testkonten nur lokal mit Zufallspasswort per `fetch('/api/auth/setup')` anlegen, Passwort nie ausgeben. Screenshots im Browser-Panel laufen oft in Timeouts → `get_page_text`/`find` nutzen.
- **Dateien** liegen im Repo-Ordner `C:\Users\Maik\proxmox-homelab\whiteboard`; pnpm über corepack, Node 24.
