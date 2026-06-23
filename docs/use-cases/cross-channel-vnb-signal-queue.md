# Cross-Channel VNB Signal Queue

## Ziel

Die Cross-Channel VNB Signal Queue macht operative Hinweise aus Mail, Chat,
Portalen oder Fachsystemen als dossier-faehige Evidenz sichtbar. Der erste
Slice ist eine read-only Statusprojektion ueber vom Caller gelieferte
Signalreferenzen und Zusammenfassungen.

## Nicht-Ziele

- Keine Mail-, Chat-, Portal-, Teams-, Slack-, Gmail- oder Fachsystem-Ingestion.
- Keine Speicherung privater Rohinhalte.
- Keine neue Queue-Persistenz, Scheduler, Notification, HITL, Persona-Inbox
  oder VDMI-Mutation.
- Keine MaKo-, Billing-, Settlement-, Tarif-, Vertrags-, Device-Control- oder
  Produktionsmutation.
- Kein Personal-Agent-Sonderweg und kein n8n-Einzelbranch.

## Datenvertrag

Ein `cross_channel_vnb_signal_queue`-Signal fuehrt:

- `signalId`
- `tenantId`
- `channel`
- `sourceSystem`
- `sourceRef`
- `receivedAt`
- `affectedProcess` / `processType`
- `riskType` / `riskSeverity`
- `ownerRole` / `ownerPersonaId`
- `dueAt`
- `evidenceStatus`
- `evidenceRefs`
- `nextDatapoint`
- `dedupeKey`
- `status`

Die API normalisiert diese Felder in `normalizedSignals`, `byProcess`,
`byRiskType`, `overdueSignals`, `needsOwnerSignals`, `needsEvidenceSignals`,
`readyForActionSignals`, `missingEvidence`, `positiveFollowUps` und
`dossierEvidence`.

## Datenschutz und Content-Minimierung

Die Queue speichert und formatiert nur Referenzen, Statuswerte und kurze
Caller-Zusammenfassungen. Private Nachrichtentexte, Mail-Bodies, Chatverlaeufe
oder Portal-Rohdaten gehoeren nicht in dieses Capability-Slice.

## Statuslogik

- Fehlender Owner: `needs_owner`
- Fehlende Quellenreferenz: `needs_source_reference`
- Fehlender Evidenzstatus oder fehlende Evidenzreferenz: `needs_evidence`
- Fehlende Frist: `needs_due_date`
- Ueberschrittene Frist: `overdue`
- Vollstaendige Evidenz: `ready_for_action`
- Blockierte Evidenz: `blocked`

## #251 Consumption Contract

Die Capability wird ueber `dashboard-api.crossChannelVnbSignalQueueStatus`
konsumiert, vom Capability Broker als `cross_channel_vnb_signal_queue`
geroutet, in der Evidence Registry beschrieben und in der Hydration Registry
als read-only Action erlaubt. Der Slim-Dossier-Formatter liefert nur
Queue-Status, Zaehler, fuehrende Risiken/Prozesse, fehlende Evidenz,
positive Follow-ups und explizite No-Call-Guardrails.
