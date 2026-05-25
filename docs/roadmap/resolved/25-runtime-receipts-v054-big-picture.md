# v0.54 Runtime Receipts - Bigger Picture

## Purpose

This document is stable context for CoPilot Plan Mode when planning v0.54.x milestones.

v0.54 is about moving brittle Personal Agent routing logic out of hard-coded JavaScript paths and into runtime-managed, testable, governed receipts. A receipt is a structured execution pattern that can select services, constrain tool calls, define evidence requirements, and shape response policy without requiring a new code patch for every domain-specific routing refinement.

The immediate proving case is the VNB/BDEW lookup flow. Today it is spread across Personal Agent routing, consultation execution, response policy guardrails, and static Cookbook recipes. v0.54 should extract this kind of pattern into a runtime receipt while preserving conservative fallback behavior.

## Current Architecture Observations

The current Cookbook service is useful but not yet a runtime receipt engine.

- `services/cookbook.service.js` loads static `COOKBOOK_RECIPES` from `src/cookbook-recipes.js`.
- `src/cookbook-recipes.js` describes code-managed, git-tracked recipes.
- Cookbook supports list/get/search/validate/health/service catalogue.
- Cookbook does not currently provide runtime CRUD, drafts, promotion, isolated execution tests, or PouchDB-backed persistence.

The generic agent already uses Cookbook hints, but the Personal Agent does not rely on Cookbook/receipts for routing.

- `services/agent.service.js` can search cookbook hints.
- `services/personal-agent.service.js` contains hard-coded response policy, consultation tool registry, and VNB-specific guardrails.
- `src/consultation-execution-bridge.js` contains hard-coded workflow classification and plan construction.
- `src/consultation-tool-resolver.js` is comparatively reusable: it can derive action parameter schemas and execute Moleculer tools.
- `src/personal-agent-knowledge-rag.js` currently reduces Knowledge Service output to coarse hints such as domain hint, regulatory frame, and synthesis style.

## Target Concept

Create a runtime receipt layer that sits between the user request, Knowledge Service context, and Personal Agent execution.

Receipts should be:

- persisted through PouchDB/Datapoints or the existing repository abstraction used for runtime documents
- versioned and auditable
- status-governed: draft, active, deprecated, archived
- independently testable without invoking the full Personal Agent chat path
- usable by Personal Agent through explicit request controls such as `forceReceipt` and `allowDraftReceipts`
- conservative by default, with existing hard-coded logic retained as fallback during migration

## Receipt Responsibilities

A receipt may define:

- matching conditions: tags, domains, trigger terms, required entities, workflow type
- required inputs: city, BDEW code, operator name, market partner id, asset id, document id, etc.
- tool plan: candidate Moleculer actions, sequence, parameter mapping strategy, fallback actions
- knowledge plan: Knowledge Service queries to run before or during execution
- evidence policy: required observations before an answer may be treated as verified
- forbidden inferences: things the agent must not claim without explicit evidence
- response policy: how to answer if verified, partial, unverified, timed out, or ambiguous
- test cases: minimal executable examples for isolated validation

Receipts should not be arbitrary code. They should be structured data interpreted by stable service code.

## Non-Goals for v0.54

v0.54 should not attempt full autonomous self-modification.

Do not allow production receipts to be silently rewritten by chat. Draft creation is acceptable in a later milestone, but promotion must remain explicit and reviewable.

Do not remove existing Personal Agent hard-coded routes until the equivalent receipt is proven by tests and runtime observations.

Do not make receipts a second untyped programming language. Keep the schema narrow, explicit, and validated.

Do not require all existing Cookbook recipes to migrate in one release.

## Proposed Milestones

### v0.54.0 - Receipt Foundation

Create the runtime receipt service, schema, persistence, CRUD actions, and REST endpoints. No deep Personal Agent integration yet.

### v0.54.1 - Receipt Test Harness

Allow isolated validation, simulation, and explanation of a receipt without full Personal Agent overhead.

### v0.54.2 - Personal Agent Runtime Selection

Integrate receipt selection into Personal Agent with request controls and conservative fallback to existing logic.

### v0.54.3 - VNB Lookup Receipt Migration

Implement the VNB/BDEW lookup as the first production-grade runtime receipt and prove it against known test cases.

### v0.54.4 - Knowledge-Aware Receipts

Let receipts request and carry Knowledge Service evidence, not just coarse domain hints.

### v0.54.5 - Learning Loop / Draft Receipts

Allow proposed draft receipts to be created from chat/admin flows, tested, reviewed, and promoted explicitly.

## Suggested Service Shape

Preferred service name:

- `agent-receipts`

Potential files:

- `services/agent-receipts.service.js`
- `src/agent-receipts-schema.js`
- `src/agent-receipts-selection.js`
- `src/agent-receipts-evaluation.js`
- `tests/agent-receipts.service.test.js`
- `tests/personal-agent.receipts.test.js`

Use existing project conventions and do not invent new infrastructure if a Datapoints/PouchDB abstraction already exists.

## Suggested REST Shape

Exact routing should follow the existing API service style.

Candidate endpoints:

- `GET /agent-receipts`
- `POST /agent-receipts`
- `GET /agent-receipts/:id`
- `PUT /agent-receipts/:id`
- `DELETE /agent-receipts/:id` or archive action if hard delete is avoided
- `POST /agent-receipts/:id/validate`
- `POST /agent-receipts/:id/test`
- `POST /agent-receipts/:id/evaluate`
- `POST /agent-receipts/:id/promote`
- `POST /agent-receipts/select`

## Personal Agent Request Controls

Candidate request parameters:

- `forceReceipt`: force one receipt id and fail clearly if not found or not allowed
- `preferredReceipts`: ordered list of receipt ids to prefer during selection
- `allowDraftReceipts`: allow draft receipts for controlled testing
- `explainReceiptSelection`: include receipt selection diagnostics in debug/metadata output
- `disableReceiptSelection`: bypass runtime receipts for comparison and regression testing

## Compatibility Requirements

Existing Personal Agent behavior must remain stable unless a receipt is explicitly selected or confidently matched.

During v0.54.2 and v0.54.3:

- hard-coded VNB logic remains available as fallback
- tests should compare receipt-selected and legacy paths
- errors must degrade to normal Personal Agent behavior rather than breaking chat

## Reference VNB Receipt Behavior

The VNB receipt should encode this high-level pattern:

1. Detect whether the user request needs a verified responsible grid operator.
2. Extract available evidence: city, postal code, operator name, BDEW code, market partner context.
3. Prefer direct `grid-operations.vnbLookup` if enough input is available.
4. Use `grid-operations.marketPartners` to resolve ambiguous operator or location input.
5. Treat the answer as verified only when the relevant tool observation supports it.
6. If evidence is missing or ambiguous, answer with the missing verification step instead of inventing a VNB.

## CoPilot Planning Protocol

For every v0.54.x milestone:

1. Use this document as stable context.
2. Ask CoPilot for a Plan Mode response only.
3. Require CoPilot to inspect the current codebase before proposing edits.
4. Require a file-by-file implementation plan.
5. Require tests and acceptance criteria.
6. Review the plan before allowing implementation.

CoPilot should not implement until the plan has been reviewed and explicitly approved.

