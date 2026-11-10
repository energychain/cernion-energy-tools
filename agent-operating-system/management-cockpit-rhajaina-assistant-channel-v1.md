# Management-Cockpit: Rhajaina Assistant Channel v1

## Zweck und aktueller Status

AP16 ergänzt das Management-Cockpit um einen gebundenen Gesprächskanal zum bestehenden
Hermes-Profil `rhajaina`. Der Kanal unterstützt Managementklärung im Kontext eines Cockpit-Objekts,
ist aber kein zweiter Kanban-, Matrix- oder AgentOS-Steuerpfad.

Stand dieses Pakets:

- Implementierung und Konfiguration liegen ausschließlich im isolierten Worktree.
- `enabled` ist standardmäßig `false`.
- Der einzige zulässige Modus ist `read_only`.
- Writes und Matrix-Handoff sind technisch auf `false` festgelegt.
- Es gab keine produktive Flagänderung, keinen Deploy und keinen Prozessneustart.
- Die AP16-Telemetrie liest die Assistant-Datenbank optional und ausschließlich aggregiert.

## Betriebsgrenze

Rhajaina darf im Assistant Channel erklären, zusammenfassen, nachfragen und Vorschläge formulieren.
Sie darf dort keine Kanban-Karte verändern, keinen Scope registrieren, keine Nachricht senden, keinen
Matrix-Handoff auslösen, keine Datei schreiben und keine externe Aktion ausführen. Cockpit-Quellen
und Assistant-Datenbank sind getrennte Zustände. Eine Assistant-Antwort ist weder Freigabe noch
Nachweis einer operativen Ausführung.

Der Transport ist auf das Profil `rhajaina`, den CLI-Transport, `safeMode: true`, Toolset `bot_room`,
einen Turn und leere `extraArgs` begrenzt. Eine SOUL- oder Promptanweisung ersetzt diese technischen
Grenzen nicht.

## Ausbaustufen A–E

### Welle A – lokaler, deaktivierter Read-only-Kern

- versionierte Policy mit Default `enabled: false`;
- profilgebundener Hermes-CLI-Transport mit Wall-Clock-Timeout und Run-Budget;
- getrennte, mode-`0600` Assistant-SQLite-Datenbank;
- Konversationen, Runs, idempotente Client-Message-Verarbeitung und fail-closed Kontextauflösung;
- keine produktive Aktivierung.

Gate A: Konfigurations-, Store-, Service-, Transport- und Privacy-Tests sind grün; ein fehlender oder
privater Kontext ruft den Transport nicht auf. Rollback: Prozess nicht mit aktivierter Policy starten
beziehungsweise `enabled: false` beibehalten.

### Welle B – kontrollierte interne Preview

- Assistant-Panel nur in einer isolierten internen Preview;
- Session-Authentifizierung bleibt unverändert erforderlich;
- echte Read-only-Cockpit-Kontexte werden mit synthetischen, nicht sensitiven Fragen geprüft;
- Telemetrie und Logs werden auf Text-, ID- und Secret-Leaks geprüft.

Gate B: Browser-Smoke, API-Vertrag, Auth-Fehlerpfad, Kontext-Isolation, Timeout und Restart-Recovery
sind belegt. Produktiver PM2-Prozess, Proxy und Kanban-Quellen bleiben unverändert. Rollback:
Preview-Prozess stoppen und Preview-Port entfernen.

### Welle C – begrenzter Shadow-Betrieb

- Aktivierung nur für benannte interne Operatoren und nicht sensitive Managementobjekte;
- Assistant-Antworten bleiben Vorschläge ohne operative Wirkung;
- mindestens 14 unterschiedliche Telemetrietage;
- Fehler-, Latenz-, Klärungs-, Kontextablehnungs- und Größenwerte werden fachlich geprüft.

Gate C: keine Privacy-Verletzung, keine Quellenmutation, keine ungebundene Sessionfortsetzung und
kein pathologischer Fehler-/Timeouttrend. Intent-, Dedupe- oder Proposal-Werte gelten nur bei
explizit typisierten Events als verfügbar. Rollback: `enabled: false`, Prozess neu laden, Assistant-
Route nicht mehr anbieten; bestehende Assistant-Datenbank unverändert für Audit sichern.

### Welle D – Anhänge und strukturierte Handoffs als eigener Entscheid

- erst nach separater Datenklassifikation und Threat Model;
- erlaubte Typen, Größen, Malwareprüfung, Aufbewahrung und Löschung müssen festgelegt sein;
- Binaries benötigen einen getrennten, nicht öffentlich erreichbaren Store;
- Kontextreferenzen dürfen keine lokalen Pfade, Tokens oder privaten Quellen offenlegen;
- ein Matrix- oder Kanban-Handoff braucht einen eigenen typisierten Preview-/Freigabeprozess.

Gate D: Privacy Review, Storage- und Löschvertrag, negative Uploadtests und ausdrückliche Freigabe.
Rollback: Attachment-/Handoff-Flag deaktivieren, neue Annahme stoppen, Quarantäne und Audit nach dem
separaten Retention-Vertrag behandeln. Welle D ist **nicht** durch AP16 v1 freigegeben.

### Welle E – optionaler produktiver Kanal

- nur nach Abnahme der Wellen A–D und ausdrücklichem Betriebsentscheid;
- festgelegte SLOs, Incident Owner, Backup/Restore, Kapazitätsgrenzen und Nutzerkreis;
- Writes bleiben getrennt und benötigen weiterhin den bestehenden Scope-/HITL-Prozess;
- Telemetrie bleibt beobachtend und darf Routing oder Freigaben nicht automatisch steuern.

Gate E: Last-Known-Good, Restore-Smoke, Security Review, 14-Tage-Nachweis und dokumentierte
Rollback-Verantwortung. Rollback: Assistant deaktivieren und auf das unveränderte Management-
Cockpit ohne Assistant zurückfallen; kein Kanban-Restore ist für diesen UI-Rollback erforderlich.

## Ein-Klick-Kontextwechsel

`Mit Rhajaina besprechen` ist der vorgesehene Ein-Klick-Einstieg für Topic, Decision, Department,
Outcome, Risk und Wakeup. Das Cockpit:

1. sperrt Senden und Texteingabe während des Wechsels;
2. sucht eine aktive Konversation mit exakt demselben `objectType` und `objectId`;
3. verwendet diese wieder oder legt genau eine gebundene Konversation an;
4. lädt deren Nachrichten vollständig innerhalb der Pagination-Grenze;
5. zeigt den neuen Kontext sichtbar an und entsperrt erst danach die Eingabe.

Während ein Run läuft, wird kein Kontextwechsel ausgeführt. Die Bindung ist keine Volltextsuche und
kein unscharfes Topic-Matching. Ein anderer Kontext erhält eine andere Konversation und Hermes-
Session. Kontextdaten werden serverseitig aus der Managementprojektion aufgelöst; der Browser darf
keinen freien Kontext-Payload einschleusen. Fehlt das Objekt, ist es privat/unklar/mixed-sensitive
oder überschreitet es die Größenbegrenzung, schlägt der Wechsel fail closed fehl.

## Attachment-Verhalten

AP16 v1 nimmt **keine Attachments** an. Es gibt weder Upload-Endpunkt noch Drag-and-drop, Clipboard-
Binary-Upload, Dateipfad-Auflösung oder Weitergabe von Management-Attachments an Hermes. Im Cockpit
sichtbare Quellen- oder Artefakthinweise sind Darstellungsdaten der bestehenden Projektion und
werden nicht automatisch zum Assistant-Anhang.

Operatoren dürfen sensible Inhalte nicht durch Einfügen in den Nachrichtentext umgehen. Benötigt
Rhajaina eine Datei, lautet das v1-Verhalten: konkrete Datei beziehungsweise Information als fehlend
benennen und im bestehenden verantwortlichen Fachprozess klären. Ein zukünftiger Attachment-Support
gehört ausschließlich in Welle D.

## Flags und feste Grenzen

Maßgeblich ist `hitl-cockpit/config/assistant-policy.json`:

| Feld                           | v1-Vertrag                                |
| ------------------------------ | ----------------------------------------- |
| `version`                      | exakt `1`                                 |
| `enabled`                      | Default `false`; einzige Aktivierungsflag |
| `mode`                         | exakt `read_only`                         |
| `writesEnabled`                | exakt `false`                             |
| `matrixHandoffEnabled`         | exakt `false`                             |
| `transport.type`               | exakt `cli`                               |
| `transport.safeMode`           | exakt `true`                              |
| `transport.profile`            | exakt `rhajaina`                          |
| `transport.toolset`            | exakt `bot_room`                          |
| `transport.maxTurns`           | exakt `1`                                 |
| `transport.source`             | exakt `tool`                              |
| `transport.extraArgs`          | leeres Array                              |
| `limits.maxMessageChars`       | höchstens 4.000                           |
| `limits.maxContextChars`       | höchstens 12.000                          |
| `limits.recentMessageCount`    | höchstens 50                              |
| `limits.sessionRotateMessages` | 2 bis 200                                 |

Ungültige, unlesbare oder erweiterte Konfiguration schlägt beim Start fehl. `writesEnabled` und
`matrixHandoffEnabled` sind keine vorbereiteten Aktivierungsflags; `true` ist im v1-Loader
unzulässig. Umgebungsvariablen dürfen den Pfad zu Policy und Datenbank wählen, aber die festen
Sicherheitswerte nicht aufweichen.

## Telemetrie und Datenschutz

Die AP16-Aggregation liest eine explizit übergebene Assistant-Datenbank mit SQLite `mode=ro` und
`query_only`. Erfasst werden nur Counts, terminale Run-Latenzen, feste Fehlerklassen, allowlistete
Intent-Klassen, Proposal-/Korrektur-/Dedupe-/Klärungszahlen, Kontextablehnungen und Bytegrößen.

Nicht erfasst oder exportiert werden:

- Nachrichten-, Summary-, Context- oder Event-Bodies;
- Conversation-, Run-, Message-, Client-, Object- oder Event-IDs;
- freie Fehlercodes oder freie Intentwerte;
- Sessionnamen oder Session-IDs;
- Attachment-Namen, Pfade, Inhalte oder Metadaten.

Ohne `assistantDatabase` ist `assistantChannel.available: false`; fehlende Beobachtung wird nicht als
Null interpretiert. Die Metriken steuern keine Aktivierung, Priorität, Antwort oder Aktion.

## Aktivierungscheckliste

Vor jeder Welle:

1. exakten Worktree, Commitstand und Diff prüfen;
2. fokussierte Tests, Syntaxcheck und `git diff --check` ausführen;
3. Policy, Datenbankpfad, Dateimodus und Profilbindung read-only prüfen;
4. Management- und Assistant-Quelle vor/nach dem Telemetrielauf hashen;
5. negative Privacy-, Kontext-, Timeout-, Dedupe- und Restart-Fälle prüfen;
6. Gate-Verantwortliche und Rückfallzeitpunkt protokollieren;
7. erst danach das für diese Welle zulässige Flag ändern.

## Rollback und Incident

Sofort auf `enabled: false` zurückfallen bei:

- Body-, ID-, Secret-, Attachment- oder privatem Kontext in Telemetrie/Logs;
- falscher Profil- oder Sessionbindung;
- Transportaufruf nach Kontextablehnung;
- unerwartetem Write, Matrix-Handoff oder externer Aktion;
- beschädigter Assistant-Datenbank, nicht auflösbarer Run-Lease oder unkontrollierter Retry-Schleife;
- überschrittenem Fehler-/Timeoutlimit des freigegebenen Gates.

Ablauf:

1. neue Assistant-Aufrufe stoppen und Flag deaktivieren;
2. produktive Managementansicht ohne Assistant verfügbar halten;
3. Assistant-Datenbank und relevante sanitisierten Logs read-only sichern;
4. keine fehlerhaften Runs automatisch wiederholen;
5. Prozessstatus und unveränderte Kanban-/Managementquellen prüfen;
6. Incident klassifizieren und erst nach neuer Gate-Abnahme wieder aktivieren.

Das Deaktivieren des Assistant Channel löscht keine Auditdaten und verändert keine Managementquelle.
Datenlöschung, Restore einer Assistant-Datenbank oder Token-/Proxyänderung sind separate, explizit
freizugebende Operationen.
