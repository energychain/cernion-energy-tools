# Klärfall-Moderationsqueue für VNB-Entscheidungen

## Purpose

The role question behind this use case: does one synthetic VNB clarification case (`Klärfall`) have enough bounded, versioned evidence — question, owner, data state, dependency, open evidence and decision-readiness — for its next cross-functional review, without a moderator, task system or workflow engine deciding anything on its behalf?

This is documentation for a **read-only moderation view**, not a moderation queue. It maps every concept requested in [#462](https://github.com/energychain/cernion-energy-tools/issues/462) — the clarification reference, owner role, supplied evidence/data state, dependencies/blockers, decision-readiness interpretation and next review gate — to existing read-only dashboard bricks. It introduces **no new endpoint, no persistence, no task/case/workflow record, no owner assignment, no status mutation and no notification**. Kurzgrenze: keine Queue, keine Task-Erzeugung, keine Workflow-Ausführung, keine Owner-Zuweisung, keine Statusmutation, keine Benachrichtigung und keine Produktionsänderung.

The conservative product cut was chosen deliberately: complex VNB clarification cases lose steering power when parallel technical, regulatory, commercial and management questions run without a leading owner, question logic or decision status. A versioned moderation view over already-existing evidence gates reduces the resulting review loops without adding a write path. See the maintainer's technical briefing and conservative-cut decision in issue #462 (comments 2026-07-22T04:04:19Z and 2026-07-23T06:34:22Z).

## Moderation View vs. Queue — Explicit Boundary

This use case is a **view**, composed at read time from caller-supplied query parameters against existing read-only actions. It is explicitly **not**:

- a versioned persistence layer / system of record for clarification cases;
- a queue, case, task, HITL item or workflow instance;
- an owner assignment mechanism;
- a due-date or status mutation path;
- a notification, escalation, mail/Teams/CRM/webhook or external-connector call;
- a final decision, approval, or Redispatch/dispatch/device-control action.

Anything that reads like "create a Klärfall", "assign an owner", "advance the status" or "notify a reviewer" belongs to a separate, explicitly approved workflow/task cut on existing Process-Intent/HITL infrastructure (`services/copilot-process.service.js`, `services/hitl.service.js`) — not to this document or this cut.

## Reused Sources

| Concept from #462 | Existing read-only source |
|---|---|
| Question / clarification reference, owner, deadline, evidence state, blocker, next clarification | `dashboard-api.ownerDeadlineEvidenceGateStatus` — `GET /api/dashboard/owner-deadline-evidence-gate` (see [owner-deadline-evidence-gate.md](owner-deadline-evidence-gate.md)) |
| Decision-readiness interpretation without decision execution | `dashboard-api.decisionReadinessMatrixStatus` — `GET /api/dashboard/decision-readiness-matrix` |
| Selected synthetic case detail (optional context) | `dashboard-api.stadtwerkMauerCaseDetailStatus` — `GET /api/dashboard/stadtwerk-mauer-case-detail` |
| Allowed read/verify actions for a selected case (optional context) | `dashboard-api.stadtwerkMauerCaseActionsStatus` — `GET /api/dashboard/stadtwerk-mauer-case-actions` |

`stadtwerk-mauer-blueprint-pack-verify` and `stadtwerk-mauer-transfer-readiness` may additionally be read as optional synthetic Blueprint-Pack verify/transfer-sync context; they are not part of the required moderation-view mapping and do not run or start any queue.

### Owner / Deadline / Evidence (`owner-deadline-evidence-gate`)

Answers: who owns the open question, what is the deadline, what evidence is supplied or missing, what decision is blocked, and what is the next clarification step. Accepts caller-supplied facts only (`signalId`, `sourceType`, `sourceRef`, `processType`, `riskLevel`, `ownerRole`, `ownerContact`, `dueAt`, `evidenceRef`, `evidenceStatus`, `blockedDecision`, `linkedEntity`, `blockedByMissingEvidence`, `overdue`, `signalContextStatus`, `missingEvidence`, `evidenceGaps`, `caseId`) and classifies them into a `readinessSignals[]` / `evidenceGaps[]` / `positiveFollowUps[]` view. See the full contract in [owner-deadline-evidence-gate.md](owner-deadline-evidence-gate.md).

**Synthetic query example:**

```
GET /api/dashboard/owner-deadline-evidence-gate
    ?caseId=synthetic-klaerfall-001
    &ownerRole=vnb_technical_lead
    &dueAt=2026-08-15T00:00:00.000Z
    &evidenceStatus=partial
    &evidenceRef=synthetic-load-flow-study-draft
    &blockedDecision=cross_functional_review_gate
    &blockedByMissingEvidence=true
```

### Decision-Readiness Interpretation (`decision-readiness-matrix`)

Answers: given the supplied case/measure facts, is this clarification ready for its next cross-functional review, and if not, what evidence gap explains that. Accepts caller-supplied facts only (`caseId`, `measureId`, `measureName`, `category`, `budgetStatus`, `financingOption`, `riskIfNotImplemented`, `evidenceSource`, `owner`, `committeeWindow`, `nextDecisionPoint`, `blockers`, `openEvidence`, `includeSyntheticRows`) and returns row readiness, `missingEvidence[]`, `positiveFollowUps[]` and `decisionBoundaries[]` without approving, budgeting or scheduling anything.

**Synthetic query example:**

```
GET /api/dashboard/decision-readiness-matrix
    ?caseId=synthetic-klaerfall-001
    &measureName=cross-functional-clarification-review
    &category=technical_regulatory_commercial
    &owner=vnb_technical_lead
    &committeeWindow=2026-08-Q3-review
    &nextDecisionPoint=2026-08-20-cross-functional-sync
    &openEvidence=grid-model-confirmation
```

Neither example uses a real customer identifier, contact, tenant, or operational case — `synthetic-klaerfall-001` and the role/date values above are illustrative placeholders only.

### Optional Read/Verify Context (`stadtwerk-mauer-case-detail`, `stadtwerk-mauer-case-actions`, Blueprint verify, transfer-readiness)

`stadtwerk-mauer-case-detail` and `stadtwerk-mauer-case-actions` may optionally be read for a selectable synthetic demo case (e.g. `caseId=smm-budibase-workbench`) to show Blueprint seed context, role-workbench hints and the allowed read/verify action set for that case. Blueprint-Pack verify and transfer-readiness reads may optionally be layered in as canonical VDMI matrix/transfer-sync evidence. All four are optional, read-only, and — per their own action contracts — execute no Budibase, Rundeck, MaKo, billing, settlement, or device-control action themselves.

## Decision-Readiness Interpretation Model

A moderation view built from the above sources classifies a synthetic clarification case into read-only readiness states such as:

- `needs_owner` — no accountable role supplied;
- `needs_evidence_ref` / `blocked_by_missing_evidence` — a decision-blocking evidence gap is open;
- `blocked_by_overdue_deadline` — the supplied due date has passed with the blocker unresolved;
- `ready_for_decision_followup` — owner, deadline, and required evidence are present, and the decision-readiness matrix reports no open blocker for the next cross-functional review.

None of these states is a decision. They describe whether the accumulated evidence is sufficient for humans to make one at the next review gate.

## Next Review Gate

The moderation view's only actionable output is a **positive follow-up pointing at the next human review gate** — e.g. "attach the missing load-flow evidence before the 2026-08-20 cross-functional sync" — never an automatic escalation, task creation, or status advance. The next review gate is read from `nextDecisionPoint` / `committeeWindow` in the supplied facts; this document does not define or schedule one.

## Out Of Scope

- Queue, case, task, HITL, or workflow creation or mutation of any kind
- Owner assignment, due-date mutation, status progression, escalation, or final decision
- Mail, Teams, CRM, webhook, or other external-connector calls
- Budibase or Cernion table writes, or any new system of record
- MaKo/A96, billing, settlement, tariff, or finance-booking action
- Redispatch/dispatch or device-control action
- Credentials, secrets, wallet, or key material, and #252 security work
- Legal, regulatory, commercial, technical, or operational final approval
- New `/api/dashboard/*` route, service code, API routing, capability catalog, hydration rule, formatter, OpenAPI/`llm.txt` change, Blueprint seed, Budibase manifest/script, HITL/process-service change, persistence, or production configuration

## Positive Follow-Ups

Because this cut is documentation-only, the useful next steps are review-only:

- confirm with Thorsten whether the fachlogik (question logic, owner-role taxonomy, review-gate cadence) matches this mapping before any visible panel or seed is proposed;
- if a visible demo is later requested, scope it as a separate Budibase read-only panel cut composing the same four sources with scalar rows and explicit no-write/no-call guard tests;
- if real queue/task/workflow behaviour (question creation, owner assignment, status progression) is later requested, scope it as a separate, explicitly approved workflow/task cut on existing Process-Intent/HITL infrastructure — not as an extension of this read-only view.
