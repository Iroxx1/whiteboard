# CLAUDE.md – Whiteboard

Dieses Projekt ist ein selbst gehostetes, Miro-ähnliches Whiteboard auf Excalidraw-Basis. Es hat eine gemeinsame Inbox, in die Nutzer vom Android-Handy aus Inhalte schicken: über das Teilen-Menü (PWA), einen Telegram-Bot und E-Mail (Cloudflare Email Routing). Es läuft per Docker in einer schwachen Debian-VM auf Proxmox und ist über Cloudflare Tunnel erreichbar.

## Pflichtlektüre vor jeder Arbeit

1. `docs/PLAN.md` ist der vollständige, mit dem Auftraggeber abgestimmte Umsetzungsplan.
   - Abschnitt 1 (Anforderungen) und Abschnitt 2 (Entscheidungen) sind **verbindlich**. Nicht neu diskutieren und nicht eigenmächtig ändern.
   - Abschnitt 8 (Sicherheit) ist **nicht verhandelbar**.
2. `docs/STATUS.md` zeigt den Fortschritt, die offenen Fragen und die Entscheidungen, die während der Umsetzung gefallen sind. Vor Arbeitsbeginn lesen, nach jeder Phase aktualisieren.

## Arbeitsweise

- **Bei Unklarheiten zuerst fragen.** Ausdrücklicher Wunsch des Auftraggebers: Wenn nicht zu 100 % klar ist, wie etwas funktionieren oder aussehen soll, oder der Plan etwas nicht regelt, fragst du nach, bevor du baust. Das gilt auch, wenn ein Spike zeigt, dass der Plan so nicht funktioniert.
- **Phasen der Reihe nach** (PLAN.md Abschnitt 9). Am Ende jeder Phase:
  1. Tests und CI grün.
  2. `docs/STATUS.md` aktualisiert.
  3. Commit und Push.
  4. Kurze Zusammenfassung an den Auftraggeber, inklusive dem, was **er** manuell tun oder auf dem Handy testen muss (PLAN.md Abschnitt 12).
- **Ressourcen sind knapp:** Die Ziel-VM hat 2 vCPU und 3–4 GB RAM.
  - Keine zusätzlichen Infrastruktur-Dienste: kein Postgres, Redis, Meilisearch, Elasticsearch, RabbitMQ o. Ä.
  - Schwere Arbeit nur über die Job-Queue mit begrenzter Parallelität.
- **Board-Elemente erzeugt nur der Browser** (Excalidraw-APIs), nie der Server (PLAN.md 2.3.4).
- **Versionen:** Die Angaben im Plan sind Stand Oktober 2026. Vor der Nutzung einer Bibliotheks-API die aktuelle Doku bzw. die Typdefinitionen im installierten Paket prüfen. Abhängigkeiten pinnen (Lockfile committen).
- **Sprache:** UI-Texte Deutsch (zentral in `apps/web/src/i18n/de.ts`); Code, Kommentare, Commit-Messages und Branch-Namen Englisch.
- **Geheimnisse** nie committen. Neue Konfiguration immer in `.env.example` mit Kommentar ergänzen.
- **Doku pflegen:** `docs/SETUP.md` (Einrichtung, Schritt für Schritt, für einen Laien nachvollziehbar) und `docs/BETRIEB.md` (Updates, Backups, Wiederherstellung, Fehlersuche).

## Befehle

Node 24, pnpm über corepack (`corepack enable`; Version steht in `package.json` → `packageManager`).

| Befehl | Zweck |
|---|---|
| `pnpm install` | Abhängigkeiten (Builds nur für die Pakete in `pnpm-workspace.yaml` → `allowBuilds`) |
| `pnpm dev` | Server (`:3000`, tsx watch) und Web (Vite `:5173`, Proxy auf den Server) |
| `pnpm test` | Vitest für alle Pakete |
| `pnpm e2e` | Playwright-E2E gegen den Produktions-Build (vorher `pnpm build`; lokal mit installiertem Chrome) |
| `pnpm --filter @wb/server db:generate` | neue SQL-Migration nach Änderung an `apps/server/src/db/schema.ts` |
| `pnpm lint` / `pnpm format` | Biome prüfen / korrigieren |
| `pnpm typecheck` | `tsc` je Paket (Web zusätzlich Service Worker mit `tsconfig.sw.json`) |
| `pnpm build` | Web (Vite + Service Worker) und Server (esbuild-Bundle nach `apps/server/dist`) |
| `pnpm start` | gebauten Server starten (braucht ENV, siehe `infra/compose/.env.example`; Einrichtungslink steht im Log) |
| `docker build -f infra/docker/Dockerfile .` | Image lokal bauen (sonst baut es `release.yml` bei Push auf `main`) |

Aufbau: `apps/server` (Fastify), `apps/web` (React/Vite/PWA), `packages/shared` (Typen, IDs), `infra/` (Docker, Compose). Betrieb: CT 118 auf Proxmox, siehe `docs/SETUP.md` (Abweichungen vom Plan in `docs/STATUS.md`).
