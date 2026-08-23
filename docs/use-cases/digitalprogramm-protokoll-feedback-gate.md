# Digitalprogramm Protokoll Feedback Gate

## Product cut

`digitalprogramm_protokoll_feedback_gate` is a docs-only, read-only evidence contract. It maps the recurring Jour-fixe/Gremien artefacts of a cross-divisional VNB/EVU Digitalisierungsprogramm — protocol item, decision, feedback/correction, owner, due date, evidence reference, closure proof and next gate — onto four existing read-only dashboard routes. It introduces no new service, action, REST alias, persistence model or connector.

This slice does not create a protocol archive, meeting/transcription pipeline, task-management backend or M365/Teams/SharePoint integration. It is a mapping document over already-shipped evidence contracts.

## Mapped routes

| Route | Action | Use-case doc |
|---|---|---|
| `GET /api/dashboard/jour-fixe-decision-closure` | `dashboard-api.jourFixeDecisionClosureStatus` | [jour-fixe-decision-closure-tracker.md](jour-fixe-decision-closure-tracker.md) |
| `GET /api/dashboard/gremiencoach-workbook-readiness` | `dashboard-api.gremiencoachWorkbookReadinessStatus` | [gremiencoach-workbook-readiness.md](gremiencoach-workbook-readiness.md) |
| `GET /api/dashboard/steering-artifact-acceptance-gate` | `dashboard-api.steeringArtifactAcceptanceGateStatus` | [steering-artifact-acceptance-gate.md](steering-artifact-acceptance-gate.md) |
| `GET /api/dashboard/owner-deadline-evidence-gate` | `dashboard-api.ownerDeadlineEvidenceGateStatus` | [owner-deadline-evidence-gate.md](owner-deadline-evidence-gate.md) |

All four routes accept only caller-supplied, optional query parameters and derive status deterministically from what is supplied. None of them ingest mail, Teams, SharePoint, calendar or transcript sources.

## Field mapping

Programmsteuerung, Fachbereich, IT-Governance and a management reviewer read a Digitalprogramm protocol/feedback item through these existing fields — no field below is new:

| Digitalprogramm concept | Primary route | Field(s) |
|---|---|---|
| Protokoll-Eintrag / Beschluss (protocol item, decision) | `jour-fixe-decision-closure` | `topicId`, `topicTitle`, `jourFixeId`, `decisionCriterion` |
| Feedback / Rückfrage / Korrektur (feedback, question, correction) | `jour-fixe-decision-closure` | `blockedFollowUpAction` (open question/correction as escalation evidence) |
| Feedback / Rückfrage / Korrektur (artefact acceptance angle) | `steering-artifact-acceptance-gate` | `escalationCriterion`, status `missing_acceptance_evidence` |
| Owner | `jour-fixe-decision-closure` | `owner` |
| Owner (signal/deadline angle) | `owner-deadline-evidence-gate` | `ownerRole`, `ownerContact` |
| Owner (steering-artifact angle) | `steering-artifact-acceptance-gate` | `owner`, `deputyOwner` |
| Datenstand / Frist (due date) | `owner-deadline-evidence-gate` | `dueAt`, `overdue` |
| Evidence-Referenz (evidence reference) | `jour-fixe-decision-closure` | `evidenceRef`, `sourceSnapshotRef` |
| Evidence-Referenz (signal angle) | `owner-deadline-evidence-gate` | `evidenceRef`, `evidenceStatus`, `sourceType`, `sourceRef` |
| Closure Proof | `jour-fixe-decision-closure` | `closureProof`, `closureStatus` |
| Naechste Entscheidung / next gate | `jour-fixe-decision-closure` | `nextGate` |
| Naechste Entscheidung (artefact rollout angle) | `steering-artifact-acceptance-gate` | `rolloutDecision`, status `ready_for_limited_rollout` |
| Gremienbezug (committee reference) | `gremiencoach-workbook-readiness` | `committeeContext`, `workbookId`, `processRole` |
| Blockierte Folgeentscheidung (blocked follow-up decision) | `owner-deadline-evidence-gate` | `blockedDecision`, `blockedByMissingEvidence` |

A single Digitalprogramm protocol item is typically read across two or three of these routes at once — e.g. a Jour-fixe topic (`jour-fixe-decision-closure`) whose owner/deadline evidence is cross-checked (`owner-deadline-evidence-gate`) before the underlying steering artefact is judged rollout-ready (`steering-artifact-acceptance-gate`).

## Source-class, freshness and provenance caveats

- All four routes are **aggregator contracts, not systems of record**. They project only the query parameters a caller supplies in the request; they do not read a protocol store, document repository, mailbox, calendar or Teams channel.
- Every field is a **caller-supplied fact**, not a fact this platform observed, verified or timestamped independently. A `sourceSnapshotRef` / `evidenceRef` / `sourceRef` names where a human says the evidence came from; it is not fetched, parsed or validated by the route.
- There is no freshness guarantee beyond the request itself: two calls with different parameter values for the same `topicId` will return different derived status, and neither call re-reads a prior state. Callers are responsible for supplying the current snapshot.
- **Missing evidence produces a clarification/review state, never a negative factual conclusion.** For example, an absent `closureProof` renders as `open`/`carried_over` (jour-fixe) or `missing_acceptance_evidence` (steering artifact) or `needs_evidence_ref` (owner-deadline) — never as "decision was not made" or "owner failed to act."

## Synthetic examples

The following example query values are **explicitly synthetic**. They name no real meeting, person, customer, tenant, VNB or EVU. Any resemblance to an actual Jour-fixe, Gremium or programme is coincidental and unintended.

```
GET /api/dashboard/jour-fixe-decision-closure
  ?topicId=synthetic-jf-topic-001
  &topicTitle=Beispielhafte%20Programmentscheidung%20(synthetisch)
  &jourFixeId=synthetic-jourfixe-2026-08
  &owner=synthetic-owner-programmsteuerung
  &nextGate=synthetic-review-gate-2026-09
  &closureStatus=carried_over
  &blockedFollowUpAction=synthetic-open-rueckfrage-fachbereich
  &evidenceRef=synthetic-protokoll-snapshot-ref-001

GET /api/dashboard/owner-deadline-evidence-gate
  ?signalId=synthetic-signal-001
  &ownerRole=synthetic-role-it-governance
  &dueAt=2026-09-15
  &evidenceRef=synthetic-evidence-ref-001
  &blockedDecision=synthetic-blocked-rollout-entscheidung

GET /api/dashboard/gremiencoach-workbook-readiness
  ?workbookId=synthetic-workbook-001
  &committeeContext=synthetic-gremium-digitalprogramm
```

A caller integrating a real Digitalprogramm review must supply its own real identifiers; this document defines the mapping contract, not example data to reuse verbatim.

## No-call / no-write boundaries

These four routes, and this mapping, do not:

- call M365, Teams, SharePoint, Graph, mail, calendar or any external connector;
- ingest, parse, transcribe or summarize meeting audio, video or documents;
- create, assign, close or mutate a task, workflow item, HITL item or protocol entry;
- send email, webhook or notification;
- write, approve or reject a document, decision, GIS, ERP, CRM or MDM record;
- touch MaKo, billing, settlement, tariff, dispatch or device-control state;
- persist, cache-write beyond the existing route-level TTL cache, or otherwise mutate any store;
- deploy to or otherwise touch production systems.

## Positive human follow-ups

Missing evidence maps to an actionable next step for a human, not a dead end:

- missing `owner`/`ownerRole` enables adding the accountable Programmsteuerung, Fachbereich or IT-Governance contact;
- missing `nextGate`/`rolloutDecision` enables scheduling the next Jour-fixe or Gremium decision point;
- missing `evidenceRef`/`sourceSnapshotRef`/`closureProof` enables attaching the protocol snapshot or closure artefact that resolves the gap;
- an open `blockedFollowUpAction`/`blockedDecision` enables routing the correction or Rückfrage back to the responsible reviewer for the next session.

## Platform boundary

No Capability Broker route, Hydration Registry rule, formatter, Sidecar or Personal Agent change is required or introduced by this document. No Personal-Agent hardcoding, persona routing or one-off branch is added. This is a mapping over the same read-only routes already documented in [jour-fixe-decision-closure-tracker.md](jour-fixe-decision-closure-tracker.md), [gremiencoach-workbook-readiness.md](gremiencoach-workbook-readiness.md), [steering-artifact-acceptance-gate.md](steering-artifact-acceptance-gate.md) and [owner-deadline-evidence-gate.md](owner-deadline-evidence-gate.md).

## Safety class

`read_only_documented_evidence_gate`, non-consequential.

## Out of scope

- M365, Teams or SharePoint connector
- transcript or audio ingestion
- automatic summarization of any meeting or document
- task or workflow creation
- email or webhook dispatch
- document write, approval or rejection
- GIS, ERP, CRM or MDM write
- MaKo, billing, settlement, tariff or dispatch action
- device control
- production data or production deployment
- secrets or wallet/key material
- issue #252 scope
- any new Moleculer service, action, REST alias or Budibase panel
