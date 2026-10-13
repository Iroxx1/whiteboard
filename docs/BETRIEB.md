# Betrieb

Updates, Sicherungen, Wiederherstellung und Fehlersuche. Stand: Phase 6. Alle Befehle laufen im Container 118 (`pct enter 118`) im Ordner `/opt/whiteboard`.

## Was liegt wo?

| Pfad (auf CT 118) | Inhalt |
|---|---|
| `/opt/whiteboard/.env` | Einstellungen und Image-Version (`WB_IMAGE_TAG`) |
| `/opt/whiteboard/data/db/whiteboard.sqlite` (+ `-wal`, `-shm`) | Datenbank: Konten, Sitzungen, Boards, Verlauf |
| `/opt/whiteboard/data/files/board/` | Bilder, die direkt aufs Board gezogen oder eingefügt wurden |
| `/opt/whiteboard/data/files/items/<jahr>/<monat>/<id>/` | Inbox-Einträge: Original, Anzeige- und Vorschauversionen |
| `/opt/whiteboard/data/tmp/` | laufende Uploads und Verarbeitung (wird beim Start geleert) |
| `/opt/whiteboard/data/backups/` | tägliche Datenbank-Sicherungen `db-JJJJ-MM-TT.sqlite` (14 Tage) und Sicherungen vor Migrationen (die 5 neuesten) |
| `/opt/whiteboard/data/inbound/` | angenommene Rohmails (30 Tage) |
| `/opt/whiteboard/update.sh`, `restore-db.sh` | Update und Datenbank-Wiederherstellung (aus `infra/scripts/`) |

## Update

1. Neues Image-Tag nachsehen: GitHub → Iroxx1/whiteboard → Packages → `whiteboard` (Format `sha-1a2b3c4`). Das Image entsteht automatisch, wenn CI auf `main` grün ist.
2. Im Container:

   ```bash
   cd /opt/whiteboard
   ./update.sh sha-1a2b3c4
   ```

   Das Skript sichert die `.env` (`.env.bak-<Zeit>`), trägt das Tag ein, holt das Image, startet neu, wartet auf „healthy“ und entfernt alte Whiteboard-Images (die drei neuesten bleiben für ein schnelles Zurück).

Ohne Skript geht es auch von Hand: `.env` sichern, `WB_IMAGE_TAG` ändern, `docker compose pull && docker compose up -d`.

Beim Start prüft die App, ob es neue Datenbank-Migrationen gibt. Falls ja, legt sie **vorher** eine Kopie der Datenbank in `data/backups/pre-migration-<Zeit>.sqlite` an.

**Zurück zur alten Version:** `./update.sh <altes Tag>`. Hat das neue Image die Datenbank migriert, zusätzlich die Datenbank aus `data/backups/pre-migration-…` zurückholen (siehe „Datenbank wiederherstellen“).

Beim Stoppen oder Neustarten (`docker compose up -d`, `restart`, `stop`) speichert die App alle offenen Boards, bevor sie sich beendet. Verloren gehen höchstens Änderungen, die in den letzten ~2 Sekunden noch unterwegs waren; offene Browser schicken sie nach dem Neuverbinden automatisch erneut.

## Sicherungen

- **Täglich in der App (`backup_db`):** ab 03:30 (Zeitzone `TZ`) ein konsistenter Abzug der Datenbank nach `data/backups/db-JJJJ-MM-TT.sqlite`, 14 Tage aufbewahrt. War die App um 03:30 aus, holt sie den Abzug am selben Tag nach. In der Verwaltung → **System** stehen Zeitpunkt und Größe der letzten Sicherung; **Jetzt sichern** erneuert die heutige Sicherung (z. B. vor einer riskanten Änderung).
- **Vor Updates mit Migrationen:** automatisch `data/backups/pre-migration-<Zeit>.sqlite`; die fünf neuesten bleiben.
- **Proxmox:** CT 118 ist im täglichen Backup-Job (03:00, eine Sicherung) enthalten: Datenbank, alle Dateien, `.env`. Bewusst so belassen (Auftraggeber, 13.10.2026): Ältere Stände der Datenbank liefern die App-Sicherungen; die Dateien ändern sich nur durch Hinzufügen und Aufräumen.
- **Verlauf pro Board:** automatische Zwischenstände (alle 30 Minuten, wenn sich etwas geändert hat; 48 h alle, dann einer pro Tag für 30 Tage, dann einer pro Woche für 6 Monate). Im Board: Menü ☰ → **Verlauf**.
- **Papierkorb:** gelöschte Boards und Inbox-Einträge 30 Tage.
- **Aufräumen (automatisch):** Board-Bilder, die weder auf einem Board noch in einem Verlaufsstand vorkommen und älter als 30 Tage sind, löscht die App einmal pro Woche; Rohmails nach 30 Tagen.

## Datenbank wiederherstellen

Im Container:

```bash
cd /opt/whiteboard
./restore-db.sh                                   # zeigt die vorhandenen Sicherungen
./restore-db.sh data/backups/db-2026-10-13.sqlite
```

Das Skript stoppt die App, **verschiebt** die aktuelle Datenbank nach `data/db-vorher-<Zeit>/` (es wird nichts gelöscht), spielt die Sicherung ein und startet die App wieder.

- Bei einer Sicherung **vor einer Migration** vorher das alte Image-Tag eintragen (`./update.sh <altes Tag>`), sonst migriert die App die Datenbank beim Start erneut.
- Dateien (Bilder, Anhänge) liegen nicht in der Datenbank. Fehlen sie, aus dem Proxmox-Backup zurückholen: `pct restore` in einen **neuen** Container oder einzelne Ordner aus dem Backup-Archiv entpacken.
- Ganz ohne Skript: App stoppen, `data/db/whiteboard.sqlite*` beiseitelegen, Sicherung als `data/db/whiteboard.sqlite` kopieren, `chown 1000:1000`, starten.

Getestet am 14.10.2026 in einem Wegwerf-Container (siehe `docs/STATUS.md`, Phase 6).

## Überwachung

- **`/healthz`:** Datenbank erreichbar, `/data` beschreibbar und mehr als 10 % frei. Uptime Kuma kann diese Adresse prüfen.
- **Verwaltung → System:** Version, Inhalt, freier Speicher, letzte Sicherung, Verarbeitung (wartend, laufend, fehlgeschlagen mit **Erneut versuchen**), Telegram- und E-Mail-Status.
- **Speicherwarnung:** Admins sehen oben ein rotes Banner, wenn weniger als 15 % frei sind. Abhilfe: Papierkorb leeren (lassen) oder den Container vergrößern (`pct resize 118 rootfs +10G` auf dem Proxmox-Host).
- **CSP-Meldungen:** Blockiert die Content Security Policy etwas im Browser, steht im Log `csp violation` mit Art und Quelle: `docker compose logs app | grep "csp violation"`. Bekannt und harmlos: `script-src eval` beim Export als SVG (Excalidraw bettet dann die Schrift nicht ein, sondern verweist auf sie).

## Passwort-Link über die Kommandozeile

Für den Notfall, z. B. wenn der einzige Admin sein Passwort vergessen hat. Der Befehl gibt einen einmaligen Link aus (24 Stunden gültig); ein deaktiviertes Konto wird dabei wieder aktiviert.

```bash
docker compose exec app node apps/server/dist/cli.js reset-link <e-mail-adresse>
```

Den Link im Browser öffnen und ein neues Passwort setzen. Danach sind alle anderen Geräte dieses Kontos abgemeldet.

## Fehlersuche

| Problem | Prüfen |
|---|---|
| Seite lädt nicht | `docker compose ps` (Status `healthy`?), `curl -s http://127.0.0.1:3000/healthz` → `{"status":"ok"}`; im Cloudflare-Dashboard den Public Hostname prüfen |
| Im Board steht „Verbindung getrennt“ | WebSocket/Long Polling blockiert? Cache-Regel für `/socket.io/*` in Cloudflare prüfen; `docker compose logs app` |
| Login sagt „Zu viele Fehlversuche“ | Nach 5 Fehlversuchen pro IP und E-Mail wartet die App 1 Minute, danach jeweils doppelt so lange (höchstens 1 Stunde). Ein Neustart der App setzt das zurück |
| Einrichtungslink fehlt im Log | Es gibt schon ein Konto. Dann Anmelden oder Passwort-Link über die Kommandozeile |
| Eintrag bleibt bei „Wird verarbeitet …“ | Die Verarbeitung läuft im Hintergrund nacheinander (Bilder, PDFs und Videos einzeln). Fehlversuche werden nach 30 s, 5 min und 30 min wiederholt; danach steht „Verarbeitung fehlgeschlagen“. Ursache: `docker compose logs app | grep "job failed"` |
| Link-Karte ohne Bild/Titel | Manche Seiten (Instagram, Amazon …) blockieren Abrufe vom Server; dann gibt es eine einfache Karte mit Domain. Private Adressen im Heimnetz ruft die Vorschau absichtlich nie ab |
| Video lässt sich nicht abspielen | Das Format kann der Browser nicht abspielen (z. B. manche .mov/.3gp); über „Herunterladen“ öffnen |
| Telegram-Bot antwortet nicht | `docker compose logs app | grep telegram`: „token rejected“ = Token in der `.env` falsch (neu bei @BotFather mit `/token`); „not reachable“ = keine Verbindung zu Telegram, der Bot versucht es jede Minute neu. In den Einstellungen steht „nicht eingerichtet“, solange der Bot nicht verbunden ist |
| Bot sagt „Dieser Bot ist privat.“ | Das Telegram-Konto ist nicht (mehr) verknüpft: in der App unter Einstellungen neu verbinden |
| Mail kommt nicht in der Inbox an | `docker compose logs app | grep e-mail`: „e-mail rejected“ mit `reason`: `sender` = Absender nicht in den Einstellungen eingetragen, `dkim` = keine gültige Signatur der Absenderdomain (z. B. über einen Weiterleitungsdienst geschickt), `from` = kein eindeutiger Absender. Steht nichts im Log: Cloudflare → Email Routing → Activity log und Worker-Logs prüfen; liegt die Mail im Gmail-Postfach (Kopfzeile `X-Whiteboard-Ingest`), war der Server nicht erreichbar oder das Token falsch. Rohmails liegen 30 Tage unter `data/inbound/` |
| Bild erscheint bei anderen nicht | Upload fehlgeschlagen (rote Meldung im Board)? Erlaubt sind PNG, JPEG, GIF, WebP, BMP, AVIF, ICO und SVG bis `MAX_UPLOAD_MB` |

Logs enthalten keine Passwörter, Cookies oder Inhalte. Ausnahme ist der Einrichtungslink, solange es noch kein Konto gibt.
