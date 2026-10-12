# Spikes (Phase 0)

Ergebnisse der Risiko-Tests aus PLAN.md Abschnitt 9, Phase 0. Abweichungen vom Plan sind markiert und werden vor Phase 1 mit dem Auftraggeber besprochen.

## Spike A – Teilen-Menü am Handy

**Aufbau:**

- Manifest dynamisch vom Server (`/manifest.webmanifest`) mit `share_target` (POST, multipart, `accept` inkl. `*/*`).
- Service Worker (`apps/web/src/sw/sw.ts`) fängt `POST /share-target` ab, legt Felder und Dateien in IndexedDB ab und leitet auf `/share?id=…` um.
- Die Seite `/share` zeigt die Felder und schickt alles an `POST /api/debug/share`. Der Server zählt nur Namen, Typen und Größen; Dateien werden verworfen, nichts wird gespeichert oder geloggt.
- Server-Fallback `POST /share-target` (falls der Service Worker noch nicht aktiv ist) leitet auf `/share?report=…` um.
- Zugang in Phase 0: einmal `/zugang?key=<SPIKE_ACCESS_KEY>` öffnen, danach gilt ein HttpOnly-Cookie (180 Tage).

**Lokal geprüft (Chrome Desktop, 12.10.2026):** Service-Worker-Abfang, IndexedDB, Umleitung, Upload und Anzeige funktionieren mit Text, URL und zwei Dateien (`image/jpeg`, `audio/ogg`).

**Test am Handy (12.10.2026, Android 10, Chrome 155):**

| # | Fall | Ergebnis |
|---|---|---|
| 1 | Installation als App (nicht nur Verknüpfung) | ✅ |
| 2 | „Whiteboard“ erscheint im Teilen-Menü | ✅ |
| 3a | Link aus Chrome | ✅ über den Service Worker; Seitentitel in `title`, **URL in `text`** (`url` leer) |
| 3b | markierter Text | nicht getestet |
| 3c | ein Foto aus der Galerie | nicht getestet |
| 3d | mehrere Fotos | nicht getestet |
| 3e | PDF aus „Dateien“ | nicht getestet |
| 3f | WhatsApp-Sprachnachricht | nicht getestet |
| 3g | Datei aus Google Drive | nicht getestet |
| 3h | YouTube-Link aus der YouTube-App | nicht getestet |
| 4 | `accept: "*/*"` funktioniert (z. B. `.docx`, `.zip`) | nicht getestet |

**Bewertung:** Das Hauptrisiko ist ausgeräumt: Die PWA lässt sich installieren und erscheint im Teilen-Menü. Wie im Plan erwartet, packt Android die URL in `text` – die Normalisierung (PLAN.md 5.5) muss URLs dort suchen. Dateien (Fotos, PDF, Audio, `*/*`) wurden auf Wunsch des Auftraggebers nicht einzeln getestet; sie werden in Phase 3 bei der Abnahme mitgeprüft.

Die empfangenen Felder stehen danach auf der Startseite unter „Zuletzt empfangen“ (nur im Speicher, gehen bei Neustart verloren).

## Spike B – Excalidraw-Integration

Geprüft mit `@excalidraw/excalidraw` 0.18.1, React 19.3, Chrome Desktop (1280×800), Testseite `/spike/excalidraw`.

| Punkt | Ergebnis |
|---|---|
| Selbst gehostete Schriften (`EXCALIDRAW_ASSET_PATH = "/"`) | ✅ Nunito, Assistant u. a. kommen aus `/fonts/`, keine CDN-Anfragen. Hinweis: Excalidraw hängt intern noch eine CDN-Adresse als Fallback an; mit der CSP aus Phase 6 bleibt sie wirkungslos. |
| Eigene Karte über `renderEmbeddable`/`validateEmbeddable`, Erkennung über `customData.wb` | ✅ funktioniert, hell und dunkel. Permalink `<origin>/i/<ULID>` wird auf jeder Domain akzeptiert. |
| **`convertToExcalidrawElements` für `embeddable`** | ⚠️ **Abweichung:** Die Funktion reicht `embeddable` unverändert durch (keine Standardwerte, keine Versionen). Lösung: mit `convertToExcalidrawElements` ein Rechteck erzeugen und `type: "embeddable"`, `link`, `customData` setzen (`createCardElement` in `ExcalidrawSpike.tsx`). Funktioniert einwandfrei. |
| Klick auf Karte | ✅ wählt aus; das Link-Popup von Excalidraw zeigt den Permalink (Fallback aus dem Plan). |
| Doppelklick → Detailansicht | ⚠️ Excalidraw nutzt den ersten Doppelklick, um die Karte zu „aktivieren“ (`pointer-events` an); die Karte selbst bekommt ihn nicht. **Lösung:** capturing `dblclick`-Listener am Container, der Karten per Treffertest erkennt → Details öffnen sich in einem Schritt. ✅ |
| Strg/Cmd+Klick → Link öffnen | ✅ ebenfalls per capturing `pointerdown` mit Treffertest; öffnet die Original-URL. |
| Drag & Drop aus der `Sidebar` an die Mausposition | ✅ capturing `drop`-Listener + `viewportCoordsToSceneCoords`; Position pixelgenau (Karte mittig unter dem Mauszeiger). „Hier platzieren“ (Bildmitte) ✅. |
| `updateScene` mit `CaptureUpdateAction.NEVER` (+ `reconcileElements`) | ✅ Fremdänderung bleibt nach mehrfachem Strg+Z erhalten; Strg+Z nimmt nur eigene Aktionen zurück. |
| Stil-Standards (`initialData.appState`) | ✅ Nunito, Rauheit 0, runde Ecken. |
| Haftnotiz (Rechteck mit gebundenem Text) | ✅ nach einer Korrektur: Das Label erbt sonst die Randfarbe `transparent` und ist unsichtbar → Label bekommt eine eigene Textfarbe. |
| **Dark Mode – Haftnotizen** | ⚠️ **Frage an den Auftraggeber:** Excalidraw invertiert im Dunkelmodus die ganze Zeichenfläche (Filter). Aus Pastellgelb `#FFF3BF` wird ein dunkles Oliv/Braun, Text wird hell. Karten (HTML) sind davon nicht betroffen und passen sich selbst an. |
| **Reihenfolge (Z-Order)** | ⚠️ **Frage an den Auftraggeber:** Karten liegen immer **über** gezeichneten Elementen (Excalidraw legt Embeddables als HTML-Ebene über die Zeichenfläche). Eine Haftnotiz lässt sich nicht über eine Karte legen. |
| **Link-Symbol an jeder Karte** | ⚠️ Excalidraw zeichnet an jedes Element mit `link` ein kleines blaues Link-Symbol (oben rechts), auch an Karten. Bei vielen Karten wirkt das unruhig. Ohne `link` rendert Excalidraw keine Karte. Abhilfe nur per Patch der Bibliothek (`pnpm patch`) – mit dem Auftraggeber zu klären. |
| 300 Karten | ✅ mit Einschränkung: Beim Verschieben Median 14 ms pro Bild (≈ 70 fps), 95. Perzentil 14 ms, gemessen auf dem Entwicklungs-PC. Einzelne Hänger beim Wechsel der Zoomstufe, wenn alle Karten neu rendern. Excalidraw hält alle Karten im DOM, auch unsichtbare. Platzhalter unter Zoom 0,3 greifen. Test auf Handy/Tablet steht aus. |

**Empfehlungen für Phase 1/2 (ohne Planänderung):**

- Karten-Elemente immer über `createCardElement` erzeugen (Rechteck → Embeddable).
- Doppelklick und Strg+Klick über capturing Listener am Container umsetzen.
- Haftnotiz-Label immer mit eigener Textfarbe anlegen.
