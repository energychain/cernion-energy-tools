# GitHub Copilot Instructions for Cernion Energy Tools

## Current Mission

Cernion Energy Tools is no longer just a Moleculer wrapper around MCP tools. Treat it as a KRITIS-oriented, domain-specific agent backend for energy-market operations.

The current architecture line is **v0.52.x**. The center of gravity is the **Personal Agent**:

- conversational orchestration through `POST /api/personal-agent/chat`
- capability routing through `capability-broker` and `capability-catalog`
- Zwiebelmodus context management in `src/personal-agent-context.js`
- durable async execution and watchdogs through `src/job-store.js` and `src/async-job-runner.js`
- async dreaming/profile enrichment through `src/personal-agent-dreamer.js`
- conversational onboarding through `src/personal-agent-onboarding.js`
- attachment/inhouse-data handling through `src/personal-agent-file-handler.js`

Older deterministic services still matter, but they are building blocks behind agent workflows. Do not optimize for isolated endpoint demos when the real product behavior is multi-turn, auditable, and domain-aware.

## Non-Negotiable Architecture Rules

### 1. Preserve the Personal Agent Boundary

- User-facing conversational behavior must flow through `services/personal-agent.service.js` and `/api/personal-agent/chat`.
- Do not bypass the Personal Agent by calling downstream REST endpoints directly from tests or UI-facing flows unless the task explicitly targets that lower-level endpoint.
- Do not add service mocks for Personal Agent acceptance tests. Blackbox tests must exercise real HTTP behavior against the running dev server.
- Preserve session/context continuity across turns. A passing single-turn test is not proof that the Personal Agent works.

### 2. Capability Broker Is the Routing Source of Truth

- Intent/capability mapping belongs in `src/capability-catalog.js` and `services/capability-broker.service.js`.
- Do not create ad hoc intent routing in `personal-agent.service.js`.
- Multi-intent chains must follow the broker/fallback policy. Unsupported chains should degrade gracefully and mark the stop point, typically via an interface-placeholder style response.
- Support both HITL plan-return mode and autopilot execution mode where the existing architecture exposes that choice.

### 3. Zwiebelmodus Context Discipline

`src/personal-agent-context.js` protects the system from context overflow and hallucinated continuity.

- L0/L1/L2/L3/L4 boundaries must stay explicit.
- L3 conversation history may be compressed; L4 tool context must be purged after use.
- Never persist raw transient tool context as durable user memory.
- If a user changes a decisive parameter such as location, asset, tenant, project, or scenario, update/replace the active context instead of blindly appending.
- Tests for multi-turn flows must check that old context does not leak into the new turn after a replacement.

### 4. Durable Execution Over In-Memory Timers

- Long-running/background work must use the existing durable job architecture: `src/job-store.js`, `src/async-job-runner.js`, and related drivers.
- Do not introduce process-local timer maps, Promise registries, or stale payload snapshots for durable behavior.
- Job payloads should carry identifiers and reload current state at execution time.
- Use native optimistic concurrency / CAS where supported. Do not fake concurrency control with timestamps alone.
- Use explicit `idempotencyKey` for wake-ups and retries when available.
- Alarm events should follow the persistent lifecycle model: open -> acknowledged -> resolved.

### 5. KRITIS Data Handling

- Embedded PouchDB and file-backed stores are intentional: no native bindings, no extra database port, no surprise external process.
- Raw inhouse data should not be persisted unless an existing module explicitly allows it. Prefer metadata, provenance, hashes, and bounded extracted facts.
- All inhouse datasource access goes through `datasource-cache.query`.
- Never use `query.ask`, SQL shortcuts, or direct DB lookups for inhouse sources.
- `src/prompt-scrubber.js` exists for PII masking before external LLM calls. Do not bypass it for user/inhouse content.

## Repository Map

- `services/` - Moleculer services and REST actions.
- `services/api.service.js` - API Gateway, OpenAPI at `/api/openapi.json`, Swagger UI at `/api/docs`.
- `services/personal-agent.service.js` - Personal Agent API surface.
- `services/capability-broker.service.js` - capability planning/routing.
- `src/capability-catalog.js` - canonical capability catalog.
- `src/personal-agent-context.js` - Zwiebelmodus context core.
- `src/personal-agent-routing.js` - Personal Agent routing helpers.
- `src/personal-agent-dreamer.js` - async profile/memory enrichment.
- `src/personal-agent-onboarding.js` - missing-context handling.
- `src/personal-agent-file-handler.js` - attachment and inhouse-file handling.
- `src/job-store.js`, `src/job-store/` - durable job persistence and drivers.
- `src/async-job-runner.js`, `src/async-job-poller.js` - async execution/polling.
- `src/mcp-client.js` - centralized MCP client.
- `docs/ui-contracts/` - backend-owned UI contracts.
- `docs/v0.52-implementation-plans/` - current Personal Agent architecture and TDD matrix.
- `tests/` - core Jest suite.
- `custom-services/`, `custom-tests/`, `uploads/` - local/git-ignored areas.

## Coding Style

- CommonJS modules, modern JavaScript, no TypeScript.
- 2 spaces indentation.
- Prefer `const`; use `let` only when reassignment is required; never use `var`.
- Keep functions focused, but do not split domain logic into meaningless fragments.
- Prefer explicit domain names over generic helpers.
- Handle errors explicitly. Do not use empty `catch` blocks.
- Do not hardcode tenant IDs, URLs, secrets, tokens, or local absolute paths.
- Public REST actions need complete OpenAPI annotations. `npm run audit:openapi` is enforced.

## Testing Rules

Use Jest. Choose the smallest meaningful gate, but make it real.

Core gates:

- `npm run test:unit:ci`
- `npm run test:tdd-matrix`
- `npm run check:tdd-matrix-coverage`
- `npm run audit:openapi`
- `npm run check:llm`
- `npm run audit:security`
- full release gate: `npm run release:check`

Personal Agent-specific expectations:

- Unit tests are necessary but not sufficient.
- TDD matrix coverage must prove that every documented `T-*` case is executed and passing, not merely parsed.
- Multi-turn domain E2E tests should be opt-in for CI stability, but executable against a real dev server.
- Blackbox E2E tests for the Personal Agent must call only `POST /api/personal-agent/chat`.
- Do not mock downstream services or HTTP for blackbox Personal Agent E2E. If the dev server is missing, skip clearly; if it is running, execute the real flow.
- Keep acceptance fixtures in `tests/acceptance/` stable unless the task explicitly changes the accepted contract.

### #TDDHermes Standard

When working on the Personal Agent TDD/Hermes thread:

- Search for scenario IDs such as `PA-MT-001`, `PA-MT-002`, `PA-MT-003`.
- Expected artifacts include `personal-agent-multi-turn-domain-e2e.md` and `multi-turn-domain.e2e.test.js` or their clearly named equivalents.
- The goal is not a green skipped suite. The goal is an opt-in suite that can run real multi-turn blackbox flows against a live dev server.
- Validate context mutation behavior: append when the user refines the same scenario; replace when the user changes the decisive scenario parameter.
- A proper fix should be reviewable by Hermes as concrete code/docs in git, not only described in chat.

## Domain Rules

Cernion operates in energy-market and utility-grid workflows. Preserve domain precision.

- Use the established German energy-market terms where the codebase uses them: MaStR, VNB, NAP, fNAV, Redispatch 2.0, §14a EnWG, §42c EnWG, ZNP, EOG, RegKonto.
- Do not invent reserve margins, capacity values, regulatory deadlines, or MaStR facts.
- If deterministic evidence is missing, surface uncertainty and request/record missing context.
- Distinguish verified machine data from user-provided assertions.
- Prefer provenance, auditability, and explainability over fluent unsupported answers.

## Existing Deterministic Layers

These layers still exist and should not be broken:

- Datapoint layer: `services/datapoint.service.js`, metadata-only PouchDB, `dp:` and `snap:` documents.
- OSM geo layer: `services/osm-geo.service.js`, Overpass via `OVERPASS_ENDPOINT`.
- Grid connection validation: `grid-connection.service.js`.
- Energy sharing validation: `energy-sharing.service.js`.
- MaStR quality audit: `mastr-quality.service.js`.
- Redispatch ex-post audit: `redispatch-expost.service.js`.
- Dashboard aggregator: `dashboard-api.service.js`.
- Token manager: `token-manager`, `ck_` tokens, SHA-256 storage, read-only/full-access scopes.

When changing one of these, keep the deterministic pipeline pattern:

- separate PouchDB where already established
- explicit step results and findings
- no hidden LLM dependency in deterministic agents
- EU AI Act Art. 12 style audit trail
- finding code metadata kept in sync

## OpenAPI, UI Contracts, and Frontend Feedback

- REST actions need OpenAPI annotations.
- If a response shape changes, update the relevant `docs/ui-contracts/` file.
- The frontend repository may provide structured feedback files:
  - `BR-` bug report
  - `CR-` change request
  - `IR-` information request
  - `DR-` documentation request
- For feedback work: read the full file, inspect affected service and UI contract, implement or answer, update the UI contract, then mark the feedback resolved with the target version.

## Release Process

1. Update `package.json` version when preparing an actual release.
2. Update OpenAPI version in `services/api.service.js`.
3. Update `CHANGELOG.md`.
4. Run `npm run release:check`.
5. Ensure no secrets are present.
6. Commit, tag, and push only when explicitly performing a release.

Do not bump versions or tag releases for ordinary feature/test changes unless asked.

## Known MCP Data Backend Limitation: Direktvermarktung

Public MaStR data does not expose active Direktvermarkter portfolios.

- `fernsteuerbarkeitDv: true` plus `minCapacity: 100` is only a proxy for Redispatch-relevant DV-like assets where the field exists.
- Filtering by a named Direktvermarkter such as Next Kraftwerke is not possible from public bulk exports.
- `DirektvermarkterMastrNummer` exists in the MaStR model but is excluded from public exports.
- If a user asks for a named DV portfolio, explain the limitation and offer the proxy approach instead of returning invented results.

## What Not To Do

- Do not treat v0.20 as current architecture.
- Do not add isolated demo endpoints for behavior that belongs in the Personal Agent.
- Do not add mocks to make blackbox Personal Agent E2E tests look green.
- Do not store raw inhouse data when metadata/provenance is sufficient.
- Do not introduce external infrastructure dependencies for KRITIS-critical paths without an explicit architecture decision.
- Do not persist L4 tool context or stale job payload state.
- Do not silently swallow errors or expose internal stack traces to users.
- Do not commit commented-out code, secrets, generated local data, or `.env`.
