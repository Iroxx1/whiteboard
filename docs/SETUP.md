# Einrichtung

Schritt-für-Schritt-Anleitung für den Betrieb auf Proxmox. Stand: Phase 0.

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
| `SPIKE_ACCESS_KEY` | nur Phase 0: `openssl rand -base64 32` |

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

## 5. Phase 0: Gerät freischalten und testen

1. Auf jedem Testgerät einmal `https://board.dittgen.uk/zugang?key=<SPIKE_ACCESS_KEY>` öffnen. Danach steht auf der Startseite „Gerät freigeschaltet“.
2. **Handy (Chrome):** Menü ⋮ → „App installieren“. Es muss eine echte Installation sein, keine Verknüpfung.
3. Aus anderen Apps an „Whiteboard“ teilen; die Testfälle stehen in `docs/SPIKES.md`.

## Updates

```bash
cd /opt/whiteboard
# WB_IMAGE_TAG in .env auf das neue sha-Tag setzen, dann:
docker compose pull && docker compose up -d && docker image prune -f
```
