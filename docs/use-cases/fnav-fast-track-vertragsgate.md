# fNAV Fast-Track Vertragsgate

## Ziel

Das fNAV Fast-Track Vertragsgate ist eine read-only Entscheidungs- und Evidenzprojektion fuer Speicher-, Rechenzentrums- und Grosslastanfragen. Es fuehrt Netzsignal-Vorrang, Fahrplanpflicht, Mess- und Steuerdaten, Vermarktungsgrenzen, Vertragsstatus, Rechtsstatus, Abbruchkriterien und Owner in einer dossierfaehigen Statussicht zusammen.

Der erste Schnitt ist keine Vertragsplattform. Er macht vorhandene fNAV-, Netzfahrplan-, Finance-, VDMI-, Evidence- und Presentation-Bausteine ueber den #251 Capability-to-Dossier-Pfad konsumierbar.

## Datenvertrag

`dashboard-api.fnavFastTrackContractGateStatus` liefert eine deterministische Statussicht mit:

- `gateId`, `gridOperatorId`, `requestType`, `assetOrLoadType`
- `requestedCapacityKW`, `firmCapacityKW`, `flexibleCapacityKW`, `voltageLevel`
- `netzsignalPriorityPolicy`, `scheduleObligation`, `meteringRequirements`, `controlEvidenceRef`
- `marketingBoundaries`, `commercialImpact`
- `contractStatus`, `legalStatus`, `breakCriteria`
- `escalationOwner`, `ownerContact`, `vdmiProcessId`
- `decisionReadiness`, `missingEvidence`, `positiveFollowUps`
- `sourceActions.notCalled` als No-Call-Guard fuer Dossier und Smoke

## Gate-Stufen

- `ready_for_fast_track`: technische, kommerzielle, vertragliche, rechtliche und Owner-Evidenz ist vorhanden.
- `needs_contract_evidence`: fNAV-Profil, Fahrplanpflicht oder Vertragsstatus fehlen.
- `needs_control_evidence`: Mess-/Steueranforderung oder Steuernachweis fehlt.
- `needs_commercial_review`: kommerzielle Wirkung oder Vermarktungsgrenze fehlt.
- `requires_governance_decision`: Netzbetreiber-, Netzsignal- oder Owner-Evidenz fehlt.
- `blocked_by_legal_status`: Rechtsstatus ist offen oder nicht freigegeben.
- `stop_fast_track`: Abbruchkriterium oder Blocker stoppt den Fast-Track.

## Evidenzregeln

Pflichtquellen sind `fnav_profile`, `grid_operator_identity`, `netzsignal_priority_policy`, `schedule_obligation`, `metering_requirement`, `control_evidence_ref`, `contract_status`, `legal_status` und `owner_contact`.

Optionale Kontextquellen sind `commercial_impact`, `marketing_boundary` und `break_criteria`. Fehlende Pflichtquellen werden nicht als implizite Freigabe behandelt, sondern als positive Follow-ups fuer das Answer Dossier.

## Nicht-Ziele

- Keine neue Vertragsdatenbank, Approval-Engine oder automatische Anschlusszusage.
- Keine neue Netzfahrplan-, fNAV-, Finance-, Billing-, Settlement- oder Tariflogik.
- Keine HITL-Erzeugung aus Dossier-Hydration.
- Keine Device-Control-, SMGW-/CLS-, MaKo- oder externe Connector-Mutation.
- Kein Personal-Agent-Hardcoding und kein one-off n8n-Branch.
