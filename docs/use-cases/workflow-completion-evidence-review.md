# Workflow Completion Evidence Review

## Purpose

The role question behind this use case: can a process owner review one synthetic case for completion — without predictable rework — in under a minute, seeing which generic requirement/plausibility evidence is present or missing, who owns the next clarification, and which safe gate comes next?

This is documentation for a **read-only completion-evidence review view**, not a completion decision, a workflow-completion endpoint, or a Blueprint-Pack seed. It maps every concept requested in [#454](https://github.com/energychain/cernion-energy-tools/issues/454) — case/requirement scope, sanitized plausibility preview, gap owner and due-date readiness, and the completion review gate — to existing read-only dashboard bricks, plus the now-integrated `hitl.completionPlausibility` action referenced strictly as `source_hint_only`. It introduces **no new endpoint, no Blueprint Pack seed/registry entry, no workflow completion, no HITL/task creation, and no Budibase manifest change**. Kurzgrenze: keine Workflow-Completion, keine HITL-Erzeugung, keine Budibase-Schreibaktion, keine Freigabeentscheidung.

The conservative product cut was chosen deliberately: #454 itself proposes a versioned `vdmi_blueprint_pack_seed`, but the dependency it needed (#452 / PR #453) only just landed on `main`, and no DevServer smoke of the merged `hitl.completionPlausibility` route or Budibase composition has been run yet. A docs-only mapping over already-existing evidence bricks proves the reuse-first shape without committing to seed/registry/validator code or a Workbench panel ahead of that smoke.

## Completion Review vs. Completion Action — Explicit Boundary

This use case is a **view**, composed at read time from caller-supplied query parameters against existing read-only actions. It is explicitly **not**:

- a workflow completion or state transition;
- a HITL item, task, or workflow creation;
- an owner assignment, due-date mutation, or approval decision;
- an invocation of `hitl.completionPlausibility` or `hitl.markWorkflowCompleted` from this document;
- a versioned Blueprint-Pack seed, registry entry, or Budibase manifest panel.

Anything that reads like "evaluate this case's plausibility now", "complete the workflow", or "render this in Budibase" belongs to a separate, explicitly approved seed/panel cut on the existing HITL infrastructure (`services/hitl.service.js`) — not to this document.

## Reused Sources

| Concept from #454 | Existing read-only source |
|---|---|
| Case and requirement scope | `dashboard-api.stadtwerkMauerCaseDetailStatus` — `GET /api/dashboard/stadtwerk-mauer-case-detail` |
| Allowed read/verify actions for the selected case | `dashboard-api.stadtwerkMauerCaseActionsStatus` — `GET /api/dashboard/stadtwerk-mauer-case-actions` |
| Gap owner and due-date readiness | `dashboard-api.ownerDeadlineEvidenceGateStatus` — `GET /api/dashboard/owner-deadline-evidence-gate` |
| Completion review gate / decision-readiness interpretation | `dashboard-api.decisionReadinessMatrixStatus` — `GET /api/dashboard/decision-readiness-matrix` |
| Evidence-confidence separation for the sanitized preview | `dashboard-api.evidenceGroundingConfidenceAudit` — `GET /api/dashboard/evidence-grounding-confidence-audit` |
| Renderer-grounding check for a presented completion brief | `dashboard-api.receiptGroundedPresentationContract` — `GET /api/dashboard/receipt-grounded-presentation-contract` |
| Canonical VDMI matrix / transfer-sync context (optional) | `dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus`, `dashboard-api.stadtwerkMauerTransferReadinessStatus` |
| Sanitized plausibility preview (`source_hint_only`, never invoked) | `hitl.completionPlausibility` — `POST /api/hitl/items/:id/completion-plausibility` (merged via #452 / PR #453) |

### Case and Requirement Scope (`stadtwerk-mauer-case-detail`, `stadtwerk-mauer-case-actions`)

Answers: which synthetic case is selected, what is its Blueprint-seed/role-workbench context, and which read/verify actions are currently allowed for it. Accepts `tenantId`, `caseId`.

**Synthetic query example:**

```
GET /api/dashboard/stadtwerk-mauer-case-detail
    ?tenantId=stadtwerk-mauer
    &caseId=smm-workflow-completion-review-001

GET /api/dashboard/stadtwerk-mauer-case-actions
    ?tenantId=stadtwerk-mauer
    &caseId=smm-workflow-completion-review-001
```

### Gap Owner and Due-Date Readiness (`owner-deadline-evidence-gate`)

Answers: who owns the remaining completion gap, what is the due date, what evidence is supplied or missing, and what is the next clarification step. Accepts caller-supplied facts only (`signalId`, `ownerRole`, `dueAt`, `evidenceRef`, `evidenceStatus`, `blockedDecision`, `caseId`, …) and classifies them into `readinessSignals[]` / `evidenceGaps[]` / `positiveFollowUps[]`.

**Synthetic query example:**

```
GET /api/dashboard/owner-deadline-evidence-gate
    ?caseId=smm-workflow-completion-review-001
    &ownerRole=ROLE_CASE_HANDLER
    &dueAt=2026-08-20T00:00:00.000Z
    &evidenceStatus=partial
    &evidenceRef=synthetic-required-field-configuration
    &blockedDecision=completion_review_gate
```

### Completion Review Gate (`decision-readiness-matrix`)

Answers: given the supplied requirement/evidence facts, is this case ready for its completion review gate, and if not, which gap explains that. Accepts `caseId`, `measureName`, `category`, `owner`, `committeeWindow`, `nextDecisionPoint`, `openEvidence`, …

**Synthetic query example:**

```
GET /api/dashboard/decision-readiness-matrix
    ?caseId=smm-workflow-completion-review-001
    &measureName=pre-completion-plausibility-review
    &category=workflow_completion_governance
    &owner=ROLE_PROCESS_OWNER
    &nextDecisionPoint=completion-review-gate
    &openEvidence=missing-required-field-configuration
```

### Sanitized Plausibility Preview — `source_hint_only`

`hitl.completionPlausibility` (`POST /api/hitl/items/:id/completion-plausibility`) is the now-merged, read-only, advisory preview action referenced by #454. It evaluates a caller-supplied `rules`/`fields` payload against a small allowlisted rule vocabulary (`required`, `number_range`, `less_than_or_equal`) and returns bounded, sanitized hints (`missing_required` / `implausible_value`) — never the submitted values, and never a state change. This document references it only as `source_hint_only` context for the "Sanitized plausibility preview" and "Gap owner and due-date readiness" rows above; **it is not invoked by this document, and no case identifier or field values are echoed here.**

Neither example uses a real customer identifier, contact, tenant, or operational case — `smm-workflow-completion-review-001` and the role/date values above are illustrative synthetic placeholders only.

### Optional Read/Verify Context (Evidence Grounding, Presentation Contract, Blueprint Verify, Transfer Readiness)

`evidence-grounding-confidence-audit` and `receipt-grounded-presentation-contract` may optionally be read to show the confidence/grounding separation for a rendered completion-review brief. `stadtwerk-mauer-blueprint-pack-verify` and `stadtwerk-mauer-transfer-readiness` may optionally be layered in as canonical VDMI matrix/transfer-sync evidence once a seed exists. All four are optional, read-only, and — per their own action contracts — execute no Budibase, Rundeck, MaKo, billing, settlement, or device-control action themselves.

## Decision-Readiness Interpretation Model

A completion-evidence review built from the above sources classifies a synthetic case into read-only readiness states such as:

- `needs_case_scope` — no selected case or requirement-field configuration supplied;
- `needs_plausibility_preview` — no sanitized preview evidence referenced yet;
- `needs_evidence_ref` / `blocked_by_missing_evidence` — a completion-blocking evidence gap is open;
- `ready_for_completion_review` — case scope, plausibility-preview reference, owner, due date, and required evidence are present, and the decision-readiness matrix reports no open blocker for the completion review gate.

None of these states is a completion decision. They describe whether the accumulated evidence is sufficient for a human process owner to review completion at the next gate without predictable rework.

## Next Review Gate

The view's only actionable output is a **positive follow-up pointing at the next human completion review gate** — e.g. "attach the missing required-field configuration before the completion review gate" — never an automatic workflow completion, task creation, or status advance. The next gate is read from `nextDecisionPoint` / `committeeWindow` in the supplied facts; this document does not define, schedule, or trigger one.

## Out Of Scope

- Workflow completion, state transition, or `hitl.markWorkflowCompleted` invocation of any kind
- `hitl.completionPlausibility` invocation from this document (source-hint reference only)
- HITL item, task, or workflow creation or mutation
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

- confirm with Thorsten whether the fachlogik (requirement taxonomy, plausibility-hint vocabulary, completion-review-gate cadence) matches this mapping before any Blueprint Pack seed or visible panel is proposed;
- if the versioned `stadtwerk-mauer-workflow-completion-evidence-review-v1` Blueprint-Pack seed described in #454 is later requested, scope it as a separate cut following the existing `src/vdmi-blueprint-pack-seeds/` JSON/registry/validator pattern, after a synthetic DevServer smoke proves `hitl.completionPlausibility` non-mutation and sanitized output;
- if a visible demo is later requested, scope it as a separate Budibase read-only panel cut composing the same sources with scalar rows and explicit no-write/no-call guard tests.
