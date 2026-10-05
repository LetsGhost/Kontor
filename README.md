# Kontor

Desktop-Anwendung für die persönliche Finanzverwaltung (Electron, React, TypeScript).

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | App im Entwicklungsmodus starten |
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run build` | Produktions-Build nach `out/` |
| `npm run dist` | Windows-Installer nach `dist/` |

Meldet `npm run dev` nach einer frischen Installation „Electron uninstall“, wurde das Electron-Binary
nicht heruntergeladen. Dann einmal `node node_modules/electron/install.js` ausführen.

## Installer und Updates

`npm run dist` prüft Typen und Tests, baut die App und legt `dist/Kontor-Setup-<Version>.exe` ab. Der
Installer ist nicht signiert, Windows zeigt beim ersten Start deshalb eine SmartScreen-Warnung.

Ein Update ist bisher Handarbeit: Version erhöhen (`npm version patch`), `npm run dist`, den neuen
Installer ausführen. Er ersetzt die alte Installation; die Daten unter `%APPDATA%\Kontor` bleiben
unberührt. Ändert eine Version das Datenformat, migriert die App beim ersten Start und legt vorher ein
Backup an. Eine ältere App-Version weigert sich, neuere Daten zu öffnen, statt sie zu beschädigen.

Das App-Icon entsteht aus `scripts/make-icon.cjs` (`npm run icon`).

## Datenablage

Alle Daten liegen als lesbares JSON im Benutzerverzeichnis:

- Installierte App: `%APPDATA%\Kontor\data\`
- Entwicklung (`npm run dev`): `%APPDATA%\Kontor-dev\data\`

```
data/
  meta.json            Schema-Version
  areas.json           Bereiche
  accounts.json        Konten (mit areaId)
  categories.json      Kategorien (zwei Ebenen über parentId)
  recurring.json       Wiederkehrende Regeln
  budgets.json         Monatsbudgets je Kategorie
  transactions/2026.json   Buchungen, eine Datei pro Jahr
  attachments/         Belege (Fotos, PDFs), Dateiname = Hash des Inhalts
  backups/             die letzten 10 Stände als Ordnerkopie (ohne Belege)
```

Beträge sind ganze Cent. Die Schemas stehen in `src/shared/schemas.ts`.

## Aufbau

- `src/main` – Electron-Hauptprozess; nur er liest und schreibt Dateien (`storage/`)
- `src/preload` – typisierte IPC-Brücke `window.kontor`
- `src/renderer` – React-Oberfläche
- `src/shared` – Schemas und reine Fachlogik, von beiden Seiten genutzt

## Festgelegte Entscheidungen

- Erfassung manuell oder per CSV-Import (unter „Buchungen“). Der Import erkennt Trennzeichen, Vorspann
  und die üblichen Spaltennamen selbst, die Zuordnung ist von Hand änderbar. `importHash` verhindert
  doppelte Importe; importierte Buchungen, die zu einer wiederkehrenden Regel passen, erledigen deren Termin
- Konten: Giro und Sparkonto, nur EUR; Konten mit Buchungen werden archiviert statt gelöscht
- Bereiche (z. B. „Privat“, „Haushalt“): Jedes Konto gehört zu genau einem Bereich. Übersicht, Prognose,
  Buchungen, wiederkehrende Posten und Budgets zeigen immer nur den in der Navigation gewählten Bereich;
  Konten verschiedener Bereiche werden nie zusammengerechnet. Kategorien sind gemeinsam, Budgets gelten
  je Bereich. Die Regel dafür steht in `src/shared/scope.ts` (`viewOf`)
- Umbuchung ist ein eigener Buchungstyp. Innerhalb eines Bereichs zählt sie weder als Ausgabe noch als
  Einnahme; zwischen zwei Bereichen ist sie beim Quellbereich eine Ausgabe (mit wählbarer Kategorie)
  und beim Zielbereich eine Einnahme
- Kategorie-Vorschläge lernen aus der Historie, es gibt keine manuellen Regeln
- Wiederkehrende Posten erzeugen Vorschläge, gebucht wird erst nach Bestätigung (Betrag änderbar,
  verpasste Fälligkeiten einzeln)
- Prognose: Kontostand-Verlauf aus wiederkehrenden Posten plus Durchschnitt der variablen Posten der
  letzten drei abgeschlossenen Monate; Buchungen mit `recurringId` und Umbuchungen zählen nicht in den
  Durchschnitt, im laufenden Monat wird nur der noch nicht gebuchte Rest erwartet
- Monatsbudget je Kategorie, ohne Übertrag in den Folgemonat
- Aufteilung: Eine Buchung kann ihren Betrag auf mehrere Kategorien verteilen (`splits`, dann ohne eigene
  `categoryId`). Auswertungen, Budgets, Vorschläge und Export zählen je Teil (`categoryParts`)
- Kategorie-Vorschläge berücksichtigen neben Empfänger und Alter auch den Betrag (`amountCloseness`)
- Belege: Fotos werden vor dem Speichern auf 1600 px und JPEG verkleinert, PDFs bleiben unverändert. Belege
  ändern sich nie und liegen deshalb nicht in den Backups; gelöscht wird beim Start nur, worauf weder die Daten
  noch ein Backup zeigen
- Verträge: Wiederkehrende Posten können Laufzeitende, Verlängerung und Kündigungsfrist tragen (`contract`)
- Erinnerungen beim Start als Windows-Benachrichtigung, höchstens einmal am Tag, abschaltbar in den Einstellungen
- Autostart („Mit Windows starten“, nur in der installierten App, standardmäßig aus): Kontor startet mit
  `--autostart` ohne Fenster, prüft auf Erinnerungen und beendet sich sofort, wenn es keine gibt. Sonst wartet es
  zehn Minuten auf einen Klick auf die Benachrichtigung. Der Uninstaller entfernt den Eintrag
  (`installer/uninstall.nsh`)
- Export der gefilterten Buchungen als XLSX (eigener Schreiber in `src/shared/xlsx.ts`, keine Abhängigkeit) oder
  CSV für deutsches Excel; aufgeteilte Buchungen ergeben eine Zeile je Teil
- Löschen von Buchungen ohne Rückfrage, dafür mit „Rückgängig“
- Auswertungen bekommen Diagramme (Recharts), jeweils mit umschaltbarer Tabellenansicht
- Buchungen in der Zukunft sind erlaubt und zählen erst ab ihrem Datum zum Saldo
- Oberfläche deutsch, nur dunkles Theme; kein Auto-Update in V1
- Gestaltung „Kontorbuch“: warmes Schwarz, Papierweiß, Messing als einziger Akzent, Haarlinien statt
  Kästen, kaum Rundungen, IBM Plex Sans und Plex Mono für Beträge (Tokens in `src/renderer/src/app.css`)
- Keine Emojis: Icons kommen aus Lucide, Kategorien speichern einen Icon-Namen aus
  `src/renderer/src/icons.tsx`

## Meilensteine

1. Fundament: Storage, Schemas, Migrationen, Backups, Tests ✅
2. Konten und Buchungen ✅
3. Kategorien und Vorschläge ✅
4. Übersicht und Budgets ✅
5. Wiederkehrende Posten ✅
6. Prognose ✅
7. Windows-Installer ✅
8. CSV-Import ✅
9. Jahresrückblick, Verträge & Abos, Aufteilung, Belege, Export, Erinnerungen ✅
