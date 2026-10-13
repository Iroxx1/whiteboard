# Einrichtung

Schritt-für-Schritt-Anleitung für den Betrieb auf Proxmox. Stand: Phase 6. Dauer ohne Cloudflare-Schritte: etwa 15 Minuten.

> **Abweichung vom Plan (mit dem Auftraggeber entschieden, 12.10.2026):** Das Whiteboard läuft in einem **LXC-Container mit Docker** statt in einer eigenen VM, und es nutzt den **bestehenden Cloudflare-Tunnel** (Connector läuft in Home Assistant) statt eines eigenen `cloudflared`-Containers. Die Anleitung beschreibt diesen Weg. Der Plan-Weg (VM + eigener Tunnel) bleibt über das Compose-Profil `tunnel` möglich.

## 1. LXC-Container anlegen (Proxmox-Host)

Debian-13-Container, unprivilegiert, mit `nesting` (nötig für Docker):

```bash
pct create 118 local:vztmpl/debian-13-standard_13.6-1_amd64.tar.zst \
  --hostname whiteboard --cores 2 --memory 3072 --swap 1024 \
  --rootfs local-lvm:20 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1 --unprivileged 1 --onboot 1 --ostype debian
pct start 118
```

- Speicher wächst mit den Dateien; vergrößern geht später mit `pct resize 118 rootfs +10G`.
- In der Fritz!Box die IP-Adresse des Containers fest zuweisen.

## 2. Grundinstallation per Skript

Im Container (`pct enter 118`, bzw. per SSH in einer VM) als root:

```bash
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/Iroxx1/whiteboard/main/infra/scripts/setup-vm.sh | bash
```

Das Skript `infra/scripts/setup-vm.sh` (vorher gern lesen) erledigt:

- Debian-Updates und **automatische Sicherheitsupdates** (`unattended-upgrades`),
- **Docker** mit Compose-Plugin aus dem offiziellen Docker-Repository, Log-Rotation (10 MB × 3),
- den Ordner `/opt/whiteboard` mit `docker-compose.yml`, `.env` (aus `.env.example`, nur beim ersten Mal), `update.sh` und `restore-db.sh`.

Es lässt sich gefahrlos erneut ausführen; eine vorhandene `.env` bleibt unverändert.

## 3. Whiteboard einrichten

```bash
cd /opt/whiteboard
nano .env
```

In `.env` mindestens setzen:

| Variable | Wert |
|---|---|
| `WB_IMAGE_TAG` | aktuelles Image, z. B. `sha-1a2b3c4` (GitHub → Packages → whiteboard) |
| `WB_BIND` | `0.0.0.0` (der Cloudflare-Connector läuft auf einem anderen Rechner im LAN) |
| `PUBLIC_URL` | `https://board.dittgen.uk` |
| `TRUSTED_PROXIES` | IP des Rechners mit dem Cloudflare-Connector (Home Assistant: `192.168.1.193`) |

Starten und prüfen:

```bash
docker compose pull
docker compose up -d
docker compose ps                     # Status "healthy"
curl -s http://127.0.0.1:3000/healthz # {"status":"ok"}
```

## 4. Cloudflare-Tunnel

Im Cloudflare-Dashboard → Zero Trust → Networks → Tunnels → bestehender Tunnel → **Public Hostname hinzufügen**:

- Subdomain `board`, Domain `dittgen.uk`
- Service: `HTTP`, URL `<IP des Containers>:3000`

Für den Hostnamen außerdem:

- Rocket Loader **aus**.
- Cache-Regel: `/api/*`, `/socket.io/*` und `/share-target` umgehen den Cache.

WebSockets sind standardmäßig aktiv.

## 5. Erste Anmeldung (Admin-Konto)

Solange es noch kein Konto gibt, schreibt die App beim Start einen **einmaligen Einrichtungslink** ins Log. Der Link ist geheim: Wer ihn hat, kann das Admin-Konto anlegen. Er gilt, bis das Konto angelegt ist; nach einem Neustart der App steht ein neuer Link im Log (der alte ist dann ungültig).

1. Link aus dem Log holen (im Container, `pct enter 118`):

   ```bash
   cd /opt/whiteboard
   docker compose logs app | grep -o 'https://[^"]*/setup?token=[^"]*'
   ```

2. Den Link im Browser öffnen, Name, E-Mail-Adresse und Passwort (mindestens 10 Zeichen) eintragen → **Admin-Konto anlegen**.
3. Danach erscheint die Board-Übersicht. Der Einrichtungslink funktioniert ab jetzt nicht mehr.

## 6. Weitere Personen einladen

1. Oben auf **Verwaltung** → **+ Einladen** (Haken „als Admin“, wenn die Person auch Nutzer verwalten soll).
2. Den angezeigten Link kopieren und z. B. per WhatsApp schicken. Er funktioniert **einmal** und ist **7 Tage** gültig; er wird nur in diesem Moment angezeigt.
3. Die Person öffnet den Link, wählt Name, E-Mail und Passwort und ist danach angemeldet.

Passwort vergessen: In der Verwaltung beim Nutzer auf **Passwort-Link** (einmalig, 24 Stunden gültig). Hat der einzige Admin sein Passwort vergessen: siehe `docs/BETRIEB.md` → „Passwort-Link über die Kommandozeile“.

## 7. Handy

1. Chrome auf Android → `https://board.dittgen.uk` → anmelden.
2. Menü ⋮ → **„App installieren“**. Es muss eine echte Installation sein, keine Verknüpfung; nur dann erscheint „Whiteboard“ im Teilen-Menü.
3. Die Anmeldung gilt 180 Tage und verlängert sich bei Benutzung von selbst.

Danach im Teilen-Menü einer beliebigen App „Whiteboard“ wählen: Der Inhalt wird sofort in der Inbox gespeichert. Tipp: „Whiteboard“ im Teilen-Menü lange drücken → **Anpinnen**. In Instagram führt „Teilen über …“ zum Android-Teilen-Menü.

## 8. Telegram-Bot (optional)

1. In Telegram `@BotFather` suchen (blauer Haken), **Starten**, `/newbot` senden.
2. Anzeigenamen schicken (z. B. `Whiteboard`), dann einen Benutzernamen, der auf `bot` endet (z. B. `familie_whiteboard_bot`).
3. BotFather antwortet mit dem **Token** (`123456789:AA…`). Es ist geheim: nicht weitergeben, nicht in Chats kopieren.
4. Im Container in `/opt/whiteboard/.env` eintragen: `TELEGRAM_BOT_TOKEN=…`, dann `docker compose up -d`.
5. Im Log steht `telegram bot polling`: `docker compose logs app | grep telegram`.
6. In der App: **Einstellungen** → **Telegram verbinden** → **In Telegram öffnen** → **Starten**. Jede Person verknüpft ihr eigenes Telegram.

Danach kann man dem Bot alles schicken oder in jeder App Teilen → Telegram → Bot wählen.

## 9. E-Mail-Eingang (optional)

Mails an `board@dittgen.uk` landen in der Inbox – aber nur von eingetragenen Absenderadressen und nur mit gültiger DKIM-Signatur (Gmail signiert immer). Cloudflare nimmt die Mail an, ein kleiner Worker reicht sie an den Server weiter. Ist der Server nicht erreichbar, leitet der Worker sie an deine Gmail-Adresse weiter.

**Server:**

1. Ein Token erzeugen (mindestens 32 Zeichen) und in `/opt/whiteboard/.env` eintragen: `EMAIL_INGEST_TOKEN=…` und `EMAIL_ADDRESS=board@dittgen.uk`, dann `docker compose up -d`.

**Cloudflare-Dashboard** (dash.cloudflare.com → Domain `dittgen.uk`):

1. **Email → Email Routing → Aktivieren.** Cloudflare legt die MX- und SPF-Einträge an; bestätigen. (Vorher hatte `dittgen.uk` keine MX-Einträge, es geht also keine bestehende Mail verloren.)
2. **Destination addresses → Add destination:** deine Gmail-Adresse eintragen und den Link in der Bestätigungsmail anklicken.
3. **Email Workers → Create:** Name `whiteboard-email-ingest`, Vorlage egal. Im Editor den ganzen Inhalt durch `infra/cloudflare-email-worker/src/index.js` ersetzen → **Deploy**.
4. Im Worker **Settings → Variables and Secrets → Add:**
   - `INGEST_URL` (Typ Text) = `https://board.dittgen.uk/api/ingest/email`
   - `FALLBACK_FORWARD` (Typ Text) = deine Gmail-Adresse aus Schritt 2
   - `INGEST_TOKEN` (Typ **Secret**) = dasselbe Token wie in der `.env`
   - **Deploy**/Speichern.
5. **Email Routing → Routing rules → Create address:** Custom address `board`, Action **Send to a Worker**, Ziel `whiteboard-email-ingest` → Save.

**In der App:** Einstellungen → Karte „E-Mail“ → eigene Absenderadresse(n) eintragen. Jede Person trägt ihre eigenen ein.

Testen: Aus Chrome am Handy eine Seite teilen → Gmail → an `board@dittgen.uk`. Der Betreff ist dann der Seitentitel, der Link wird zur Link-Karte.

Alternativ zum Dashboard: `infra/cloudflare-email-worker/wrangler.toml` anpassen und `npx wrangler deploy` (vorher `npx wrangler login`, Secret mit `npx wrangler secret put INGEST_TOKEN`).

## Updates

Siehe `docs/BETRIEB.md`.
