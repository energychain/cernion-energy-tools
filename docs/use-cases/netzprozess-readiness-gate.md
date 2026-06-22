# Netzprozess Readiness Gate

## Product Cut

The Netzprozess Readiness Gate is a read-only evidence contract for administrative process readiness. It answers whether a Redispatch, Netzanschluss, ZNP/transformation, asset-transformation, or Netzkoppelvertrag process can reach the next decision, or whether supplied prerequisites still block it.

## First Slice

- Capability key: `netzprozess_readiness_gate`
- Action: `dashboard-api.netzprozessReadinessGateStatus`
- REST route: `GET /api/dashboard/netzprozess-readiness-gate`
- Safety: `read_only`

The first slice classifies supplied facts only. It does not create HITL items, mutate VDMI or workflow state, execute a process, call external connectors, or add a Personal-Agent shortcut.

## Evidence Inputs

- `processType`, `processId`, `processRefType`, `processRefId`
- `portalAccess`
- `sftpRoute`
- `rolePermission`
- `itSecurityUpdate`
- `training`
- `dataPath`
- `blockedDecision`
- `owner`, `dueAt`, `nextDecision`
- `missingEvidence`, `customSignals`, `sourceRef`

Accepted readiness status values are normalized to `ready`, `partial`, `blocked`, `missing`, or `unknown`.

## Status Semantics

- `blocked`: at least one supplied signal is blocked, or a blocked decision is supplied.
- `partial`: at least one supplied signal is partial, missing, unknown, or non-ready.
- `ready`: all supplied readiness signals are ready.
- `unknown`: no meaningful readiness signal evidence is supplied.

## Dossier Evidence

The slim dossier formatter exposes:

- overall readiness status
- process type and reference
- leading readiness signal and blocker
- owner and next decision
- positive follow-up for missing or non-ready evidence
- side-effect guard showing no mutation or external execution path was called

## Out Of Scope

- new readiness persistence/table
- HITL creation or mutation
- VDMI, decision-frame, Copilot process, ZNP, grid-connection, or netzkoppelvertrag mutation
- workflow execution, escalation, notification, or external connectors
- legal/security interpretation beyond supplied blocker facts
- broad cockpit UI
- secrets/key handling
