# Stadtwerk Governance Architecture — CR-LKA-RV-001 RC v1.0 Implementation Pack

This directory contains the CR-LKA-RV-001 Release Candidate implementation pack for **Cernion Energy Tools source version 0.99.21** targeting **RC v1.0**.

The pack turns the earlier spec/test-prep material into executable, schema-backed governance architecture support for selected Stadtwerk decision patterns while keeping all consequential actions outside the RC boundary.

## Scope and boundaries

Implemented scope:

- Schema pack, fixtures, and deterministic projection utilities for CR-LKA-RV-001.
- Scoped development/test in-process writes only, using isolated test databases in the UAT harness.
- In-process Moleculer verification of metadata handoff through existing services where needed.
- Internal-only governance policy evaluation support for UAT and service-level tests.

Explicitly excluded:

- Production deployment, restart, release tagging, or public rollout.
- External market partner actions, EDIFACT/market-message sends, or customer communication.
- Customer-data migration or mutation of production tenant data.
- Binding billing, budget, investment, committee, or regulatory commitments.
- REST/API alias exposure for `governance.evaluatePolicy` in this RC.
- Regeneration of generated OpenAPI/LLM artifacts for this RC decision.

## Worked examples

1. **CRC001 — MaKo/M2C Resolution Value**
   - Projects a MaKo clarification into qualitative Resolution Value.
   - Captures cashflow acceleration / revenue leakage / process-learning value only as evidence-bound qualitative signals.
   - Forbids external market partner replies, master-data changes, invoice approval, and final cashflow amount claims.

2. **CRC004 — Asset-to-Decision**
   - Projects an asset-state signal into a decision-readiness dossier.
   - Keeps forecast/budget confidence qualitative until asset state, risk, budget assumptions, alternatives, and decision ownership evidence are complete.
   - Forbids final investment recommendations, budget commitments, and committee-ready claims.

3. **CRC002 — NEST macro trace only**
   - Remains a macro-boundary trace for investment governance context.
   - It is intentionally not converted into executable UAT scenarios in RC v1.0.

## Components added or changed

Added in `src/stadtwerk-governance-architecture/`:

- `schema-pack/cr-lka-rv-001.schema.json` — neutral schema for run-card value projections.
- `schema-pack/resolution-value-dimensions.schema.json` — allowed Resolution Value dimensions and evidence semantics.
- `fixtures/red/mako-resolution-value.red.json` — RED fixture for MaKo/M2C boundaries.
- `fixtures/red/asset-to-decision.red.json` — RED fixture for Asset-to-Decision boundaries.
- `fixtures/uat/mako-resolution-value.uat.json` — executable CRC001 UAT scenarios.
- `fixtures/uat/asset-to-decision.uat.json` — executable CRC004 UAT scenarios.
- `resolution-value-projection.js` — pure projection utilities for CRC001 and CRC004.
- `governance-policy-adapter.js` — adapter helpers for governance control cases and evidence requirements.
- `handoff/CR-LKA-RV-001-transition-handoff.md` — transition handoff for product-candidate analysis.

Changed elsewhere by the CR-LKA implementation stream:

- `src/agent-receipts-seeds.js` — draft CR-LKA receipt profile seeds.
- `services/decision-frame.service.js` — optional governance metadata pass-through/export.
- `src/role-workbench-projector.js` — governanceArchitecture enrichment for role workbench projections.

Not changed for this RC decision:

- `services/api.service.js` — no REST alias was added for `governance.evaluatePolicy`.
- `openapi-export.json`, `operation-capability-index.json` — not regenerated because there is no API-visible alias change.
- `llm.txt` — regenerated only after the CHANGELOG update so the LLM summary/hash stays in sync; it does not introduce a REST/API alias.

## Test coverage

Focused tests covering the implementation pack:

- `tests/stadtwerk-governance-architecture.schema.test.js` — schema validity and negative-contract checks.
- `tests/stadtwerk-governance-architecture.resolution-value.test.js` — MaKo/M2C Resolution Value projection behavior and safety boundaries.
- `tests/stadtwerk-governance-architecture.asset-to-decision.test.js` — Asset-to-Decision projection behavior and committee/budget boundaries.
- `tests/stadtwerk-governance-architecture.governance-policy.test.js` — governance policy adapter behavior.
- `tests/cr-lka-rv-001.rc-uat.test.js` — RC UAT harness for executable scenarios and in-process service integration.
- `tests/cr-lka-rv-001.api-alias-decision.test.js` — Option A API alias decision guard.

Related regression tests from other touched components:

- `tests/agent-receipts.service.test.js`
- `tests/decision-frame.service.test.js`
- `tests/role-workbench-projector.test.js`

## UAT harness coverage

The RC UAT harness executes **9 scenarios**:

- `UAT-MAKO-001`
- `UAT-MAKO-002`
- `UAT-MAKO-003`
- `UAT-MAKO-004`
- `UAT-MAKO-005`
- `UAT-ASSET-001`
- `UAT-ASSET-002`
- `UAT-ASSET-003`
- `UAT-ASSET-004`

The harness runs in-process with Moleculer and isolated test DB paths. It does not deploy, start a production server, mutate production tenants, or call external market partners.

CRC002 / NEST remains **non-executable macro-boundary documentation** for this RC. It exists to preserve traceability of investment-governance context without implying budget, investment, or committee readiness.

## API alias and generated-artifact decision

RC v1.0 uses **Option A: internal-only** for `governance.evaluatePolicy`.

Decision details:

- `governance.evaluatePolicy` is available for internal Moleculer/service-level UAT.
- No REST alias was added in `services/api.service.js`.
- No API-visible route such as `/governance/evaluate-policy` is introduced.
- `openapi-export.json` and `operation-capability-index.json` are intentionally not regenerated.
- `llm.txt` may be regenerated as a documentation/index artifact when the Unreleased CHANGELOG text changes; this does not change the REST API surface.

This keeps the first RC release-safe while the governance evaluation contract is still being validated.

## Safety and role boundaries

Resolution Value in this pack is qualitative and evidence-bound.

The implementation must not claim:

- final cashflow amount,
- approved invoice state,
- final investment decision recommendation,
- budget commitment,
- committee-ready state,
- binding regulatory assessment,
- autonomous external action authority.

Allowed actions stay preparatory, such as drafting internal handovers, preparing summaries, and requesting missing evidence. Consequential actions require human-in-the-loop confirmation and appropriate resolver/owner roles.

## Focused verification commands

Syntax-check the CR-LKA JavaScript utilities and tests:

```bash
node --check src/stadtwerk-governance-architecture/resolution-value-projection.js
node --check src/stadtwerk-governance-architecture/governance-policy-adapter.js
node --check tests/cr-lka-rv-001.api-alias-decision.test.js
node --check tests/cr-lka-rv-001.rc-uat.test.js
node --check tests/stadtwerk-governance-architecture.governance-policy.test.js
node --check tests/stadtwerk-governance-architecture.schema.test.js
node --check tests/stadtwerk-governance-architecture.asset-to-decision.test.js
node --check tests/stadtwerk-governance-architecture.resolution-value.test.js
```

Run the focused CR-LKA suite:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest \
  tests/cr-lka-rv-001.api-alias-decision.test.js \
  tests/cr-lka-rv-001.rc-uat.test.js \
  tests/stadtwerk-governance-architecture.governance-policy.test.js \
  tests/stadtwerk-governance-architecture.schema.test.js \
  tests/stadtwerk-governance-architecture.asset-to-decision.test.js \
  tests/stadtwerk-governance-architecture.resolution-value.test.js \
  --runInBand --forceExit
```

Confirm generated/API files stayed untouched for this RC decision:

```bash
git diff --name-only -- openapi-export.json llm.txt operation-capability-index.json services/api.service.js CHANGELOG.md
```

Inspect final working tree scope:

```bash
git status --short
```
