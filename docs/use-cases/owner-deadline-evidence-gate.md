# Owner-Frist-Evidenz Gate

## Purpose

The Owner-Frist-Evidenz Gate is a read-only evidence capability for VNB operational signals. It classifies supplied facts into a dossier-ready view of owner, deadline, evidence, source, blocked decision, and linked entity readiness.

The gate is an aggregator contract, not a system of record. It does not ingest mail, Teams, Loop, reports, or external sources. It does not create tasks, mutate deadlines, send notifications, escalate workflows, or assign owners.

## Capability Boundary

- Capability key: `owner_deadline_evidence_gate`
- Action: `dashboard-api.ownerDeadlineEvidenceGateStatus`
- REST route: `GET /api/dashboard/owner-deadline-evidence-gate`
- Safety: `read_only`
- Dossier hydration: static allowlisted rule `owner_deadline_evidence_gate`

## Supplied Facts

The first slice accepts only caller-supplied facts:

- `signalId`, `sourceType`, `sourceRef`
- `processType`, `riskLevel`
- `ownerRole`, `ownerContact`
- `dueAt`
- `evidenceRef`, `evidenceStatus`
- `blockedDecision`
- `linkedEntity`
- `blockedByMissingEvidence`, `overdue`

## Status Model

- `unknown`
- `needs_signal_context`
- `needs_owner`
- `needs_deadline`
- `needs_evidence_ref`
- `blocked_by_missing_evidence`
- `blocked_by_overdue_deadline`
- `ready_for_decision_followup`

## Evidence Contract

The response returns:

- `signalContext`
- `ownerContext`
- `readinessSignals[]`
- `evidenceGaps[]`
- `validationFindings[]`
- `positiveFollowUps[]`
- `nextActions[]`
- `sourceActions`
- `dossierEvidence`

Missing facts are mapped to positive follow-ups:

- missing signal provenance enables adding signal and process context
- missing owner enables adding accountable VNB role or contact evidence
- missing deadline enables deadline tracking evidence
- missing evidence reference enables attaching the blocking proof
- missing blocked decision enables explaining the affected follow-up decision
- missing linked entity enables linking the signal to asset, process, market role, Redispatch, security, finance, or governance context

## Out Of Scope

- Mail, Teams, Loop, report scraping, parsing, or ingestion
- External connectors
- Workflow execution, escalation, notification, or deadline mutation
- New task, owner, role, or persona backend
- HITL, VDMI, DecisionFrame, or Copilot mutation
- Broad cockpit frontend
- Personal-Agent hardcoding or one-off n8n routing
- Legal or regulatory interpretation beyond surfacing supplied blocker facts
