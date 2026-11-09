# Management Cockpit – Matrix- und Artifact-Verknüpfung v1

Status: AP 11, Shadow-/Read-only-Iteration

## Zweck

Cockpit, Matrix-Fachraum, Kanban-Quellen und Nextcloud-Artefakte werden auf dieselben Management-Topics und Governance-Decisions projiziert. Die Projektion schreibt weder in Matrix noch in Kanban, Nextcloud oder die Artifact Registry.

## Gemeinsame Identität

Jede kanalübergreifende Entscheidung verwendet einen stabilen Marker:

`DECISION_ID: decision_<id>`

Explizite `decision_id`-/`decisionId`-Felder und dieser Marker haben Vorrang. Mehrere blockierte Quellen mit derselben gültigen Decision-ID werden als eine Governance-Decision mit mehreren `source_refs` dargestellt. Matrix-Quellen werden über ihre Event-ID als Kanal `matrix` ausgewiesen.

Wenn kein expliziter Marker existiert, wird nur bei einer starken Identität zusammengeführt: dasselbe Management-Topic, dieselbe Entscheidungsklasse, dieselbe Sensitivität, dieselbe optionale Ressource und eine exakt gleiche, ausreichend spezifische Entscheidungsfrage. Kurze oder nur ähnliche Fragen bleiben getrennt.

## Abschluss über einen anderen Kanal

Enthält eine abgeschlossene Quelle denselben expliziten Decision-Marker, erhält die gemeinsame Decision den Status `resolved`. Aufgelöste Decisions werden nicht mehr in Lage, Standard-Entscheidungsliste oder Risiken als offen angezeigt. Die Detailansicht bleibt für Audit und Readback erreichbar.

AP 11 simuliert noch keine Schreibaktion. Der Matrix-Notifier wird erst nach Shadow-Validierung so erweitert, dass er den projizierten Marker unverändert übernimmt. Das Cockpit schreibt ebenfalls noch keine Entscheidungen zurück.

## Fachraum-Verknüpfung

Die Raumkonfiguration wird ausschließlich lesend aus `matrix-agent-rooms.json` geladen.

Priorität:

1. explizite sichere Raum-ID an einer Quellkarte;
2. ein zum expliziten Topic-Hashtag passender Fachraum;
3. der konfigurierte Fachraum des verantwortlichen Agenten.

TWL-Räume werden in der allgemeinen Managementprojektion nie als Deep-Link verwendet. Die UI zeigt den Link als „Im Fachraum öffnen“ und öffnet `matrix.to` in einem neuen Browserkontext.

## Artifact-Verknüpfung

Die bestehende AgentOS Artifact Registry reicht für die read-only Projektion aus. Eine Änderung an `agent_os_artifacts.py` ist in AP 11 nicht erforderlich.

Ein Artefakt wird verknüpft, wenn seine `kanban_task` zu einer Topic-Quelle gehört oder sein explizites Topic mit einem Quell-Hashtag übereinstimmt. Projiziert werden ausschließlich:

- Artifact-ID,
- Typ,
- Titel,
- Nextcloud-Pfad,
- Lifecycle-Status.

Notizen und Dateiinhalte werden nicht übernommen.

## TWL-Firewall

Folgende Quellen werden vor Topic-, Decision-, Link- und Audit-Projektion ausgeschlossen:

- Board `twl-netze-private`;
- private, unklare, gemischt-sensitive oder TWL-private Sensitivitäten;
- TWL-Domänen und TWL-Nextcloud-Pfade;
- rohe Karten aus `twl-netze-bridge`.

Aus `twl-netze-bridge` sind nur explizit sanitizte `STEERING_SIGNAL`, `SANITIZED_EXPORT`, `SANITIZED_BRIDGE` oder `sanitizedForBridge=true` zulässig. Auch dann wird kein TWL-Raum oder TWL-Artefakt in die allgemeine Projektion übernommen.

Automatisierte Negativtests prüfen, dass private Titel, Entscheidungsfragen, Nextcloud-Pfade, Artefakttitel und Matrix-Raum-IDs nicht im serialisierten Projektionsobjekt vorkommen.

## Schema und API

Schema v4 ergänzt `governance_decisions.source_refs_json`. Decision-Responses enthalten zusätzlich den sicheren Fachraum und die nicht sensitiven Topic-Artefakte. Standardlisten liefern nur offene Decisions; ein expliziter Statusfilter kann Audit-Zustände lesen.

Legacy-Endpunkte und die Legacy-HITL-Liste bleiben unverändert.

## Aktivierungsgrenze

AP 11 ändert nicht:

- `/home/clawd/.hermes/scripts/agent_os_topic_hitl_notifier.py`;
- `/home/clawd/.hermes/scripts/agent_os_artifacts.py`;
- Matrix-Nachrichten oder Räume;
- Kanban-Karten;
- Nextcloud-Dateien;
- die produktive Management-Datenbank.

Eine Write-Aktivierung ist erst nach Shadow-Review und einem separaten Rollout-Gate zulässig.
