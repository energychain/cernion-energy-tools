# Controllability Submission Cockpit

`controllability_submission_cockpit` is a read-only evidence gate for Steuerbarkeitscheck submission and cycle handover work. It makes organizational submission readiness visible without creating a new compliance platform, queue, filing engine or control-execution path.

## Read-Only Surface

- Moleculer action: `dashboard-api.controllabilitySubmissionCockpitStatus`
- HTTP route: `GET /api/dashboard/controllability-submission-cockpit`
- Capability key: `controllability_submission_cockpit`
- Safety: `read_only`

## Evidence Fields

- `submissionId`
- `submissionDeadline`
- `coordinator`
- `sourceList`
- `dataReconciliationStatus`
- `reasonCatalog`
- `assetGroupStatuses`
- `openMeasures`
- `handoverDecision`
- `handoverOwner`
- `nextCycleTasks`
- `deadlineRisks`
- `sourceEvidenceRefs`

Missing evidence is returned as positive follow-ups so the dossier can state which fact becomes possible once a source, owner, reconciliation result, reason catalog, asset-group status, open measure or handover decision is supplied.

## Side-Effect Guards

The first slice must not call:

- `hitl.create`
- `grid-operations.executeControl`
- `cls.executeControl`
- `smgw.switch`
- `device-control.execute`
- `mako.dispatch`
- `billing.release`
- `settlement.prepareBilling`
- `settlement.exportA96`
- `external.connector.call`
- `personal-agent.execute`

The capability is consumed through Capability Broker routing, the Hydration Registry allowlist and the Slim Answer Dossier formatter. No Personal-Agent hardcoding or one-off n8n branch is required.
