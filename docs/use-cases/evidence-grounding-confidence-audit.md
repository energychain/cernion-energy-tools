# Evidence Grounding Confidence Audit

## Ziel

Der Evidence Grounding Confidence Audit macht fuer Cernion-Antworten sichtbar, ob eine
Aussage durch belastbare Evidenz, nur durch Routing-Sicherheit, durch Prompt-Annahmen
oder durch degradierte Tools gestuetzt ist.

Der erste Implementierungsschnitt ist ein read-only Dashboard-/Dossier-View:

- `dashboard-api.evidenceGroundingConfidenceAudit`
- `GET /api/dashboard/evidence-grounding-confidence-audit`

## Nicht-Ziele

- Keine zweite Antwortpipeline.
- Kein neuer LLM-Service.
- Keine RAG-Ingestion.
- Keine HITL- oder Interface-Placeholder-Erzeugung.
- Keine Mutation von Datasources, Datapoints, VDMI, Settlement, MaKo oder Personal-Agent-Sessions.

## Confidence-Arten

- `routingConfidence`: Wie gut passt die Anfrage zu einer Capability oder Action?
- `evidenceConfidence`: Wie belastbar sind Quellen, Claims, Scope und Toolstatus?

Eine hohe `routingConfidence` darf niemals automatisch eine hohe `evidenceConfidence`
erzeugen.

## Antwortstatus

- `ok`: Scope und belastbare Evidenz sind ausreichend.
- `needs_clarification`: Fachdomain oder Capability-Kontext fehlt.
- `hypothetical_scenario`: Die Anfrage ist als Szenario oder Annahme markiert.
- `tool_degraded`: Mindestens ein read-only Quelltool ist ausgefallen.
- `out_of_scope`: Scope-Filter wie Netzgebiet, Datasource oder Datapoint fehlen.
- `requires_operator_confirmation`: Netzbetreiberbestaetigte Evidenz fehlt.

## Quellenklassen

- `authoritative_registry`: Netzbetreiber-/Registry-/Datasource-Evidenz.
- `internal_process_evidence`: VDMI, Capability oder ausgefuehrte interne Action.
- `rag_chunk`: Knowledge-RAG-Chunk oder Dokumentquelle.
- `datapoint_health`: Health/Freshness/Completeness eines Datenpunkts.
- `user_or_prompt_hint`: Prompt- oder Nutzerhinweis ohne harte Evidenz.

## Positive Follow-ups

Fehlende Evidenz wird als `missingEvidence[]` und `positiveFollowUps[]` ausgegeben:

- `network_operator_confirmation` -> operator-confirmed evidence statt Szenarioannahme.
- `scope_filter_grid_area` -> Begrenzung auf Netzgebiet, Datasource oder Datenpunkt.
- `claim_source_ref` -> Claim kann auf Receipt, Datenpunkt, RAG-Chunk oder Action zeigen.
- `tool_failure_status` -> degradierte Confidence und Wiederholvoraussetzung.
- `domain_or_capability_context` -> eindeutige Fachdomain oder Capability.

## Beispiel

Eine Standort-Vorpruefung ohne Netzbetreiberbestaetigung und ohne Netzgebiet darf nicht
`ok` mit hoher Evidenzconfidence liefern. Sie bleibt `out_of_scope` oder
`requires_operator_confirmation` und nennt die fehlenden Datenpunkte als Follow-ups.
