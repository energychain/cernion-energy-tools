# Management Cockpit – Topic- und Case-Aggregation v1

## Zweck

AP 9 bündelt belegbar zusammengehörige Kanban-Karten, Decisions und Outcomes zu verständlichen Management Topics. Die Projektion liest Kanban, Scoped-Approval-Ledger und Artifact Registry ausschließlich lesend. Sie verändert keine Quellkarte und erzeugt keine produktiven Aktionen.

## Verbindliche Matching-Reihenfolge

1. Expliziter Topic-Hashtag oder explizite Parent-/Source-Task-Referenz.
2. Gemeinsames, nicht sensibles Topic in der Artifact Registry.
3. Aktive, als `covered` bewertete Scope-Source-Task-Referenz.
4. Explizite CRM-, Lead-, Case-, Conversation-, Thread- oder Project-Referenz.
5. Exakter Board-/Owner-/Titel-Fingerprint nur als unsicherer Kandidat.
6. Ohne starken Beleg bleibt jede Karte ein eigenes Topic.

Ein Match über reine Wortähnlichkeit, gleiche Domain, gleichen Kundenbegriff oder einen nur vermuteten Zusammenhang ist ausgeschlossen. Exakte Titel-Fingerprints werden standardmäßig nicht automatisch zusammengeführt (`autoMergeExactFingerprint=false`). Sie erscheinen ausschließlich in den Projektionsdiagnosen mit `autoMerged=false`.

## Auditierbarkeit

Ein aggregiertes Topic enthält alle Quellreferenzen in `source_task_refs_json`. Decisions behalten ihre primäre `source_board`-/`source_task_id`-Referenz und verweisen zusätzlich auf das gemeinsame `topic_id`. Outcomes werden demselben Topic zugeordnet, bleiben aber über ihre ursprüngliche Quellkarte nachweisbar.

Die Zuordnungstabelle `projection_objects` verwendet ab Schema v2 eine Mehrfachbeziehung. Dadurch kann ein Topic mehrere Quellkarten und Boards referenzieren, ohne die primäre Auditquelle einer Decision zu verlieren.

## Schutzregeln

- `twl-private`, `private`, `secret` und `restricted` Artefakte werden nicht als Aggregationsbrücke verwendet.
- Fehlende Parent- oder Scope-Source-Tasks führen zu keiner spekulativen Zuordnung.
- Ein `unclear` Scope ist kein Aggregationsbeleg.
- Historische `scheduled`-Karten werden nur gelesen; die Aggregation ändert weder Status noch Wiedervorlagevertrag.
- Die Artifact Registry wird per Read-only-Dateideskriptor gelesen.
- Unsichere Kandidaten bleiben getrennt und werden nicht automatisch fusioniert.
- Ein automatisch aggregiertes Topic ist standardmäßig auf 50 Quellkarten begrenzt; größere oder durch mehrere Schlüssel verkettete Kandidaten werden getrennt und als unsicher gemeldet.
- Inkrementelle Läufe übernehmen die bestehende Topic-ID und die bereits belegten Quellreferenzen eines bekannten Mitglieds; vollständige Läufe bleiben die verbindliche Rekonsolidierung.

## Betrieb

Der Projektionslauf akzeptiert optional:

    --artifact-registry /pfad/zur/agent-os-artifact-registry.json

Ohne Angabe wird `<HERMES_HOME>/agent-os-artifact-registry.json` gelesen. Ist die Registry nicht verfügbar oder ungültig, läuft die Projektion konservativ ohne Artifact-Matches weiter.

Der Dry-Run berichtet insbesondere:

- Quellkarten und resultierende Topics;
- Anzahl tatsächlich aggregierter Topics;
- Zahl belegbar zusammengeführter Karten;
- Merge-Evidenz und Matching-Grund;
- unsichere, nicht automatisch zusammengeführte Kandidaten;
- Verfügbarkeit der Artifact Registry.

## Rückfall

AP 9 bleibt Teil der separaten Shadow-/Read-only-Projektion. Die Legacy-HITL-Liste und ihre Endpunkte werden nicht verändert. Ein Rückfall besteht aus dem Deaktivieren der Managementsicht beziehungsweise dem Verwerfen und Neuaufbauen der Managementdatenbank; Kanban-Quellen sind davon unberührt.
