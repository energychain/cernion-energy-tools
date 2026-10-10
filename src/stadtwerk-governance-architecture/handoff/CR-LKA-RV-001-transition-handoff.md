# CR-LKA-RV-001 — RC v1.0 Implementation Handoff

## Active conclusion

CR-LKA-RV-001 has moved from product-candidate analysis into an RC v1.0 implementation pack for Cernion Energy Tools source version `0.99.21`.

The current branch implements the first two worked examples as bounded, schema-backed governance architecture support:

1. `CRC001 — MaKo/M2C Resolution Value Projection`
2. `CRC004 — Asset-to-Decision Run Card Projection`

`CRC002 — NEST / Investment Governance Track` remains macro trace only and is not executable UAT in this RC.

## Current approval and implementation boundary

The earlier pre-implementation approval covered schema-pack, pure utilities, and RED/UAT fixture preparation. The RC implementation scope subsequently allowed scoped development/test implementation in the isolated worktree and in-process test harness.

Allowed in this RC implementation pack:

- deterministic CR-LKA projection utilities;
- schema and fixture hardening;
- draft Agent Receipt profile seeds;
- Decision Frame governance metadata pass-through/export;
- Role Workbench `governanceArchitecture` enrichment;
- in-process Moleculer UAT with isolated local test databases;
- internal-only `governance.evaluatePolicy` use in service-level/UAT tests.

Still explicitly out of scope:

- production deploy, restart, release tagging, or public rollout;
- GitHub push/PR without separate approval;
- external market partner actions or EDIFACT/market-message sends;
- customer-data migration or production tenant mutation;
- binding billing, revenue, budget, investment, committee, or regulatory commitments;
- REST/API alias exposure for `governance.evaluatePolicy` in this RC.

## Source-of-truth references for audit trail

**Nextcloud ADR Registry:** `03 Projekte/Cernion/Governance-Decision-Architecture/ADR/ADR-Register-Cernion-Evidence-to-Decision-v0.1.md`

**Nextcloud Release Change Register:** `03 Projekte/Cernion/Governance-Decision-Architecture/Release-Change/CET-Release-Change-Register-v0.1.md`

**Nextcloud working artifact:** `STROMDAO/AgentOS/10 Working/2026-09-19-StadtwerkeVerstaendnis-Arbeitsstand.md`

**Implementation README:** `src/stadtwerk-governance-architecture/README.md`

**QDrant primary collection:** `stadtwerke_verstaendnis_claim_bridges_v1`

**QDrant run markers inspected during planning:**

- `20260919T_DEEPBRIEFING_V1`
- `20260920T_RUN_CARD_ATLAS_V01_FIRST5`
- `20260920T_MAKO_RESOLUTION_NEST_TRACK_V01`
- `20260920T_RELEASE_CHANGE_GATE_V02`
- `20260920T_ADR_DEEPBRIEFING_V01`

## Implemented mapping to CET components

- `src/stadtwerk-governance-architecture/resolution-value-projection.js` — pure MaKo and Asset projection builders.
- `src/stadtwerk-governance-architecture/governance-policy-adapter.js` — CR-LKA control-case adapter helpers for existing governance policy evaluation.
- `src/agent-receipts-seeds.js` — draft CR-LKA receipt profiles `mako-resolution-value-v1` and `asset-to-decision-v1`.
- `services/decision-frame.service.js` — optional governance metadata persistence/pass-through/export.
- `src/role-workbench-projector.js` — read-only CR-LKA role-boundary projection enrichment.
- `tests/cr-lka-rv-001.rc-uat.test.js` — in-process RC UAT harness for 9 executable MaKo/Asset scenarios.
- `tests/cr-lka-rv-001.api-alias-decision.test.js` — Option A guard: `governance.evaluatePolicy` remains internal-only for RC v1.0.

## Worked example boundaries

### CRC001 — MaKo/M2C Resolution Value

The projection expresses Resolution Value as qualitative, evidence-bound operational value. It may support clarification summaries, missing-evidence requests, internal handover drafts, and role-specific workbench views.

It must not approve invoices, send market partner replies, change master data, or state final cashflow amounts.

### CRC004 — Asset-to-Decision

The projection expresses asset-state signals as decision-readiness evidence for a dossier. It may support asset-state summaries, missing-evidence requests, budget-committee handover drafts, and role-specific workbench views.

It must not recommend a final investment decision, state a budget commitment, or mark committee readiness.

### CRC002 — NEST

NEST remains a macro trace only. The RC UAT harness asserts that NEST is not registered as executable UAT and does not generate regulatory, investment, budget, or committee recommendations.

## API and generated-artifact decision

RC v1.0 selected Option A:

- `governance.evaluatePolicy` is used internally through Moleculer calls.
- No REST alias was added to `services/api.service.js`.
- `openapi-export.json` and `operation-capability-index.json` are not regenerated for this RC decision.
- `llm.txt` may be regenerated after CHANGELOG edits to keep the generated LLM summary and hash in sync; that documentation sync does not expose `governance.evaluatePolicy` as a REST/API route.

## RC verification status

Before this handoff update, the focused and impacted verification set passed:

- CR-LKA focused/UAT/API-alias suites: 6 suites / 26 tests.
- Focused plus impacted service suites: 10 suites / 133 tests.

After this handoff update and schema hardening, rerun the RC quality gate from the implementation plan before committing:

```bash
npm run audit:openapi
npm run check:llm
npm run check:operation-capability-index
npm run test:unit:ci
```

If `npm run test:unit:ci` is blocked by pre-existing repository-wide failures, classify them separately from CR-LKA regressions and fix only touched-scope regressions unless a broader cleanup is explicitly approved.
