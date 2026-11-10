# Management-Cockpit: Shadow-Metriken v1

## Zweck

AP 13 misst, ob die Cockpit-Iteration die Managementlast senkt und autonome, belegte Prozessabschlüsse erhöht. Die Messung hat ausschließlich beobachtende Wirkung. Sie verändert weder Kanban-Karten noch Decisions, Scopes, Wiedervorlagen, Matrix-Räume, Agenten-Routing oder Prioritäten.

## Betriebsvertrag

Der Exporter läuft immer mit folgenden Eigenschaften:

- `mode: shadow`
- `shadowOnly: true`
- `operationalEffect: false`
- `sourceWritePerformed: false`

Die Managementprojektion und die Kanban-Boards werden ausschließlich lesend geöffnet. Der Exporter kennt keinen Write-Modus. Unbekannte Argumente, insbesondere eine angenommene Option `--write`, werden abgewiesen.

Der einzige optionale Schreibvorgang ist das Anhängen eines sanitisierten Messpunkts an eine Telemetrie-JSONL. Diese Datei ist kein operativer Eingang und darf von keinem Agenten, Router, Classifier oder Cleanup-Prozess als Steuerungssignal verwendet werden. Sie wird mit Modus `0600` angelegt.

## Aufruf

Nur aktuelle Messung auf stdout, ohne Telemetriepersistenz:

```bash
node hitl-cockpit/bin/export-telemetry.js \
  --hermes-home /home/clawd/.hermes \
  --database /pfad/zur/management.db \
  --stdout-only
```

14-Tage-Historie aufbauen:

```bash
node hitl-cockpit/bin/export-telemetry.js \
  --hermes-home /home/clawd/.hermes \
  --database /pfad/zur/management.db \
  --history /home/clawd/.hermes/management-cockpit/telemetry-shadow.jsonl \
  --window-days 14
```

Ohne `--history` wird dieselbe Datei unterhalb des angegebenen Hermes-Home verwendet. Eine produktive Zeitplanung ist in AP 13 nicht eingerichtet; Aktivierung eines Cronjobs benötigt einen eigenen Betriebsentscheid.

## Metriken

### Managementlast

- aktuell sichtbare, fachlich reife Decisions;
- erste Projektion sichtbarer Decisions je Tag;
- Legacy-HITL-Kandidaten aus genau dem read-only Intake, den die Rückfallansicht verwendet;
- Verhältnis zwischen Legacy-Kandidaten und Management-Decisions.

Risiko- und Scope-Eskalationen bleiben auch dann sichtbar, wenn ihre Optionen noch unvollständig sind. Unreife gewöhnliche Governance-Kandidaten zählen nicht als sichtbare Managemententscheidung.

### Klassifikation

Erfasst werden Anzahl und Anteil der jüngsten Klassifikation je Quellkarte für:

- `AUTO_EXECUTE`
- `SCOPE_COVERED`
- `INFORM_ONLY`
- `DECISION_REQUIRED`
- `INPUT_REQUIRED`
- `RISK_ESCALATION`
- `SCHEDULED`
- `NOISE`

TWL-private Quellen werden vor der Aggregation ausgeschlossen.

### Entscheidungsverhalten

Soweit Audit-Events vorliegen, misst die Telemetrie:

- Wahl einer Option;
- Ablehnung;
- Rückfrage;
- Wiedervorlage;
- Delegation;
- Anteil abgelehnter Vorgänge mit Klassifikation `NOISE` oder `INFORM_ONLY`;
- Interaktionen mit einem konkreten nächsten Schritt.

AP 6 persistiert Shadow-Interaktionen absichtlich nicht. Bis eine spätere Write-Welle sanitisierten Audit erzeugt, stehen diese Quoten auf `available: false`; es werden keine Werte erfunden.

### Prozessqualität

- Medianzeit vom letzten belegten Outcome bis zur aufgelösten Decision, sofern ein belastbares Paar existiert;
- Topics mit mehr als einer offenen HITL und Zahl zusätzlicher HITLs;
- kanalübergreifend konsolidierte Decision-Quellen;
- autonom abgeschlossene Topic-Bündel mit Outcome und ohne offene Decision;
- Wiedervorlagen, die auf ein neues Signal warten;
- wiederholte Wiedervorlagen ohne Zustandsänderung;
- Mittelwert, Median, 95. Perzentil und Maximum der Quellkarten je Topic.

Aktive Gespräche und fällige Antworten werden nur aus explizit strukturierten Feldern gezählt. Fehlen solche Felder, bleibt `conversationMetricsAvailable: false`; Titel oder Bodies werden nicht heuristisch ausgewertet.

### Scope-Sicherheit

- offene Scope-Verletzungen beziehungsweise Risiko-Eskalationen;
- nachweislich verhinderte Aktionen, sofern ein sanitisiertes Audit-Event existiert.

Eine bloße Klassifikation wird nicht als tatsächlich verhinderte Aktion ausgegeben.

### Projektionsqualität

- Anzahl und Gesamtumfang der erfolgreich projizierten Boards;
- Zeitpunkt und Alter der jüngsten erfolgreichen Board-Projektion;
- unvollständige Decision-Projektionen;
- Board-Lesefehler des parallel ausgeführten Legacy-Intakes.

## Datenschutz und TWL-Grenze

Ein Messpunkt enthält ausschließlich Aggregationen und Zeitwerte. Verboten sind insbesondere:

- Mail-, Kommentar- oder Aufgaben-Bodies;
- Titel und Entscheidungsfragen;
- Empfehlungen und Signale im Wortlaut;
- Task-IDs und Source-Task-IDs;
- Anhänge, Gegenparteien und Evidenz-URLs;
- TWL-private Board-Inhalte.

`assertSanitized` verweigert das Schreiben, sobald ein verbotener Schlüssel im Snapshot vorkommt. Das private Board `twl-netze-private` und private Topic-Sensitivitäten werden bereits in der read-only SQL-Projektion ausgeschlossen.

## AP16: Assistant-Channel-Aggregate

`collectTelemetry` kann additiv eine Assistant-Datenbank über `assistantDatabase` lesen. Ohne diesen
expliziten Pfad bleibt `assistantChannel.available: false`; fehlende Daten werden nicht als Nullerfolg
interpretiert. Bestehende Aufrufer und der AP13-CLI-Exporter behalten damit ihren bisherigen Vertrag.
Die Datenbank wird per SQLite-URI mit `mode=ro` und `PRAGMA query_only=ON` geöffnet.

Der Block `assistantChannel` enthält ausschließlich:

- Summen für Konversationen, aktive Konversationen, Runs, Nachrichten und Events;
- Run-Anzahlen je festem Status;
- Stichprobengröße, Median und 95. Perzentil der terminalen Run-Laufzeit;
- Fehleranzahlen in festen Klassen: Kontextablehnung, Timeout, Busy, Identität, Restart,
  Validierung, Transport und Sonstige;
- Intent-Anzahlen für die feste Taxonomie `new_topic`, `resume_topic`, `status`, `decision`,
  `action`, `meta_control`, `unknown` und `other`;
- Proposal-, Korrektur-, Dedupe- und Klärungsanzahlen aus explizit typisierten Events;
- Kontextablehnungen aus Fehlerklasse beziehungsweise typisiertem Event;
- Byte- und Anzahl-Aggregate für User-/Assistant-/System-Nachrichten, Context Envelopes und
  Summaries.

Intent-, Proposal-, Korrektur-, Dedupe- und Klärungswerte werden nicht aus Nachrichtentexten
heuristisch abgeleitet. Nicht allowlistete Intent-Werte werden nur als `other` gezählt. Freie
Fehlercodes werden in feste Klassen überführt und nicht ausgegeben. Event-Payloads werden nicht in
den Snapshot übernommen. Die Aggregation enthält keine Conversation-, Run-, Message-, Client-,
Object- oder Event-IDs, keine Bodies und keine Attachments.

Diese Werte sind Qualitätsbeobachtung, kein Steuerkreis. Sie ändern keine Konversation, keinen Run,
keinen Kontext, keine Assistant-Antwort und keine Managementprojektion. Eine produktive
Assistant-Aktivierung oder ein neuer CLI-Parameter ist damit nicht freigegeben.

## 14-Tage-Vergleich

Pro Kalendertag wird für den Vergleich der jüngste Messpunkt verwendet. Gate C ist erst bei `coverageDays >= 14` messbereit. Verglichen werden mindestens:

- sichtbare Decisions;
- wiederholte HITL-Topics;
- autonome Prozessabschlüsse;
- Legacy-Kandidaten;
- Noise-Anteil;
- Projektionsalter.

Die Telemetrie bewertet diese Werte nicht automatisch und löst keine Eskalation aus. Fachliche Grenzwerte und eine spätere produktive Nutzung benötigen eine eigene Entscheidung nach Sichtung der Shadow-Daten.

## Abnahme AP 13

AP 13 gilt als technisch erfüllt, wenn:

1. alle Metriken deterministisch aus read-only Quellen berechnet werden;
2. Quellen vor und nach dem Lauf unverändert sind;
3. sensible Texte und Quellidentifikatoren nicht im Snapshot erscheinen;
4. fehlende Audit- oder Gesprächsdaten als nicht verfügbar ausgewiesen werden;
5. 14 tägliche Messpunkte vergleichbar gespeichert werden können;
6. keine Metrik Status, Routing, Priorität, Governance-Sicht oder Benachrichtigung beeinflusst.
