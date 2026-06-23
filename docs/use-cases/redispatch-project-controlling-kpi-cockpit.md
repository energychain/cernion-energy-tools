# Redispatch Project Controlling KPI Cockpit

## Product Cut

This use case exposes a narrow, read-only Redispatch project-controlling evidence gate. It connects supplied Redispatch audit, datasource, MaStR/asset, load-profile, settlement-readiness, owner, due-date, KPI, and blocker facts into a dossier-ready status.

## Service Boundary

- Action: `dashboard-api.redispatchProjectControllingKpiCockpitStatus`
- Route: `GET /api/dashboard/redispatch-project-controlling-kpi-cockpit`
- Capability: `redispatch_project_controlling_kpi_cockpit`
- Safety: `read_only`

The action classifies supplied facts only. It does not fetch operational Redispatch, settlement, datasource, HITL, VDMI, task, asset, MaStR, or Lastgang data.

## Status Model

- `needs_redispatch_audit`
- `needs_source_health`
- `needs_asset_evidence`
- `needs_load_profile_evidence`
- `needs_settlement_readiness`
- `needs_owner`
- `blocked_by_decision_gap`
- `ready_for_project_review`

## Evidence Contract

Important inputs:

- `cockpitId`, `gridOperatorId`, `period`
- `redispatchAuditId`, `settlementRef`, `vdmiProcessId`
- `taskId`, `taskStatus`, `taskOwner`, `dueDate`
- `hasRedispatchAudit`, `hasAssetEvidence`, `hasMastrEvidence`, `hasLoadProfileEvidence`
- `hasSettlementReadiness`, `hasKpiReference`
- `datasourceHealth`, `sourceFreshness`, `qualityStatus`, `staleSources`
- `blockedDecision`, `decisionBlocker`, `missingEvidence`

The response includes `projectContext`, `taskSignals`, `kpiSignals`, `sourceHealth`, `evidenceGaps`, `decisionBlockers`, `positiveFollowUps`, `sourceActions.notCalled`, and `dossierEvidence`.

## Reuse Mapping

- Redispatch audit source: `redispatch-expost.audit`, `redispatch-expost.list`
- Settlement reference: `settlement.calculateRedispatch` as referenced source only
- Datasource and datapoint quality: `datapoint.health`, `datasource-registry.get`
- Asset and MaStR evidence: `assets.effective`, `mastr-quality.audit`
- Owner/blocker context: `vdmi.dossier`, `vdmi.findings`, `hitl.list`
- Report rendering: `presentation.render`

## Out Of Scope

- No Redispatch order or execution.
- No settlement, billing, A96 export, tariff, or device-control mutation.
- No task/workflow/HITL/VDMI creation or mutation.
- No datasource ingestion, datapoint write, MaStR import, or asset override.
- No external connector, notification, broad cockpit UI, one-off n8n branch, or Personal Agent hardcoding.
