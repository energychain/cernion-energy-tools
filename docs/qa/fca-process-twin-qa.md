# FCA Process Twin QA Notes

Scope: FCA Process Twin v0.1 / issue #447, implemented as the additive `lifecycleEvidence` projection on `dashboard-api.fnavFastTrackContractGateStatus` and exposed through `GET /api/dashboard/fnav-fast-track-contract-gate`.

## Automated test command

Maintainers can run the focused regression suite with:

```bash
npm test -- tests/dashboard-api.test.js --runInBand --forceExit
```

Optional fast syntax check for touched files:

```bash
node --check services/dashboard-api.service.js && node --check tests/dashboard-api.test.js
```

## Automated coverage in `tests/dashboard-api.test.js`

The focused `fnavFastTrackContractGateStatus` block covers:

- Core happy path: all required gate evidence is supplied and the existing gate returns `ready_for_fast_track`.
- Core missing-evidence path: metering/control evidence gaps return `needs_control_evidence` plus positive follow-ups.
- Backward compatibility: callers without any FCA lifecycle parameters still get the existing gate fields, status semantics, dossier facts and additive `lifecycleEvidence` only.
- Complete FCA/fNAV lifecycle evidence: all required lifecycle stages produce fully provided rows, no lifecycle gaps and no lifecycle follow-ups.
- Partial/missing lifecycle evidence: partial connection/capacity rows and missing restriction, contract, measurement, Redispatch/compensation and governance rows produce review-only lifecycle follow-ups.
- Optional operating-event snapshot: no event is not a gap, a partial event is a gap, and a full event creates exactly one scalar-safe row.
- Scalar-safe display contract: lifecycle rows contain only dossier-display-safe scalar values.
- Read-only safety: lifecycle projection declares forbidden contract, capacity-allocation, grid-mutation, curtailment/dispatch, Redispatch execution/classification, compensation, settlement, MaKo/A96, workflow/HITL, connector and Personal-Agent actions as not called.
- Non-promoting lifecycle evidence: complete lifecycle evidence alone does not promote the legacy/core gate when control, contract, legal, owner or commercial gate evidence remains incomplete; the top-level gate still follows its stricter legacy blocker ordering.
- Validation failure mode: empty lifecycle evidence references are rejected by Moleculer validation before a projection is created.

## Manual QA checklist

Use the endpoint read-only; do not deploy, restart PM2, create HITL items, execute device/control actions or write to external systems during this check.

1. Fetch OpenAPI and confirm the route exists:
   `GET /api/dashboard/fnav-fast-track-contract-gate`.
2. Call the endpoint with only legacy/core gate parameters and confirm existing top-level fields remain present: `capabilityKey`, `gateId`, `decisionReadiness`, `status`, `requestSummary`, `technicalGate`, `commercialGate`, `contractGate`, `evidenceStatus`, `missingEvidence`, `positiveFollowUps`, `sourceActions`, `dossierEvidence`, `safety`, `timestamp`, `_errors`.
3. Confirm `lifecycleEvidence` is present as an additive object and does not change the top-level `status`/`decisionReadiness` calculation.
4. Call with all FCA lifecycle parameters supplied and confirm required lifecycle rows are `provided`, `missingEvidence` is empty, and `positiveFollowUps` is empty.
5. Call with partial lifecycle parameters and confirm gaps are reported under `lifecycleEvidence.missingEvidence` / `lifecycleEvidence.positiveFollowUps` only, with category `fca_fnav_lifecycle_evidence`.
6. Call with no operating-event fields and confirm this optional snapshot is not counted as a gap; call with only `operatingEventRef` and confirm it becomes a partial lifecycle gap.
7. Inspect `lifecycleEvidence.sourceActions.notCalled` and `lifecycleEvidence.notice` for the read-only boundary.
8. Try an empty lifecycle reference such as `connectionRequestRef=` and confirm validation rejects it instead of normalizing it into a lifecycle row.

## Still unverified

- No deployed DevServer/Prod smoke was performed in this QA task.
- No browser or Personal-Agent UI surface was tested; this v0.1 scope is the API-level projection only.
- OpenAPI quality audit remains subject to the existing broader repository gate findings noted in the merge handoff; this QA note does not claim those repo-wide findings are resolved.
