# Status

Wird vom umsetzenden Modell nach jeder Phase aktualisiert. Phasen und Abnahmekriterien stehen in `docs/PLAN.md`, Abschnitt 9.

## Fortschritt

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Fundament und Risiko-Tests (Spike A: Teilen-Menü am Handy, Spike B: Excalidraw) | ✅ fertig (12.10.2026) |
| 1 | Whiteboard-Kern (Konten, Boards, Echtzeit-Sync, Dark Mode) | offen |
| 2 | Inbox, Verarbeitung und Karten | offen |
| 3 | PWA und Teilen-Menü | offen |
| 4 | Telegram-Bot | offen |
| 5 | E-Mail über Cloudflare | offen |
| 6 | Produktivbetrieb und Härtung | offen |
| 7 | Volltextsuche | offen |
| 8 | OCR | offen |
| 9 | Sprachnachrichten → Text | offen |
| 10 | Feinschliff (optional) | offen |

## Offene Fragen an den Auftraggeber

_(keine)_

## Entscheidungen während der Umsetzung

| Datum | Entscheidung | Grund |
|---|---|---|
| 12.10.2026 | **LXC-Container (CT 118) mit Docker statt eigener VM** (Abweichung von PLAN.md 1 und 7.1, vom Auftraggeber entschieden) | Auf dem Host sind nur ~4 GB RAM frei; die übrigen Docker-Dienste laufen ebenfalls als LXC. Whisper (Phase 9) dann ggf. knapp → neu bewerten. |
| 12.10.2026 | **Bestehender Cloudflare-Tunnel** (Connector in Home Assistant) statt eigenem `cloudflared`-Container (Abweichung von PLAN.md 3 und 7.2, vom Auftraggeber entschieden) | Einheitlich mit den anderen Diensten. Folge: Port 3000 ist im LAN veröffentlicht (`WB_BIND=0.0.0.0`), vertrauter Proxy ist 192.168.1.193. Der Plan-Weg bleibt per Compose-Profil `tunnel` möglich. |
| 12.10.2026 | Domain `board.dittgen.uk`, App-Name „Whiteboard“ | Vorschläge aus dem Plan bestätigt |
| 12.10.2026 | Prozessor x86-64; Repo öffentlich (GHCR-Image ohne Token abrufbar) | geprüft |
| 12.10.2026 | Entwicklung über Claude Code auf dem PC des Auftraggebers, Branch `main` direkt | vom Auftraggeber gewählt |
| 12.10.2026 | TypeScript 7.0, Biome (statt ESLint + Prettier), pnpm 12 | TS 7 funktioniert mit allen Werkzeugen; Biome ist ein Werkzeug statt zwei |
| 12.10.2026 | Phase-0-Zugang über `SPIKE_ACCESS_KEY` + Cookie | PLAN.md 8.1 „Auth überall“ gilt ab dem ersten öffentlichen Start; echte Konten kommen erst in Phase 1 |
| 12.10.2026 | Server wird mit esbuild zu einer Datei gebündelt; Laufzeit-Image ohne `node_modules` | kleines Image; ändert sich, sobald native Module dazukommen (better-sqlite3, sharp – Phase 1/2) |
| 12.10.2026 | Service Worker cacht vorab nur App-Shell und Schriften (~0,5 MB); Excalidraw-Teile beim ersten Gebrauch | vollständiger Precache wären ~8 MB auf jedem Handy |
| 12.10.2026 | Medienwerkzeuge (ffmpeg, poppler, tesseract) erst mit Phase 2/8 ins Image | in Phase 0 nicht gebraucht |
| 12.10.2026 | Haftnotizen im Dunkelmodus: Excalidraw-Standard (Zeichenfläche wird invertiert, Pastell wird gedimmt) | Auftraggeber: so lassen; kein Patch nötig |
| 12.10.2026 | Karten liegen immer über gezeichneten Elementen | Auftraggeber: akzeptabel (Excalidraw legt Embeddables als HTML-Ebene darüber) |
| 12.10.2026 | Link-Symbol an Karten per `pnpm patch` von Excalidraw entfernen, nur für Elemente mit `customData.wb` | Auftraggeber: entfernen. Umsetzung mit den Karten in Phase 2; Patch bei jedem Excalidraw-Update prüfen |

## Manuelle Tests durch den Auftraggeber

### Phase 0

- [x] CT 118 angelegt (192.168.1.151), App läuft (`sha-b43b8a6`), im täglichen Proxmox-Backup
- [x] Cloudflare: Public Hostname `board.dittgen.uk` → `http://192.168.1.151:3000` im bestehenden Tunnel anlegen; Rocket Loader aus, Cache-Regel (`docs/SETUP.md` Schritt 4)
- [x] Fritz!Box: IP 192.168.1.151 für CT 118 fest zuweisen
- [ ] GitHub: Standard-Branch des Repos auf `main` umstellen (Settings → General → Default branch)
- [x] Handy: Zugangslink, App installiert, Link aus Chrome geteilt (weitere Fälle folgen in Phase 3)
- [ ] Optional: `/spike/excalidraw` auf Tablet/Handy öffnen, „300 Karten“ antippen und verschieben – flüssig?
- [x] Die drei offenen Fragen aus Spike B beantwortet
