# Whiteboard

Selbst gehostetes, Miro-ähnliches Whiteboard für mehrere Personen. Inhalte kommen vom Android-Handy direkt in eine gemeinsame Inbox, und zwar ohne eigene native App:

- **Android-Teilen-Menü:** „Whiteboard“ erscheint nach Installation der Web-App (PWA) im System-Teilen-Menü.
- **Telegram-Bot:** Links, Texte, Fotos, Dateien und Sprachnachrichten an den eigenen Bot schicken.
- **E-Mail:** an `board@<deine-domain>` senden (Cloudflare Email Routing, kein eigener Mailserver).

Aus der Inbox zieht man Inhalte per Drag & Drop aufs Board. Alternativ wählt man beim Teilen direkt ein Board aus.

**Technik:**

- Zeichenfläche: Excalidraw.
- Backend: Node.js, SQLite.
- Betrieb: Docker auf einer Debian-VM unter Proxmox, erreichbar über Cloudflare Tunnel.

**Ausbaustufen:** Volltextsuche, lokale Spracherkennung (whisper.cpp), lokale Texterkennung (Tesseract).

## Status

Phase 0 (Grundgerüst und Risiko-Tests) abgeschlossen; als Nächstes Phase 1 (Whiteboard-Kern).

- [`docs/PLAN.md`](docs/PLAN.md): vollständiger Umsetzungsplan (Anforderungen, Architektur, Phasen, Abnahmekriterien)
- [`docs/STATUS.md`](docs/STATUS.md): Fortschritt und Entscheidungen
- [`docs/SPIKES.md`](docs/SPIKES.md): Ergebnisse der Risiko-Tests
- [`docs/SETUP.md`](docs/SETUP.md): Einrichtung auf Proxmox
- [`CLAUDE.md`](CLAUDE.md): Arbeitsregeln für das umsetzende Claude-Modell

## Umsetzung starten

Repository in Claude Code öffnen und zum Beispiel sagen:

> Lies `CLAUDE.md` und `docs/PLAN.md` und setze Phase 0 um. Frag mich, wenn etwas unklar ist.
