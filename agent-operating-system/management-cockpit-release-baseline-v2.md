# Management-Cockpit Release-Baseline v2

Stand: 2026-11-11T09:06:47Z
Arbeitspaket: AP 17
Status: reproduzierbare, nicht produktiv ausgerollte Releasebasis

## 1. Vertrag und Grenzen

Diese Baseline ersetzt für künftige Cockpit-Code-Releases den unversionierten AP-0-Dateisnapshot. Ein Release wird ausschließlich aus einem konkreten Git-Commit und einer dokumentierten, secret-freien Runtime-Konfiguration erzeugt. Der Build liest keine Dateien aus dem Arbeitsbaum und keine Prozessumgebung mit Secrets.

Nicht Teil von AP 17 sind produktiver Cutover, PM2-/Proxy-Änderungen, Datenbank-Rebuilds, Board-Mutationen und ein Restore von Hermes-Kanban. Die Management- und Assistant-Datenbanken bleiben getrennte Cockpit-Daten; Kanban bleibt System of Record.

## 2. Kanonische Eingaben

1. ein vollständiger Git-Commit auf einem Branch, der `main` enthält;
2. `hitl-cockpit/config/release-runtime.example.json` oder eine geprüfte, inhaltlich gleich strukturierte Konfiguration;
3. keine Token, Passwörter, API-Keys, Credentials oder privaten Schlüssel.

Die Runtime-Konfiguration enthält nur:

- sichere Feature-Flags;
- absolute Pfade für Management-, Assistant- und Kanban-Datenbanken;
- die erforderlichen Hermes-Profile `infrastructure` und `rhajaina`;
- den verpflichtenden Board-Ausschluss `twl-netze-private`.

Secrets werden erst beim separat freigegebenen Prozessstart über den bestehenden Secret-Mechanismus bereitgestellt. Sie sind weder Build-Eingabe noch Artefaktbestandteil.

## 3. Release-Preflight

Aus dem Repository-Root:

```bash
node hitl-cockpit/bin/release-preflight.js preflight \
  --commit "$(git rev-parse HEAD)" \
  --base-ref origin/main \
  --profile-root /home/clawd/.hermes/profiles \
  --config hitl-cockpit/config/release-runtime.example.json
```

Der Preflight bricht ab, wenn:

- der Commit nicht exakt `HEAD` ist oder `main` nicht enthält;
- tracked Änderungen oder nicht freigegebene untracked Dateien existieren;
- Management-Schema v6 oder Assistant-Schema v10 fehlen;
- die committed Assistant-Policy nicht deaktiviert/read-only ist;
- Write-, Matrix-Handoff- oder Management-Default-Flags unsicher sind;
- Management- und Assistant-Datenbank nicht absolut, nicht getrennt oder innerhalb des Kanban-Pfads liegen;
- `infrastructure` oder `rhajaina` unter dem expliziten, lesbaren Profile-Root fehlen;
- Runtime-Konfiguration, Flags oder Pfadobjekt unbekannte Felder enthalten;
- Required-Profile/Board-Ausschlüsse nicht exakt dem Vertrag entsprechen;
- ein Pfad nicht normalisiert/absolut ist oder ein Wert secret-typischen Inhalt enthält.

Eine exakt benannte untracked Datei eines anderen Arbeitspakets darf ausnahmsweise mit wiederholbarem `--allow-untracked <repo-relativer-pfad>` ignoriert werden. Tracked Änderungen werden dadurch nie erlaubt. Für diesen Integrations-Worktree ist ausschließlich folgende AP-18-Datei als Ausnahme zulässig:

```bash
--allow-untracked agent-operating-system/rhajaina-assistant-channel-production-smoke-v1.md
```

## 4. Deterministischer Release-Build

```bash
commit="$(git rev-parse HEAD)"
node hitl-cockpit/bin/release-preflight.js build \
  --commit "$commit" \
  --base-ref origin/main \
  --profile-root /home/clawd/.hermes/profiles \
  --config hitl-cockpit/config/release-runtime.example.json \
  --output /tmp/agentos-cockpit-release-a
```

Das Artefakt enthält:

- `runtime/` mit den committed Dateien aus `server.js`, `package.json`, `README.md`, `bin/`, `config/`, `lib/` und `public/`;
- `runtime-config.json` in kanonisch sortierter JSON-Darstellung;
- `release-manifest.json` mit Releaseformat, Anwendungsversion, Commit, Schemaversionen und SHA-256 jedes Artefaktfiles.

Tests, Arbeitsbaumdateien, Profile, Datenbanken, Logs, Prozessmetadaten und Secrets werden nicht aufgenommen. Unbekannte Runtime-Felder sowie NUL-/Binärinhalte im Release-Scope werden fail-closed abgewiesen. Das Manifest enthält bewusst keinen Build-Zeitstempel. Gleicher Commit plus semantisch gleiche Runtime-Konfiguration erzeugen identische Dateien und Hashes.

Reproduzierbarkeit wird mit zwei leeren Zielen geprüft:

```bash
node hitl-cockpit/bin/release-preflight.js build \
  --commit "$commit" --base-ref origin/main \
  --profile-root /home/clawd/.hermes/profiles \
  --config hitl-cockpit/config/release-runtime.example.json \
  --output /tmp/agentos-cockpit-release-b

diff -ru /tmp/agentos-cockpit-release-a /tmp/agentos-cockpit-release-b
```

## 5. Last-Known-Good

Erst ein geprüftes, separat freigegebenes Artefakt wird als Last-Known-Good (LKG) promoted. Das Ziel muss noch nicht existieren; vorhandene LKG-Verzeichnisse werden nie überschrieben.

```bash
node hitl-cockpit/bin/release-preflight.js promote-lkg \
  --artifact /tmp/agentos-cockpit-release-a \
  --target /tmp/agentos-cockpit-lkg
```

Vor und nach dem Kopieren werden Dateisatz und alle Manifest-Hashes verifiziert. Für einen produktiven Pfad gelten zusätzlich Zugriffsschutz, Retention und ein freigegebenes Betriebsfenster.

## 6. Rollback-Dry-Run ohne Kanban-Restore

```bash
node hitl-cockpit/bin/release-preflight.js rollback-dry-run \
  --lkg /tmp/agentos-cockpit-lkg \
  --target /tmp/agentos-cockpit-rollback
```

Der Dry-Run:

1. verifiziert das LKG-Manifest;
2. stellt Cockpit-Code und dokumentierte Runtime-Konfiguration in einem neuen Ziel bereit;
3. verifiziert den wiederhergestellten Dateisatz erneut;
4. schreibt neben dem unverändert manifestkonformen Ziel `<ziel>-report.json` mit
   `kanbanRestorePerformed=false`.

Er stoppt oder startet keinen Prozess und liest, kopiert oder restauriert keine Kanban-Datenbank. Ein späterer produktiver Rollback besteht aus einem separat genehmigten Code-/Konfigurationswechsel auf das verifizierte LKG und anschließendem Legacy-Smoke; Kanban wird nicht global zurückgesetzt.

## 7. Verifikation und Abnahme

TDD-Nachweis: Die Gap-Tests scheiterten zuerst an beliebigen Untracked-Ausnahmen, unbekannten Runtime-Feldern, fehlender Profile-Prüfung und übersprungenen NUL-Inhalten. Nach der Korrektur deckt der fokussierte Test Preflight, exakt versionierte Untracked-Ausnahme, striktes Runtime-Schema, reale Profile, NUL-/Binärablehnung, deterministischen Build, LKG-Promotion und Rollback-Dry-Run ab.

Verbindliche Abnahmebefehle:

```bash
cd hitl-cockpit
node --test test/release-preflight.test.js
npm test
npm run check
cd ..
git diff --check
```

Zusätzlich werden nach dem AP-17-Commit zwei echte Builds in getrennten temporären Zielen verglichen, ein LKG in ein drittes temporäres Ziel promoted und daraus ein echter Rollback-Dry-Run in ein viertes temporäres Ziel ausgeführt. Die Ergebnis-Hashes müssen identisch sein und der Rollback-Report muss `kanbanRestorePerformed=false` enthalten.

Diese Abnahme erzeugt ausschließlich Dateien unter temporären Zielen. Produktive Boards, Datenbanken, Prozesse und Proxy-Konfigurationen bleiben unverändert.
