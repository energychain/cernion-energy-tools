# Redispatch Test-Readiness-Akte

## Product Cut

This use case describes a narrow, **read-only** evidence contract — a "Test-Readiness-Akte" (test-readiness file) — for Redispatch participation. It does not introduce any new service, endpoint or seed. It composes existing dashboard read models, the existing Redispatch Readiness Gate, and the existing Blueprint-Pack verify/transfer-readiness bricks into one documented reading path so a reviewer can see, in one place, whether *evidence for test-readiness* exists — without that evidence ever being confused with authorization, test provisioning, operational controllability, actual Redispatch execution, or final approval.

All examples in this document use the synthetic `stadtwerk-mauer` demo tenant and invented IDs. No production tenant, asset, or credential is referenced.

## Service Boundary (existing, unchanged)

- `redispatch-readiness-gate` service — `POST /api/redispatch-readiness-gate/evaluate` (operational acceptance gate: access matrix, test-call status, production proof, template version, open questions, responsible role, acceptance deadline)
- `dashboard-api.redispatchParticipationReadinessStatus` — `GET /api/dashboard/redispatch-participation-readiness-status` (read-only projection of the 5 evidence requirements defined in the `stadtwerk-mauer-redispatch-participation-readiness-v1` Blueprint-Pack seed)
- `dashboard-api.ownerDeadlineEvidenceGateStatus` — `GET /api/dashboard/owner-deadline-evidence-gate` (read-only owner/deadline/blocker classification for supplied Owner-Frist-Evidenz facts)
- `dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus` — `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify` (Blueprint-Pack verify projection)
- `dashboard-api.stadtwerkMauerTransferReadinessStatus` — `GET /api/dashboard/stadtwerk-mauer-transfer-readiness` (Blueprint-Pack transfer-readiness projection)
- Seed: `src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-redispatch-participation-readiness-v1.json`

No new route, action, seed, formatter, Budibase panel, Personal Agent branch, workflow, or persistence is added by this document.

## Test-Readiness-Akte Mapping

The Akte maps each process step to the existing evidence source, so evidence status stays legible without duplicating any service logic:

| Process step | Test environment / evidence | Asset class / scope | Data quality | Owner / blocker | Next validation gate |
|---|---|---|---|---|---|
| 1. Synthetic asset & portfolio identified | `syntheticRedispatchAssetPortfolio` (`redispatch-participation-readiness-status`) | Synthetic demo portfolio, `stadtwerk-mauer` tenant only | `synthetic_tenant_seed`; `evidence_gap` if missing | ROLE_ASSET_MANAGEMENT (mitwirkend); ROLE_GRID_OPERATIONS_LEAD (verantwortlich) | Installation/grid-location review |
| 2. Installation & grid-location evidence | `installationGridLocationEvidence` (`redispatch-participation-readiness-status`) | Synthetic MaStR/grid-location context | `publicContextLayer` + `synthetic_tenant_seed`; read-only, never mutated | ROLE_ASSET_MANAGEMENT (mitwirkend) | Communication-test evidence |
| 3. Remote-control communication test | `remoteControlCommunicationTestEvidence` (`redispatch-participation-readiness-status`) | Synthetic communication-test marker (evidence only, never a control action) | `synthetic_tenant_seed` + `sandboxRuntimeArtifact` | ROLE_METERING (mitwirkend) | Forecast/dispatch-test proof |
| 4. Forecast / dispatch-test proof | `forecastDispatchTestProof` (`redispatch-participation-readiness-status`) | Synthetic forecast/test-run proof; not a claim of productive dispatch | `synthetic_tenant_seed` + `sandboxRuntimeArtifact` | ROLE_ASSET_MANAGEMENT (mitwirkend) | Readiness review decision |
| 5. Readiness review decision | `readinessReviewDecision` (`redispatch-participation-readiness-status`) | Synthetic review outcome: `ready_for_review` or `evidence_gap` | `synthetic_tenant_seed`; `clarification` if missing | ROLE_GRID_OPERATIONS_LEAD (verantwortlich) | Owner/deadline evidence gate |
| 6. Owner & deadline evidence | `ownerDeadlineEvidenceGateStatus` (owner role, contact, `dueAt`, `evidenceRef`, `blockedByMissingEvidence`, `overdue`) | Owner/deadline tracking for the readiness case | Blocked/overdue classification from supplied facts only | Assigned `ownerRole`/`ownerContact` or `blocked_by_decision_gap` | Blueprint-Pack verify / transfer-readiness |
| 7. Blueprint-Pack verify & transfer-readiness | `stadtwerkMauerBlueprintPackVerifyStatus`, `stadtwerkMauerTransferReadinessStatus` | Canonical V/D/M/I matrix and Landing-Registry/productive Demo-Raum handoff status (both `pending` by design) | Seed-defined `demoProcessMatrix`; downstream handoff explicitly `pending` | ROLE_CERNION_GOVERNANCE (durchführend) | Operational acceptance gate (`redispatch-readiness-gate`, separate step, see below) |

## Evidence Status Is Not Authorization, Provisioning, Controllability, Execution, or Approval

This Akte is a **read-only evidence-status view**. It intentionally does not answer, and must never be read as answering, the following distinct questions:

- **Authorization** — whether Redispatch access (GUI, SFTP, test system, Produktivsystem) has been granted is evaluated only by `redispatch-readiness-gate.evaluate`'s access-matrix check (`RRG_ACCESS_MATRIX_COMPLETE` / `RRG_ACCESS_MATRIX_INCOMPLETE`), a separate, already-existing operational acceptance gate. The Akte's evidence rows above do not grant, request, or confirm any access.
- **Test provisioning** — `remoteControlCommunicationTestEvidence` and `forecastDispatchTestProof` are evidence *markers* that a test was performed; they are not the test call itself and do not provision, schedule, or execute a test call. Actual test-call outcome (`missing` / `pending` / `passed` / `failed`) is tracked only inside `redispatch-readiness-gate`.
- **Operational controllability** — none of the mapped read actions establish, verify, or claim remote control of any asset. `remoteControlCommunicationTestEvidence` is documented as "evidence only, never a control action" in the seed itself.
- **Redispatch execution** — no mapped action enrolls an asset, dispatches a control command, or triggers a Redispatch order. The seed's `decisionPolicy.mustNotTrigger` and `forbiddenActions` explicitly list `redispatch_enrollment`, `dispatch_control`, and `smgw_cls_device_control` as actions this evidence contract must never cause.
- **Final approval** — `readinessReviewDecision` and the owner/deadline gate report a *reviewed-or-not* and *blocked-or-not* status, not a productive go-live approval. `downstreamHandoff.productiveDemoRoom` and `downstreamHandoff.landingRegistry` in the seed are explicitly `pending`, meaning the Blueprint-Pack matrix is canonical evidence but is not itself the productive sign-off.

## Positive Review-Only Follow-Ups

- Reviewer reads `redispatch-participation-readiness-status` to see which of the 5 evidence requirements are present vs. `evidence_gap`/`clarification`, then requests the missing synthetic demo values from the responsible role — no system call is made to fetch or generate them automatically.
- Reviewer cross-checks `owner-deadline-evidence-gate` to confirm an owner and due date exist for the readiness case, and escalates only through existing owner/deadline tooling if `blockedByMissingEvidence` or `overdue` is true.
- Reviewer reads `stadtwerk-mauer-blueprint-pack-verify` and `stadtwerk-mauer-transfer-readiness` to confirm the canonical V/D/M/I matrix is complete before treating the Akte as ready for the next (separate, already-existing) operational acceptance step in `redispatch-readiness-gate`.
- Reviewer documents the assembled Akte (all rows above) as a dossier attachment; no field in the Akte is written back to any source system.

## No-Call / No-Write Boundaries

This document, and the read-only contract it describes, must never:

- Call or trigger `redispatch_enrollment`, `dispatch_control`, `smgw_cls_device_control`, or any device-control action.
- Call `mako_write`, `billing`, `settlement`, or `tariff_mutation`.
- Call any `external_connector_call`, `webhook`, or notification/email dispatch.
- Create or mutate a `hitl_create` item, a workflow, or a task.
- Perform `tenant_provisioning`, `rundeck_execution`, `public_context_mutation`, or `production_mutation`.
- Write to Budibase tables, the VDMI dossier store, the Landing-Registry, or any persistence layer.
- Hardcode or bypass Personal Agent capability routing (`personal_agent_hardcoding`).
- Invoke `redispatch-readiness-gate.evaluate` as a side effect of reading this Akte — the gate remains a distinct, explicitly-called operational step, never an implicit consequence of evidence review.

All of the above mirror the `forbiddenActions` / `mustNotTrigger` lists already declared in `stadtwerk-mauer-redispatch-participation-readiness-v1.json` and the `notCalled` lists already returned by `redispatchParticipationReadinessStatus` and `ownerDeadlineEvidenceGateStatus`.

## Produktivpfad-Reviewprofil (#516)

Redispatch and controllability validation can hit test-system boundaries when calls, data-point lists, external roles, or interfaces are incomplete, and reliable evidence is only possible on the productive path. This profile makes that condition reviewable through explicit evidence and a human follow-up — it never executes, authorizes, or infers the result of a productive action. Evidence that productive validation would be required is **not** proof that it ran, **not** authorization to run it, and **not** a release decision.

The profile maps the nine facts named in issue #516 onto the two existing read-only routes already covered by this Akte — `GET /api/redispatch-readiness-gate/status` (the operational acceptance gate's last-evaluated state) and `GET /api/dashboard/redispatch-participation-readiness-status` (the readiness-Akte evidence rows above) — and is explicit about which facts those routes do not carry.

| # | Fact | Source | Classification |
|---|---|---|---|
| 1 | Test-system boundary | `redispatch-readiness-gate.getStatus` → `accessMatrixStatus` (`RRG_ACCESS_MATRIX_COMPLETE` / `RRG_ACCESS_MATRIX_INCOMPLETE`), covering the `testsystem` key of the access matrix | Existing gate-status fact |
| 2 | Productive-validation condition | `redispatch-readiness-gate.getStatus` → `productionProofConfirmed` (`RRG_PRODUCTION_PROOF_CONFIRMED` / `RRG_PRODUCTION_PROOF_MISSING`) | Existing gate-status fact |
| 3 | Data-point-list status | `redispatch-readiness-gate.getStatus` → `templateVersion` / `requiredTemplateVersion` / `templateVersionCurrent` (`RRG_TEMPLATE_VERSION_CURRENT` / `RRG_TEMPLATE_VERSION_OUTDATED`) is the nearest existing proxy (the Redispatch master-data template version), not a literal enumerated data-point list | Existing gate-status fact (partial proxy); a full enumerated data-point list is **missing evidence** — no existing route tracks one |
| 4 | Retrievability / test-call marker | `redispatch-readiness-gate.getStatus` → `testCallStatus` (`RRG_TEST_CALL_PASSED` / `RRG_TEST_CALL_MISSING` / `RRG_TEST_CALL_FAILED`); `redispatchParticipationReadinessStatus` → `remoteControlCommunicationTestEvidence` ("evidence only, never a control action") | Existing gate-status fact |
| 5 | Exception reason | `redispatch-readiness-gate.getStatus` → `openQuestionsCount` (`RRG_OPEN_QUESTIONS_PRESENT`) is the nearest existing proxy, but it is a count, not a reason text | Missing evidence — no reason-text field exists on either in-scope route |
| 6 | Risk | Neither in-scope route exposes a named `risk` field; each gate finding's `severity` (`error`/`warning`/`info`) is the nearest existing structural proxy | Missing evidence — no explicit risk field exists on either in-scope route |
| 7 | Responsible role | `redispatch-readiness-gate.getStatus` → `responsibleRole` (`RRG_RESPONSIBLE_ROLE_ASSIGNED` / `RRG_RESPONSIBLE_ROLE_MISSING`) | Existing gate-status fact |
| 8 | Acceptance deadline | `redispatch-readiness-gate.getStatus` → `acceptanceDeadline` / `daysUntilDeadline` (`RRG_ACCEPTANCE_DEADLINE_MISSED` / `RRG_ACCEPTANCE_DEADLINE_APPROACHING`) | Existing gate-status fact |
| 9a | Human approval step | `redispatch-readiness-gate.getStatus` only reflects the `overallStatus` (`RRG_GATE_READY` / `RRG_GATE_READY_WITH_WARNINGS` / `RRG_GATE_BLOCKED`) of the last run; the approval action itself is the separate, explicitly-called `POST /api/redispatch-readiness-gate/evaluate` | Existing gate-status fact (status only) — the approval step is a distinct out-of-scope operational action, never an implicit consequence of reading this profile |
| 9b | Evidence artifact | Neither in-scope route returns a durable artifact/attachment reference; this Akte's own "Positive Review-Only Follow-Ups" section already documents the practice of the reviewer attaching the assembled Akte as a dossier artifact | Missing evidence — no system-tracked artifact field exists; the artifact is the human-assembled dossier, not a route response |

**Read vs. operational action:** `GET /api/redispatch-readiness-gate/status` may be inspected read-only at any time as part of this profile, exactly like `GET /api/dashboard/redispatch-participation-readiness-status` above. `POST /api/redispatch-readiness-gate/evaluate` is a separate, explicit operational action — creating a new gate run, access provisioning, test-call execution, productive validation, approval, dispatch and release all remain outside this issue and are never triggered by reading this profile.

**Missing evidence is a positive follow-up, never an inferred failure.** Where the table above marks a fact as missing (rows 3, 5, 6, 9b), that absence means the responsible role (row 7) is asked to supply or locate the evidence before the acceptance deadline (row 8) — it is never read as a failed test, a denied release, or a productive-path incident. The `redispatch-readiness-gate` service's own `blocked` status already encodes this distinction: it blocks the *operational acceptance gate run*, not this read-only review profile, which has no pass/fail state of its own.

## Out Of Scope

- No new service, route, capability, seed, formatter, or OpenAPI entry.
- No Budibase panel, Personal Agent branch, workflow/HITL wiring, or persistence change.
- No change to `redispatch-readiness-gate`, `dashboard-api`, or any Blueprint-Pack seed behavior.
- No production tenant data, credential, or wallet/key material.
- The Produktivpfad-Reviewprofil (#516) above composes only the two already-in-scope GET routes; `POST /api/redispatch-readiness-gate/evaluate` and any test-call/access-provisioning/approval/dispatch/release action remain out of scope.
