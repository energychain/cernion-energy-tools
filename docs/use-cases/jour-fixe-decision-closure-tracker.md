# Jour-Fixe Decision Closure Tracker

## Product cut

`jour_fixe_decision_closure_tracker` is a read-only evidence/status projection for recurring Jour-fixe topics. It helps a dossier state whether a topic has owner, KPI, decision criterion, next gate, closure status, closure proof and citable evidence.

This slice does not create a meeting tracker, transcription pipeline, task queue or automatic decision service. VDMI, NOVA and HITL remain referenced process systems; the status route only projects supplied evidence.

## Read-only API

- Moleculer action: `dashboard-api.jourFixeDecisionClosureStatus`
- REST alias: `GET /api/dashboard/jour-fixe-decision-closure`
- Capability key: `jour_fixe_decision_closure_tracker`
- Safety: `read_only`, non-consequential

Accepted query fields are optional so incomplete topics can still produce explicit gaps:

- `topicId`, `topicTitle`, `jourFixeId`
- `owner`, `kpi`, `decisionCriterion`, `nextGate`
- `closureStatus`, `closureProof`, `blockedFollowUpAction`
- `sourceSnapshotRef`, `evidenceRef`

## Status model

The route derives status only from supplied evidence:

- `open`
- `needs_owner`
- `needs_kpi`
- `needs_decision_criterion`
- `needs_next_gate`
- `escalated`
- `decided`
- `done`
- `carried_over`

A closed or decided topic needs `closureProof` before it can be rendered as closed in a dossier. A `blockedFollowUpAction` is surfaced as escalation evidence rather than silently closing the topic.

## Dossier consumption

The #251 path is:

`Capability Broker -> dashboard-api.jourFixeDecisionClosureStatus -> Hydration Registry -> Slim Answer Dossier`

The hydration formatter emits answer-ready facts, missing evidence, positive follow-ups and side-effect guards. There is no Personal-Agent hardcoding or one-off n8n branch.

## Out of scope

- meeting/transcription ingestion
- calendar, email or Teams connector
- separate task queue or meeting tracker service
- automatic closure or decision execution
- VDMI, NOVA or HITL mutation from the read-only route
- external connector calls
- broad cockpit UI
