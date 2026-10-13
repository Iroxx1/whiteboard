# Einrichtung

Schritt-für-Schritt-Anleitung für den Betrieb auf Proxmox. Stand: Phase 1.

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

## 2. Docker im Container installieren

Im Container (`pct enter 118`):

```bash
apt-get update && apt-get -y full-upgrade
apt-get install -y ca-certificates curl unattended-upgrades
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

Log-Rotation für alle Container (`/etc/docker/daemon.json`):

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

Danach `systemctl restart docker`.

## 3. Whiteboard einrichten

```bash
mkdir -p /opt/whiteboard/data
cd /opt/whiteboard
curl -fsSLO https://raw.githubusercontent.com/Iroxx1/whiteboard/main/infra/compose/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Iroxx1/whiteboard/main/infra/compose/.env.example -o .env
chmod 600 .env
chown 1000:1000 data          # die App läuft im Container als Benutzer "node" (UID 1000)
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

## Updates

Siehe `docs/BETRIEB.md`.
