# Process Sensitization Readiness Map

## Purpose

The Process Sensitization Readiness Map is a read-only dossier capability for deciding whether a process topic is ready for sensitization, workshop, or training communication.

It separates four cases before recommending communication work:

- `ready_for_sensitization`: evidence, role decisions, data quality, system continuity, and red-line checks are clear.
- `needs_evidence`: evidence, data quality, or system-break remediation is still missing.
- `needs_process_decision`: an owner, role, or governance decision is still open.
- `blocked_by_red_line`: a non-negotiable grid/security/process constraint blocks soft training recommendations.

## First Slice

- Action: `dashboard-api.processSensitizationReadinessMapStatus`
- Route: `GET /api/dashboard/process-sensitization-readiness-map`
- Capability: `process_sensitization_readiness_map`
- Hydration rule: `process_sensitization_readiness_map`

The slice classifies supplied facts only. It does not inspect live systems, write records, create HITL tasks, mutate VDMI state, call external services, or execute Personal-Agent actions.

## Evidence Inputs

- `processType` or `topic`
- `roleDecision` or `roleDecisionStatus`
- `evidenceStatus`
- `dataQualityStatus`
- `systemBreakStatus`
- `redLineStatus`
- `missingEvidence`
- `roleDecisionGaps`
- `dataQualityGaps`
- `systemBreaks`
- `nonNegotiableConstraints`
- optional context such as `owner`, `dueDate`, `gridOperatorId`, `taskId`, `matrixId`, and `assetId`

## Dossier Value

The dossier output states whether sensitization is useful now or whether evidence, role clarification, remediation, or red-line handling must happen first. Missing items are mapped to positive follow-ups so the next evidence addition is explicit.

## Out Of Scope

- Training or workshop backend
- New VDMI, RACI, governance, or data-quality engine
- Datastore writes
- HITL or VDMI mutation
- External connectors
- Legal interpretation beyond surfacing supplied blocker facts
- Personal-Agent hardcoding
