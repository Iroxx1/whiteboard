# Status

Wird vom umsetzenden Modell nach jeder Phase aktualisiert. Phasen und Abnahmekriterien stehen in `docs/PLAN.md`, Abschnitt 9.

## Fortschritt

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Fundament und Risiko-Tests (Spike A: Teilen-Menü am Handy, Spike B: Excalidraw) | ✅ fertig (12.10.2026) |
| 1 | Whiteboard-Kern (Konten, Boards, Echtzeit-Sync, Dark Mode) | ✅ fertig (12.10.2026), auf CT 118 ausgerollt (`sha-82a447a`) |
| 2 | Inbox, Verarbeitung und Karten | ✅ fertig (12.10.2026), auf CT 118 ausgerollt (`sha-6745b66`; Nachbesserung `sha-0cf5ebf`: Instagram-Embed, Neuladen nach Updates, Bibliothek ausgeblendet) |
| 3 | PWA und Teilen-Menü | ✅ fertig (12.10.2026), auf CT 118 ausgerollt (`sha-9464792`) |
| 4 | Telegram-Bot | ✅ fertig (13.10.2026), auf CT 118 ausgerollt (`sha-d37a228`, Bot @familie_whiteboard_bot) |
| 5 | E-Mail über Cloudflare | offen |
| 6 | Produktivbetrieb und Härtung | offen |
| 7 | Volltextsuche | offen |
| 8 | OCR | offen |
| 9 | Sprachnachrichten → Text | offen |
| 10 | Feinschliff (optional) | offen |

## Offene Fragen an den Auftraggeber

_(keine)_

## Stand Phase 4 (13.10.2026)

- **Bot:** grammY mit Long Polling im App-Prozess; aus, solange `TELEGRAM_BOT_TOKEN` leer ist. Die App startet auch ohne Verbindung zu Telegram; der Bot verbindet sich im Hintergrund und versucht es jede Minute neu (bei abgelehntem Token nicht).
- **Verknüpfen:** Einstellungen → Karte „Telegram“ → „Telegram verbinden“ → „In Telegram öffnen“ (am PC zusätzlich QR-Code); Einmal-Code 10 min, `/start <code>` verknüpft. Die Seite merkt die Verknüpfung von selbst. „Trennen“ in den Einstellungen oder `/trennen` im Bot. Jedes Konto kann sein eigenes Telegram verknüpfen.
- **Nachrichten:** Text und Links (auch hinter Wörtern versteckte Links), Fotos (größte Auflösung), Alben (1,5 s gesammelt, eine Gruppe), Dokumente, Sprachnachrichten, Audio, Videos, Videonachrichten, GIFs, Standorte und Orte (OpenStreetMap-Link, Ortsname als Titel), Kontakte (Notiz), Weitergeleitetes („Weitergeleitet von …“). Bildunterschrift = Notiz, `#hashtag` legt aufs Board; unbekannte Hashtags → Hinweis mit Board-Liste.
- **Antwort:** „✅ In der Inbox“ bzw. „✅ Auf Board ‚X‘“ mit den Knöpfen 📋 Auf Board legen (8 zuletzt geänderte Boards + „Mehr …“), ✏️ Notiz (Antwort auf die Rückfrage ersetzt die Notiz), 🗑️ Löschen (Papierkorb).
- **Befehle:** `/hilfe`, `/boards`, `/inbox`, `/trennen`; werden beim Start im Telegram-Menü eingetragen.
- **Grenzen:** Dateien über 20 MB lehnt der Bot mit Hinweis auf das Teilen-Menü ab. Gruppen und fremde Absender werden ignoriert (einmal „Dieser Bot ist privat.“).
- **Tests:** Bot-Handler mit gemockter Bot-API (Verknüpfen, alle Nachrichtenarten, Alben, Größenlimit, Knöpfe, Befehle, fremde Absender).

## Stand Phase 3 (12.10.2026)

- **Teilen-Menü:** Der Service Worker fängt `POST /share-target` ab und legt Titel, Text, Link und Dateien sofort in IndexedDB ab; die Seite `/share` lädt alles gleich hoch (erst Text/Link, dann jede Datei einzeln, jeder Schritt idempotent über `clientShareId`) und zeigt „✓ In der Inbox gespeichert“. Danach lassen sich Titel, Notiz und Board ändern (entprellt, für alle Einträge des Teilens), „Löschen“ und „Fertig“.
- **Ohne Netz:** Der Inhalt wartet auf dem Handy; Hintergrund-Sync lädt ihn hoch, sobald wieder Verbindung besteht, zusätzlich bei jedem App-Start und beim Wechsel zu „online“. Hinweis „1 Eintrag wartet auf Upload“ in der Handy-Inbox.
- **Nicht angemeldet:** Anmelden-Knopf, danach geht es automatisch auf `/share` weiter und der Upload läuft.
- **Server-Fallback:** `POST /share-target` ohne aktiven Service Worker verarbeitet den Upload direkt (mit Anmeldung) bzw. zeigt einen Hinweis.
- **Board-Wahl:** „Nur Inbox“, zuletzt gewählte Boards (pro Gerät), alle Boards mit Suche.
- **Handy-Startseite:** Tabs „Inbox“ und „Boards“ (zuletzt benutzter Tab), Inbox-Liste mit „Auf Board legen“, „Notiz bearbeiten“, „Erledigt“, „Löschen“ und „+ Hinzufügen“; auch unter `/inbox`.
- **Updates:** „Neue Version verfügbar – neu laden“ auf allen Seiten; die App sucht stündlich nach Updates.
- **Installationshinweis** auf Android-Browsern, die Installation anbieten.
- **Tests:** Server-Tests für die Upload-Schritte, Wiederholungen und gleichzeitige Uploads; E2E „Teilen über den Service Worker“ inkl. Board-Wahl und Flugmodus.

## Stand Phase 2 (12.10.2026)

- **Einträge:** Datenmodell (Einträge, Platzierungen, Texte, Jobs), Ingest-Kern mit Normalisierung nach PLAN.md 5.5 (URLs auch im Text, Tracking-Parameter, Hashtags `#board`/`#inbox`, Gruppen, Duplikate in der Inbox), Dateiablage unter `/data/files/items/<jahr>/<monat>/<id>/`, Art nach Inhalt (file-type) statt Endung.
- **Verarbeitung:** Job-Queue in SQLite (Wiederholung nach 30 s/5 min/30 min, Parallelität je Typ, höchstens ein schwerer Job, Neustart-fest). Link-Vorschau über `safeFetch` (oEmbed für YouTube/Vimeo/Spotify/TikTok/X, OpenGraph, Titel/Beschreibung, Vorschaubild 800 px, Favicon; Orte aus Google Maps/OSM; blockierende Seiten ergeben eine einfache Karte). Bilder: EXIF-Drehung, HEIC → JPEG, Anzeigeversion 1600 px und Vorschau 400 px ohne Metadaten. PDF: Seitenzahl, Vorschau Seite 1, Text. Audio/Video: Dauer, Standbild. Textdateien: Vorschau und Text.
- **SSRF-Schutz:** nur http/https auf 80/443, alle aufgelösten Adressen müssen öffentlich sein (auch IPv6/IPv4-mapped), Auflösung beim Verbindungsaufbau mit genau der geprüften Adresse, Weiterleitungen einzeln geprüft (max. 5), Zeit- und Größenlimits; Tests für privates Netz, Weiterleitung auf private IP, DNS-Rebinding und IPv6.
- **Inbox-Leiste:** Tabs Inbox/Archiv/Papierkorb, Filter, Gruppen (gestapelt), Ziehen aufs Board, „Hier platzieren“, „Alle in Inbox-Bereich legen“, „Erledigt“, „Löschen“, „Wiederherstellen“, „+ Hinzufügen“ (Link/Text/Datei), Anzahl am Knopf, Live-Aktualisierung.
- **Platzieren:** Protokoll mit Lease (`placement:claim`/`done`/`pending`), automatische Ablage im Rahmen „📥 Inbox“ (4 Spalten, wächst nach unten), Abgleich Platzierungen ↔ Board beim Speichern (gelöscht → Archiv, Kopie → platziert), „Platziert · Rückgängig“.
- **Darstellung:** Notizen als Haftnotiz (240 px, wächst mit dem Text), Bilder nativ (lange Seite 400 px, Notiz als gruppierte Bildunterschrift), Karten für Links, Video-Links, PDF, Dokumente, Dateien, Audio, Video – hell und dunkel, Platzhalter unter Zoom 0,3, Herkunft „via Web · Maik · 12.10.“. Doppelklick → Details (Desktop: Seitenleiste, Handy: `/i/:id`), Strg/Cmd+Klick öffnet den Link. Link-Symbol an Karten per `pnpm patch` entfernt.
- **Detailansicht:** Vorschau, Player für Audio/Video, YouTube/Vimeo/Spotify eingebettet, Titel/Notiz bearbeiten, Original öffnen/herunterladen, Texte mit Kopieren-Knopf, Boards, auf denen der Eintrag liegt, „Auf Board legen“, „Erledigt“, „Löschen“.
- **Papierkorb:** Einträge 30 Tage, danach mit Dateien endgültig gelöscht (Prüfung alle 6 h).
- **Tests:** 101 Unit-/Integrationstests (Normalisierung, Hashtags, URLs, SSRF, Job-Queue, Raster, Verarbeitung mit echten kleinen Bildern/PDF/Audio/Video, Platzierungsprotokoll mit zwei Clients) und E2E „Ziehen an die Mausposition“ sowie „automatische Ablage genau einmal mit zwei Browsern“.

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
| 12.10.2026 | Phase 2: Bilder aus der Inbox erscheinen mit langer Seite 400 px | Auftraggeber |
| 12.10.2026 | Phase 2: Notiz-Einträge werden Haftnotizen mit 240 px Breite, mindestens 180 px hoch, wachsen mit dem Text nach unten | Auftraggeber |
| 12.10.2026 | Phase 2: Papierkorb der Einträge als Tab „Papierkorb“ in der Inbox-Leiste (neben Inbox und Archiv) | Auftraggeber |
| 12.10.2026 | Phase 2: Ausrollen einmal am Phasenende nach Rückfrage | Auftraggeber |
| 12.10.2026 | Phase 2: Inbox-Leiste beim Öffnen eines Boards auf dem Desktop angedockt und offen; Videos werden nicht umgewandelt (nicht abspielbare Formate als Download); „+ Hinzufügen“ oben in der Inbox-Leiste | Annahmen, vom Auftraggeber nicht widersprochen |
| 12.10.2026 | Phase 2: zusätzlicher Filter „Videos“ (Video-Dateien und YouTube/Vimeo-Links) neben den Filtern aus PLAN.md 4.4 | Videos passen sonst in keinen Filter |
| 12.10.2026 | Phase 2: Kartengrößen für Fälle, die PLAN.md 5.4 nicht nennt: Video-Links 340×240, Dateien ohne Vorschau 340×130, Links in Verarbeitung 340×300 | wie die nächstliegende Kartenart |
| 12.10.2026 | Phase 2: Archivierte Einträge lassen sich erneut platzieren; „Rückgängig“ legt den Eintrag ohne Ziel-Board zurück in die Inbox (sonst würde er sofort wieder automatisch abgelegt) | PLAN.md 5.4 |
| 12.10.2026 | Phase 2: Neue Spalte `items.status_before_trash`: „Wiederherstellen“ aus dem Papierkorb bringt den Eintrag dorthin zurück, wo er war | nicht in PLAN.md 5.2 |
| 12.10.2026 | Phase 2: Die Anzeigeversion eines Bildes ist zugleich die Excalidraw-Datei auf dem Board (`fileId` = Asset-ID, ausgeliefert über `/api/files/:id`) | kein zweites Hochladen beim Platzieren |
| 12.10.2026 | Phase 2: Detailansicht im Board als eigene Seitenleiste rechts (nicht als Excalidraw-Sidebar) | Excalidraw zeigt nur eine Sidebar gleichzeitig; so bleibt die Inbox offen |
| 12.10.2026 | Phase 2: sharp, heic-convert und file-type bleiben (wie better-sqlite3 und argon2) außerhalb des Server-Bundles und kommen per `pnpm deploy` ins Image; ffmpeg und poppler-utils sind im Image | native Module bzw. Laden zur Laufzeit |
| 12.10.2026 | Phase 2: HEIC-Umwandlung ist nicht automatisch getestet (kein HEIC-Encoder für Testdateien); Prüfung mit einem echten Handyfoto in Phase 3 | – |
| 12.10.2026 | Instagram-Beiträge und -Reels spielen in der Detailansicht über Instagrams offizielles Embed (`instagram.com/<p|reel>/<id>/embed`); beim Öffnen der Details lädt der Browser Inhalte und Tracking von Meta. **Abweichung von PLAN.md 8.4:** `www.instagram.com` kommt in Phase 6 mit auf die `frame-src`-Liste | Auftraggeber |
| 12.10.2026 | Nach einem Update lädt ein vorher geöffneter Tab einmal automatisch neu, wenn ein nachgeladener Programmteil fehlt (Vite `preloadError`, höchstens einmal pro Minute); der Hinweis „Neue Version verfügbar“ folgt in Phase 3 | Fehler „Bild einfügen geht nicht“ nach dem Phase-2-Update (404 auf alten Excalidraw-Baustein) |
| 12.10.2026 | Excalidraw-Bibliothek (Knopf „Bibliothek“) ausgeblendet; Vorlagen von libraries.excalidraw.com werden nicht übernommen | Auftraggeber; nicht im Plan |
| 12.10.2026 | Teilen aus der Instagram-App: Instagrams eigenes Teilen-Menü zeigt nur wenige Apps; „Whiteboard“ erscheint nur im Android-Teilen-Menü (in Instagram über „Teilen über …“/„Mehr“). Bis Phase 3 landet Geteiltes noch auf der Testseite, nicht in der Inbox | Hinweis an den Auftraggeber |
| 12.10.2026 | Phase 3: Handy-Startseite öffnet den zuletzt benutzten Tab (Inbox oder Boards) | Auftraggeber |
| 12.10.2026 | Phase 3: „Zuletzt gewählte Boards“ beim Teilen werden pro Gerät im Browser gespeichert | Auftraggeber |
| 12.10.2026 | Phase 3: Phase-0-Testseite und `/api/debug/share` entfallen; Ausrollen am Phasenende nach Rückfrage; neue Versionen werden erst nach „neu laden“ aktiv | Annahmen, vom Auftraggeber nicht widersprochen |
| 12.10.2026 | Phase 3: Neue Tabelle `share_requests` hält zusätzlich Gruppe, bereinigte Notiz, Titel, Ziel-Board und Dateianzahl eines Teilens | Upload in mehreren Anfragen (PLAN.md 5.6) braucht diesen Zustand |
| 12.10.2026 | Phase 3: Beim Teilen von Link und Datei zusammen bekommt der Link den geteilten Titel, die erste Datei den Begleittext als Notiz; ohne Link geht der Titel an eine einzelne Datei | Android schickt Seitentitel + URL |
| 12.10.2026 | Phase 3: Upload-Schritte eines Teilens laufen auf dem Server nacheinander | Seite und Hintergrund-Sync laden manchmal gleichzeitig hoch; sonst entstünden doppelte Einträge |
| 12.10.2026 | Phase 3: Einmalige Übergangsregel im Service Worker: Ist noch eine Version ohne Update-Hinweis aktiv (bis Phase 2), übernimmt die neue sofort | sonst bliebe die alte Version, bis alle Tabs bzw. die App geschlossen sind |
| 13.10.2026 | Phase 4: Der Bot ist für jedes Konto da; jede Person verknüpft ihr eigenes Telegram | Auftraggeber |
| 13.10.2026 | Phase 4: Den Bot legt Maik bei @BotFather an; das Token kommt beim Ausrollen ohne Anzeige in die `.env` | Auftraggeber |
| 13.10.2026 | Phase 4: „Dieser Bot ist privat.“ geht pro App-Start einmal an einen fremden Absender (im Speicher, keine eigene Tabelle) | PLAN.md regelt nicht, wie dauerhaft „einmalig“ ist |
| 13.10.2026 | Phase 4: Tabelle `telegram_messages` mit zusätzlicher Spalte `kind` (`reply`/`note_prompt`); Einträge älter als 90 Tage werden gelöscht | „✏️ Notiz“ braucht die Zuordnung der Rückfrage zu den Einträgen |
| 13.10.2026 | Phase 4: „📋 Auf Board legen“ zeigt die 8 zuletzt geänderten Boards (für alle gleich), „Mehr …“ alle nach Namen | Boards haben keine Nutzungsstatistik pro Person |
| 13.10.2026 | Phase 4: grammY bleibt wie die nativen Module außerhalb des Server-Bundles (kommt per `pnpm deploy` ins Image) und nutzt sein eigenes `node-fetch`; `getMe` bricht nach 30 s ab und wird wiederholt | gebündelt bzw. mit Nodes eingebautem `fetch` hingen die API-Aufrufe auf CT 118 |

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
- [x] Admin-Konto über den Einrichtungslink anlegen (`docs/SETUP.md` Schritt 5)
- [x] Zweite Person (oder zweiter Browser im Inkognito-Fenster) einladen und gemeinsam ein Board bearbeiten: erscheinen Änderungen und Mauszeiger sofort?
- [x] Bild per Drag & Drop oder Einfügen aufs Board – sieht die andere Person es auch?
- [x] Hell/Dunkel umstellen, abmelden, neu anmelden (anderes Gerät): bleibt die Einstellung?
- [x] Haftnotiz-Leiste unten: Farbe wählen, „Haftnotiz“, Enter, Text tippen
- [x] Verlauf: ☰ → Verlauf → „Version jetzt speichern“, etwas löschen, Version wiederherstellen (am besten mit zweitem offenem Browser)
- [x] Am Handy: `https://board.dittgen.uk` öffnen, anmelden; die installierte App ggf. einmal schließen und neu öffnen

### Phase 2

- [x] Neues Image auf CT 118 (`sha-6745b66`, `.env` gesichert, Änderungsprotokoll)
- [ ] Im Board rechts „📥 Inbox“ → „+ Hinzufügen“: einen Link (z. B. Zeitungsartikel, YouTube-Video), einen Text, ein Foto (gern ein iPhone-HEIC), ein PDF, eine Office-Datei, eine Sprachnachricht und ein kurzes Video hinzufügen – kommen Vorschau, Titel, Seitenzahl, Dauer usw. richtig?
- [ ] Einträge aufs Board ziehen: landen sie an der Mausposition? „Hier platzieren“ und „Rückgängig“ ausprobieren
- [ ] Doppelklick auf eine Karte → Details; Video/Audio abspielen; Strg+Klick auf eine Link-Karte öffnet den Link
- [ ] Mit zwei offenen Browsern auf demselben Board einen Eintrag mit `#boardname` im Text hinzufügen: liegt er genau einmal im Rahmen „📥 Inbox“?
- [ ] Karten hell und dunkel ansehen
- [ ] Eine Karte vom Board löschen: steht der Eintrag dann im Archiv? Von dort „Erneut platzieren“
- [ ] Am Handy: Details öffnen sich als eigene Seite

### Phase 3

- [x] Neues Image auf CT 118 (`sha-9464792`, `.env` gesichert, Änderungsprotokoll)
- [ ] Die installierte App einmal öffnen (lädt die neue Version)
- [ ] Teilen → „Whiteboard“ aus: Chrome (Link), markierter Text, Galerie (ein Foto, mehrere Fotos – bilden sie eine Gruppe?), „Dateien“ (PDF), WhatsApp-Sprachnachricht, Google Drive, YouTube-App, Instagram („Teilen über …“) – erscheint „✓ In der Inbox gespeichert“ und landet alles richtig in der Inbox?
- [ ] Beim Teilen ein Board wählen: liegt der Inhalt danach im Rahmen „📥 Inbox“ dieses Boards?
- [ ] Flugmodus an, etwas teilen („wird automatisch hochgeladen“), Flugmodus aus: kommt es von selbst an?
- [ ] Abmelden, etwas teilen: führt „Anmelden“ zum Login und danach weiter zum gespeicherten Inhalt?
- [ ] Handy-Startseite: Tabs „Inbox“/„Boards“, merkt sie sich den zuletzt benutzten Tab?
- [ ] Ein iPhone-HEIC-Foto (falls zur Hand) über „+ Hinzufügen“: wird es angezeigt?

### Phase 4

- [x] Bot bei @BotFather anlegen (@familie_whiteboard_bot), Token in die `.env`
- [x] Neues Image auf CT 118 (`sha-d37a228`, `.env` gesichert, Änderungsprotokoll)
- [ ] Einstellungen → „Telegram verbinden“ → „In Telegram öffnen“ → Starten: meldet der Bot „✅ Verknüpft …“ und zeigt die Einstellungsseite „Verknüpft“?
- [ ] An den Bot schicken: Link, Text, Foto, Album (mehrere Fotos), PDF, Sprachnachricht, Video, Standort – kommt alles richtig in der Inbox an („via Telegram · Maik“)?
- [ ] Text mit `#boardname`: „✅ Auf Board ‚…‘“ und Karte im Rahmen „📥 Inbox“ des Boards?
- [ ] Knöpfe: „📋 Auf Board legen“ → Board wählen; „✏️ Notiz“ → Notiz als Antwort schicken; „🗑️ Löschen“
- [ ] `/boards`, `/inbox`, `/hilfe`
- [ ] Von einem anderen Telegram-Konto (falls zur Hand) etwas schicken: nur „Dieser Bot ist privat.“, nichts in der Inbox?
