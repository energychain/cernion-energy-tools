# Wissenssicherung Governance Gate

Issue: #247

This use case defines a dossier-native governance view for knowledge-continuity readiness. It makes
primary knowledge locations, permission owners, admin continuity, handover documents, volatile
communication boundaries, retention risk and IT acceptance visible before a role change or critical
process handover happens.

## Boundary

Service: `knowledge-continuity-governance-gate`

The service is an evidence/status boundary. It is not a Teams, SharePoint, Loop, DMS or IAM
connector and does not mutate external collaboration systems.

- `POST /api/knowledge-continuity-governance-gate/evaluate`
  creates a non-consequential internal governance evidence record from provided facts.
- `GET /api/knowledge-continuity-governance-gate/:processId/status`
  returns read-only dossier-safe status and slim evidence.
- `GET /api/knowledge-continuity-governance-gate/gates`
  and `GET /api/knowledge-continuity-governance-gate/gates/:governanceGateId`
  expose tenant-scoped review data for operators.

## Source Actions

The gate references existing platform capabilities instead of duplicating them:

- `vdmi.create` for process and task structure.
- `vdmi-evidence.inject` and `vdmi-findings.evaluate` for evidence and gaps.
- `interface-placeholder.list` for explicit M365/DMS/IAM connector gaps.
- `hitl.create` for manual owner and IT-acceptance decisions.
- `presentation.generate` for decision briefs and evidence-gap tables.

These are source references. Dossier hydration executes only the read-only `getStatus` action.

## Dossier Evidence

The slim evidence view includes:

- critical process ID and process name;
- main folder reference and evidence state;
- permission owner and admin owner;
- guest-access policy;
- handover document reference;
- chat/mail boundary between volatile communication and durable evidence;
- retention policy and deletion deadline;
- IT approval status and role-change risk;
- blocked capabilities and missing data points with positive follow-ups.

## Safety Classification

- Read-only: `getStatus`, `listGates`, `getGate` and the dossier formatter.
- Non-consequential: `evaluate`, which writes only internal evidence/status.
- Out of scope: live Teams/SharePoint/Loop/IAM connectors, permission mutations, admin-rights
  mutations, guest-access changes, retention changes, automatic HITL approval and any external
  collaboration sync.

## #251 Consumption Contract

Capability Broker routes Wissenssicherung / Rollenwechsel / Hauptordner / Gastzugriff /
Adminrechte / Loeschfrist / IT-Abnahme intents to `knowledge-continuity-governance-gate.getStatus`.
The Hydration Registry allowlists only this read-only status action. Personal Agent hardcoding is
not required.
