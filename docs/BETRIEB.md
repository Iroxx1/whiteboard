# Betrieb

Updates, Sicherungen, Wiederherstellung und Fehlersuche. Stand: Phase 1. Alle Befehle laufen im Container 118 (`pct enter 118`) im Ordner `/opt/whiteboard`.

## Was liegt wo?

| Pfad (auf CT 118) | Inhalt |
|---|---|
| `/opt/whiteboard/.env` | Einstellungen und Image-Version (`WB_IMAGE_TAG`) |
| `/opt/whiteboard/data/db/whiteboard.sqlite` (+ `-wal`, `-shm`) | Datenbank: Konten, Sitzungen, Boards, Verlauf |
| `/opt/whiteboard/data/files/board/` | Bilder auf den Boards |
| `/opt/whiteboard/data/backups/` | automatische Datenbank-Sicherungen vor Updates mit neuen Migrationen |

## Update

1. Neues Image-Tag nachsehen: GitHub → Iroxx1/whiteboard → Packages → `whiteboard` (Format `sha-1a2b3c4`). Das Image entsteht automatisch, wenn CI auf `main` grün ist.
2. `.env` sichern und das Tag eintragen:

   ```bash
   cp .env .env.bak-$(date +%Y%m%d-%H%M)
   sed -i 's/^WB_IMAGE_TAG=.*/WB_IMAGE_TAG=sha-1a2b3c4/' .env
   ```

3. Neues Image holen und starten:

   ```bash
   docker compose pull && docker compose up -d
   docker compose ps          # Status "healthy" abwarten
   docker compose logs --tail=50 app
   ```

Beim Start prüft die App, ob es neue Datenbank-Migrationen gibt. Falls ja, legt sie **vorher** eine Kopie der Datenbank in `data/backups/pre-migration-<Zeit>.sqlite` an.

**Zurück zur alten Version:** altes Tag in `.env` eintragen und `docker compose up -d`. Hat das neue Image die Datenbank migriert, zusätzlich die Datenbank aus `data/backups/pre-migration-…` zurückholen (siehe „Datenbank wiederherstellen“).

Beim Stoppen oder Neustarten (`docker compose up -d`, `restart`, `stop`) speichert die App alle offenen Boards, bevor sie sich beendet. Verloren gehen höchstens Änderungen, die in den letzten ~2 Sekunden noch unterwegs waren; offene Browser schicken sie nach dem Neuverbinden automatisch erneut.

## Sicherungen

- **Proxmox:** CT 118 ist im täglichen Backup-Job (03:00) enthalten. Damit sind Datenbank, Bilder und `.env` gesichert.
- **Verlauf pro Board:** Die App speichert automatisch Zwischenstände (alle 30 Minuten, wenn sich etwas geändert hat; Aufbewahrung: 48 h alle, dann einer pro Tag für 30 Tage, dann einer pro Woche für 6 Monate). Im Board: Menü ☰ → **Verlauf** → **Wiederherstellen** oder **Version jetzt speichern**.
- **Papierkorb:** Gelöschte Boards bleiben 30 Tage im Papierkorb (Board-Übersicht unten) und lassen sich wiederherstellen.
- Tägliche Datenbank-Abzüge innerhalb der App folgen in Phase 6.

## Datenbank wiederherstellen

1. App stoppen: `docker compose stop app`
2. Aktuelle Datenbank beiseitelegen:

   ```bash
   ALT=data/db-defekt-$(date +%Y%m%d-%H%M)
   mkdir -p "$ALT" && mv data/db/whiteboard.sqlite* "$ALT"/
   ```

3. Sicherung zurückkopieren (Beispiel: Sicherung vor einer Migration):

   ```bash
   cp data/backups/pre-migration-<Zeit>.sqlite data/db/whiteboard.sqlite
   chown 1000:1000 data/db/whiteboard.sqlite
   ```

4. Passendes Image-Tag in `.env` eintragen (bei einer Sicherung vor einer Migration: das alte Tag) und `docker compose up -d`.

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
| Bild erscheint bei anderen nicht | Upload fehlgeschlagen (rote Meldung im Board)? Erlaubt sind PNG, JPEG, GIF, WebP, BMP, AVIF, ICO und SVG bis `MAX_UPLOAD_MB` |

Logs enthalten keine Passwörter, Cookies oder Inhalte. Ausnahme ist der Einrichtungslink, solange es noch kein Konto gibt.
