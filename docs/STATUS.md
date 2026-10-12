# Status

Wird vom umsetzenden Modell nach jeder Phase aktualisiert. Phasen und Abnahmekriterien stehen in `docs/PLAN.md`, Abschnitt 9.

## Fortschritt

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Fundament und Risiko-Tests (Spike A: Teilen-Menü am Handy, Spike B: Excalidraw) | ✅ fertig (12.10.2026) |
| 1 | Whiteboard-Kern (Konten, Boards, Echtzeit-Sync, Dark Mode) | ✅ fertig (12.10.2026), auf CT 118 ausgerollt (`sha-82a447a`) |
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

## Stand Phase 1 (12.10.2026)

- **Konten:** Ersteinrichtung über einmaligen Log-Link, Login/Logout, Sitzungen (180 Tage, gleitend, Cookie `wb_session`, in der DB nur SHA-256), Einladungen (7 Tage, einmalig), Admin: einladen, deaktivieren, Admin-Rechte, Reset-Link (24 h); Profil: Name, Passwort, Theme, angemeldete Geräte. argon2id (19 MiB, t=2, p=1), Mindestlänge 10 + Liste häufiger Passwörter, Login-Sperre nach 5 Fehlversuchen pro IP+E-Mail mit wachsender Wartezeit.
- **Boards:** Übersicht (Suche, Sortierung, „geändert … von …“), anlegen, umbenennen inkl. Hashtag, Papierkorb (30 Tage) und Wiederherstellen.
- **Editor:** Echtzeit-Sync nach PLAN.md 5.3 (Abgleich per `version`/`versionNonce`, ~80 ms gedrosselt, Speichern 2 s nach der letzten Änderung, beim letzten Verlassen und bei SIGTERM; nach Reconnect gilt der Server-Stand plus unbestätigte lokale Änderungen), Präsenz (Mauszeiger, Namen, Auswahl), Board-Bilder (Upload pro `fileId`, Status `saved`, Nachladen bei anderen), Stil-Standards (pro Nutzer im Browser gemerkt), Haftnotiz-Leiste mit 6 Farben, Dark Mode pro Nutzer gespeichert.
- **Verlauf:** automatische Zwischenstände (30 min), Aufbewahrungsregeln, „Version jetzt speichern“, Wiederherstellen (vorher `before_restore`, höhere Versionen, Verteilung an offene Browser); Grabsteine älter als 7 Tage werden beim Snapshot entfernt.
- **Tests:** 60 Unit-/Integrationstests (Abgleich, Sortierung, Snapshots/Aufbewahrung, Auth-Abläufe, Rechte, socket.io mit zwei Nutzern, Neustart, Bilder) und E2E „zwei Nutzer, ein Board“ (Playwright) in CI.
- **Lokal im Browser geprüft:** Einrichtung, Dashboard, Haftnotiz, Sync zwischen zwei Fenstern, Präsenz, Bilder, Reconnect nach Server-Neustart, Verlauf/Wiederherstellen, Hell/Dunkel, Handy-Breite.

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
| 12.10.2026 | Phase-0-Zugang (`/zugang`, `SPIKE_ACCESS_KEY`) und `/spike/excalidraw` entfernt; die Teilen-Testseite `/share` bleibt bis Phase 3, jetzt nur mit echter Anmeldung | Auftraggeber |
| 12.10.2026 | Hashtag wird beim Anlegen automatisch aus dem Namen gebildet (ä→ae, nur a–z/0–9/_), ist änderbar und Pflicht; eindeutig auch gegenüber Boards im Papierkorb | Auftraggeber |
| 12.10.2026 | Einrichtungslink nur im Log (`docker compose logs app`); Token nur im Speicher, nach Neustart neuer Link | Auftraggeber; PLAN.md 5.12 |
| 12.10.2026 | Ausrollen auf CT 118 einmal am Phasenende, nach Rückfrage | Auftraggeber |
| 12.10.2026 | Datenbank in Phase 1 nur mit den Tabellen für Konten, Boards, Verlauf und Board-Bilder; Inbox-, Job-, Telegram- und Mail-Tabellen kommen mit ihren Phasen als eigene Migrationen | kleinere, prüfbare Migrationen |
| 12.10.2026 | Zusätzliche Spalte `boards.updated_by` (nicht in PLAN.md 5.2) | Dashboard zeigt „zuletzt geändert von“ (PLAN.md 4.6) |
| 12.10.2026 | `board:join` liefert im Ack zusätzlich Elemente und App-State; `board:update` kann `appState` (Hintergrundfarbe, Raster) mitschicken | Beitritt ohne Lücke zwischen `GET` und Beitritt; Hintergrundfarbe wird mit synchronisiert |
| 12.10.2026 | Docker-Image: Server weiter gebündelt, native Module (better-sqlite3, @node-rs/argon2) kommen per `pnpm deploy` als `node_modules` dazu (ohne fremde Plattform-Binärdateien) | better-sqlite3 13 bringt fertige Binärdateien mit, kein Compiler nötig |
| 12.10.2026 | Reset-Links vom Admin sind 24 h gültig (Einladungen 7 Tage); zusätzlich Kommandozeilen-Befehl `cli.js reset-link <e-mail>` für den Notfall | PLAN.md regelt die Laufzeit nicht; ohne CLI gäbe es keinen Weg, wenn der einzige Admin sein Passwort vergisst |
| 12.10.2026 | Papierkorb für Boards wird schon in Phase 1 nach 30 Tagen geleert (Prüfung alle 6 h); Bilder-Aufräumen bleibt Phase 6 | Hinweis „30 Tage“ in der Oberfläche soll von Anfang an stimmen |
| 12.10.2026 | Excalidraw mit `handleKeyboardGlobally` | Tastenkürzel (z. B. Enter zum Beschriften der Haftnotiz) funktionieren auch nach Klick auf die eigene Haftnotiz-Leiste |
| 12.10.2026 | Haftnotiz startet mit einem Leerzeichen als Text | Excalidraw legt den gebundenen Text (Nunito 20, linksbündig, dunkle Schrift) nur bei nicht-leerem Label an; Enter oder Doppelklick beschriftet |
| 12.10.2026 | E2E-Tests (Playwright) lokal mit installiertem Chrome, in CI mit Chromium; der Testserver liest den Einrichtungslink aus seinem eigenen Log | kein Browser-Download auf dem Entwicklungs-PC nötig |

## Manuelle Tests durch den Auftraggeber

### Phase 0

- [x] CT 118 angelegt (192.168.1.151), App läuft (`sha-b43b8a6`), im täglichen Proxmox-Backup
- [x] Cloudflare: Public Hostname `board.dittgen.uk` → `http://192.168.1.151:3000` im bestehenden Tunnel anlegen; Rocket Loader aus, Cache-Regel (`docs/SETUP.md` Schritt 4)
- [x] Fritz!Box: IP 192.168.1.151 für CT 118 fest zuweisen
- [ ] GitHub: Standard-Branch des Repos auf `main` umstellen (Settings → General → Default branch)
- [x] Handy: Zugangslink, App installiert, Link aus Chrome geteilt (weitere Fälle folgen in Phase 3)
- [ ] Optional: `/spike/excalidraw` auf Tablet/Handy öffnen, „300 Karten“ antippen und verschieben – flüssig?
- [x] Die drei offenen Fragen aus Spike B beantwortet

### Phase 1

- [x] Neues Image auf CT 118 (`sha-82a447a`, `.env` gesichert, `SPIKE_ACCESS_KEY` entfernt, Änderungsprotokoll)
- [ ] Admin-Konto über den Einrichtungslink anlegen (`docs/SETUP.md` Schritt 5)
- [ ] Zweite Person (oder zweiter Browser im Inkognito-Fenster) einladen und gemeinsam ein Board bearbeiten: erscheinen Änderungen und Mauszeiger sofort?
- [ ] Bild per Drag & Drop oder Einfügen aufs Board – sieht die andere Person es auch?
- [ ] Hell/Dunkel umstellen, abmelden, neu anmelden (anderes Gerät): bleibt die Einstellung?
- [ ] Haftnotiz-Leiste unten: Farbe wählen, „Haftnotiz“, Enter, Text tippen
- [ ] Verlauf: ☰ → Verlauf → „Version jetzt speichern“, etwas löschen, Version wiederherstellen (am besten mit zweitem offenem Browser)
- [ ] Am Handy: `https://board.dittgen.uk` öffnen, anmelden; die installierte App ggf. einmal schließen und neu öffnen
