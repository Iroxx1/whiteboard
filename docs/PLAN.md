# Umsetzungsplan: Selbst gehostetes Whiteboard mit Handy-Inbox

> **Stand:** 12.10.2026 · **Status:** mit dem Auftraggeber abgestimmt, bereit zur Umsetzung
>
> **Für wen:** für das umsetzende Claude-Modell und für dich als Auftraggeber.
>
> **Verbindlichkeit:** Die Anforderungen (Abschnitt 1) und Entscheidungen (Abschnitt 2) sind mit dir abgestimmt und gelten. Was hier nicht geregelt ist oder sich bei der Umsetzung als unklar herausstellt, wird **vorher mit dir geklärt**. Das umsetzende Modell baut dann nicht einfach los (siehe `CLAUDE.md`).

## Inhalt

0. [Kurzfassung](#0-kurzfassung)
1. [Anforderungen (abgestimmt)](#1-anforderungen-abgestimmt)
2. [Entscheidungen und Begründungen](#2-entscheidungen-und-begründungen)
3. [Architektur](#3-architektur)
4. [Abläufe aus Nutzersicht](#4-abläufe-aus-nutzersicht)
5. [Komponenten im Detail](#5-komponenten-im-detail)
6. [API und Echtzeit-Events](#6-api-und-echtzeit-events)
7. [Betrieb: Proxmox, Docker, Cloudflare, Backups](#7-betrieb-proxmox-docker-cloudflare-backups)
8. [Sicherheit und Datenschutz](#8-sicherheit-und-datenschutz)
9. [Umsetzungsphasen mit Abnahmekriterien](#9-umsetzungsphasen-mit-abnahmekriterien)
10. [Teststrategie](#10-teststrategie)
11. [Risiken und Gegenmaßnahmen](#11-risiken-und-gegenmaßnahmen)
12. [Manuelle Schritte für dich](#12-manuelle-schritte-für-dich)
13. [Bewusst nicht im Umfang (spätere Ideen)](#13-bewusst-nicht-im-umfang-spätere-ideen)

---

## 0. Kurzfassung

**Machbarkeit: ja.** Alles lässt sich mit freier Software auf deinem Proxmox-Server umsetzen. Du brauchst weder eine eigene native App noch einen eigenen Mailserver.

- **Whiteboard:** eine eigene Web-App mit der Zeichenfläche von **Excalidraw** (MIT-Lizenz), einem Node.js-Backend und SQLite.
  - Mehrere Nutzer mit eigenem Login; alle sehen alle Boards.
  - Echtzeit-Zusammenarbeit.
  - Sauberer, Miro-ähnlicher Stil; Dark Mode umschaltbar.
- **Drei Wege vom Handy aufs Board:**
  1. **„Whiteboard“ im Android-Teilen-Menü.** Die Web-App wird einmal über Chrome installiert (PWA). Kein Play Store, keine App-Entwicklung.
  2. **Telegram-Bot.** Inhalte an den eigenen Bot schicken.
  3. **E-Mail an `board@<deine-domain>`.** Cloudflare nimmt die Mail an und reicht sie per kleinem Skript an den Server weiter.
- **Eine gemeinsame Inbox:**
  - Alles Geteilte landet dort und wird per Drag & Drop aufs Board gezogen.
  - Du kannst beim Teilen auch ein Board wählen oder `#boardname` schreiben. Dann legt die App den Inhalt automatisch im Bereich „📥 Inbox“ dieses Boards ab.
- **Betrieb:**
  - Docker-Compose-Stack in einer neuen Debian-13-VM, erreichbar über Cloudflare Tunnel unter `https://board.<deine-domain>`. Keine Portfreigabe nötig.
  - Bewusst ressourcensparend für deinen schwachen Mini-PC (≤ 4 GB RAM frei).
- **Ausbaustufen:**
  - Volltextsuche.
  - Sprachnachrichten → Text, lokal mit whisper.cpp.
  - Texterkennung in Bildern und PDFs, lokal mit Tesseract.
- **Größte Unsicherheit:** Erscheint die PWA auf deinem Handy sauber im Teilen-Menü? Das wird **als Allererstes (Phase 0)** auf deinem echten Gerät getestet.

---

## 1. Anforderungen (abgestimmt)

| Thema | Festlegung |
|---|---|
| Zweck | Miro-ähnliches Whiteboard mit unendlicher Zeichenfläche, selbst gehostet auf Proxmox |
| Eingangskanäle | **PWA im Android-Teilen-Menü**, **Telegram-Bot**, **E-Mail**. **Kein WhatsApp** (Begründung: 2.2) |
| Inhalte | Links, Text/Ideen, Bilder, Dokumente (PDF, Office, sonstige Dateien), Sprachnachrichten/Audio, Videos |
| Nutzer | mehrere Personen mit **eigenem Konto**; der Admin lädt per Link ein |
| Sichtbarkeit | **alle sehen und bearbeiten alle Boards** |
| Inbox | **genau eine, gemeinsam für alle**; jeder Eintrag zeigt, wer ihn wann über welchen Kanal geschickt hat |
| Ablage | Standard: Inbox, von dort per Drag & Drop aufs Board. Optional beim Teilen ein Board wählen: Der Inhalt wird dort automatisch im Bereich „📥 Inbox“ abgelegt |
| PWA-Teilen | **sofort speichern**, danach optional Titel, Notiz oder Board ergänzen |
| Look | sauber und Miro-ähnlich (gerade Linien, Schrift Nunito, Haftnotizen in Pastellfarben); **Dark Mode umschaltbar** |
| Hosting | **neue Debian-13-VM mit Docker** auf Proxmox; **Host schwach (≤ 4 GB RAM frei)** |
| Erreichbarkeit | **Cloudflare Tunnel** (Domain liegt bei Cloudflare) |
| E-Mail-Empfang | **Cloudflare Email Routing + Email Worker**. Kein eigener Mailserver, kein Postfach |
| Ausbaustufen | **Volltextsuche**, **Sprachnachrichten → Text (lokal)**, **OCR (lokal)** |
| Nicht gewünscht | KI-Zusammenfassungen über Cloud-APIs, WhatsApp-Anbindung |
| Sprache | Oberfläche Deutsch |

---

## 2. Entscheidungen und Begründungen

### 2.1 Whiteboard-Basis: Excalidraw in eigener App

Basis ist `@excalidraw/excalidraw` 0.18.x (MIT-Lizenz) als React-Komponente in einer eigenen App.

Excalidraw bringt alle nötigen Erweiterungspunkte mit. Im Paket 0.18.1 geprüft:

- **Eigene Karten:** `renderEmbeddable` und `validateEmbeddable`.
- **Eigene Seitenleisten:** `Sidebar`.
- **Programmatisch Elemente erzeugen:** `convertToExcalidrawElements`. Unterstützt werden Rahmen mit `children`, Bilder mit `fileId` und Container mit `label`.
- **Echtzeit-Abgleich:** `reconcileElements`. Mit `updateScene({ captureUpdate: CaptureUpdateAction.NEVER })` landen Fremdänderungen nicht im eigenen Rückgängig-Verlauf.
- **Drag & Drop an der Mausposition:** `viewportCoordsToSceneCoords`.
- **Dark Mode:** Prop `theme`.
- **Deutsche Oberfläche:** `langCode="de-DE"`.
- **Schriften selbst hosten:** `window.EXCALIDRAW_ASSET_PATH`.

Verworfene Alternativen:

| Alternative | Warum nicht |
|---|---|
| **tldraw** (am Miro-ähnlichsten) | Ab SDK 4 ist im Produktivbetrieb ein Lizenzschlüssel Pflicht. Ohne Schlüssel hört der Editor nach 5 Sekunden auf zu rendern. Die kostenlose Hobby-Lizenz gibt es nur auf Antrag und nach Ermessen von tldraw; die Laufzeit legt tldraw fest, sie zeigt ein Wasserzeichen und sendet Nutzungsdaten. Für ein langlebiges Privatprojekt zu riskant. |
| **ExcaliDash** (fertige Excalidraw-Plattform mit API) | Inbox-Seitenleiste und eigene Karten gingen nur per Fork. Board-Elemente müssten auf dem Server erzeugt werden; dabei passen Textmaße, Schriften und Z-Order-Indizes oft nicht. |
| **AFFiNE** | Keine stabile Schreib-API für die Whiteboard-Ansicht („Edgeless“). |
| **Ourboard, WBO, Spacedeck** | Kaum noch gepflegt bzw. zu eingeschränkt. |

### 2.2 Kein WhatsApp

- **Offizielle WhatsApp Cloud API:** Sie braucht eine Zweitnummer, ein Meta-Business-Konto und einen öffentlich erreichbaren Webhook. Laut aktuellen Berichten sind Antworten des Bots seit 01.10.2026 kostenpflichtig, eingehende Nachrichten bleiben gratis.
- **Inoffizielle Brücken** (WAHA, Baileys, Evolution API): Sie verstoßen gegen die WhatsApp-Nutzungsbedingungen. Die angebundene Nummer kann gesperrt werden.
- **Ersatz:** Bilder, Dokumente und Sprachnachrichten in WhatsApp lange drücken → Teilen-Symbol → „Whiteboard“ (PWA).

### 2.3 Weitere Entscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| 2.3.1 | **SQLite** (WAL-Modus) mit **FTS5** für die Suche. **Kein** Postgres, Redis, Meilisearch oder Elasticsearch | RAM-Budget der VM; eine einzelne Datei lässt sich leicht sichern |
| 2.3.2 | **Eigene kleine Job-Queue in SQLite** im App-Prozess. Rechenintensive Tools laufen als Kindprozesse mit Timeout; die Parallelität pro Jobtyp ist begrenzt | Kein zusätzlicher Dienst; schwache CPU |
| 2.3.3 | **Echtzeit über socket.io.** Der Server hält den Board-Zustand im Speicher, gleicht pro Element über `version`/`versionNonce` ab (Excalidraw-Prinzip) und speichert verzögert in SQLite | Bewährtes Excalidraw-Kollaborationsmodell, robust bei Verbindungsabbrüchen |
| 2.3.4 | **Board-Elemente erzeugt immer der Browser**, nie der Server. Der Server speichert nur, gleicht ab und verteilt | Korrekte Textmaße, Schriften und Indizes; kein Nachbau des Excalidraw-Formats auf dem Server |
| 2.3.5 | **Eigene Konten:** argon2id, Sitzungs-Cookies (180 Tage, gleitend), Einladungslinks. Passwort-Reset als Link, den der Admin erzeugt. Passkeys später | Kein Mailversand nötig. Lange Sitzungen, damit das Teilen vom Handy nicht ständig am Login scheitert |
| 2.3.6 | **Telegram über grammY mit Long Polling** | Keine eingehende Verbindung und kein Webhook nötig |
| 2.3.7 | **E-Mail über Cloudflare Email Routing:** Ein Email Worker schickt die Rohmail per `POST` an `/api/ingest/email`. Der Server prüft die DKIM-Signatur und eine Absender-Freigabeliste. Ist der Server nicht erreichbar, leitet der Worker die Mail an deine Gmail-Adresse weiter | Kein Mailserver, keine Verzögerung, keine Mail geht verloren |
| 2.3.8 | **Spracherkennung mit dem whisper.cpp-Server** (eigener Container, nur intern erreichbar). Modell `small` quantisiert (`q5_1`), Sprache Deutsch. Der Endpunkt ist konfigurierbar | Leichtester brauchbarer Weg auf schwacher CPU; später auf einen stärkeren Rechner umstellbar |
| 2.3.9 | **OCR mit Tesseract** (`deu` + `eng`) und Poppler im App-Container | Lokal, leichtgewichtig |
| 2.3.10 | **GitHub Actions baut das Docker-Image** und schiebt es nach GHCR. Die VM zieht nur fertige Images | Ein Frontend-Build mit Excalidraw braucht zu viel RAM für die VM |
| 2.3.11 | **Genau eine App-Instanz**, keine horizontale Skalierung | Board-Zustand im Speicher; für wenige Nutzer völlig ausreichend |
| 2.3.12 | Oberfläche **Deutsch**; Code, Kommentare und Commits **Englisch** | – |

---

## 3. Architektur

```
Handy (Android)                         Cloudflare                          Proxmox-VM (Debian 13 + Docker)
─────────────────────────               ────────────────────────────        ─────────────────────────────────
PWA „Whiteboard“ ──── HTTPS ──────────▶ Tunnel board.<domain> ────────────▶ cloudflared ──▶ app :3000
Browser (PC/Tablet) ─ HTTPS/WSS ──────▶ Tunnel board.<domain> ────────────▶ cloudflared ──▶ app :3000
Gmail ▶ board@<domain> ── SMTP ───────▶ Email Routing ▶ Email Worker ── HTTPS-POST (Rohmail) ──▶ app
Telegram ▶ @DeinBot ──────────────────▶ Telegram-Server ◀──── Long Polling (ausgehend) ─────── app

app (ein Node-24-Prozess): Web-UI · REST-API · socket.io · Telegram-Bot · Job-Queue
 ├─ SQLite (WAL, FTS5) .......... /data/db/whiteboard.sqlite
 ├─ Dateien ...................... /data/files/…
 ├─ Tesseract, Poppler, ffmpeg ... als Kindprozesse
 └─▶ whisper (whisper.cpp-Server) eigener Container, nur im internen Docker-Netz
```

- **Keine eingehenden Ports** an VM oder Router: cloudflared baut die Verbindung nach außen auf, und Telegram fragt der Server selbst ab.
- **Container:**
  - `app`: alles außer Spracherkennung.
  - `whisper`: Spracherkennung, ab Phase 9.
  - `cloudflared`: Tunnel.

---

## 4. Abläufe aus Nutzersicht

### 4.1 Teilen über das Android-Teilen-Menü (PWA)

1. In einer beliebigen App (Chrome, Galerie, Dateien, WhatsApp, YouTube …) auf **Teilen** tippen und **„Whiteboard“** wählen.
2. Die PWA öffnet sich und **speichert sofort**. Du siehst „✓ In der Inbox gespeichert“ mit einer Vorschau.
3. Optional ergänzt du **Titel**, **Notiz** oder **Board** (Liste zuletzt genutzter Boards plus Suche). Änderungen werden direkt gespeichert. Daneben gibt es „Löschen“.
4. „Fertig“ – oder einfach zurückwischen. Ohne Board-Wahl bleibt der Inhalt in der Inbox.
5. **Ohne Netz:** Der Inhalt bleibt auf dem Handy in einer Warteschlange und wird automatisch hochgeladen, sobald wieder Verbindung besteht. Die App zeigt „1 Eintrag wartet auf Upload“.

Tipp: „Whiteboard“ im Teilen-Menü anpinnen (lange drücken → Anpinnen). Dann steht es immer oben.

### 4.2 Telegram

1. Einmalig: In der App unter Einstellungen → **„Telegram verbinden“** tippen. Ein Link öffnet Telegram, das Konto ist verknüpft.
2. Danach: Teilen → Telegram → **@DeinBot**, oder direkt im Chat schicken: Text, Link, Foto, Album, Datei, Sprachnachricht, Video, Standort.
3. Bildunterschrift bzw. Begleittext werden zur **Notiz**. `#urlaub` im Text legt den Inhalt direkt auf das Board mit diesem Hashtag.
4. Der Bot antwortet mit „✅ In der Inbox“ (bzw. „✅ Auf Board ‚Urlaub‘“) und bietet Knöpfe: **📋 Auf Board legen**, **✏️ Notiz**, **🗑️ Löschen**.

### 4.3 E-Mail

1. Einmalig: In der App unter Einstellungen → **„Meine Absenderadressen“** deine Gmail-Adresse eintragen.
2. Teilen → Gmail → an **`board@<deine-domain>`** senden.
3. Was woraus wird:
   - **Betreff** → Titel.
   - **Text** → Notiz.
   - **Links im Text** → Link-Karten.
   - **Anhänge** → je ein Eintrag.
   - **`#boardname`** in Betreff oder Text → direkt auf dieses Board.
4. Mails von nicht eingetragenen Absendern oder mit gefälschtem Absender lehnt das System ab.

### 4.4 Inbox am PC oder Tablet (im Board)

Rechts im Board gibt es eine **Inbox-Leiste**. Sie lässt sich ein- und ausklappen und zeigt eine Anzahl als Badge.

- **Einträge:** Vorschau, Titel, Absender, Kanal, Zeit. Laufende Verarbeitung zeigt einen Spinner.
- **Filter:** Alle, Links, Bilder, Dokumente, Audio, Notizen.
- **Gruppen:** Mehrere gemeinsam geteilte Dateien, etwa ein Album, erscheinen gestapelt und lassen sich gemeinsam platzieren.

Aktionen:

- **Ziehen** eines Eintrags auf die Zeichenfläche platziert ihn genau an der Mausposition.
- **„Hier platzieren“** (für Touch-Geräte) platziert in der Bildmitte.
- **„Alle in Inbox-Bereich legen“** legt alle Einträge in den Rahmen „📥 Inbox“ dieses Boards.
- **„Erledigt“** archiviert den Eintrag, ohne ihn zu platzieren. Er bleibt über Suche und Archiv auffindbar.
- **„Löschen“** verschiebt ihn in den Papierkorb (30 Tage).

Weitere Regeln:

- **Gleichzeitiges Platzieren:** Zieht eine andere Person denselben Eintrag gerade woanders hin, gewinnt die erste Aktion. Die zweite bekommt den Hinweis „Wurde gerade von Anna platziert“.
- **Einträge mit Ziel-Board:** Sie stehen mit dem Hinweis „→ Board X“ in der Inbox. Sobald jemand dieses Board öffnet (oder es schon offen ist), legt die App sie automatisch im Rahmen „📥 Inbox“ ab. Danach verschwinden sie aus der Inbox.

### 4.5 Inbox am Handy

- **Startseite der installierten App (auf schmalen Bildschirmen):** Tabs **Inbox** und **Boards**.
- **Inbox-Liste mit Aktionen:**
  - Auf Board legen (Board wählen → automatische Ablage im Inbox-Bereich)
  - Notiz bearbeiten
  - Erledigt
  - Löschen
- Oben **„+ Hinzufügen“** für Link, Text oder Datei.
- Boards lassen sich auch am Handy öffnen und bearbeiten; Excalidraw hat eine Touch-Oberfläche.

### 4.6 Boards

- **Übersicht:** Kacheln mit Name, Hashtag, zuletzt geändert und von wem. Sortierung und Suche.
- **Verwalten:** anlegen, umbenennen, Hashtag ändern, löschen (Papierkorb 30 Tage), wiederherstellen.
- **Verlauf:** Automatische Zwischenstände mit „Version wiederherstellen“; zusätzlich „Version jetzt speichern“.
- **Export:** über die Excalidraw-Funktionen, als `.excalidraw`, PNG oder SVG.

### 4.7 Darstellung der Inhalte auf dem Board

| Art | Erkannt an | Darstellung auf dem Board | Interaktion |
|---|---|---|---|
| Notiz/Idee | nur Text, keine URL | **Haftnotiz** (natives Excalidraw-Rechteck mit Text, gelb) | direkt auf dem Board editierbar |
| Link | URL | **Link-Karte**: Vorschaubild, Titel, Beschreibung, Domain + Favicon, ggf. Notiz | Doppelklick: Detailansicht; Strg/Cmd+Klick: Link öffnen |
| YouTube/Vimeo | URL-Muster | Video-Karte mit Vorschaubild | Abspielen in der Detailansicht (youtube-nocookie) |
| Bild | `image/*` (HEIC wird zu JPEG) | **natives Excalidraw-Bild** (Anzeigeversion max. 1600 px), Notiz als Bildunterschrift (gruppiert) | Original in der Detailansicht herunterladbar |
| PDF | `application/pdf` | Dokument-Karte mit Vorschau der 1. Seite, Dateiname, Seitenzahl, Größe | Öffnen im Browser-PDF-Viewer |
| Office/Text/sonstige | übrige Typen | Datei-Karte mit Typ-Symbol, Name, Größe; bei `.txt`/`.md` die ersten Zeilen | Download |
| Audio/Sprachnachricht | `audio/*` inkl. `.opus`, `.ogg`, `.m4a` | Audio-Karte mit Dauer und Transkript-Auszug (sobald fertig) | Abspielen + vollständiges Transkript in der Detailansicht |
| Video | `video/*` | Video-Karte mit Standbild und Dauer | Abspielen in der Detailansicht |
| Ort | Telegram-Standort, Maps-Link | Link-Karte (Name/Adresse, OpenStreetMap-Link) | Link öffnen |

Für alle Karten gilt:

- **Theme:** Karten passen sich hell und dunkel an.
- **Herkunft:** Jede Karte zeigt klein „via Telegram · Anna · 12.10.“.
- **Verarbeitung:** Ist die Verarbeitung noch nicht fertig (z. B. Transkript), zeigt die Karte einen Platzhalter. Sie aktualisiert sich live, sobald das Ergebnis da ist.

### 4.8 Suche (Ausbaustufe)

- **Aufruf:** Lupe oben oder Strg/Cmd+K.
- **Durchsucht:**
  - Inbox- und Archiv-Einträge: Titel, Notizen, URLs, Seitentexte von Links, PDF-Texte, OCR-Texte, Transkripte.
  - Boardnamen und alle Texte auf allen Boards.
- **Ein Klick auf einen Treffer:**
  - Eintrag → öffnet die Detailansicht.
  - Board-Text → öffnet das Board und zoomt auf das Element.

### 4.9 Nutzerverwaltung

- **Erster Start:** Im Log steht ein einmaliger Einrichtungslink; darüber legst du das Admin-Konto an.
- **Einladen:** Der Admin erzeugt einen Einladungslink (7 Tage gültig, einmalig) und schickt ihn z. B. per WhatsApp. Die eingeladene Person wählt Name und Passwort.
- **Verwalten:** Der Admin kann Nutzer deaktivieren und Passwort-Reset-Links erzeugen.
- **Profil:** Name, Passwort, Theme, aktive Sitzungen (abmelden), Telegram-Verknüpfung, Absenderadressen.

---

## 5. Komponenten im Detail

### 5.1 Repository und Tech-Stack

Versionen Stand Oktober 2026. Beim Projektstart die aktuellen Patch-Versionen prüfen und **pinnen**.

| Bereich | Wahl |
|---|---|
| Laufzeit | Node.js 24 LTS („Krypton“) |
| Paketmanager | pnpm Workspaces |
| Sprache | TypeScript (strict). Aktuell ist TS 7.0; falls Tooling (z. B. ESLint-Plugins) es noch nicht unterstützt, TS 6.0 verwenden |
| Backend | Fastify 5, socket.io 4, better-sqlite3, Drizzle ORM + drizzle-kit (Migrationen), zod 4, pino |
| Frontend | React 19, Vite, `@excalidraw/excalidraw` 0.18.x, React Router, TanStack Query 5, Tailwind CSS 4 (+ Radix-Primitives), `vite-plugin-pwa` (Strategie `injectManifest`), Workbox, `idb` |
| Telegram | grammY 1.x |
| E-Mail | mailparser, mailauth |
| Medien | sharp, heic-convert, file-type; ffmpeg/ffprobe, poppler-utils, tesseract-ocr (+ `deu`, `eng`) als Systempakete |
| Links | undici (SSRF-sicherer Fetch), ipaddr.js, open-graph-scraper (Parsing aus vorab geladenem HTML), @mozilla/readability + linkedom |
| Auth | @node-rs/argon2; später @simplewebauthn/server + /browser (Passkeys) |
| Tests | Vitest, Playwright |
| Container | `node:24-trixie-slim`, `ghcr.io/ggml-org/whisper.cpp`, `cloudflare/cloudflared` (jeweils auf Version pinnen) |

```
whiteboard/
├─ apps/
│  ├─ server/                 Fastify-App: API, socket.io, Jobs, Telegram-Bot, Ingest
│  │  ├─ src/
│  │  │  ├─ auth/ boards/ items/ files/ realtime/ search/ admin/
│  │  │  ├─ ingest/ (normalize.ts, pwa.ts, telegram/, email/)
│  │  │  ├─ jobs/ (queue.ts, runner.ts) processors/ (link, image, pdf, audio, video, document, ocr, transcribe)
│  │  │  ├─ lib/ (safeFetch.ts, mime.ts, hashtags.ts, urls.ts, ids.ts)
│  │  │  └─ db/ (schema.ts, migrations/)
│  │  └─ test/ (fixtures: Mails, Share-Payloads, HTML-Seiten)
│  └─ web/                    React-App inkl. PWA/Service Worker
│     ├─ src/
│     │  ├─ routes/ (login, setup, invite, dashboard, board, inbox, item, share, search, settings, admin)
│     │  ├─ board/ (ExcalidrawHost, sync, presence, cards/, placement, stickyTool, styleDefaults)
│     │  ├─ inbox/  sw/ (service-worker.ts, shareQueue.ts)  ui/  lib/  i18n/de.ts
│     └─ public/ (Icons; Excalidraw-Schriften werden beim Build hierher kopiert)
├─ packages/shared/           gemeinsame Typen, zod-Schemas, Event-Namen, Konstanten
├─ infra/
│  ├─ docker/Dockerfile       multi-stage
│  ├─ compose/                docker-compose.yml, .env.example
│  ├─ cloudflare-email-worker/ src/index.ts, wrangler.toml
│  └─ scripts/                setup-vm.sh, update.sh, download-whisper-model.sh
├─ docs/                      PLAN.md, STATUS.md, SPIKES.md, SETUP.md, BETRIEB.md
└─ .github/workflows/         ci.yml, release.yml
```

### 5.2 Datenmodell (SQLite)

IDs sind ULIDs (Ausnahme: `assets.id`, siehe unten). Zeitstempel in UTC (ms). JSON-Felder sind per zod validiert.

| Tabelle | Felder (Kurzform) | Zweck |
|---|---|---|
| `users` | id, email (unique, lowercase), name, password_hash, role (`admin`/`member`), theme (`system`/`light`/`dark`), created_at, disabled_at | Konten |
| `sessions` | id (= SHA-256 des Tokens), user_id, created_at, last_seen_at, expires_at, user_agent, ip | Sitzungen |
| `invites` | id, token_hash, role, created_by, expires_at, used_at, used_by | Einladungslinks |
| `password_resets` | token_hash, user_id, created_by, expires_at, used_at | Reset-Links (vom Admin erzeugt) |
| `user_senders` | user_id, email_normalized (unique) | erlaubte Absender für E-Mail-Eingang |
| `telegram_links` | user_id, telegram_user_id (unique), username, linked_at | verknüpfte Telegram-Konten |
| `telegram_link_codes` | code_hash, user_id, expires_at | Einmal-Codes (10 min) |
| `telegram_messages` | chat_id, message_id, item_ids (JSON), created_at | Zuordnung Bot-Antwort ↔ Einträge (für Knöpfe und Antworten) |
| `boards` | id, name, hashtag (unique), created_by, created_at, updated_at, deleted_at, version, elements_json, app_state_json, inbox_frame_id | Boards inkl. Szene (Elemente als JSON, inkl. gelöschter Elemente als Grabsteine) |
| `board_snapshots` | id, board_id, created_at, created_by, reason (`auto`/`manual`/`before_restore`), element_count, elements_gz (BLOB) | Verlauf |
| `items` | id, created_at, created_by, source (`pwa`/`telegram`/`email`/`web`), kind (`note`/`link`/`image`/`pdf`/`document`/`audio`/`video`/`file`), status (`inbox`/`placed`/`archived`/`trashed`), title, note, url, url_normalized, group_id, target_board_id, lease_owner, lease_until, processing (`pending`/`ready`/`failed`), processing_error, meta_json, updated_at, trashed_at | Inbox-Einträge |
| `item_placements` | item_id, board_id, element_id, placed_at, placed_by | Wo liegt ein Eintrag (mehrfach möglich, z. B. nach Kopieren) |
| `assets` | id, item_id?, board_id?, role (`original`/`display`/`thumb`/`og_image`/`favicon`/`poster`/`page1`/`board_file`), mime, size, width, height, duration_ms, sha256, path, created_at | Dateien. Bei Board-Bildern ist `id` die Excalidraw-`fileId` |
| `item_texts` | item_id, kind (`article`/`pdf`/`ocr`/`transcript`/`doc`), text, created_at | extrahierte Texte (für Suche und Anzeige) |
| `jobs` | id, type, payload_json, status (`queued`/`running`/`done`/`failed`), priority, attempts, max_attempts, run_after, started_at, finished_at, last_error | Job-Queue |
| `share_requests` | client_share_id (unique), user_id, item_ids (JSON), created_at | Idempotenz für PWA-Uploads |
| `inbound_emails` | id, received_at, envelope_from, envelope_to, message_id, size, raw_path, status, error | Rohmails (30 Tage aufbewahren, für Fehlersuche und Neuverarbeitung) |
| `search_fts` | FTS5 (siehe 5.9) | Volltextsuche |

**Dateiablage:**

- `/data/files/items/<yyyy>/<mm>/<itemId>/<role>-<bereinigter-name>`
- `/data/files/board/<fileId>`

**Rohdaten:**

- `/data/inbound/<id>.eml` (E-Mails)
- `/data/tmp` (temporäre Uploads, beim Start aufräumen)

### 5.3 Whiteboard und Echtzeit-Sync

**Laden:**

1. `GET /api/boards/:id` liefert Elemente, App-State-Ausschnitt (`viewBackgroundColor`, `gridModeEnabled`), Board-Version und die Liste der benötigten `fileId`s.
2. Danach `board:join` per socket.io. Die Antwort enthält offene Platzierungen für dieses Board (5.4).

**Lokale Änderungen:**

1. `onChange` von Excalidraw liefert die Elemente.
2. Der Client merkt sich pro Element-ID die zuletzt gesendete `version`.
3. Geänderte Elemente (inkl. `isDeleted`) gehen gedrosselt (ca. 80 ms) per `board:update` an den Server.

**Server:**

- **Laden:** Board-Zustand liegt als `Map<elementId, element>` im Speicher; er wird beim ersten Beitritt geladen und 5 Minuten nach dem letzten Verlassen verworfen.
- **Abgleich nach Excalidraw-Regel:** Ein eingehendes Element gewinnt, wenn noch keins existiert, wenn `version` höher ist, oder wenn `version` gleich ist und `versionNonce` kleiner.
- **Verteilen:** Nur übernommene Elemente gehen per `board:update` an die anderen im Raum.
- **Speichern:** verzögert (2 s nach der letzten Änderung), beim letzten Verlassen und beim Herunterfahren (SIGTERM-Handler). Die Elemente werden nach `index` sortiert (Fractional Index, als String vergleichbar), bei Gleichstand nach `id`.
- **Grabsteine:** Gelöschte Elemente, deren `updated` älter als 7 Tage ist, entfernt der Server beim Snapshot.

**Fremdänderungen im Client:**

```ts
excalidrawAPI.updateScene({
  elements: reconcileElements(local, remote, appState),
  captureUpdate: CaptureUpdateAction.NEVER,
})
```

Fremde Änderungen landen damit nicht im eigenen Rückgängig-Verlauf.

**Präsenz:**

- `presence:update` (flüchtig, gedrosselt) überträgt Mauszeiger, Auswahl, Name und Farbe.
- Die Anzeige läuft über `collaborators` in `updateScene` und `isCollaborating`.

**Bilder:**

- **Hochladen:** Neue Einträge im `files`-Objekt von `onChange` gehen per `POST /api/boards/:id/files` (`fileId` + Binärdaten) an den Server.
- **Laden:** Fehlt einem Client eine Datei, holt er sie per `GET /api/files/:fileId` und ruft `addFiles` auf.
- **Status:** Hochgeladene Bilder bekommen den Status `saved`.

**Robustheit:**

- **Verbindung:**
  - Nach Reconnect übernimmt der Client den **Server-Zustand** und sendet nur die Elemente erneut, die er seit dem Abbruch lokal geändert hat (Menge „noch nicht bestätigter“ Element-IDs).
  - **Nicht** blind lokal und remote abgleichen: Sonst tauchen serverseitig bereinigte Grabsteine aus lange offenen Tabs wieder auf.
  - Bei getrennter Verbindung zeigt der Client einen Hinweisbalken.
- **Speichern:** Der Server speichert atomar in einer Transaktion und erhöht `boards.version`.

**Snapshots:**

- **Zeitpunkt:** automatisch, wenn das Board seit dem letzten Snapshot geändert wurde und dieser älter als 30 Minuten ist.
- **Aufbewahrung:** alle der letzten 48 h, danach einer pro Tag für 30 Tage, dann einer pro Woche für 6 Monate. Dazu kommen manuelle Snapshots.
- **Wiederherstellen:**
  1. Vorher automatisch einen Snapshot `before_restore` anlegen.
  2. Aktuelle Elemente, die im Ziel-Snapshot fehlen, als `isDeleted` markieren.
  3. Snapshot-Elemente übernehmen. Alle betroffenen Elemente bekommen dabei eine **höhere `version`**, damit verbundene Clients sie akzeptieren.
  4. Verteilen.

**Stil-Standards:** Neue Elemente sind sauber und Miro-ähnlich. Die Standards werden als `initialData.appState` gesetzt:

- `currentItemRoughness: 0`
- `currentItemFontFamily: FONT_FAMILY.Nunito`
- `currentItemRoundness: "round"`
- `currentItemStrokeWidth: 2`
- `currentItemFontSize: 20`
- `currentItemFillStyle: "solid"`

Der handgezeichnete Stil bleibt pro Element über das Excalidraw-Menü wählbar. Was ein Nutzer in einer Sitzung umstellt, merkt sich `localStorage` pro Nutzer.

**Haftnotiz-Werkzeug** (fehlt in Excalidraw, wird ergänzt):

- **Bedienung:** kleine schwebende Leiste mit „Haftnotiz“ und Farbwahl.
- **Farben:** Gelb `#FFF3BF`, Orange `#FFE8CC`, Grün `#D3F9D8`, Blau `#D0EBFF`, Rosa `#FFDEEB`, Lila `#E5DBFF`.
- **Erzeugung:** Rechteck 240×180, abgerundet, ohne Rand, mit gebundenem Text (Nunito 20, linksbündig), in der Bildmitte; anschließend ausgewählt.

### 5.4 Inbox, Platzierung und Karten

**Inbox-Leiste:**

- **Komponente:** Excalidraw-`Sidebar` (`name="inbox"`, andockbar), umschaltbar per Knopf oben rechts mit Anzahl-Badge.
- **Daten:** TanStack Query; Live-Aktualisierung per `inbox:changed` und `item:updated`.

**Drag & Drop:**

- **Ziehen:** Einträge sind per HTML5 ziehbar (`dataTransfer`-Typ `application/x-wb-item`, Wert: Item- oder Gruppen-ID).
- **Abfangen:** Ein **capturing** `drop`-Listener auf dem Container um Excalidraw fängt diesen Typ ab, bevor Excalidraw ihn behandelt.
- **Position:** Szenenkoordinaten per `viewportCoordsToSceneCoords({ clientX, clientY }, appState)`.
- **Touch-Geräte:** Knopf „Hier platzieren“ (Bildmitte).

**Platzierungsprotokoll** (für manuelles Ziehen und automatische Ablage gleich):

1. Client sendet `placement:claim {itemId, boardId}` und wartet auf das Ack.
2. Der Server setzt atomar eine Lease:
   ```sql
   UPDATE items SET lease_owner = :socketId, lease_until = now + 30 s
   WHERE id = :itemId AND status = 'inbox'
     AND (lease_until IS NULL OR lease_until < now)
   ```
   Er antwortet mit `granted: true|false`.
3. Bei `granted`:
   1. Der Client prüft, ob bereits ein Element mit `customData.wb.itemId === itemId` auf dem Board liegt (Idempotenz).
   2. Falls nicht, erzeugt er die Elemente (Abschnitt 4.7) per `convertToExcalidrawElements`.
   3. Er fügt sie per `updateScene` ein und synchronisiert sie normal.
      - Manuelles Ablegen: mit `CaptureUpdateAction.IMMEDIATELY`, also rückgängig machbar.
      - Automatische Ablage: mit `CaptureUpdateAction.NEVER`. Sie soll nicht im Rückgängig-Verlauf eines zufällig anwesenden Nutzers landen.
   4. Danach sendet er `placement:done {itemId, boardId, elementIds}`.
4. Der Server prüft, ob die Elemente im Board-Zustand angekommen sind. Er setzt `status = 'placed'`, schreibt `item_placements`, löscht die Lease und sendet `inbox:changed` an alle.
5. Bei `granted: false` zeigt der Client einen Hinweis („Wurde gerade von … platziert“).
6. Im Client erscheint nach dem Ablegen ein Hinweis „Platziert · Rückgängig“. Rückgängig entfernt die Elemente und legt den Eintrag zurück in die Inbox (`POST /api/items/:id/unplace`).

**Automatische Ablage** (Eintrag mit `target_board_id`):

- **Board offen:** Der Server sendet `placement:pending {boardId, itemIds}` an den Board-Raum. Die Clients versuchen zu claimen; genau einer gewinnt.
- **Board nicht offen:** Der Eintrag wartet in der Inbox mit Badge „→ Board X“. Beim nächsten `board:join` erfährt der beitretende Client die offenen Einträge und platziert sie.

**Rahmen „📥 Inbox“ pro Board:**

- **Rahmen:** Excalidraw-`frame` mit `customData.wb.role = "inbox-frame"`.
  - Wird bei Bedarf angelegt: links neben dem vorhandenen Inhalt (`x = minX − 1720`, `y = minY`), auf leerem Board bei (0, 0), Größe 1520×1000.
  - Die ID steht in `boards.inbox_frame_id`. Hat jemand den Rahmen gelöscht, legt die App ihn neu an.
- **Raster:** 4 Spalten à 340 px, 40 px Abstand. Zeilenweise wird der nächste freie Platz gesucht; belegt ist, was mit einem vorhandenen Kind-Element überlappt.
- **Wachstum:** Ist der Rahmen voll, wächst er nach unten.
- **Zuordnung:** Neue Elemente bekommen `frameId` des Rahmens.

**Abgleich Platzierungen ↔ Board** (der Server macht das bei jedem Speichern):

- Für jedes `itemId` in nicht gelöschten Board-Elementen wird `item_placements` ergänzt; ist der Eintrag noch nicht `placed`, wird er es.
- Fehlen alle Elemente eines platzierten Eintrags auf allen Boards (gelöscht), wird er `archived`. Er erscheint dann im Tab „Archiv“ der Inbox-Leiste mit „erneut platzieren“.

**Karten-Rendering:**

- **Elementtyp:** Karten sind Excalidraw-Elemente vom Typ `embeddable` mit:
  - `link = <PUBLIC_URL>/i/<itemId>` (Permalink, zeigt die Detailseite)
  - `customData.wb = { itemId, kind }`
- **Erkennung:**
  - `renderEmbeddable` erkennt Karten über `customData.wb`, nicht über die Domain; ein späterer Domainwechsel stört also nicht. Für Karten liefert es die React-Komponente `<ItemCard>`; sonst `null` (Standardverhalten, z. B. YouTube-Iframe).
  - `validateEmbeddable` liefert `true` für Pfade `/i/<ULID>` (unabhängig von der Domain), sonst `undefined`. Damit gilt für alles andere die Standard-Positivliste von Excalidraw.
- **Inhalt:** `<ItemCard>` lädt die Eintragsdaten gebündelt (`GET /api/items?ids=…`, gecacht). Sie rendert hell oder dunkel passend und aktualisiert sich bei `item:updated`.
- **Standardgrößen:**

  | Karte | Größe |
  |---|---|
  | Link mit Bild | 340×300 |
  | Link ohne Bild | 340×130 |
  | Dokument | 340×260 |
  | Audio | 340×160 |
  | Video | 340×240 |

  Alle Karten sind skalierbar.
- **Interaktion** (Zielverhalten; die Machbarkeit klärt Spike B):
  - Klick: auswählen/verschieben.
  - Doppelklick oder „↗“: Detailansicht (Seitenleiste „Details“ bzw. auf dem Handy die Seite `/i/:id`).
  - Strg/Cmd+Klick auf eine Link-Karte: Link öffnen.
  - **Fallback:** das Link-Popup von Excalidraw.
- **Natives:**
  - **Bilder:** natives `image`-Element. `fileId` ist die Asset-ID der Anzeigeversion; Status `saved`.
  - **Notizen:** native Haftnotiz.
  - **Bildunterschrift:** ein Textelement unter dem Bild, mit dem Bild gruppiert.
- **Performance:** Bei Zoom < 0,3 rendert die Karte nur einen leichten Platzhalter (Titel + Symbol). Ziel: 300 Karten flüssig, Test in Spike B.

**Detailansicht `/i/:id`:**

- **Inhalt:**
  - Vorschau, Titel und Notiz (editierbar).
  - Absender, Kanal, Zeit.
  - „Original öffnen“ bzw. Download.
  - Player für Audio/Video.
  - Transkript, OCR-Text, PDF-Text, jeweils mit Kopieren-Knopf.
  - Liste der Boards, auf denen der Eintrag liegt.
  - Aktionen: Auf Board legen, Erledigt, Löschen.
- **Darstellung:** Auf dem Desktop als Seitenleiste im Board, auf dem Handy als eigene Seite.

### 5.5 Verarbeitungspipeline (Ingest und Jobs)

Alle Kanäle liefern ein einheitliches Objekt:

```ts
type IngestPayload = {
  userId: string
  source: 'pwa' | 'telegram' | 'email' | 'web'
  title?: string
  text?: string
  url?: string
  files: { filename: string; mime?: string; size: number; tmpPath: string }[]
  targetBoardId?: string
  groupKey?: string                 // z. B. Telegram media_group_id, Mail-Message-ID, clientShareId
  sourceMeta?: Record<string, unknown> // z. B. Telegram-Chat/Message-ID, Message-ID der Mail
}
```

**Normalisierung** (`ingest/normalize.ts`, gut getestet):

1. **URLs finden:**
   - Quellen: `url` und `text` (Android packt URLs oft mit Seitentitel in `text`).
   - Tracking-Parameter beim Vergleich ignorieren (`utm_*`, `fbclid`, `gclid`, `si` bei YouTube). Die Original-URL bleibt erhalten.
2. **Hashtags:**
   - `#name` in Titel, Text, Bildunterschrift oder Betreff wird gegen `boards.hashtag` geprüft. Groß-/Kleinschreibung ist egal; Umlaute werden normalisiert (ä→ae …).
   - Treffer → `targetBoardId`; der Hashtag wird aus der Notiz entfernt.
   - `#inbox` erzwingt „nur Inbox“.
   - Unbekannte Hashtags bleiben im Text stehen. Telegram antwortet mit einem Hinweis und der Liste der Boards.
3. **Einträge bilden:**
   - **Genau eine URL:** ein Link-Eintrag; der übrige Text wird die Notiz. Ist der übrige Text identisch mit dem Seitentitel, wird er der Titel.
   - **Mehrere URLs:** je ein Link-Eintrag mit derselben Notiz, als Gruppe.
   - **Keine URL, nur Text:** ein Notiz-Eintrag.
   - **Dateien:** je Datei ein Eintrag. Die Art bestimmt der Inhalt (`file-type`-Sniffing), nicht nur die Endung. Der Begleittext wird Notiz des ersten Eintrags; alle Einträge bilden eine Gruppe.
   - **Text und Dateien gemeinsam:** Text mit URLs ergibt zusätzlich Link-Einträge in derselben Gruppe.
4. **Duplikate:** Gibt es denselben normalisierten Link schon mit Status `inbox`, entsteht kein neuer Eintrag.
   - Der vorhandene Eintrag wird zurückgegeben (Hinweis „war schon in der Inbox“).
   - Eine neue Notiz wird angehängt, ein neues Ziel-Board übernommen.
5. **Speichern:**
   - Einträge mit `processing = 'pending'` anlegen und Dateien ablegen.
   - Jobs einreihen.
   - `inbox:changed` senden; bei Ziel-Board zusätzlich `placement:pending`.

**Jobs** (Queue in SQLite, Runner im App-Prozess):

- **Neustart:** Laufende Jobs gehen zurück auf `queued`.
- **Wiederholung:** bis zu 3 Versuche mit Backoff (30 s, 5 min, 30 min).
- **Kindprozesse:** mit Timeout (AbortController), `nice -n 10`.
- **Begrenzung:** pro Typ (siehe Tabelle) und global höchstens ein „schwerer“ Job gleichzeitig.
- **Threads:** `UV_THREADPOOL_SIZE=2`, `sharp.concurrency(1)`.

| Job | Was | Parallel | Schwer |
|---|---|---|---|
| `unfurl_link` | Metadaten, Vorschaubild (800 px WebP), Favicon (64 px); Spezialfälle siehe unten | 2 | nein |
| `extract_article` | Lesetext der Seite (Readability, max. 200 KB) → `item_texts`; erst Phase 7 | 1 | nein |
| `process_image` | EXIF-Drehung, Anzeigeversion (max. 1600 px, WebP/JPEG) und Thumbnail (400 px) ohne Metadaten (GPS entfernt). Original bleibt unverändert. HEIC → JPEG | 1 | ja |
| `process_pdf` | Seitenzahl, Vorschau Seite 1 (`pdftoppm -f 1 -l 1 -scale-to 800`), Text (`pdftotext`) → `item_texts` | 1 | ja |
| `process_audio` | Dauer (`ffprobe`); bei aktivierter Spracherkennung → `transcribe_audio` | 1 | nein |
| `process_video` | Dauer, Standbild (`ffmpeg -ss 1 -frames:v 1`, 800 px) | 1 | ja |
| `process_document` | Typ-Symbol; bei `text/*` die ersten 2 KB als Vorschau + Text für Suche | 1 | nein |
| `ocr_image`, `ocr_pdf` | Phase 8 (5.10) | 1 | ja |
| `transcribe_audio` | Phase 9 (5.11) | 1 | ja |
| `reindex_board` | Board-Texte in FTS (Phase 7), höchstens alle 30 s pro Board | 1 | nein |
| `purge_trash`, `backup_db`, `gc_files` | täglich bzw. wöchentlich (Abschnitt 7) | 1 | nein |

**Link-Vorschau (`unfurl_link`):**

- **Abruf** nur über `safeFetch`; Regeln in Abschnitt 8.
- **Kopfzeilen:** realistischer Browser-User-Agent, `Accept-Language: de-DE,de;q=0.9,en;q=0.8`.
- **Parsing:** HTML (max. 3 MB) mit `open-graph-scraper` (Option `html`), sonst eigenes Parsing per Cheerio.
- **Reihenfolge der Quellen:** oEmbed (falls bekannt) → OpenGraph/Twitter-Card → `<title>`/`<meta description>` → Fallback.
- **Spezialfälle:**
  - **YouTube:** ID aus URL; Vorschau `i.ytimg.com/vi/<id>/hqdefault.jpg`; Titel per oEmbed; Abspielen über `youtube-nocookie.com/embed/<id>`.
  - **Vimeo, Spotify, TikTok, X/Twitter:** oEmbed.
  - **Google Maps / OpenStreetMap:** Ortsname aus der URL, Karten-Symbol.
- **Fallback:** Karte mit Domain, URL und Favicon. Die Verarbeitung gilt trotzdem als `ready`; kein Fehlerzustand für blockierende Seiten wie Instagram oder Amazon.

**Größenlimits:**

- PWA: 100 MB pro Datei (Cloudflare-Limit pro Anfrage).
- Telegram: 20 MB (Bot-API).
- E-Mail: 25 MB (Cloudflare).
- Server-Konfiguration: `MAX_UPLOAD_MB=100`.

### 5.6 PWA und Teilen-Menü

**Manifest:**

- Wird **vom Server dynamisch** unter `/manifest.webmanifest` ausgeliefert; so sind Name und Farben ohne Neubau konfigurierbar (`APP_NAME`). In `vite-plugin-pwa` daher `manifest: false`.
- Inhalt: `display: "standalone"`, `start_url: "/"`, `scope: "/"`, Icons 192/512 + maskable.
- Share-Target:

```json
"share_target": {
  "action": "/share-target",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "title": "title",
    "text": "text",
    "url": "url",
    "files": [{
      "name": "files",
      "accept": ["image/*", "video/*", "audio/*", "application/pdf", "text/*", "application/*", "*/*"]
    }]
  }
}
```

Spike A klärt, ob Chrome auf Android `*/*` akzeptiert. Falls nicht: eine explizite Liste inkl. `.opus`, `.ogg`, `.m4a`, `.heic`, `.docx`, `.xlsx`, `.pptx`, `.odt`, `.zip`, `.txt`, `.md`.

**Service Worker** (`injectManifest`, eigener Code + Workbox-Precache):

- **Precache:** App-Shell sowie die benötigten Excalidraw-Schriften (u. a. Nunito, Excalifont, Assistant für die Oberfläche). **Ohne** die große CJK-Schrift Xiaolai; diese wird nur bei Bedarf zur Laufzeit gecacht.
- **`POST /share-target` abfangen:**
  1. `formData()` lesen.
  2. Mit einer neuen `clientShareId` in IndexedDB ablegen (`share-queue`; Felder title, text, url, Files als Blobs, Zeit, Status).
  3. `Response.redirect('/share?id=<clientShareId>', 303)`.
- **Hintergrund:** Background Sync (`sync`-Tag `upload-shares`) lädt Wartendes hoch; zusätzlich bei jedem App-Start.
- **Updates:** Bei einer neuen Version erscheint „Neue Version verfügbar – neu laden“.
- **Cache-Header:** `sw.js`, `index.html` und das Manifest werden mit `Cache-Control: no-cache` ausgeliefert, damit Cloudflare und Browser Updates nicht blockieren.

**Seite `/share`:**

1. Den Eintrag aus IndexedDB lesen und eine Vorschau anzeigen.
2. **Sofort hochladen:**
   - Erst Text/URL per `POST /api/items/share` mit `clientShareId` (idempotent).
   - Dann **jede Datei in einer eigenen Anfrage** (`clientShareId` + Index); so bleibt jede Anfrage unter 100 MB.
3. „✓ In der Inbox gespeichert“ anzeigen, mit den Feldern **Titel**, **Notiz** und **Board**:
   - Board als Auswahl: „Nur Inbox“ (Standard), dann die zuletzt vom Nutzer gewählten Boards, dann Suche.
   - Änderungen gehen entprellt per `PATCH /api/items/:id` (bei Gruppen an alle Einträge).
4. Knöpfe:
   - „Löschen“ verschiebt in den Papierkorb.
   - „Fertig“ versucht `window.close()`; geht das nicht, wechselt die Seite zur Inbox mit „Gespeichert – du kannst zurückwischen“.
5. **Nicht eingeloggt:** Login anzeigen, danach automatisch fortsetzen; die Daten liegen ja noch in IndexedDB.
6. **Fehler/offline:** Status „wartet“ anzeigen; Wiederholung über Background Sync.

**Server-Fallback für `POST /share-target`:** Für den seltenen Fall, dass der Service Worker (noch) nicht aktiv ist und die Anfrage den Server erreicht.

- **Mit gültiger Sitzung:** Der Server verarbeitet den multipart-Upload wie `/api/items/share` und leitet per 303 auf `/share?done=<ids>` weiter. Für diese eine Route ist neben `same-origin` auch `Sec-Fetch-Site: none` erlaubt (Start durch das Betriebssystem).
- **Ohne Sitzung:** Hinweisseite „Bitte die App einmal öffnen, anmelden und erneut teilen“.

**Installation:**

1. Chrome auf Android, `https://board.<domain>` öffnen, einloggen.
2. Menü → **„App installieren“** bzw. **„Zum Startbildschirm hinzufügen“ → Installieren**. Es muss eine echte Installation sein, keine Verknüpfung; nur dann erscheint die App im Teilen-Menü.

Die App zeigt beim ersten Aufruf auf Android einen Installationshinweis.

Hinweise:

- **Firefox** für Android unterstützt keine Share-Targets; zum Installieren also Chrome verwenden.
- **iPhones** unterstützen keine Share-Targets. iPhone-Nutzer verwenden Telegram oder E-Mail.

### 5.7 Telegram-Bot

- **Grundlagen:**
  - grammY, Long Polling über `bot.start()`.
  - Token `TELEGRAM_BOT_TOKEN`; ist es leer, ist der Bot aus.
  - Er läuft im App-Prozess.
- **Chats:** Nur private Chats (`chat.type === 'private'`). Gruppen werden ignoriert.
- **Verknüpfen:**
  1. Einstellungen → „Telegram verbinden“.
  2. Der Server erzeugt einen Einmal-Code (10 min, `[A-Za-z0-9_-]{24}`).
  3. Die App zeigt einen Deep Link `https://t.me/<bot>?start=<code>` (am PC zusätzlich als QR-Code).
  4. `/start <code>` verknüpft `from.id` mit dem Nutzer.
- **Unbekannte Absender:** Sie bekommen einmalig „Dieser Bot ist privat.“ und werden danach ignoriert.
- **Nachrichtenarten:**

  | Telegram | Eintrag |
  |---|---|
  | Text (mit/ohne Links) | Normalisierung nach 5.5 |
  | Foto | größte Auflösung → Bild |
  | Dokument | Art per Sniffing |
  | Sprachnachricht (`voice`, OGG/Opus), Audio | Audio |
  | Video, Videonachricht (`video_note`), Animation | Video |
  | Standort, Ort (`venue`) | Link-Eintrag (OpenStreetMap-URL, Name/Adresse als Titel) |
  | Kontakt | Notiz |
  | Weitergeleitete Nachrichten | Notiz „Weitergeleitet von …“ |

  - Die Bildunterschrift wird zur Notiz (inkl. Hashtag-Logik).
- **Alben:** Nachrichten mit gleicher `media_group_id` werden 1,5 s gesammelt und bilden eine Gruppe.
- **Dateigröße:** Download über `getFile` funktioniert nur bis 20 MB. Bei größeren Dateien antwortet der Bot: „Zu groß für Telegram-Bots (max. 20 MB) – bitte über Teilen → Whiteboard senden (bis 100 MB).“
- **Antwort:** „✅ In der Inbox“ bzw. „✅ Auf Board ‚X‘“, mit Inline-Knöpfen.
  - Die Zuordnung Antwort ↔ Einträge steht in `telegram_messages`.
  - **📋 Auf Board legen:** zeigt bis zu 8 zuletzt genutzte Boards plus „Mehr …“; der Callback setzt `target_board_id`.
  - **✏️ Notiz:** Der Bot bittet mit `force_reply` um die Notiz; die Antwort wird als Notiz gespeichert.
  - **🗑️ Löschen:** verschiebt in den Papierkorb und editiert die Antwort zu „🗑️ gelöscht“.
- **Befehle:**
  - `/hilfe`
  - `/boards` (Boards mit Hashtags)
  - `/inbox` (Anzahl und die letzten 5)
  - `/trennen` (Verknüpfung lösen)
- **Tests:** grammY lässt sich per API-Transformer mocken.

### 5.8 E-Mail über Cloudflare Email Routing

**Ablauf:**

- Mail an `board@<domain>` → Cloudflare Email Routing → Email Worker `whiteboard-email-ingest` → `POST https://board.<domain>/api/ingest/email` (durch den Tunnel).
- Ist der Server nicht erreichbar, leitet der Worker die Mail an deine verifizierte Gmail-Adresse weiter. Es geht also nichts verloren.

**Worker** (`infra/cloudflare-email-worker/src/index.ts`, Deploy per `npx wrangler deploy`):

```ts
export default {
  async email(message: ForwardableEmailMessage, env: Env) {
    try {
      const res = await fetch(env.INGEST_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.INGEST_TOKEN}`,
          'Content-Type': 'message/rfc822',
          'X-Envelope-From': message.from,
          'X-Envelope-To': message.to,
        },
        body: message.raw, // Stream direkt durchreichen – kaum CPU-Zeit im Free-Plan
      })
      if (res.ok) return
      if (res.status === 403) return message.setReject('Absender nicht berechtigt')
      throw new Error(`ingest failed: ${res.status}`)
    } catch {
      if (env.FALLBACK_FORWARD) await message.forward(env.FALLBACK_FORWARD)
      else message.setReject('Whiteboard derzeit nicht erreichbar')
    }
  },
}
```

- **Variablen:** `INGEST_URL`, `INGEST_TOKEN` (Secret, identisch mit `EMAIL_INGEST_TOKEN` auf dem Server), `FALLBACK_FORWARD` (deine Gmail-Adresse; in Email Routing als Ziel verifiziert).
- **In Phase 5 testen:** Funktioniert `forward()`, nachdem `message.raw` schon (teilweise) gelesen wurde? Falls nicht: Rohmail zuerst puffern (`new Response(message.raw).arrayBuffer()`). Bei sehr großen Mails kann der Free-Plan dann an CPU-Grenzen stoßen; das dokumentieren.

**Server `POST /api/ingest/email`:**

1. Bearer-Token zeitkonstant prüfen. Ratenbegrenzung. Größe ≤ 30 MB.
2. Rohmail nach `/data/inbound/<id>.eml` schreiben und in `inbound_emails` vermerken.
3. **Echtheit prüfen** mit `mailauth`: Es muss eine **gültige DKIM-Signatur** geben, deren Domain zur From-Domain passt (relaxed alignment). Gmail signiert immer.
4. **Absender prüfen:** From-Adresse normalisieren (lowercase; bei `gmail.com`/`googlemail.com` Punkte und `+suffix` im lokalen Teil entfernen) und gegen `user_senders` prüfen. Kein Treffer oder DKIM ungültig → **403**; der Worker lehnt die Mail dann ab.
5. **202** zurückgeben und Job `ingest_email` einreihen.

**Auswertung** (`mailparser.simpleParser`):

- **Betreff** → Titel; „Fwd:“, „Re:“ und „WG:“ entfernen.
- **Text:**
  - Bevorzugt `text/plain`, sonst HTML → Text.
  - Signatur ab `-- ` und zitierte Abschnitte („Am … schrieb …“, `>`-Zeilen) entfernen.
  - Der Rest → Normalisierung nach 5.5. Beim Gmail-„Teilen“ aus Chrome ist der Betreff der Seitentitel und der Text die URL; das ergibt einen Link-Eintrag mit Titel.
- **Anhänge** → Dateien. Inline-Bilder unter 20 KB mit `Content-ID` (Signatur-Logos), `smime.p7s` und `.ics` werden ignoriert.
- **Gruppe:** alle Einträge einer Mail (`groupKey = Message-ID`).
- Es wird keine Antwortmail verschickt; es gibt keinen SMTP-Versand.

### 5.9 Volltextsuche (Ausbaustufe, Phase 7)

```sql
CREATE VIRTUAL TABLE search_fts USING fts5(
  title, body,
  doc_type UNINDEXED,   -- 'item' | 'board' | 'board_text'
  doc_id   UNINDEXED,   -- itemId | boardId | elementId
  board_id UNINDEXED,
  tokenize = 'trigram remove_diacritics 1'
);
```

- **Tokenizer:** Trigram findet auch Wortteile, wichtig für deutsche Komposita („tür“ findet „Haustür“). Suchbegriffe unter 3 Zeichen: Fallback per `LIKE` auf Titel.
- **Indexiert:**
  - **Einträge:** Titel, Notiz, URL, Seitenname, Beschreibung, Dateiname, `item_texts` (Artikel, PDF, OCR, Transkript).
  - **Boards:** Name und Hashtag.
  - **Board-Texte:** je Textelement bzw. Karten-Titel ein Dokument; `reindex_board` ersetzt alle Board-Dokumente eines Boards.
- **Pflege:** Die App aktualisiert den Index bei jeder Änderung (keine SQL-Trigger, die App hält das zusammen).
- **API:** `GET /api/search?q=…&type=…` liefert Treffer gruppiert, mit `snippet()`-Hervorhebung, sortiert nach `bm25`.
- **UI:** Suchdialog (Strg/Cmd+K), Ergebnisgruppen „Inbox & Archiv“, „Boards“, „Auf Boards“.
  - Ein Klick auf einen Board-Text öffnet das Board.
  - Dann `scrollToContent(element, { fitToViewport: true, animate: true })` und das Element auswählen.
- `extract_article` (Lesetext von Links) wird in dieser Phase aktiviert.

### 5.10 OCR (Ausbaustufe, Phase 8)

- **Systempakete** im App-Image: `tesseract-ocr`, `tesseract-ocr-deu`, `tesseract-ocr-eng`, `poppler-utils`.
- **`ocr_image`:**
  - Bild auf max. 2500 px verkleinern, dann `tesseract <bild> stdout -l deu+eng --psm 3`.
  - Timeout 120 s; nur behalten, wenn mindestens 20 Zeichen erkannt wurden.
- **`ocr_pdf`:**
  - Nur, wenn `pdftotext` weniger als 50 Zeichen pro Seite liefert (Scan).
  - Erste 10 Seiten: `pdftoppm -r 150`, dann Tesseract pro Seite.
- **Ergebnis:**
  - Text → `item_texts(kind='ocr')`.
  - Anzeige in der Detailansicht unter „Erkannter Text“ mit Kopieren-Knopf.
  - Suche.
- **Schalter:** `OCR_ENABLED`, `OCR_LANGS=deu+eng`.

### 5.11 Sprachnachrichten → Text (Ausbaustufe, Phase 9)

- **Container `whisper`:**
  - Image `ghcr.io/ggml-org/whisper.cpp:main` (enthält ffmpeg; auf eine konkrete Version/Digest pinnen).
  - Befehl: `whisper-server --host 0.0.0.0 --port 8080 -m /models/ggml-small-q5_1.bin -l de -t 2 --convert`.
  - Den genauen Pfad des Binaries im Image prüfen. Optional VAD (`--vad -vm <silero-modell>`) testen, verkürzt Stille.
- **Netz und Grenzen:** nur im internen Docker-Netz; `mem_limit: 1500m`, `cpus: 2`.
- **Modell:** `infra/scripts/download-whisper-model.sh` lädt es nach `./models` (`small-q5_1` ca. 190 MB; Alternative `base-q5_1`, schneller, aber schwächer auf Deutsch).
- **Job `transcribe_audio`:**
  - `POST` multipart an `WHISPER_URL` (`/inference`, `response_format=json`, `temperature=0`).
  - Timeout = 10 × Dauer + 60 s. Parallelität 1.
  - Ergebnis → `item_texts(kind='transcript')`; Karte und Detailansicht aktualisieren sich live.
- **Erwartung auf deinem Mini-PC:** Eine Sprachnachricht von 1 Minute braucht etwa 30–90 s. Die Karte zeigt so lange „Transkribiere …“.
- **Schalter:** `TRANSCRIBE_ENABLED`, `WHISPER_URL` (z. B. später ein stärkerer Rechner im Heimnetz), `WHISPER_MODEL`.
- **Quellen:** Telegram-Sprachnachrichten, per Teilen-Menü geschickte Audiodateien (auch WhatsApp-Sprachnachrichten als `.opus`), Audio-Anhänge in Mails.

### 5.12 Nutzer, Login und Rechte

- **Rollen:** `admin` (Nutzerverwaltung, Systemseite) und `member`. Beide sehen und bearbeiten alles.
- **Ersteinrichtung:** Gibt es keine Nutzer, schreibt der Server einen Einmal-Link `/setup?token=…` ins Log (gültig bis zur Nutzung). Darüber wird das Admin-Konto angelegt.
- **Passwörter:**
  - argon2id (OWASP-Parameter: m = 19 MiB, t = 2, p = 1), mindestens 10 Zeichen.
  - Prüfung gegen eine eingebaute Liste häufiger Passwörter.
- **Sitzungen:**
  - **Token und Speicherung:** 32 Byte Zufall im Cookie `wb_session`; in der DB nur SHA-256.
  - **Cookie-Attribute:** `HttpOnly; Secure; SameSite=Lax; Path=/`.
  - **Laufzeit:** 180 Tage, gleitend (Verlängerung, wenn die letzte Erneuerung > 24 h her ist).
- **Login-Schutz:** 5 Fehlversuche pro 15 min pro IP+E-Mail, danach steigende Wartezeit. Fehlermeldungen allgemein halten.
- **CSRF:**
  - Zusätzlich zu `SameSite=Lax` müssen alle nicht-GET-Anfragen `Origin` bzw. `Sec-Fetch-Site: same-origin` tragen.
  - Der socket.io-Handshake prüft Cookie und Origin.
  - Ausnahme: `/api/ingest/email` (Bearer-Token).
- **Client-IP:**
  - Nur Anfragen aus dem cloudflared-Container werden als Proxy vertraut.
  - Die IP kommt aus `CF-Connecting-IP`.
- **Passkeys** (Phase 10): SimpleWebAuthn, als zusätzliche Anmeldemethode.

### 5.13 Oberfläche, Stil und Dark Mode

**Seiten:**

| Seite | Inhalt |
|---|---|
| `/login`, `/setup`, `/invite/:token` | Anmeldung, Ersteinrichtung, Einladung |
| `/` | Dashboard: Boards. Mobil zusätzlich Tab „Inbox“ |
| `/b/:boardId` | Board mit Inbox-Leiste und Detail-Leiste |
| `/inbox` | mobile Liste |
| `/i/:itemId` | Detailansicht |
| `/share` | Teilen-Bestätigung |
| `/search` | Suche |
| `/settings` | Profil, Theme, Telegram, Absenderadressen, Sitzungen |
| `/admin` | Nutzer, Einladungen, System |

**Excalidraw:**

- Props: `langCode="de-DE"`, `theme` aus der App, `isCollaborating`.
- `UIOptions.canvasActions`: kein „Szene laden“, kein „Speichern in Datei“ als Hauptaktion, **eigener** Theme-Schalter (der Excalidraw-Schalter wird ausgeblendet). Export bleibt.
- `MainMenu` angepasst (Boards, Export, Theme, Hilfe).

**Schriften:** Inhalt von `node_modules/@excalidraw/excalidraw/dist/prod/fonts` beim Build nach `public/` kopieren und `window.EXCALIDRAW_ASSET_PATH = "/"` setzen. Nötig für den Betrieb ohne CDN und für eine strikte CSP.

**Dark Mode:**

- Umschalter System/Hell/Dunkel im Kopf, gespeichert in `users.theme` und `localStorage` (sofort beim Start).
- Tailwind `dark`-Klasse.
- Karten und Leisten über CSS-Variablen.
- Excalidraw über `theme`.

**UI-Kit:** Tailwind + Radix-Primitives. Alle Texte zentral in `i18n/de.ts`, Datumsangaben in `de-DE`, Zeitzone `Europe/Berlin`.

**Ladezeit:** Editor-Route lazy laden; Excalidraw ist groß.

---

## 6. API und Echtzeit-Events

Alle Routen verlangen eine Sitzung (Ausnahmen markiert). Antworten in JSON; Eingaben per zod validiert.

| Methode und Pfad | Zweck |
|---|---|
| `POST /api/auth/setup` *(nur ohne Nutzer, mit Setup-Token)* | Admin anlegen |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | Sitzung |
| `GET /api/invites/:token` · `POST /api/invites/:token` *(ohne Sitzung)* | Einladung prüfen/annehmen |
| `POST /api/auth/reset/:token` *(ohne Sitzung)* | Passwort per Reset-Link setzen |
| `GET/PUT /api/me` · `GET/DELETE /api/me/sessions[/:id]` · `PUT /api/me/password` | Profil, Sitzungen |
| `POST /api/me/telegram/link-code` · `DELETE /api/me/telegram` | Telegram verknüpfen/trennen |
| `GET/POST/DELETE /api/me/senders[/:email]` | Absenderadressen |
| `GET/POST /api/admin/users` · `PATCH /api/admin/users/:id` · `POST /api/admin/users/:id/reset-link` · `POST /api/admin/invites` · `GET /api/admin/system` | Admin |
| `GET/POST /api/boards` · `GET/PATCH/DELETE /api/boards/:id` · `POST /api/boards/:id/restore` | Boards |
| `GET/POST /api/boards/:id/snapshots` · `POST /api/boards/:id/snapshots/:sid/restore` | Verlauf |
| `POST /api/boards/:id/files` · `GET /api/files/:fileId` | Board-Bilder |
| `GET /api/items?status=&kind=&ids=&cursor=` | Inbox, Archiv, Abruf gebündelter Einträge |
| `POST /api/items` | Web: „+ Hinzufügen“ (JSON oder multipart) |
| `POST /api/items/share` · `POST /api/items/share/:clientShareId/files` | PWA-Upload (idempotent) |
| `GET/PATCH/DELETE /api/items/:id` · `POST /api/items/:id/restore` | Eintrag lesen, bearbeiten (Titel, Notiz, Ziel-Board, Status `archived`), Papierkorb |
| `POST /api/items/:id/unplace` | „Rückgängig“ nach dem Platzieren |
| `GET /api/assets/:assetId[?download=1]` | Dateien ausliefern (Sicherheitsregeln: Abschnitt 8) |
| `POST /api/ingest/email` *(Bearer-Token statt Sitzung)* | E-Mail-Eingang |
| `GET /api/search?q=` | Suche (Phase 7) |
| `GET /manifest.webmanifest` · `POST /share-target` *(normalerweise vom Service Worker abgefangen; Server-Fallback siehe 5.6)* | PWA |
| `GET /healthz` *(ohne Sitzung, keine Details nach außen)* | Healthcheck |

**socket.io-Events:**

| Richtung | Event | Inhalt |
|---|---|---|
| C→S | `board:join` (Ack) / `board:leave` | `{boardId}` → Ack `{ok, version, pendingItemIds}` |
| C↔S | `board:update` | `{boardId, elements[]}` (nur Geändertes inkl. `isDeleted`) |
| C↔S | `presence:update` (flüchtig) | `{boardId, pointer, button, selectedElementIds}`; Server ergänzt Nutzername und Farbe |
| S→C | `presence:leave` | `{boardId, socketId}` |
| C→S | `placement:claim` (Ack) · `placement:done` | siehe 5.4 |
| S→C | `placement:pending` | `{boardId, itemIds}` |
| S→C | `inbox:changed` · `item:updated` · `boards:changed` | Listen bzw. Karten neu laden |

---

## 7. Betrieb: Proxmox, Docker, Cloudflare, Backups

### 7.1 VM auf Proxmox

- **Basis:** Debian 13 („trixie“), CPU-Typ `host`, **2 vCPU**, **3 GB RAM** (4 GB, wenn möglich; Ballooning aus), **40 GB** Disk (Thin Provisioning; Dateien wachsen mit).
- **Swap:** 2 GB als Sicherheitsnetz für Whisper-Spitzen.
- **System:** QEMU Guest Agent, SSH nur per Schlüssel, `unattended-upgrades`.
- **Firewall:** UFW. **Eingehend nur SSH aus dem LAN**; der Tunnel braucht keine eingehenden Ports.
- **Docker:** Docker Engine + Compose-Plugin aus dem offiziellen Docker-Repo; Log-Rotation (`json-file`, `max-size 10m`, `max-file 3`).
- **Skript:** `infra/scripts/setup-vm.sh` erledigt alles ab „frisches Debian mit SSH“. Es ist idempotent und gut kommentiert.

### 7.2 Docker Compose (Skizze)

```yaml
# /opt/whiteboard/docker-compose.yml
services:
  app:
    image: ghcr.io/iroxx1/whiteboard:latest     # in der Praxis auf sha-Tag pinnen
    env_file: .env
    volumes: ["./data:/data"]
    restart: unless-stopped
    mem_limit: 1g
    healthcheck:
      test: ["CMD", "node", "/app/healthcheck.js"]
      interval: 30s
  whisper:
    image: ghcr.io/ggml-org/whisper.cpp:main      # auf Version/Digest pinnen
    command: ["whisper-server", "--host", "0.0.0.0", "--port", "8080",
              "-m", "/models/ggml-small-q5_1.bin", "-l", "de", "-t", "2", "--convert"]
    volumes: ["./models:/models:ro"]
    restart: unless-stopped
    mem_limit: 1500m
    cpus: 2
    profiles: ["transcription"]                   # ab Phase 9 aktivieren
  cloudflared:
    image: cloudflare/cloudflared:2026.10.0
    command: tunnel --no-autoupdate run
    environment: ["TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}"]
    restart: unless-stopped
```

Keine veröffentlichten Ports; höchstens `127.0.0.1:3000` zur lokalen Fehlersuche.

**`.env.example`:**

```
PUBLIC_URL=https://board.example.de
APP_NAME=Whiteboard
TZ=Europe/Berlin
DATA_DIR=/data
MAX_UPLOAD_MB=100
LOG_LEVEL=info
CF_TUNNEL_TOKEN=
TELEGRAM_BOT_TOKEN=                # leer = Bot aus
EMAIL_INGEST_TOKEN=                # mind. 32 Zufallsbytes, identisch im Cloudflare Worker
OCR_ENABLED=false                  # ab Phase 8: true
OCR_LANGS=deu+eng
TRANSCRIBE_ENABLED=false           # ab Phase 9: true
WHISPER_URL=http://whisper:8080/inference
```

### 7.3 Docker-Image

Multi-stage:

1. **Build-Stage** (`node:24`): `pnpm install --frozen-lockfile`, Build von `web` und `server`, Excalidraw-Schriften kopieren.
2. **Laufzeit-Stage** (`node:24-trixie-slim`):
   - Systempakete `tini`, `ca-certificates`, `poppler-utils`, `ffmpeg`, `tesseract-ocr`, `tesseract-ocr-deu`, `tesseract-ocr-eng`.
   - Nur Produktionsabhängigkeiten.
   - Nicht-Root-Nutzer.
   - `ENTRYPOINT ["tini", "--"]`.

Nur `linux/amd64` (Mini-PC mit x86-64; falls ARM, Bescheid geben).

### 7.4 Cloudflare

- **Tunnel:**
  - Zero Trust → Networks → Tunnels → „Create tunnel“ (cloudflared), Token kopieren.
  - Public Hostname `board.<domain>` → Service `http://app:3000`.
  - WebSockets sind standardmäßig an.
- **Für den Hostnamen:** Rocket Loader **aus**. Cache-Regel: `/api/*`, `/socket.io/*` und `/share-target` umgehen den Cache. Der Server setzt korrekte `Cache-Control`-Header: Assets mit Hash 1 Jahr `immutable`; `index.html`, `sw.js` und Manifest `no-cache`.
- **Optional:** WAF-Ratenbegrenzung für `/api/auth/login`; Geo-Beschränkung auf DE.
- **Email Routing:**
  - Für die Domain aktivieren; MX/TXT-Einträge setzt Cloudflare automatisch. Das ist unproblematisch, da die Domain bisher keine Mails empfängt.
  - Gmail-Adresse als Ziel verifizieren.
  - Worker deployen, Regel `board@<domain>` → „Send to a Worker“.

### 7.5 Build, Deployment und Updates

- **`ci.yml`** (Push/PR): Lint, Typecheck, Unit- und Integrationstests, Build.
- **`release.yml`** (Push auf `main`): Image bauen → `ghcr.io/iroxx1/whiteboard:latest` und `:sha-<kurz>`. Ist das Repo privat, braucht die VM ein GitHub-Token mit `read:packages` (`docker login ghcr.io`).
- **Update auf der VM:** `infra/scripts/update.sh` → `docker compose pull && docker compose up -d && docker image prune -f`.
- **Migrationen:** laufen beim App-Start; vorher automatisch ein DB-Backup.
- **Version:** Die App zeigt die Version (Git-SHA) auf der Admin-Seite. Die PWA bietet bei neuer Version „neu laden“ an.

### 7.6 Backups und Wiederherstellung

- **Ebene 1 – Proxmox:** nächtliches `vzdump` der VM (Snapshot-Modus) auf ein zweites Speicherziel (NAS/PBS, falls vorhanden). Aufbewahrung 7 täglich + 4 wöchentlich.
- **Ebene 2 – App:**
  - Täglich 03:30 erzeugt der Job `backup_db` einen konsistenten DB-Abzug (better-sqlite3 `.backup()`) nach `/data/backups/db-YYYY-MM-DD.sqlite`; 14 Tage aufbewahren.
  - `/data/files` ändert sich nur durch Hinzufügen und Aufräumen und ist im VM-Backup enthalten. Optional später `rsync`/`rclone` auf ein NAS.
- **Aufräumen:**
  - `purge_trash` löscht Papierkorb-Einträge und -Boards nach 30 Tagen.
  - `gc_files` entfernt wöchentlich Board-Bilder ohne Referenz in Board oder Snapshots (älter als 30 Tage).
  - Rohmails werden nach 30 Tagen gelöscht.
- **Wiederherstellung:** in `docs/BETRIEB.md` Schritt für Schritt dokumentiert und **einmal tatsächlich getestet** (Teil der Abnahme in Phase 6).

### 7.7 Überwachung und Ressourcen

- **`/healthz`:** DB erreichbar, freier Speicher > 10 %, Job-Rückstau, Whisper erreichbar (falls aktiv).
- **Admin-Seite „System“:** Version, Speicherbelegung (`/data`, DB-Größe), Jobs (wartend/fehlgeschlagen mit „erneut versuchen“), Telegram-Status, letzter Backup-Zeitpunkt.
- **Speicherwarnung:** Banner für Admins bei < 15 % freiem Speicher.
- **RAM-Budget** (Spitzenwerte):

  | Komponente | RAM |
  |---|---|
  | Debian + Docker | ca. 350 MB |
  | app | 250–450 MB |
  | whisper aktiv | 600–900 MB |
  | cloudflared | ca. 40 MB |
  | Tesseract | ca. 150 MB |
  | **Summe** | **ca. 1,5–2 GB** |

  Mit 3 GB RAM + Swap passt das.

---

## 8. Sicherheit und Datenschutz

Diese Regeln sind **nicht verhandelbar**; die App hängt öffentlich im Internet.

1. **Auth überall:** Jede Route, jedes Asset und jedes socket.io-Event verlangt eine gültige Sitzung (Ausnahmen nur wie in Abschnitt 6 markiert).
2. **SSRF-Schutz** für alle serverseitigen Abrufe fremder URLs (Link-Vorschau, oEmbed, Bilder, Favicons). Umgesetzt in `safeFetch`:
   - Nur `http`/`https`; Ports 80/443.
   - DNS selbst auflösen und **alle** nicht-öffentlichen Adressen ablehnen. Konkret alles, was `ipaddr.js` nicht als `unicast` einstuft: `10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `100.64/10`, `0/8`, `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped-IPv6 usw.
   - Die geprüfte IP für die Verbindung festnageln (undici-Agent mit eigenem `lookup`, gegen DNS-Rebinding).
   - Redirects manuell folgen (max. 5), jede Station neu prüfen.
   - Timeouts: Verbindung 5 s, gesamt 15 s. Größenlimits: HTML 3 MB, Bilder 10 MB.

   Dein Heimnetz (Proxmox, Router …) darf über die Link-Vorschau **nicht** erreichbar sein. Eigene Tests decken das ab.
3. **Hochgeladene Dateien ausliefern:**
   - Immer mit `X-Content-Type-Options: nosniff` und `Content-Security-Policy: sandbox; default-src 'none'`.
   - **HTML, SVG, XML und JS nie inline**, sondern als `attachment`.
   - Bilder, PDF, Audio und Video inline mit dem per Sniffing bestimmten MIME-Typ.
   - Dateinamen bereinigen (Pfadangaben, Steuerzeichen).
4. **Sicherheits-Header:**
   - CSP: `default-src 'self'`; `img-src 'self' data: blob:`; `media-src 'self' blob:`; `style-src 'self' 'unsafe-inline'` (Excalidraw); `frame-src` nur `youtube-nocookie.com`, `player.vimeo.com`, `open.spotify.com` und die Standard-Embeds von Excalidraw.
   - Dazu `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, HSTS (Cloudflare).
5. **Eingaben:** alles per zod validieren. Größenlimits für Uploads und JSON. Board-Updates: maximal 2 MB pro Nachricht.
6. **Ratenbegrenzung:** Login, Einladungen, Ingest-Endpunkte, Uploads.
7. **Geheimnisse:** nur in `.env` (nie im Repo). `.env.example` pflegen. In Logs werden Tokens maskiert; es werden keine Inhalte geloggt.
8. **Telegram/E-Mail:** Nur verknüpfte bzw. freigegebene Absender. E-Mails zusätzlich mit DKIM-Prüfung.
9. **Updates:** Abhängigkeiten über Dependabot/Renovate aktuell halten (wöchentliche Gruppen-PRs). Die VM installiert Sicherheitsupdates automatisch.

**Datenschutz-Hinweise:** Alle Daten liegen auf deinem Server. Drei Dinge laufen über Dritte:

- **Cloudflare** terminiert TLS und sieht den Verkehr zwischen Browser und Server im Klartext. Das ist der Preis für Tunnel ohne Portfreigabe.
- **Telegram** sieht die Nachrichten an den Bot.
- **Die Link-Vorschau** ruft die geteilten Webseiten vom Server aus ab; die Seitenbetreiber sehen die IP deines Anschlusses.

---

## 9. Umsetzungsphasen mit Abnahmekriterien

Grundsätze für das umsetzende Modell:

- **Reihenfolge:** Phasen nacheinander abarbeiten.
- **Abschluss jeder Phase:** Tests grün, `docs/STATUS.md` aktualisiert, Commit/Push, kurze Zusammenfassung an dich mit allem, was **du** testen oder einrichten musst.
- **Unklarheiten:** sofort fragen.

### Phase 0 – Fundament und Risiko-Tests

**Ziel:** lauffähiges Grundgerüst; die zwei kritischsten Annahmen sind auf echter Hardware bestätigt.

1. Monorepo (pnpm, TS strict, Biome **oder** ESLint+Prettier, Vitest). `pnpm dev` startet Server und Web mit Proxy.
2. Fastify-Grundgerüst: Konfiguration per zod-validierter ENV, pino, `/healthz`, Auslieferung des Web-Builds, Cache-Header.
3. Web-Grundgerüst: React, Router, Tailwind, Theme-Umschalter, deutsche Texte zentral.
4. Dockerfile, `docker-compose.yml`, `.env.example`; Workflows `ci.yml` und `release.yml` (GHCR).
5. **Spike A – Teilen-Menü auf deinem Handy:**
   - Minimal-PWA mit Manifest/share_target und Service Worker. Die Seite `/share` zeigt alle empfangenen Felder und Dateien (Name, Typ, Größe) an und sendet sie an `/api/debug/share` (nur in dieser Phase).
   - Betrieb unter echter HTTPS-Domain: VM + Cloudflare Tunnel, oder übergangsweise ein Quick Tunnel `trycloudflare.com` von einem Rechner aus.
   - **Du testest:**
     1. Installation als App (nicht nur Verknüpfung).
     2. Erscheint „Whiteboard“ im Teilen-Menü?
     3. Empfang von: Link aus Chrome, markiertem Text, Foto aus der Galerie, mehreren Fotos, PDF aus „Dateien“, WhatsApp-Sprachnachricht, Datei aus Google Drive, YouTube-Link aus der YouTube-App.
     4. Funktioniert `accept: "*/*"`?
6. **Spike B – Excalidraw-Integration:**
   - Excalidraw 0.18 mit selbst gehosteten Schriften.
   - Eigene Karte über `renderEmbeddable`/`validateEmbeddable` (Erkennung über `customData`).
   - Doppelklick-/Öffnen-Verhalten der Karten (Abschnitt 5.4).
   - Drag & Drop aus der `Sidebar` an die Mausposition.
   - `updateScene` mit `CaptureUpdateAction.NEVER`.
   - Dark Mode (wie sehen Karten und Haftnotizen aus?).
   - Performance mit 300 Karten.
7. Ergebnisse in `docs/SPIKES.md`. **Abweichungen vom Plan mit dir besprechen, bevor es weitergeht.**

**Von dir benötigt:** VM und Tunnel (Abschnitt 12, Schritte 1–3) oder Zustimmung zum Quick Tunnel; der Handy-Test.

**Fertig, wenn:**

- CI ist grün und das Image liegt in GHCR.
- Spike A ist auf deinem Handy bestanden (oder Alternativen sind mit dir entschieden).
- Spike B bestätigt alle Excalidraw-Integrationspunkte.

### Phase 1 – Whiteboard-Kern (mehrere Nutzer, Echtzeit)

**Aufgaben:**

- **Datenbank:** Schema + Migrationen.
- **Konten:**
  - Ersteinrichtung; Login, Logout und Sitzungen.
  - Einladungen.
  - Admin-Nutzerverwaltung: einladen, deaktivieren, Reset-Link.
  - Profil: Name, Passwort, Theme, Sitzungen.
- **Boards:** Übersicht, anlegen, umbenennen inkl. Hashtag, Papierkorb, wiederherstellen.
- **Editor:**
  - Persistenz und Echtzeit-Sync nach 5.3, Präsenz (Cursor + Namen).
  - Board-Bilder.
  - Stil-Standards, Haftnotiz-Werkzeug, Dark Mode.
- **Verlauf:** Snapshots + Wiederherstellen.

**Fertig, wenn:**

- Zwei Nutzer in zwei Browsern bearbeiten dasselbe Board gleichzeitig; Änderungen erscheinen in < 1 s.
- Bei einem Server-Neustart gehen höchstens die letzten 2 s verloren.
- Bilder erscheinen bei beiden.
- Gelöschtes bleibt gelöscht, auch nach Reconnect.
- Dark Mode bleibt pro Nutzer gespeichert.
- Snapshot-Wiederherstellung funktioniert, auch bei geöffnetem zweitem Browser.
- Tests:
  - Unit-Tests für Abgleichslogik, Sortierung und Auth.
  - E2E „zwei Nutzer, ein Board“.

### Phase 2 – Inbox, Verarbeitung und Karten

**Aufgaben:**

- **Datenfluss:** Einträge-Modell, Ingest-Kern mit Normalisierung (5.5), Dateiablage, Job-Queue.
- **Prozessoren:** Link (mit `safeFetch`), Bild, PDF, Audio, Video, Dokument.
- **Inbox-Leiste:** Liste, Filter, Gruppen, Aktionen, Archiv-Tab.
- **Platzieren:**
  - Drag & Drop und „Hier platzieren“.
  - Platzierungsprotokoll, automatische Ablage im Rahmen „📥 Inbox“, „Alle in Inbox-Bereich legen“.
  - Abgleich Platzierungen ↔ Board, „Rückgängig“.
- **Darstellung:** Karten für alle Arten, Detailansicht `/i/:id`.
- **Web-Eingang:** „+ Hinzufügen“ (Link/Text/Datei).
- **Papierkorb.**

**Fertig, wenn:**

- Per Web oder API hinzugefügte Links, Texte, Bilder (inkl. HEIC), PDFs, Audios, Videos und Office-Dateien erscheinen korrekt mit Vorschau.
- Drag & Drop platziert an der Mausposition.
- Einträge mit Ziel-Board werden **genau einmal** automatisch platziert, auch mit zwei offenen Browsern.
- Karten sehen hell und dunkel gut aus.
- SSRF-Tests (privates Netz, Redirect auf private IP, DNS-Rebinding, IPv6) sind grün.

### Phase 3 – PWA und Teilen-Menü

**Aufgaben:**

- **PWA-Grundlagen:** dynamisches Manifest, Service Worker (Precache, Share-Target, IndexedDB-Warteschlange, Background Sync, Update-Hinweis).
- **Teilen:** Seite `/share` nach 5.6.
- **Mobil:** mobile Startseite mit Inbox-Liste, Installationshinweis.

**Fertig, wenn** (Test auf deinem Handy):

- Alle Fälle aus Spike A landen korrekt in der Inbox.
- Die Board-Wahl beim Teilen führt zur automatischen Ablage.
- Im Flugmodus Geteiltes wird später automatisch hochgeladen.
- Nach abgelaufener Sitzung führt das Teilen zum Login und danach weiter.
- Mehrere Fotos auf einmal bilden eine Gruppe.

### Phase 4 – Telegram-Bot

**Aufgaben:** alles aus 5.7: Verknüpfen, alle Nachrichtenarten, Alben, Größenlimit, Antworten mit Knöpfen, Befehle.

**Fertig, wenn:**

- Ein verknüpfter Nutzer schickt Link, Text, Foto, Album, PDF, Sprachnachricht, Video und Standort; alles kommt korrekt an.
- `#hashtag` legt direkt aufs Board.
- Die Knöpfe funktionieren.
- Unbekannte Absender werden ignoriert.
- Tests mit gemockter Bot-API sind grün.

### Phase 5 – E-Mail über Cloudflare

**Aufgaben:**

- Ingest-Endpunkt mit Bearer-Token.
- Rohmail-Ablage.
- DKIM- und Absenderprüfung.
- Einstellungsseite „Meine Absenderadressen“.
- Mail-Auswertung nach 5.8.
- Worker-Code, `wrangler.toml` und eine Schritt-für-Schritt-Anleitung in `docs/SETUP.md`.

**Fertig, wenn:**

- Teilen aus Chrome per Gmail an `board@<domain>` ergibt eine Link-Karte mit Seitentitel.
- Anhänge werden zu Einträgen.
- `#hashtag` im Betreff funktioniert.
- Mails mit fremdem oder gefälschtem Absender werden abgelehnt.
- Bei gestopptem Server landet die Mail in deinem Gmail.
- Tests mit Mail-Fixtures sind grün: Gmail-Teilen, HTML-only, Signatur, Weiterleitung, mehrere Anhänge.

### Phase 6 – Produktivbetrieb und Härtung

Grundgerüst schon ab Phase 0 nutzen, hier vervollständigen.

**Aufgaben:**

- **Installation:** `setup-vm.sh`, Produktiv-Compose, Update-Skript.
- **Backups:** Backup-Jobs, Aufräum-Jobs, `docs/BETRIEB.md` mit Wiederherstellung.
- **Härtung:** Sicherheits-Header und CSP, Ratenbegrenzungen.
- **Überwachung:** Admin-Seite „System“.
- **Abhängigkeiten:** Dependabot/Renovate einrichten.

**Fertig, wenn:**

- Eine frische VM ist mit `docs/SETUP.md` in unter 30 min lauffähig.
- Die Wiederherstellung aus Backup ist einmal erfolgreich getestet.
- Der Security-Header-Check ist grün (CSP ohne Verstöße in der Konsole).

### Phase 7 – Volltextsuche

**Aufgaben:** FTS5 nach 5.9, `extract_article` aktivieren, Index-Pflege, Such-API, Suchdialog, Sprung zum Element.

**Fertig, wenn:**

- Suche nach einem Wort aus einer PDF, einem Artikel, einer Haftnotiz oder einem Boardnamen findet den Treffer.
- Ein Klick springt an die richtige Stelle.
- Wortteile werden gefunden.

### Phase 8 – OCR

**Aufgaben:** nach 5.10.

**Fertig, wenn:**

- Text auf einem Foto bzw. Screenshot und in einem gescannten PDF ist in der Detailansicht sichtbar und auffindbar.
- Die UI bleibt während der OCR flüssig.

### Phase 9 – Sprachnachrichten → Text

**Aufgaben:** Whisper-Container, Modell-Download-Skript, `transcribe_audio`, Anzeige in Karte und Detailansicht, Suche.

**Fertig, wenn:**

- Eine Telegram-Sprachnachricht und eine per Teilen-Menü geschickte WhatsApp-Sprachnachricht werden auf Deutsch transkribiert.
- Die Dauer ist auf deinem Mini-PC gemessen und in `docs/BETRIEB.md` dokumentiert.

### Phase 10 – Feinschliff (optional, nach Rücksprache)

- Passkeys.
- Links und PDFs beim Einfügen oder Ablegen direkt auf der Zeichenfläche als Karte.
- Board-Vorschaubilder im Dashboard.
- Telegram-Dateien > 20 MB über einen lokalen Bot-API-Server.
- Ordner/Tags für Boards.

---

## 10. Teststrategie

- **Unit (Vitest):**
  - URL-Erkennung und -Normalisierung, Hashtags, Payload-Normalisierung (Android-Varianten: URL in `text`, Titel + URL, nur Datei …).
  - Mail-Auswertung (Fixtures), Absender-Normalisierung.
  - `safeFetch`/SSRF (inkl. Redirect- und Rebinding-Fälle).
  - Abgleichsregel und Sortierung, Rasterplatzierung im Inbox-Rahmen.
  - FTS-Query-Bau, Retention-Regeln der Snapshots.
- **Integration** (Fastify `inject` + temporäre SQLite):
  - Auth-Abläufe, Rechte, Einträge-API, Share-Idempotenz.
  - Ingest-E-Mail mit DKIM-Mock.
  - Telegram-Handler mit gemockter API.
  - Jobs mit kleinen echten Dateien (Bild, PDF, Audio, Video) im CI-Container.
- **E2E (Playwright, Chromium):**
  - Login, Board anlegen.
  - Zwei Browser-Kontexte synchronisieren.
  - Inbox-Drag-&-Drop.
  - Share-Target-Simulation: Formular-POST mit Dateien an `/share-target` bei aktivem Service Worker.
- **Manuelle Checkliste** (für dich, in `docs/STATUS.md` pro Phase): Tests am Handy, Telegram, E-Mail, Dark Mode, offline.
- **Pflicht:** CI läuft bei jedem Push; ohne grüne CI kein Release-Image.

---

## 11. Risiken und Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| PWA erscheint auf deinem Handy nicht im Teilen-Menü (WebAPK-Erzeugung, Browser) | Spike A ganz am Anfang. Chrome verwenden. Fallback: Telegram und E-Mail sind gleichwertige Kanäle; zusätzlich wäre die Android-App „HTTP Shortcuts“ möglich (nach Rücksprache) |
| Uploadlimits (Cloudflare 100 MB, Telegram 20 MB, Mail 25 MB) | klare Fehlermeldungen; große Videos über die PWA |
| Seiten blockieren Link-Vorschauen (Instagram, Facebook, Amazon) | oEmbed wo möglich; saubere Fallback-Karte |
| Viele Karten machen das Board langsam | Platzhalter beim Herauszoomen; Test mit 300 Karten |
| Excalidraw-Updates ändern APIs | Version pinnen; Upgrades bewusst und mit E2E-Tests |
| Schwache Hardware: OCR/Transkription langsam | Queue mit Parallelität 1, asynchrone Anzeige; `WHISPER_URL` auf stärkeren Rechner umstellbar |
| Datenverlust | zwei Backup-Ebenen, getestete Wiederherstellung, Snapshots pro Board, Papierkorb |
| Öffentliche Erreichbarkeit | Pflichtregeln aus Abschnitt 8; optional Cloudflare WAF/Access |
| Gemeinsame Inbox: alle sehen alles | ausdrücklich so gewünscht; in der Einladung erwähnen |

---

## 12. Manuelle Schritte für dich

Das umsetzende Modell schreibt dazu ausführliche Anleitungen in `docs/SETUP.md` und sagt dir jeweils Bescheid, wann ein Schritt dran ist.

1. **Proxmox:** VM anlegen (Debian 13, 2 vCPU, 3–4 GB RAM, 40 GB Disk), Debian installieren, SSH-Schlüssel hinterlegen. Den Rest erledigt `setup-vm.sh`.
2. **Domain:** Subdomain festlegen, z. B. `board.<deine-domain>`.
3. **Cloudflare Tunnel:** Tunnel anlegen, Token in `.env` (`CF_TUNNEL_TOKEN`), Public Hostname → `http://app:3000`.
4. **GitHub:** Actions aktivieren. Bei privatem Repo ein Token mit `read:packages` für die VM anlegen.
5. **Erste Anmeldung:** Setup-Link aus dem Log öffnen (`docker compose logs app`), Admin-Konto anlegen.
6. **Handy:** Chrome → `https://board.<domain>` → einloggen → „App installieren“ → „Whiteboard“ im Teilen-Menü anpinnen.
7. **Telegram** (Phase 4): Bei @BotFather einen Bot anlegen (Name, Username), Token in `.env`. Danach in der App „Telegram verbinden“.
8. **E-Mail** (Phase 5):
   1. Cloudflare Email Routing aktivieren.
   2. Gmail als Ziel verifizieren.
   3. Worker deployen (Anleitung; `wrangler` per `npx`).
   4. Regel `board@<domain>` → Worker.
   5. In der App deine Absenderadresse eintragen.
9. **Weitere Nutzer:** Einladungslinks erzeugen und verschicken. Jede Person installiert die PWA, verknüpft Telegram und trägt Absenderadressen ein.

---

## 13. Bewusst nicht im Umfang (spätere Ideen)

- **WhatsApp-Anbindung:** Gründe in 2.2. Technisch wäre sie später über denselben Ingest-Kern nachrüstbar.
- **KI-Zusammenfassungen/Tags:** Wäre über die Job-Queue als eigener Prozessor ergänzbar.
- **Öffentliche Lese-Links** für Personen ohne Konto.
- **Kommentare, Abstimmungen, Timer, Vorlagen** (Miro-Extras).
- **Offline-Bearbeitung von Boards:** Offline ist nur das Teilen (Warteschlange) möglich.
- **iOS-Teilen-Menü:** Technisch nicht möglich; iPhone-Nutzer nehmen Telegram oder E-Mail.
