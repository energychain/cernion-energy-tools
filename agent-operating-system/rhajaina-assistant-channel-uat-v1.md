# AP16 Rhajaina Assistant Channel – Browser-UAT A–E

Zeitpunkt: 2026-11-10T09:47:08+01:00
Ziel: `http://10.0.0.101:3938/management`
Worktree: `feat/agentos-management-cockpit-iteration`
Ergebnis: **Wellen-A/B-Dialog und realer Directive-Transport bestanden; produktive E-Abnahme bleibt governance-seitig gesperrt**

## Testaufbau

- Wellen A und B wurden gegen die reale Managementprojektion und das reale Hermes-Profil `rhajaina` im Shadow-Modus geprüft.
- Wellen C bis E wurden über denselben Browserpfad und Port 3938 gegen eine vollständig isolierte synthetische Management-/Kanban-Datenbank geprüft. Produktive Kanban-Quellen wurden dabei nicht als Write-Ziel verwendet.
- Nach dem UAT wurde Port 3938 wieder auf die reale Preview zurückgestellt.
- Reale Preview im Endzustand: `mode=shadow`, `writesEnabled=false`, `matrixHandoffEnabled=false`, leere Action-Allowlist.

## Welle A – Read-only-Dialog

Bestanden:

- globaler Rhajaina-Dialog mit realem Hermes-Turn;
- zwei aufeinanderfolgende Turns mit nachgewiesener Kontextkontinuität;
- persistenter Verlauf nach Browser-Reload;
- objektgebundene und globale Conversations bleiben getrennt;
- Kartenklick übermittelt im Browser nur Objektart/-ID; der Message-POST enthält nur `clientMessageId` und Text;
- Kontext-Chip zeigt Typ, Titel und stabile Objekt-ID;
- Wechsel auf ein zweites Thema und Rückkehr zum globalen Gespräch funktionieren per Klick;
- reale Managementprojektion blieb unverändert;
- private beziehungsweise nicht verfügbare Kontext-ID liefert HTTP 404.

Fehler:

1. Der globale Chat setzt am Kontextbereich zwar `hidden=true`, CSS rendert ihn dennoch mit `display:grid`. Dadurch erscheint ein leerer Kontext-Chip mit Entfernen-Schaltfläche.
2. Die 390-px-Mobilprüfung hat horizontalen Overflow. Bei `clientWidth=390` und `visualViewport.width=390` wächst das Layout auf `innerWidth=683`; das Assistant-Panel ist ebenfalls 683 px breit und wird abgeschnitten.

## Welle B – Shadow Routing

Bestanden:

- echter objektgebundener Chat;
- sichtbarer Themenwechsel ohne Textkommando;
- Rhajaina formuliert bei „Delegiere dieses Thema an Felix“ ausdrücklich einen Vorschlag und behauptet keine Ausführung;
- keine Quellmutation.

Ursprünglicher Befund, am 2026-11-10 behoben:

- Das reale Rhajaina-Profil lieferte trotz dreier eindeutiger Delegationsformulierungen keinen maschinenlesbaren `assistant_directive`-Block. Deshalb wurde kein `assistant_action_proposal` gespeichert und kein „Shadow-Vorschlag“-Artefakt im UI angezeigt.
- Die Stub-/Unit-Tests decken strukturierte Directives ab; der reale Transportvertrag ist damit praktisch noch nicht zuverlässig erfüllt.

## Welle C – Low-Risk Writes, isoliert

Bestanden:

- Policy `low_risk`, `writesEnabled=true`, Allowlist ausschließlich `delegate_followup`;
- strukturierter Follow-up-Vorschlag erscheint mit „Ausführen“ und „Verwerfen“;
- explizite Bestätigung schreibt genau einmal in die synthetische Kanban-Karte;
- exakter Readback mit Board `uat-safe`, Task `t_uat0001`, Before-/After-Fingerprint und Receipt;
- Wiederholungs-POST liefert dasselbe Receipt mit `deduplicated=true`;
- genau ein Kommentar und kein doppelter Write.

Fehler:

- UI-Kicker, Erklärung und Status bleiben auch im Modus `low_risk` bei „Read-only“. Das widerspricht der tatsächlich angebotenen Ausführung und ist vor einer Write-Aktivierung ein Blocker.

## Welle D – Scope-gedeckte Ausführung und Grenzen, isoliert

Bestanden:

- Policy `scoped`, Allowlist ausschließlich `set_owner`;
- Owner-Vorschlag erscheint;
- Bestätigung wird serverseitig mit HTTP 403 / `scope_not_covered` abgewiesen;
- synthetische Karte bleibt unverändert;
- private Kontext-ID liefert 404;
- keine Upload-/Datei- oder Dropzone-Steuerung vorhanden;
- Matrix-Handoff bleibt deaktiviert.

## Welle E – Produktivmodus-Sicherheitsgrenzen, isoliert

Bestanden:

- Policy `productive` mit enger Allowlist;
- automatische Ausführung ohne serverseitige Scope-Abdeckung wird mit `proposal.auto_execution_denied` / `scope_not_covered` blockiert;
- Proposal bleibt `shadow`;
- synthetische Karte und Kommentare bleiben unverändert;
- ein absichtlich verbotener Payload mit Zahlungsfeld wird fail-closed abgewiesen und erzeugt kein Proposal und keinen Write.

Nicht als produktiv abgenommen:

- Die reale Preview blieb richtigerweise im Shadow-Modus.
- Der Server-Scope-Checker liefert aktuell immer `covered:false`; eine positive produktive Ausführung ist im realen Previewbetrieb technisch nicht möglich.
- Gate 16-E einschließlich 14-Tage-Nachweis, Restore-/Security-Abnahme und Betriebsentscheid ist nicht erfüllt.

## Abschlussverifikation

- `233/233` Cockpit-Tests bestanden.
- `npm run check` bestanden.
- fokussiertes ESLint bestanden.
- Prettier bestanden.
- Repository-Build bestanden (`No build step required`).
- `git diff --check` bestanden.
- SQLite-Integrität aller 17 geprüften realen Quellen/Preview-Dateien: `ok`.
- Reale Managementprojektion blieb bytegleich.
- Zwei Live-Kanban-Datenbanken änderten sich parallel durch das laufende AgentOS: `stromdao-business-ops` und `twl-netze-bridge`. Die neuen Einträge stammen von Felix-, Mail-Intake-, Autonomy-Guard- und Bridge-Gate-Läufen; der Assistant-Preview-UAT lief in A/B ohne Writes und C–E ausschließlich gegen die synthetische UAT-Quelle.
- Endzustand Port 3938: reale Preview; Backend 3937 und HTTP-Proxy 3938 erreichbar; produktive Instanz 3927 unverändert erreichbar.

## Verbleibendes Aktivierungsgate

Der Welle-B-Abnahmeblocker ist behoben. Eine produktive E-Abnahme bleibt bis zum Governance- und 14-Tage-Gate gesperrt.

## UX-Nachtest – 2026-11-10T11:03:55+01:00

Die drei im vollständigen A–E-UAT gefundenen UX-Blocker wurden auf der realen Preview unter Port 3938 erneut im Browser geprüft:

1. Globaler Kontext: `hidden=true` wird durch eine verbindliche `[hidden]`-Regel respektiert. Der leere Kontext-Chip ist im globalen Gespräch nicht mehr sichtbar. Der positive Gegenfall wurde ebenfalls geprüft: Nach Klick auf „Mit Rhajaina besprechen“ erscheinen Typ, Titel und stabile Objekt-ID; „Globales Gespräch / neues Thema“ entfernt das Attachment wieder ohne Texteingabe.
2. Mobile 390 px: `clientWidth`, `visualViewport.width`, Dokumentbreite, Bodybreite, Panelbreite und Panel-Scrollbreite betragen jeweils 390 px. Das Panel liegt bei `left=0` und `right=390`; es gibt keinen horizontalen Overflow oder abgeschnittenen Drawer mehr. Lange Outcome-Titel und der Toast brechen beziehungsweise positionieren sich innerhalb des Viewports.
3. Moduswahrheit: Die reale Preview zeigt `Shadow-Assistenz` und `Shadow-Modus · bereit`. Die DOM-Prüfung der schreibfähigen Modi zeigt `Assistenz · begrenzte Aktionen`, `Assistenz · Scope-gedeckt` und `Produktive Assistenz` mit jeweils passender Beschreibung; keiner dieser Modi wird als Read-only bezeichnet.

Nach diesem Stand bestanden `236/236` Cockpit-Tests, Syntaxprüfung, fokussiertes ESLint, Prettier, Repository-Build und `git diff --check`. Port 3938 blieb auf der realen Preview im Shadow-Modus mit deaktivierten Writes.

## Welle-B-Nachtest – 2026-11-10T12:15:08+01:00

Der Directive-Vertrag wurde am realen Hermes-Profil und auf der realen Preview erneut geprüft:

1. Der Rhajaina-Transport verlangt jetzt für jede Antwort genau einen strikt begrenzten Directive-Block, beschreibt alle erlaubten Intents und Payloads und bindet Vorschläge an das serverseitig aufgelöste Zielobjekt.
2. Der bisher widersprüchliche Read-only-Text unterscheidet jetzt ausdrücklich zwischen verbotener Ausführung und erlaubtem, servergeprüftem Vorschlag.
3. Der Assistant-Service übergibt dem Transport neben dem sanitisierten Payload auch `objectType` und `objectId`. Zuvor erhielt das Modell nur den Payload und konnte das im Cockpit sichtbare Attachment deshalb nicht als gültiges Management-Zielobjekt erkennen.
4. Eine reale Transportprobe mit frischer Session sowie eine Probe mit fortgesetzter Hermes-Session lieferten jeweils `intent=delegate`, das exakte angeheftete Ziel und `assignee=Felix`.
5. Der Browser-Nachtest auf `http://10.0.0.101:3938/management` erzeugte für das angeheftete Thema `topic_ae0e81aa58f5df25362e832f` einen sichtbaren `SHADOW-VORSCHLAG` mit Proposal-ID. Rhajaina erklärte zugleich ausdrücklich, dass die Delegation nur vorgeschlagen und nicht ausgeführt wurde.
6. Preview-Endzustand blieb `mode=shadow`, `writesEnabled=false`, `matrixHandoffEnabled=false`; es erfolgte kein Kanban-Write und kein Matrix-Handoff.
