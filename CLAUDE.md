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

Wird in Phase 0 ergänzt, sobald das Grundgerüst steht, z. B. `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `docker compose …`.
