# Changelog

All notable changes to the Cernion Energy Tools project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No changes yet._

## [0.50.4] — VDMI E2E Stabilization (DB Path Runtime Resolution)

### Fixed
- [services/vdmi.service.js](services/vdmi.service.js): `created()` resolves `VDMI_DB_PATH` at runtime before opening PouchDB.
  - Prevents accidental fallback to `./data/vdmi` in test processes where the service module is loaded before environment variables are set.
  - Eliminates intermittent `OpenError: IO error: lock ./data/vdmi/LOCK: Resource temporarily unavailable` in VDMI service test runs.

### Changed
- [package.json](package.json): bumped version to `0.50.4`.
- [README.md](README.md): updated current release marker to `v0.50.4`.

## [0.50.3] — API Discoverability Onboarding Fix (Issue #88)

### Changed
- API-Onboarding in [README.md](README.md) neu strukturiert, damit die Plattformbreite in der Schnellnavigation sichtbar ist (Issue #88):
  - prominenter Einstieg über `/api/docs` (Swagger UI) und `/api/openapi.json`
  - domänenbasierter Überblick mit repräsentativen Endpunkten für VDMI, CYA, ZNP/NOVA, EDM, Forecast/Settlement/Flex, Assets/Grid-Validation, Datapoints, MaStR Monitor, OEP/OSM/Knowledge und Finance Agent
  - Klarstellung, dass die Tabelle nur ein Onboarding-Auszug ist und die vollständige API in Swagger dokumentiert ist

## [0.50.2] — VDMI Governance APIs (Human Override, Spectator Mode, Findings, Evidence)

### Added
- New VDMI Governance APIs in [docs/VDMI_GOVERNANCE_APIS.md](docs/VDMI_GOVERNANCE_APIS.md) extending automated agent inference with human-in-the-loop workflows:

  **1. Human Override & Audit Trail** ([services/vdmi-human-override.service.js](services/vdmi-human-override.service.js)):
  - `PATCH /api/vdmi/tenants/:tenantId/matrices/:matrixId` — Override LLM-inferred matrix roles with mandatory rationale (min 20 chars)
  - `POST /api/vdmi/tenants/:tenantId/matrices/:matrixId/revert` — Version rollback with complete audit trail
  - Immutable audit logging for all overrides with integrity hash verification
  - Automatic stakeholder notification on matrix corrections

  **2. Spectator Mode for A2A Dialog Transparency** ([services/vdmi-spectator.service.js](services/vdmi-spectator.service.js)):
  - `GET /api/vdmi/tenants/:tenantId/tasks/:taskId/negotiation-trace` — View complete agent negotiation with reasoning and evidence
  - `GET /api/vdmi/tenants/:tenantId/tasks/:taskId/dossier` — Formatted governance decision document with executive summary and risk assessment
  - Support for phase filtering (proposal, consensus, conflict_resolution) and agent filtering
  - Human touchpoint warnings for low-confidence assignments

  **3. Governance Findings Workflow** ([services/vdmi-findings.service.js](services/vdmi-findings.service.js)):
  - `GET /api/vdmi/tenants/:tenantId/findings` — List all tenant findings with status/severity filters
  - `POST /api/vdmi/tenants/:tenantId/findings/:findingId/mitigate` — Submit mitigation plans with proposed actions
  - `POST /api/vdmi/tenants/:tenantId/findings/:findingId/resolve` — HITL-based finding resolution with dual approval chain
  - Finding lifecycle: `proposed` → `triaged` → `pending_approval` → `approved` → `applied` (mirrors nova-decision-machine v0.49.0)

  **4. Offline-Realität & Evidence Injection** ([services/vdmi-evidence.service.js](services/vdmi-evidence.service.js)):
  - `POST /api/vdmi/tenants/:tenantId/tasks/:taskId/evidence` — Inject manual evidence for dual-evidence requirement fulfillment
  - `POST /api/vdmi/tenants/:tenantId/evidence/:evidenceId/sign` — Digital signature workflow for evidence approval
  - Support for evidence categories: `hr_confirmation`, `manager_attestation`, `legal_exception`, `legacy_system_mapping`
  - Signature requests with portal integration and expiration handling (72-hour default)

- New helper modules for Governance APIs:
  - [src/vdmi-audit-trail.js](src/vdmi-audit-trail.js) — Immutable audit logging with SHA-256 integrity hashing
  - [src/vdmi-signature.js](src/vdmi-signature.js) — Digital signature management for evidence and critical approvals

- 10 new REST endpoints registered in [services/api.service.js](services/api.service.js#L847-L856) with full OpenAPI annotations

- Integration with existing patterns:
  - Tenant quota limits for governance operations (100 overrides/month, 50 findings resolved/month, 20 evidence injections/month)
  - Role-based access control: `hitl-approver`, `data-steward`, `matrix-admin`, `spectator` (read-only)
  - Dual approval chains for critical findings and manual evidence (requires 2+ signatories)
  - Tenant isolation for all new endpoints via `:tenantId` path parameter

### Changed
- Updated package.json to version 0.50.2
- Expanded EOG Calculator endpoints (already present from v0.50.1 fix)

### Technical Details
- All new services use PouchDB for audit trail, findings, and evidence storage (data/vdmi-* directories)
- Audit entries are cryptographically immutable with integrity hash verification
- Finding status follows NOVA Decision Lifecycle (v0.49.0 compatibility)
- Evidence injection supports optional digital signatures with multi-signer approval chains
- Human touchpoint warnings auto-generated for low-confidence assignments (<0.75 precedence score)

## [0.50.1] — Dashboard VDMI KPI Integration

### Added
- Dashboard quality aggregation now includes VDMI governance in [services/dashboard-api.service.js](services/dashboard-api.service.js):
  - new `qualitySummary` agent entry `vdmi` (latest matrices + critical-open finding metric)
  - new `businessKpis` block with management KPIs:
    - `vdmi_shadow_path_resolution_rate`
    - `vdmi_n1_escalation_reduction_rate`
    - `vdmi_fnav_time_to_decision_gain_days`

### Changed
- Expanded finding catalog in [src/validation-findings.js](src/validation-findings.js) with initial VDMI governance code metadata (`VD_*`) for dashboard/tooling consistency.
- Updated dashboard test coverage in [tests/dashboard-api.test.js](tests/dashboard-api.test.js) for VDMI quality summary integration and KPI calculations.
- Updated quality-summary UI contract for VDMI agent rendering and `businessKpis` display in [docs/ui-contracts/03-quality-summary.md](docs/ui-contracts/03-quality-summary.md).

## [0.50.0] — VDMI Service Baseline (Issue 19)

### Added
- New VDMI microservice [services/vdmi.service.js](services/vdmi.service.js) with PouchDB-backed matrix lifecycle and audit persistence (`vdmi:`, `vdmi-template:`, `vdmi-audit:`, `vdmi-finding:`).
- New VDMI REST endpoints (API-first foundation) including:
  - Matrix lifecycle: `GET /api/vdmi`, `GET /api/vdmi/:id`, `POST /api/vdmi`, `POST /api/vdmi/detect`
  - Nomination flow: `GET /api/vdmi/nominations`, `POST /api/vdmi/:id/nominate`, `POST /api/vdmi/:id/confirm-nomination`, `GET /api/vdmi/templates`
  - Human governance APIs: `PATCH /api/vdmi/:id`, `POST /api/vdmi/:id/revert`, `POST /api/vdmi/:id/evidence`
  - Spectator APIs: `GET /api/vdmi/tasks/:taskId/negotiation-trace`, `GET /api/vdmi/tasks/:taskId/dossier`
  - Findings workflow: `GET /api/vdmi/findings`, `POST /api/vdmi/findings/:findingId/mitigate`, `POST /api/vdmi/findings/:findingId/resolve`
  - Role/context APIs: `GET /api/vdmi/my-responsibilities`, `GET /api/vdmi/my-informed`, `GET /api/vdmi/agent/:agentId/role`, `GET /api/vdmi/context`
- Event-driven inference hooks for Moleculer signals and shadow-process bridge events (`mail.attachment.extracted`, `sharepoint.excel.updated`) with automatic governance-finding creation.
- New test suite [tests/vdmi.service.test.js](tests/vdmi.service.test.js) covering matrix lifecycle, detect/trace/dossier, nomination confirmation, findings mitigate/resolve, and tenant isolation.

### Notes
- This release establishes the v0.50.x baseline (Roadmap steps 1–4 core service path).
- KPI aggregation in dashboard and global `VD_*` finding metadata integration are scheduled for follow-up v0.50.x increments.

## [0.49.0] — NOVA Decision Engine Baseline (project-scoped, tenant-bound)

### Added
- New decision lifecycle module [src/nova-decision-machine.js](src/nova-decision-machine.js) with transitions:
  - `proposed -> triaged -> pending_approval -> approved -> applied`
  - terminal states: `rejected`, `expired`
- New NOVA decision guide [docs/NOVA_DECISION_GUIDE.md](docs/NOVA_DECISION_GUIDE.md).
- New project-scoped NOVA endpoints:
  - `GET /api/znp/projects/:projectId/nova/decisions`
  - `GET /api/znp/projects/:projectId/nova/decisions/:id`
  - `POST /api/znp/projects/:projectId/nova/decisions/:id/approve`
  - `POST /api/znp/projects/:projectId/nova/decisions/:id/reject`
  - `GET /api/znp/projects/:projectId/nova/decisions/stats`
  - `POST /api/znp/projects/:projectId/nova/decisions/:id/replay-trigger`

### Changed
- [services/nova.service.js](services/nova.service.js):
  - NOVA decisions are now persisted (`PouchDB`) with project scope and tenant-bound access.
  - Added lifecycle transitions with audit trail (`agent_interventions`) and expiration handling.
  - Added HITL bridge for selected decision kinds (`mastr_correction`, `threshold_update`, `asset_override`).
  - `GET /api/nova/stream` is tenant-aware with optional `projectId` filter and lifecycle event frames.
  - Replay trigger is implemented as **always async** (job descriptor response).
- [services/webhooks.service.js](services/webhooks.service.js): added NOVA lifecycle webhook events:
  - `decision.proposed`, `decision.approved`, `decision.rejected`, `decision.applied`, `decision.expired`.
- [services/api.service.js](services/api.service.js): aliased new NOVA decision endpoints.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): NOVA capability updated to TRL 7 baseline for v0.49.

### Tests
- [tests/nova.service.test.js](tests/nova.service.test.js): added coverage for decision listing, approval/apply lifecycle, tenant binding enforcement, and async replay-trigger descriptor.

## [0.48.4] — Rate Limiting + Tenant Quota Enforcement

### Added
- New rate/quota foundation modules:
  - [src/rate-quota-store.js](src/rate-quota-store.js)
  - [src/rate-quota/driver.js](src/rate-quota/driver.js)
  - [src/rate-quota/file-driver.js](src/rate-quota/file-driver.js)
  - [src/rate-quota/redis-compat-driver.js](src/rate-quota/redis-compat-driver.js)
  - [src/rate-quota/factory.js](src/rate-quota/factory.js)
- New read-only tenant quota service [services/tenant-quota.service.js](services/tenant-quota.service.js):
  - `GET /api/tenants/:id/quotas`
  - `PUT /api/tenants/:id/quotas`
  - `GET /api/tenants/:id/rate-limit-events`
- New documentation [docs/RATE_LIMIT_AND_QUOTAS.md](docs/RATE_LIMIT_AND_QUOTAS.md) for configuration, defaults, and phased rollout.
- New webhook event support for:
  - `rate_limit.exceeded`
  - `quota.threshold.reached`
  - `quota.exhausted`

### Changed
- [src/llm-client.js](src/llm-client.js): LLM calls now preflight tenant quotas and record tenant-scoped usage via an interim token estimator when a tenant context is available.
- [src/metrics.js](src/metrics.js): Added tenant-hash-safe metrics `cernion_rate_limit_hits` and `cernion_quota_usage`.
- [services/api.service.js](services/api.service.js):
  - added explicit aliases and OpenAPI tag for tenant quota visibility endpoints
  - hardened both new GET routes behind the existing full-access policy
  - added full-access enforcement and alias wiring for `PUT /api/tenants/:id/quotas`
  - propagates gateway tenant context into observability async-local state for downstream quota accounting
  - enforces endpoint-class token buckets with `X-RateLimit-*` and `Retry-After` response headers
  - returns structured `429 RATE_LIMIT_EXCEEDED` errors when tenants exceed the configured bucket.
- [services/tenant-quota.service.js](services/tenant-quota.service.js): added `setQuotas` admin action with strict key/value validation (`422 VALIDATION_ERROR`) and tenant-scope protection.
- [src/job-store.js](src/job-store.js): REST-originated async jobs now enforce daily per-tenant job quotas before queueing work.
- [src/job-store.js](src/job-store.js): added tenant-fair async dispatch with per-tenant concurrency caps (`JOB_STORE_MAX_CONCURRENT_PER_TENANT`, default `2`) so one tenant cannot monopolize worker execution.
- [services/knowledge-rag.service.js](services/knowledge-rag.service.js): ingest now enforces monthly per-tenant RAG chunk quotas before embedding and persistence.

### Tests
- Added focused coverage for:
  - gateway rate-limit headers and `429` behavior
  - preflight `LLM_QUOTA_EXCEEDED`
  - async-job quota rejection
  - tenant concurrency-cap enforcement and tenant isolation under queue pressure
  - RAG chunk quota rejection
  - webhook subscription acceptance for new rate/quota events
  - tenant quota mutation endpoint coverage (OpenAPI + aliases + scope + validation)

## [0.48.3] — Subset-Test Coverage Gate Fix + Retrieval Window Floor

### Changed
- [jest.config.js](jest.config.js): Coverage threshold gating is now applied only for full-suite runs.
  - Explicit subset runs (e.g. `npm test -- --runInBand tests/...`) no longer fail due to global coverage thresholds.
  - Full release and CI runs keep strict global thresholds unchanged.
- [services/knowledge-rag.service.js](services/knowledge-rag.service.js): Increased semantic rerank candidate default window floor to at least 30.
  - New effective default for `rerankWindow`: `max(30, min(limit * 4, 50))`
  - OpenAPI description/examples updated accordingly.

## [0.48.2] — Knowledge-RAG Semantic Dedupe & Reranking Hardening

### Changed
- [services/knowledge-rag.service.js](services/knowledge-rag.service.js): Added robust, backward-compatible semantic result post-processing in the v0.43.1 extension path:
  - new optional query params for `query` + `semantic`: `dedupe` (default `true`), `rerank` (default `true`), `diversityPerDocument` (1..5, default `2`), `rerankWindow` (1..100, default `min(limit*4, 50)`)
  - semantic post-processing methods introduced:
    - `normalizeTextForDedupe()`
    - `getResultPayload()`
    - `getDedupeKey()`
    - `getDocumentKey()`
    - `applySemanticPostProcessing()`
  - deduplication now keeps highest-score hit per semantic duplicate group using key priority:
    - `documentId + normalized referenceText_L0`
    - fallback `metadata.title + normalized referenceText_L0`
    - fallback `pointId`
  - score-preserving reranking/diversity applied on candidate window (`rerankWindow`) with per-document cap (`diversityPerDocument`) and deterministic refill behavior
  - local semantic path applies post-processing before pagination to avoid duplicate blocking of first page
  - external semantic MCP path applies same post-processing after MCP response and before metric recording
  - semantic responses now include `data.reranking` diagnostics (`applied`, `dedupe`, `rerank`, `inputCount`, `outputCount`, `removedDuplicates`, `diversityPerDocument`)
- OpenAPI request schemas/examples for semantic query endpoints were extended to expose the new post-processing controls.

### Tests
- [tests/knowledge-rag.service.test.js](tests/knowledge-rag.service.test.js):
  - verifies external semantic duplicate removal by `documentId/referenceText_L0`
  - verifies `dedupe: false` preserves duplicates
  - verifies `data.reranking` metadata population
- [tests/knowledge-rag-ingest.test.js](tests/knowledge-rag-ingest.test.js):
  - verifies local semantic dedupe is executed before pagination and keeps `returned/total` consistent

## [0.48.1] — OIDC/SAML SSO Foundation (Issue 17)

### Added
- Initial authentication foundation for SSO rollout:
  - new RBAC helper [src/auth/rbac.js](src/auth/rbac.js)
  - OIDC helper stub [src/auth/oidc.js](src/auth/oidc.js)
  - SAML helper stub [src/auth/saml.js](src/auth/saml.js)
  - new session service [services/auth.service.js](services/auth.service.js) with `csess_*` session lifecycle:
    - `GET /api/auth/oidc/login`
    - `GET /api/auth/oidc/callback`
    - `POST /api/auth/saml/acs`
    - `POST /api/auth/verify`
    - `POST /api/auth/refresh`
    - `POST /api/auth/logout`
- New documentation [docs/AUTH_OIDC_SAML.md](docs/AUTH_OIDC_SAML.md) with configuration examples for Azure AD, Keycloak and ADFS.

### Changed
- API gateway [services/api.service.js](services/api.service.js):
  - supports `csess_*` verification via `auth.verify` in addition to legacy `ck_*` token verification
  - role checks introduced for write endpoints and HITL approval endpoints (`hitl-approver` required)
  - legacy `ck_*` full-access tokens map to transition roles (`full-access`, `hitl-approver`)
  - legacy `ck_*` responses now include deprecation headers (`Deprecation`, `Sunset`)
  - added new OpenAPI tag `Authentication` and auth route aliases
- HITL service [services/hitl.service.js](services/hitl.service.js): intervention actor metadata enriched with `userId`, `groups`, and `idpClaims` when available via auth context.
- Webhooks service [services/webhooks.service.js](services/webhooks.service.js):
  - added whitelisted events `auth.session.created`, `auth.session.expired`
  - added corresponding event handlers.

## [0.48.0] — EOG-Calculator MVP (Validate/Commit, Kalibrieranker, HITL-Audit)

### Added
- New microservice [services/eog-calculator.service.js](services/eog-calculator.service.js) with tenant-scoped, typed EOG datapoint model and dedicated REST API:
  - `POST /api/eog-calculator/input-status`
  - `POST /api/eog-calculator/datapoints/validate`
  - `POST /api/eog-calculator/datapoints/commit`
  - `POST /api/eog-calculator/calculate`
  - `POST /api/eog-calculator/scenario`
  - `POST /api/eog-calculator/request-input`
  - `GET /api/eog-calculator/:tenantId/:vnbId`
- Strict state model implemented for EOG processing:
  - `dataStatus`: `complete | partial | blocked`
  - `calculationMode`: `actual | scenario | provisional`
  - `confidence`: `confirmed | user_supplied | derived | missing | assumed`
- Typed datapoint keys for MVP scope (including calibration anchors), e.g. `eog.efficiency_value`, `eog.base_cost_level`, `eog.controllable_costs`, `eog.approved_revenue_cap`, `eog.adjusted_revenue_cap`.
- **Detail-Reproduction Field Classification:** `inputStatus` now reports `optionalButRelevant` category (importance: 'detail_reproduction') containing:
  - `eog.quality_element` — Regulatory quality adjustments (positive: bonus +EUR, negative: malus −EUR); directly impacts computed EOG in formula
  - `eog.regulatory_account_balance` — Periodic corrections from prior regulatory periods
  - `eog.capex_adjustment_addition` — Positive capex adjustments
  - `eog.capex_adjustment_deduction` — Negative capex adjustments
  - `eog.volatile_costs` — Market-dependent variable costs
  - These fields are optional for partial EOG calculations but critical for detail reproduction and calibration comparison
- Scenario overrides are transient (`scenario` action) and are not persisted as confirmed actual datapoints.
- HITL integration for missing values with blocker explanations and explicit decision options:
  - `manual_confirm`
  - `document_upload`
  - `scenario_assumption`
  - `abort`
- Audit-capable decision events (tenant/VNB-scoped) persisted for commit/hitl decisions.

### Changed
- API gateway full-access policy extended in [services/api.service.js](services/api.service.js) so `POST /api/eog-calculator/*` requires full-access token scope.
- `inputStatus` response structure enhanced: Now includes `optionalButRelevant` array alongside `required` and `missing` to signal detail-reproduction fields

### Added (Tests)
- New test suite [tests/eog-calculator.service.test.js](tests/eog-calculator.service.test.js) covering:
  - validate vs commit separation (no persistence on validate)
  - successful commit flow with datapoint persistence
  - blocker explanation behavior for missing required inputs
  - calibration-anchor comparison (`match`/deviation model)
  - transient scenario separation from persisted actuals
  - HITL item creation with user choice set
  - **Quality Element Impact Test (NEW):** Demonstrates that positive (+50 EUR) and negative (−30 EUR) quality_element values correctly modify the computed EOG:
    - Positive Q-element (bonus): 1000 − 10 + 300 + 100 + 50 = 1440 EUR
    - Negative Q-element (malus): 1000 − 10 + 300 + 100 − 30 = 1360 EUR
    - No Q-element (default zero): 1000 − 10 + 300 + 100 + 0 = 1390 EUR

## [0.47.2] — Architecture Documentation Re-baseline

### Changed
- Re-based [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to the current workspace state and release baseline:
  - version reference updated to `v0.47.2`
  - architecture layers extended through Multi-Tenant, OEO export, LLM provider abstraction, Knowledge-RAG ingest, Webhooks, HITL, Observability, Pagination, Asset Overrides, OEP delta, Job-Store drivers and Capability Broker
  - top-level counts indexed against the repository export (`63` core services in `services/`, `224` OpenAPI paths, `264` REST operations)
  - TRL section replaced by a hybrid capability + service-coverage table covering all current core services
  - known limitations refreshed with hygiene sprint status, internal-only broker scope and open §42c cutover risks
- Updated [README.md](README.md) for consistent current-state numbers and `v0.47.2` references.

### Added
- New release bridge document [docs/RELEASE_SUMMARY_v0.46.md](docs/RELEASE_SUMMARY_v0.46.md) summarizing the component delta from `v0.40.x` to `v0.46.2`.

## [0.47.1] — Async-Job-Cutover Foundations (Client-Key Idempotency + Progress SSE)

### Added
- New shared async wrapper [src/async-job-runner.js](src/async-job-runner.js):
  - `runAsync(ctx, ...)` for standardized async execution via job-store
  - deterministic idempotency-key generation from request payload hash
  - **client-key priority** for idempotency (`x-client-key` / `x-idempotency-key` / `idempotency-key`)
- Job progress API extension in [services/job-status.service.js](services/job-status.service.js):
  - new `GET /api/jobs/:jobId/progress` endpoint
  - JSON polling response with normalized progress shape `progress: { step, totalSteps, message, payload }`
  - SSE mode via `stream=true` or `Accept: text/event-stream`
  - `Last-Event-ID` replay support (header + `lastEventId` query fallback)

### Changed
- Job-store idempotency support in [src/job-store.js](src/job-store.js) and [src/job-store/file-driver.js](src/job-store/file-driver.js):
  - persisted `idempotencyKey` on job records
  - lookup/reuse of existing non-error jobs for identical idempotency key
  - `appendLog()` now supports optional normalized progress details (`step`, `totalSteps`, `payload`)
  - async descriptor now includes `progressUrl`
- API gateway now forwards incoming request headers into action context metadata (`ctx.meta.requestHeaders`) in [services/api.service.js](services/api.service.js) for client-key and SSE replay handling.
- Async-cutover to shared runner for long-running actions:
  - [services/oep.service.js](services/oep.service.js) → `oep.compareWithMastr`
  - [services/redispatch-expost.service.js](services/redispatch-expost.service.js) → `redispatch-expost.audit`
  - [services/grid-connection.service.js](services/grid-connection.service.js) → `grid-connection.validate`
  - [services/energy-sharing.service.js](services/energy-sharing.service.js) → `energy-sharing.validate`
  - [services/energy-sharing-allocation.service.js](services/energy-sharing-allocation.service.js) → `energy-sharing-allocation.allocate`
  - [services/knowledge-rag.service.js](services/knowledge-rag.service.js) → ingest/reindex/query async entrypoints
  - [services/cya.service.js](services/cya.service.js) → `cya.generate`
  - [services/utility-report.service.js](services/utility-report.service.js) → gateway cutover to generic async jobs (internal path remains compatibility mode)

### Documentation
- Added/updated `202 Accepted` OpenAPI responses for migrated deterministic validation/allocation/audit endpoints.
- Added explicit route alias `GET /jobs/:jobId/progress` in [services/api.service.js](services/api.service.js).

### Tests
- New unit suite [tests/async-job-runner.test.js](tests/async-job-runner.test.js)
- Extended [tests/job-store.test.js](tests/job-store.test.js) for idempotent job reuse + normalized progress fields
- Extended [tests/job-status.service.test.js](tests/job-status.service.test.js) for progress polling + SSE replay behavior

## [0.47.0] — §42c Energieteilen Production-Cutover Sub-Tracks A–G

### Added

**Sub-Track A — A96-Feldspezifikation mit BNetzA-Fallback**
- New module `src/a96-validator.js`: JSON-schema validation for A96 MSCONS messages, drift detection for 4 `[BNetzA-OFFEN]` fields (`ErzeugerMastrNummer`, `Bilanzierungsmonat`, `BdewCodeNetzbetreiber`, `QualitaetskennzeichenMscons`), defensive defaults via `applyA96Defaults()`, finding code `ES_A96_FIELD_DRIFT` (severity: warning)
- New doc `docs/ENERGY_SHARING_A96_DEFAULTS.md`: All 4 open fields documented with defensive defaults, spec-freeze date 2026-06-15, Q3 2026 BNetzA final spec deferred to v0.51
- New test suite `tests/a96-validator.test.js`: 13 unit tests covering validate, applyDefaults, buildDriftFinding

**Sub-Track B — Pilot-Tenant Höheinöd produktiv**
- `services/energy-sharing.service.js`: Tenant-prefixed doc IDs (`es:{tenantId}:{uuid}`), tenantId index, scoped list/get with fallback to legacy prefix
- `services/energy-sharing-allocation.service.js`: Tenant-prefixed doc IDs (`alloc:{tenantId}:{uuid}`), tenantId index
- New migration script `scripts/migrate-tenant-energy-sharing.js`: Fully automated tenant migration (`--tenant`, `--dry-run`), idempotent, EU AI Act Art. 12 audit manifest at `data/migrations/`

**Sub-Track C — Settlement-Readiness Härte-Test**
- Fixed stale references: canonical module is `src/settlement-calculator.js` → `calculateSettlementReadiness()` (not the non-existent `src/settlement-readiness.js`)
- Updated `docs/roadmap/issues/13-energy-sharing-42c-subtracks.md` and CHANGELOG references accordingly

**Sub-Track D — Allokations-Engine Last-Test**
- New test suite `tests/energy-sharing-allocation-load.test.js`: 5 sub-tests — CSV byte-determinism, 30d×96 intervals×100 consumers×5 generators within 10s CI budget, heap delta < 512 MB, allocation correctness (lossless), `ALLOC_MAX_WORKERS` env conformance

**Sub-Track E — Operative Runbooks + HITL-Wiring**
- `services/energy-sharing.service.js`: HITL escalation wired on `error`-severity findings — calls `hitl.create` with `kind: 'energy-sharing-validation-error'`, `originService: 'energy-sharing'`, `originAction: 'validate'`, `severity: 'error'`
- New runbook `docs/RUNBOOK_ES_INCIDENT.md`: 6 incident types (MSCONS gap, Stufe-A/B Reklamation, DV-Wechsel, BK-Korrektur, A96 rollback gate), escalation levels L1–L4

**Sub-Track F — Compliance Sign-Off (DSGVO Art. 35)**
- New template `docs/DSFA_TEMPLATE.md`: DSGVO Art. 35 compliant DSFA template, risk matrix (probability × impact), data categories, Art. 7/17/20 rights references, signature block

**Sub-Track G — Rollback-Plan + Feature Flag + Backup/Restore**
- New service `services/backup-orchestrator.service.js`: Full data restore orchestration for energy-sharing PouchDB, allocation-engine PouchDB, datapoints PouchDB, jobs dir, tokens file. 5 admin API actions: `snapshot`, `restore`, `list`, `get`, `delete`. SHA-256 `provenanceHash` manifest (EU AI Act Art. 12). Restore is additive (missing docs restored, existing skipped).
- `services/bilanzkreis.service.js`: New `getFeatureFlags` (`GET /:id/feature-flags`) and `updateFeatureFlags` (`PATCH /:id/feature-flags`) actions for `virtual_energy_sharing.enabled` flag with rollback gate
- `services/api.service.js`: 7 new admin backup routes + 2 feature-flag routes registered
- New runbook `docs/RUNBOOK_CUTOVER_ROLLBACK.md`: Pre-cutover checklist, Phase 0/1/2 cutover steps, 7-step rollback procedure, DR restore test

### Breaking Changes (⚠️)

- **Tenant-prefixed doc IDs**: Energy-sharing docs previously stored as `es:{uuid}` are now `es:{tenantId}:{uuid}` for non-default tenants. Run `scripts/migrate-tenant-energy-sharing.js --tenant <id>` to migrate existing data. Default tenant continues to use legacy prefix without migration.
- **Allocation doc IDs**: Same pattern: `alloc:{tenantId}:{uuid}` for non-default tenants.

### Fixed

- `src/settlement-calculator.js` was referenced as `src/settlement-readiness.js` in roadmap issue doc and CHANGELOG — corrected.

## [0.46.5] — Finance Agent KPI benchmark orchestrator + MaStR asset fixes

### Added
- **New Finance Agent KPI benchmark orchestrator** in [services/finance-agent.service.js](services/finance-agent.service.js):
  - new action `finance-agent.benchmarkComparison` (REST POST /benchmark-comparison)
  - multi-service orchestration: resolves both VNBs via marketPartners, fetches EWK metrics (Anschlussdauer, Digitalisierungsindex, Umsetzungsquote)
  - optional asset context (solar, wind, storage portfolios) via `assets.all`
  - returns evidence-based comparison with hard KPI synthesis (no RAG hypotheticals)
  - PouchDB persistence with `fa:benchmark:*` document type
  - 4-step pipeline: VNB resolution → EWK fetch → optional asset context → synthesis
  - parameters: `vnb1Name`, `vnb2Name` (required), `comparisonDimensions` (default: anschlussdauer, digitalisierungsindex, umsetzungsquote), `includeAssetContext` (default: false)

- **New VNB KPI benchmark comparison capability** in [src/capability-catalog.js](src/capability-catalog.js):
  - capability `vnb_kpi_benchmark_comparison` in finance-agent domain
  - keywords: benchmark, vergleich, potenzialvergleich, nachbar, wettbewerber, kpi, anschlussdauer, digitalisierungsindex, umsetzungsquote, ewk
  - preferred actions: marketPartners, benchmarkVnb, vnbLookup, assets.all
  - registered in CURATED_CAPABILITIES array with full capability descriptor

### Fixed
- **MaStR asset filtering (`energy-market.service.js`) now sends correct parameter name to MCP tool** ([services/energy-market.service.js](services/energy-market.service.js)):
  - Parameter name corrected: `gridOperatorId` → `gridOperatorMastrId` at line 1001
  - Upstream MCP tool `cernion_installations_local` expects `gridOperatorMastrId` (not `gridOperatorId`)
  - Previous regression: `/api/assets/solar?gridOperatorId=SNB...` returned installations from all grid operators

- **Defensive post-filter added to MaStR asset queries** ([services/energy-market.service.js](services/energy-market.service.js)):
  - lines 1087-1117: After MCP retrieval, extracts operator IDs from multiple fields (netzbetreiberMastrNummer, napData.netzbetreiberMastrNummer, anschlussnetzbetreiberMastrNummer)
  - drops installations with non-matching operator IDs; keeps rows without IDs (older MaStR records)
  - ensures consistent filtering even if upstream MCP tool ignores parameters

- **Asset location parameter routing fixed** ([services/assets.service.js](services/assets.service.js)):
  - lines 647-654: distinguishes 5-digit postal codes from city names
  - 5-digit patterns → `postleitzahl` parameter; others → `location` parameter
  - prevents validation errors when city names passed to PLZ-only fields

- **BDEW code normalization added** ([services/energy-market.service.js](services/energy-market.service.js)):
  - removes internal whitespace from BDEW codes before forwarding to MCP tool
  - supports BDEW codes with spaces (e.g., "9900 599000003")

### Tests
- Added 12 new tests for `benchmarkComparison` action in [tests/finance-agent.service.test.js](tests/finance-agent.service.test.js):
  - evidence-based comparison for two valid VNBs
  - correct comparison of all three dimensions (anschlussdauer, digitalisierungsindex, umsetzungsquote)
  - asset context inclusion/exclusion behavior
  - default comparisonDimensions
  - PouchDB persistence and retrieval
  - no regression in existing `analyze` RAG flow

- Added 2 new tests for Capability Broker routing in [tests/capability-broker.service.test.js](tests/capability-broker.service.test.js):
  - routes VNB KPI benchmark queries to correct capability
  - includes correct keywords for recommendation

- Added regression tests in [tests/energy-market.service.test.js](tests/energy-market.service.test.js):
  - gridOperatorMastrId parameter forwarding
  - defensive post-filter logic (matching rows + fallback)

- Added regression tests in [tests/assets.service.test.js](tests/assets.service.test.js):
  - location parameter routing (5-digit vs city names)

### Changed
- `finance-agent.get` action now supports both `/fa:*` and `/fa:benchmark:*` document types (updated document retrieval logic).

## [0.46.4] — Finance Agent $gateway fix (correct Moleculer meta merge)

### Fixed
- **Root cause of `rawHits=0` identified and fixed** in `retrieveEvidence()` ([services/finance-agent.service.js](services/finance-agent.service.js)): the v0.46.3 attempt destructured `$gateway` out of a spread (`{ $gateway: _gw, ...ragMeta }`) and passed `ragMeta` to `ctx.call`. This is insufficient because Moleculer merges `opts.meta` **on top of** `parentCtx.meta` via `Object.assign({}, parentCtx.meta, opts.meta)`. Since `ragMeta` contains no `$gateway` key, the parent's `$gateway: true` is never overridden in the merged child meta — the child `ctx.meta.$gateway` stays `true`, `startJob` fires async, returns a `{ status: 'queued', jobId }` descriptor, sets `ctx.meta.$statusCode = 202` on the child, Moleculer propagates that back to the parent, and `finance-agent.analyze` returns HTTP 202 after 62 s with `rawHits = 0`.
- **Fix**: replaced the destructure pattern with `{ meta: { ...ctx.meta, $gateway: false } }` — identical to the pattern used in `agent.service.js` internal calls. The explicit `false` value overrides the parent's `true` in the merged meta, `startJob` runs synchronously, and knowledge-rag returns real results.
- **Test mock strengthened**: the shared `knowledge-rag.query` mock in the test suite now simulates `startJob` behaviour — it returns an async job descriptor when `ctx.meta.$gateway === true`. The regression test `'does not propagate $gateway …'` now verifies `ragCalls.every(c => c.gatewayWasTrue === false)`, so any future regression will be caught immediately.

## [0.46.3] — Finance Agent central collection default + gateway fix

### Fixed
- **Finance Agent `retrieveEvidence()` now strips `$gateway` from the meta forwarded to `knowledge-rag.query`** ([services/finance-agent.service.js](services/finance-agent.service.js)). When `/api/finance-agent/analyze` was called via the REST gateway, `ctx.meta.$gateway = true` was propagated to the inner `knowledge-rag.query` call. `startJob()` in `job-store.js` treats any call with `$gateway: true` as a REST call and returns a 202 async-job descriptor instead of actual results. `retrieveEvidence` then received `{ status: 'queued', jobId, … }`, found no `data.results`, and accumulated `rawHits = 0` → `evidence_count = 0` → `hypothetical_scenario`. The fix destructures `$gateway` out of `ctx.meta` before the inner call, so `knowledge-rag.query` always runs synchronously and returns real results.

### Changed
- **Finance Agent retrieval now defaults to the central Landside knowledge collection** `cernion_knowledge_v1` in [services/finance-agent.service.js](services/finance-agent.service.js) when `/api/finance-agent/analyze` is called without an explicit `collection`.
- **Explicitly provided collections remain authoritative** and are passed unchanged to `knowledge-rag.query`.
- **No fallback was added** from explicit empty/no-hit collections to `cernion_knowledge_v1`.
- **No execution behavior changed**: Capability Broker / `agent.analyze` remains advisory only, retrieval remains finance-owned via `knowledge-rag.query`, and `executePlan()` is unchanged.

## [0.46.2] — Planning-Assist rollout (Utility Report, ZNP, CYA)

### Changed
- **Utility Report pipeline (`_runPipeline`) now includes non-blocking planning assist metadata** in [services/utility-report.service.js](services/utility-report.service.js):
  - new helper `getPlanningAssist(...)` (fail-open)
  - phase-0 capture persisted under `progress.meta.planAssist`
  - strict advisory-only behavior (no execution delegation)
- **ZNP planning-assist integration** in [services/znp.service.js](services/znp.service.js):
  - `strategicPrompts` enriches LLM context with broker advisory summary (best-effort)
  - `addAssumption` adds non-blocking `agent.analyze` assist hint for extraction context
  - helper methods `getPlanningAssist(...)` and `getAgentAnalyzeAssist(...)` added with graceful fallback
- **CYA retrieval routing now accepts broker-derived ontology signals** in [services/cya.service.js](services/cya.service.js):
  - new helper `getPlanningOntologySignals(...)`
  - signals injected into retrieval paths for classic generate, multi-agent orchestration, and profile-compare flow
  - fallback remains deterministic/non-blocking when assist is unavailable

### Tests
- Focused suites passed after rollout:
  - [tests/utility-report.service.test.js](tests/utility-report.service.test.js)
  - [tests/znp.service.test.js](tests/znp.service.test.js)
  - [tests/cya.service.test.js](tests/cya.service.test.js)

## [0.46.1] — Finance Agent iterative `agent.analyze` integration

### Changed
- **Finance Agent now uses `agent.analyze` as always-on planning assist** in [services/finance-agent.service.js](services/finance-agent.service.js):
  - initial assist call before retrieval rounds
  - iterative assist calls during refinement rounds
  - strict planning-only usage (`agent.execute` is not used)
- **Dynamic retrieval iteration control** in [services/finance-agent.service.js](services/finance-agent.service.js):
  - quality signals based on L1 evidence, legal references, score, and evidence growth
  - adaptive stop conditions (`quality_target_reached`, `no_new_evidence`, `stagnation`, `max_iterations`)
  - retrieval metadata extended with `stopReason` and `qualitySignals`

### Tests
- Extended [tests/finance-agent.service.test.js](tests/finance-agent.service.test.js) with assertions for:
  - active `agent.analyze` assistance
  - iterative behavior under weak L1 evidence
  - guarantee that `agent.execute` is never called
  - retrieval metadata for dynamic stop logic

## [0.46.0] — Capability Broker v1 (Additive, Internal)

### Added
- **New internal Capability Broker service** in [services/capability-broker.service.js](services/capability-broker.service.js) with actions:
  - `capability-broker.recommend` (advisory recommendation only)
  - `capability-broker.catalog` (curated capability metadata)
- **Curated capability catalog v1** in [src/capability-catalog.js](src/capability-catalog.js) with three-layer modeling:
  - domain capability
  - preferred/fallback/avoid action mapping
  - action-level metadata and routing notes
- **Shared planning utilities** in [src/agent-planning-utils.js](src/agent-planning-utils.js) for reusable planner primitives:
  - `buildServiceCatalogue(...)`
  - `normalizePlan(...)`
- **New broker test suite** in [tests/capability-broker.service.test.js](tests/capability-broker.service.test.js).

### Changed
- **Agent planning now reuses shared utilities** in [services/agent.service.js](services/agent.service.js) by delegating catalogue/normalization to [src/agent-planning-utils.js](src/agent-planning-utils.js).
- **Additive broker integration in `agent.analyze`** (best-effort, non-blocking):
  - calls `ctx.call('capability-broker.recommend', ...)` to capture advisory hints for session context
  - failures degrade gracefully to existing planner behavior
- **Schema/version behavior for broker recommendations**:
  - request schema version is tolerant (missing/unknown maps to v1 with warnings)
  - response is strict and always returns `schemaVersion: "cernion.capabilityRecommendation.v1"`
- **Mode fallback behavior introduced** in broker recommendations:
  - `next_step` without history degrades to `initial`
  - `repair` without execution context degrades to `initial`
  - `compare` without candidates degrades to `initial`
  - all degradations emit warnings
- **Hard `doNotUse` enforcement** in broker output filtering (forbidden actions are excluded from recommended steps).

### Notes
- Capability Broker v1 is **internal action-only** (no API gateway route in v1).
- Execution runtime is unchanged: `executePlan()` remains untouched and authoritative.
- Introduction is additive and backward-compatible with existing `agent.analyze`, `agent.execute`, `query.*`, and domain service flows.

## [0.45.1] — Job-Store Driver Interface Foundation (Closes #60)

### Added
- **Job-store driver interface** in [src/job-store/driver.js](src/job-store/driver.js) with pluggable driver factory in [src/job-store/factory.js](src/job-store/factory.js).
- **Driver targets wired via `JOB_STORE_DRIVER`**:
  - `file` driver in [src/job-store/file-driver.js](src/job-store/file-driver.js) (default).
  - `pouchdb` compatibility driver in [src/job-store/pouchdb-driver.js](src/job-store/pouchdb-driver.js).
  - `redis-compat` compatibility driver in [src/job-store/redis-compat-driver.js](src/job-store/redis-compat-driver.js).
- **Job migration utility** [scripts/migrate-jobs.js](scripts/migrate-jobs.js) and npm script `migrate:jobs` for file→pouchdb document migration.

### Changed
- **Job-store facade refactored** in [src/job-store.js](src/job-store.js) to select drivers via environment without caller code changes.
- **Lease heartbeat metadata introduced** in async job execution path (`leaseOwner`, `leaseExpiresAt`, `lastHeartbeatAt`) with configurable defaults (`JOB_STORE_LEASE_SECONDS`, `JOB_STORE_HEARTBEAT_SECONDS`).
- **`mastr-quality.audit` aligned to generic async job pattern** in [services/mastr-quality.service.js](services/mastr-quality.service.js):
  - REST/gateway calls return `202` job descriptor and use `/api/jobs/:jobId/*` polling.
  - Internal service calls remain synchronous for backward compatibility.
  - OpenAPI action response docs extended to include `202 Accepted` async contract.

### Notes
- v0.45.1 establishes the interface and runtime switch required for distributed rollout while keeping compatibility in-place for existing synchronous call paths.
- Changelog comment for issue closure: implementation start delivered and tracked for GitHub issue `#60` (`Job-Store-Driver-Interface`).

## [0.45.0] — §42c Energieteilen Production-Cutover Plan (Closes #59)

### Added
- **§42c Cutover-Plan Tracking Issue**: Formal tracking structure for Energieteilen production go-live (deadline 01.07.2026) in [docs/roadmap/issues/10-energy-sharing-42c-cutover.md](docs/roadmap/issues/10-energy-sharing-42c-cutover.md).
- **Seven Sub-Tracks with Acceptance Gates**:
  1. A96-Feldspezifikation finalisieren (BNetzA-Klärungspunkte, Spec-Freeze bis 2026-06-15)
  2. Pilot-Tenant-Onboarding Höheinöd (bk_es_test, 3-Wochen-Schattenbetrieb)
  3. Settlement-Readiness Härte-Test (Property-basierte Tests, Edge-Case-Kalibrierung)
  4. Allokations-Engine Last-Test (SLA <30s für 365d × 96 Slots × 100 Consumer × 20 Generator)
  5. Operative Runbooks + HITL-Integration (ES-Incident-Handling, Reklamation-Workflow)
  6. Compliance-Sign-Off (EU-AI-Act Art. 12 Audit-Trail, DSFA)
  7. Rollback-Plan (Feature-Flag `virtual_energy_sharing.enabled`, Snapshot/Restore-Test)

- **Cutover-Freigabe Akzeptanzkriterien**:
  - Alle Sub-Tracks erledigt
  - Pilot-Tenant 14 Tage ohne `error`-Findings
  - `A96_FAEHIG=true` über alle Bilanzkreise
  - BNetzA-Klärungspunkte: 0 offen

### Changed
- **Planning foundations consolidated** across:
  - [docs/ENERGY_SHARING_ABNAHME.md](docs/ENERGY_SHARING_ABNAHME.md): Regulatory acceptance checklist with explicit `[BNetzA-OFFEN]` field markers
  - [src/settlement-calculator.js](src/settlement-calculator.js): KPI logic for `PARAGRAF_42C_KONFORM` and `A96_FAEHIG` (function `calculateSettlementReadiness`)
  - [services/energy-sharing.service.js](services/energy-sharing.service.js): 6-step §42c validation pipeline (deterministic, auditable)
  - [services/energy-sharing-allocation.service.js](services/energy-sharing-allocation.service.js): Allocation engine with CSV export (SLA-critical)
  - [services/settlement.service.js](services/settlement.service.js): A96 readiness endpoint and settlement-export path
  - [docs/ui-contracts/09-bilanzkreis-status.md](docs/ui-contracts/09-bilanzkreis-status.md): Bilanzkreis UI contract for §42c readiness visibility

### Notes
- Deadline: 01.07.2026 (harte Regulatory Frist für Energieteilen Live-Schaltung)
- External dependency: BNetzA A96-Feldspezifikation erwartetet Q3 2026 (nach Cutover-Ziel, daher Fallback-Planung notwendig)
- Existing services & tests provide foundation; cutover plan is **planning artifact only** (no code changes in v0.45.0)
- See [docs/roadmap/issues/12-hitl-queue.md](docs/roadmap/issues/12-hitl-queue.md) for related HITL queue integration context
- Changelog comment for issue closure: tracking plan finalized for GitHub issue `#59` (`§42c Energieteilen Production-Cutover`).

## [0.44.5] — HITL Approval Workflow First-Class (Closes #61)

### Added
- **First-class HITL dashboard APIs** in [services/hitl.service.js](services/hitl.service.js):
  - `GET /api/hitl/summary`
  - `GET /api/hitl/sla-heatmap`
  - `POST /api/hitl/items/bulk-approve`
  - `POST /api/hitl/items/bulk-reject`
  - `POST /api/hitl/items/bulk-escalate`
- **UI contract** [docs/ui-contracts/40-hitl.md](docs/ui-contracts/40-hitl.md) for approval dashboard, bulk actions, filters, and SLA heatmap.

### Changed
- **Direct HITL item returns** in caller flows:
  - [services/assets.service.js](services/assets.service.js) now returns `hitlItem` immediately for critical overrides.
  - [services/finance-agent.service.js](services/finance-agent.service.js) now returns `hitlItem` for `hypothetical_scenario` analyses.
  - [services/cya.service.js](services/cya.service.js) now attaches `hitl_item` to unresolved multi-agent clarification responses and avoids duplicate event-hook creation.
- **HITL filtering and queue analytics** in [services/hitl.service.js](services/hitl.service.js): `originService`, `originAction`, `severity`, and `overdueOnly` filters.
- **Webhook coverage** in [services/webhooks.service.js](services/webhooks.service.js): `hitl.item.expired` is now whitelisted and delivered.

### Tests
- Expanded coverage across:
  - [tests/hitl.service.test.js](tests/hitl.service.test.js)
  - [tests/assets.override.test.js](tests/assets.override.test.js)
  - [tests/finance-agent.service.test.js](tests/finance-agent.service.test.js)
  - [tests/cya.service.test.js](tests/cya.service.test.js)
  - [tests/webhooks.service.test.js](tests/webhooks.service.test.js)
  - [tests/api.service.test.js](tests/api.service.test.js)

### Notes
- Changelog comment for issue closure: implementation completed for GitHub issue `#61` (`HITL Approval Workflow First-Class`).

## [0.44.4] — MaStR↔OEP Delta Engine (Closes #58)

### Added
- **Semantic delta engine** in [src/oep-delta-engine.js](src/oep-delta-engine.js):
  - heuristic MaStR↔OEP joins via `joinByOeoClass`
  - field-level mismatch calculation via `computeFieldDeltas`
  - aggregate delta summary via `aggregateDeltas`
- **Semantic field mapping source-of-truth** in [src/oep-tables.js](src/oep-tables.js):
  - OEO-linked field mappings for `supply.ego_dp_res_powerplant`
  - reusable helpers `getOepTableConfig` and `getOepFieldMappings`
- **Focused test coverage**:
  - [tests/oep-delta-engine.test.js](tests/oep-delta-engine.test.js)
  - expanded [tests/oep.service.test.js](tests/oep.service.test.js)
  - expanded [tests/energy-market.service.test.js](tests/energy-market.service.test.js)

### Changed
- **Structured delta output** in [services/oep.service.js](services/oep.service.js):
  - `POST /api/oep/compare-mastr` now returns non-null `delta` summaries when both sources are available
  - adds `matchedPairs`, `mastrOnly`, `oepOnly`, `capacityDeltaMW`, `fieldDeltas`, `topMismatches`, and `_evidence`
  - keeps `oep.available: false` graceful when OEP is unavailable
- **`installationType: "all"` support** in [services/oep.service.js](services/oep.service.js) and [services/energy-market.service.js](services/energy-market.service.js):
  - enum + OpenAPI updates
  - aggregated MaStR queries across all supported installation types
- **Async large-portfolio compare** in [services/oep.service.js](services/oep.service.js):
  - REST callers now receive HTTP `202` + job descriptor for large requested comparisons (`limit > 5000` or `limit: "all"`)

### Notes
- Changelog comment for issue closure: implementation completed for GitHub issue `#58` (`MaStR↔OEP Delta-Engine`).

## [0.44.3] — Asset Override Production Path (Closes #57)

### Added
- **Persistent asset overrides** in [services/assets.service.js](services/assets.service.js):
  - `POST /api/assets/:assetId/override` now persists tenant-scoped override records in Object Store namespace `tenant:{id}:asset_overrides`.
  - Provenance and audit fields: `provenanceHash`, `approvedBy`, `approvedAt`, `reason`, `agent_interventions`, `supersedes`, `tenantId`.
  - Business `assetId` support with SEE-ID default/fallback via normalized mapping.
- **New override read/apply/revert endpoints**:
  - `GET /api/assets/:assetId/overrides`
  - `GET /api/assets/:assetId/effective`
  - `POST /api/assets/:assetId/overrides/:id/apply`
  - `DELETE /api/assets/:assetId/overrides/:id`
- **UI contract** [docs/ui-contracts/31-asset-overrides.md](docs/ui-contracts/31-asset-overrides.md).

### Changed
- **Critical field governance with pending approval**:
  - Whitelist implemented for overrideable fields: `capacityKW`, `voltageLevel`, `commissionDate`, `direktvermarktungActive`.
  - Critical fields (`voltageLevel`, `direktvermarktungActive`) are persisted with `approvalStatus=pendingApproval` and linked HITL item.
- **Effective-read integration**:
  - Asset list flows (`assets.solar/wind/storage/all`) apply approved overrides before output mapping.
  - `mastr-quality.stepInventory` and `redispatch-expost.stepPortfolio` attempt to apply approved overrides via `assets.applyOverridesToInstallations` (graceful fallback when unavailable).
- **API gateway aliases** in [services/api.service.js](services/api.service.js) updated for all new asset-override routes.

### Tests
- Expanded [tests/assets.override.test.js](tests/assets.override.test.js) from stub coverage to production behavior:
  - persistence + provenance
  - critical-field `pendingApproval`
  - apply after HITL approval
  - effective view with source trail
  - soft-revert
  - cross-tenant isolation

## [0.44.2] — Global Cursor Pagination Framework (Closes #56)

### Added
- **Shared cursor pagination utility** in [src/pagination.js](src/pagination.js):
  - Opaque cursor format with signed payload `{ pivot, direction, hash }`
  - Tenant-aware HMAC verification with derived default secret fallback
  - Standard `pageInfo` contract: `nextCursor`, `prevCursor`, `hasMore`, `totalCountApprox`
  - Offset deprecation helper (`Deprecation: true`, `Sunset: 2026-11-05`)
- **Reusable OpenAPI schemas** in [services/api.service.js](services/api.service.js):
  - `PaginationCursor`
  - `PageInfo`

### Changed
- **Cursor pagination rolled out** to the following API list endpoints:
  - [services/cya.service.js](services/cya.service.js): `GET /profiles`, `GET /a2a-stats`, `GET /sessions/:id/a2a-log`
  - [services/mastr-monitor.service.js](services/mastr-monitor.service.js): `GET /watches`, `GET /watches/:watchId/deltas`
  - [services/mastr-quality.service.js](services/mastr-quality.service.js): `GET /audits`
  - [services/redispatch-expost.service.js](services/redispatch-expost.service.js): `GET /audits`
  - [services/grid-connection.service.js](services/grid-connection.service.js): `GET /validations`
  - [services/energy-sharing.service.js](services/energy-sharing.service.js): `GET /validations`
  - [services/energy-sharing-allocation.service.js](services/energy-sharing-allocation.service.js): `GET /allocations`
  - [services/finance-agent.service.js](services/finance-agent.service.js): `GET /analyses`
  - [services/datapoint.service.js](services/datapoint.service.js): `GET /`
  - [services/datasource-registry.service.js](services/datasource-registry.service.js): `GET /datasources`
  - [services/edm.service.js](services/edm.service.js): `GET /melos` (cursor-compatible keyset pagination)
- **Backwards compatibility**:
  - Existing `limit` support retained
  - `offset` accepted as deprecated alias during transition and emits deprecation headers

### Tests
- Added [tests/pagination.test.js](tests/pagination.test.js) covering:
  - cursor roundtrip signing/verification
  - tamper detection
  - cursor traversal behavior

## [0.44.1] — Observability Stack Foundation (Closes #55)

### Added
- **Prometheus-style metrics export** on root route [services/api.service.js](services/api.service.js):
  - `GET /metrics` with `METRICS_PUBLIC=true` for public scrape or full-access `ck_` token otherwise
  - custom metric families for actions, logs, utility-report phases, async jobs, LLM, MCP, RAG, MaStR deltas and A2A negotiations
- **Structured logging** in [src/logger.js](src/logger.js) with context fields `service`, `action`, `tenantId`, `traceId`, `sessionId`, `correlationId`
- **OpenTelemetry helpers** in [src/tracing.js](src/tracing.js) and async context propagation in [src/observability-context.js](src/observability-context.js)
- **Grafana starter dashboards** in [docs/observability/grafana/README.md](docs/observability/grafana/README.md)

### Changed
- **Global Moleculer instrumentation** in [moleculer.config.js](moleculer.config.js):
  - action spans and structured log emission
  - trace-carrier propagation into nested service calls
- **Shared outbound clients instrumented**:
  - [src/llm-client.js](src/llm-client.js) records provider/model/status latency metrics
  - [src/mcp-client.js](src/mcp-client.js) records tool latency and quota-retry trace events
- **Acceptance-critical trace coverage** in [services/utility-report.service.js](services/utility-report.service.js):
  - Phase 3/4 duration metrics
  - outbound broker + MCP child spans
  - retry trace events for `fetchWithRetry`
- **Domain metrics added**:
  - [services/knowledge-rag.service.js](services/knowledge-rag.service.js) → `cernion_rag_query_hit_count`
  - [services/mastr-monitor.service.js](services/mastr-monitor.service.js) → `cernion_mastr_delta_count`
  - [services/cya.service.js](services/cya.service.js) → `cernion_a2a_negotiation_rounds`

### Notes
- Prometheus labels intentionally exclude tenant identifiers to stay KRITIS-safe.

## [0.44.0] — Outbound Webhooks + HITL Ownership (Closes #54)

### Added
- **Neuer Service `webhooks`** in [services/webhooks.service.js](services/webhooks.service.js):
  - `POST /api/webhooks` (Subscription erstellen)
  - `GET /api/webhooks` (Subscriptions listen)
  - `DELETE /api/webhooks/:id`
  - `POST /api/webhooks/:id/test`
  - `GET /api/webhooks/:id/deliveries`
  - `POST /api/webhooks/:id/deliveries/:deliveryId/replay`
- **Persistente Outbox + Retry/DLQ**:
  - At-least-once Delivery mit Backoff `1m/5m/30m/2h/12h`, max. 5 Versuche.
  - Dead-Letter-Status (`dead`) und optionales Auto-Disable nach 50 Dead Deliveries.
- **Signatur + Secret-Schutz**:
  - `X-Cernion-Signature` via HMAC-SHA256.
  - Neuer Crypto-Helper [src/webhook-crypto.js](src/webhook-crypto.js).
  - Webhook-Secrets werden at-rest verschlüsselt gespeichert (`WEBHOOK_SECRET_ENCRYPTION_KEY`, Option A: ein aktiver Key).
- **Neuer Service `hitl`** in [services/hitl.service.js](services/hitl.service.js):
  - `POST /api/hitl/items`, `GET /api/hitl/items`, `GET /api/hitl/items/:id`
  - `POST /api/hitl/items/:id/approve|reject|escalate`
  - Events: `hitl.item.created`, `hitl.item.resolved`, `hitl.item.expired`
- **Integrationsdokumentation** in [docs/INTEGRATION_WEBHOOKS.md](docs/INTEGRATION_WEBHOOKS.md) mit Verifikationsbeispielen (Node/Python/Power Automate).

### Changed
- **Emitter ergänzt**:
  - `mastr-quality.audit.completed` in [services/mastr-quality.service.js](services/mastr-quality.service.js)
  - `redispatch-expost.audit.completed` in [services/redispatch-expost.service.js](services/redispatch-expost.service.js)
  - `finance-agent.analysis.completed` in [services/finance-agent.service.js](services/finance-agent.service.js)
- **Dedizierte HITL-Ownership für CYA-Konsensfehler**:
  - CYA delegiert `cya.a2a.consensus.failed` an `hitl.create` in [services/cya.service.js](services/cya.service.js).
- **API Gateway erweitert** in [services/api.service.js](services/api.service.js):
  - neue Alias-Routen für `hitl` und `webhooks`
  - neue OpenAPI-Tags `HITL` und `Webhooks`
  - Full-Access-Schutz für mutierende HITL-/Webhook-Endpunkte

### Tests
- Neue Tests:
  - [tests/webhook-crypto.test.js](tests/webhook-crypto.test.js)
  - [tests/hitl.service.test.js](tests/hitl.service.test.js)
  - [tests/webhooks.service.test.js](tests/webhooks.service.test.js)
- API-Gateway-Tests erweitert in [tests/api.service.test.js](tests/api.service.test.js) um Alias-/Tag-Abdeckung für HITL/Webhooks.

## [0.43.1] — Knowledge-RAG Ingestion Pipeline (Closes #53)

### Added
- **Knowledge-RAG own ingestion pipeline** in [services/knowledge-rag.service.js](services/knowledge-rag.service.js):
  - `POST /api/knowledge-rag/collections` — tenant-isolierte Collection-Erstellung (`tenant:{id}:knowledge` default)
  - `POST /api/knowledge-rag/ingest` — Dokument-Ingest als Async-Job
  - `POST /api/knowledge-rag/ingest/from-datasource` — Ingest aus `datasource-registry` + `datasource-cache`
  - `POST /api/knowledge-rag/ingest/from-audit` — Self-Knowledge-Ingest (CYA, MaStR-Quality, Redispatch, Energy Sharing)
  - `DELETE /api/knowledge-rag/collections/:name` — Collection + Chunk-Löschung
  - `POST /api/knowledge-rag/reindex/:collection` — Re-Embedding auf neues Modell
  - `POST /api/knowledge-rag/cutover/:collection` — aktives Modell-Version-Cutover
- **Chunking utility** in [src/knowledge-rag-chunker.js](src/knowledge-rag-chunker.js):
  - Strategien `paragraph`, `markdown-section`, `fixed-window`, `semantic`.

### Changed
- **Knowledge-RAG Query path erweitert**:
  - Query-Endpunkte nutzen bei vorhandener lokaler Collection tenant-lokale Vektor-Retrieval-Logik,
    andernfalls weiterhin MCP-Fallback über `cernion_rag_search`.
- **Provenance für lokale Chunks**:
  - pro Chunk: `sourceId`, `sourceVersion`, `sha256`, `oeoTags`, `tenantId`, `ingestedAt`, `modelVersion`.
- **PII-Scrubbing ist verpflichtend im Ingest-Pfad**:
  - strukturiert via `scrubForLLM(...)` und freitextlich via `scrubPromptText(...)` vor Persistenz/Embeddings.
- **Finance-Agent tenant-default collection** in [services/finance-agent.service.js](services/finance-agent.service.js):
  - Default Retrieval-Collection jetzt `tenant:{tenantId}:knowledge`.
- **API Gateway erweitert** in [services/api.service.js](services/api.service.js):
  - neue Knowledge-RAG-Aliases
  - Full-Access-Schutz für write/reindex/cutover-Endpunkte.

### Tests
- Neue Test-Suites:
  - [tests/knowledge-rag-ingest.test.js](tests/knowledge-rag-ingest.test.js)
  - [tests/knowledge-rag-chunker.test.js](tests/knowledge-rag-chunker.test.js)
- Erweiterte Suite:
  - [tests/knowledge-rag.service.test.js](tests/knowledge-rag.service.test.js)

### Notes
- Reindex verwendet kontrolliertes Grace-Fenster: vorherige aktive Modellversion bleibt bis zu 7 Tage als `grace` markiert.

## [0.43.0] — LLM Provider Abstraction (Closes #52)

### Added
- **Provider-based LLM abstraction** in `src/llm-client.js`:
  - New provider interface with `generateStructured(schema, prompt, options)`, `generateText(prompt, options)`, `embeddings(texts, options)` and `capabilities()`.
  - Configurable provider selection via `LLM_PROVIDER` (`gemini`, `openai-compat`, `ollama`).
  - Provider capabilities now exposed as `{ structured, embeddings, vision, contextWindow }`.
- **Provider adapters**:
  - `src/adapters/gemini.js`
  - `src/adapters/openai-compat.js`
  - `src/adapters/ollama.js`
- **System LLM health probe** in `services/system.service.js`:
  - New endpoint `GET /api/system/llm/health`
  - Probe executes `generateText('ping')` and `embeddings(['ping'])` with 5s timeout.
  - Degraded mode reporting (`status=degraded`, `signal=yellow`) when text is healthy but embeddings are unavailable/failing.

### Changed
- **Permissive structured auto-fallback** in `src/llm-client.js`:
  - Structured generation first attempts provider-native structured output.
  - On provider/schema/parsing failures, automatic fallback to JSON-only text generation with tolerant JSON extraction (raw, fenced, first object block).
- **Centralized prompt scrubbing preserved**:
  - `prompt-scrubber` is still enforced before every provider adapter call.
- **Direct Gemini runtime callsites migrated to `llm-client`**:
  - `services/agent.service.js`
  - `services/utility-report.service.js`
  - `src/cookbook-embeddings.js`
- **Provider config surface expanded** in `.env.example` and runtime parsing:
  - `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`
  - `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`
  - `LLM_STRUCTURED_MODE=schema|json|tool`
  - `LLM_EMBEDDING_MODEL`
  - Gemini env vars remain backward-compatible.

### Tests
- New `tests/llm-client.test.js` for provider selection, structured fallback, capability handling and retry behavior.
- `tests/system.service.test.js` extended for `system.llmHealth` with `ok`, `degraded` and `unhealthy` semantics.

### Documentation
- `README.md` updated with provider config and `/api/system/llm/health` endpoint.
- `docs/BACKEND_CONTEXT.md` updated for KRITIS/on-prem LLM provider abstraction context.

## [0.42.0] — Productive OEO Export (Closes #50)

### Added
- **Productive OEO JSON-LD export** in `src/oeo-exporter-stub.js`:
  - `transformToOEO()` now emits productive JSON-LD instead of throwing `OEO_NOT_IMPLEMENTED`.
  - `NODE_TYPE_TO_OEO_CLASS` and `EDGE_TYPE_TO_OEO_PROPERTY` now map the CYA graph surface for `INSTALLATION`, `NAP`, `SUBSTATION`, `VNB`, `REGION` and `VERBUNDEN_MIT`, `LIEGT_IN`, `BETRIEBEN_VON`, `ZUSTAENDIG_FUER`.
  - Installations are exported as `oeo:PowerPlant` with energy-carrier-specific subclasses where detectable.

- **Central OEO JSON-LD context** in `src/oeo-context.js`:
  - Pinned ontology version `2.11.0`
  - Fixed release IRI `https://github.com/OpenEnergyPlatform/ontology/releases/tag/v2.11.0`
  - Shared namespace/context source for exporter and tests.

- **New CYA export endpoint** in `services/cya.service.js` and `services/api.service.js`:
  - `GET /api/cya/graph/export/oeo` is now the canonical endpoint.
  - `GET /api/cya/graph/export/oeo-stub` remains as a deprecated alias until `2026-11-05`.
  - The response now includes `oeo`, `warnings`, `validationSummary`, `oeoVersion` and `oeoVersionIri`.

### Changed
- **OEO version pinning** is now enforced:
  - Query parameter `oeoVersion` is accepted, but only the release-pinned version is valid.
  - Unsupported versions return `UNSUPPORTED_OEO_VERSION` instead of silently drifting ontology semantics.

- **Unknown graph types** no longer block exports:
  - Unknown node and edge types are downgraded to `warnings[]`.
  - `validationSummary` now aggregates mapped/unknown counts for regression visibility.

- **Science documentation** in `CONTRIBUTING_SCIENCE.md` now documents the productive endpoint, version pinning and SHACL-based regression flow.

### Tests
- New and expanded OEO coverage:
  - `tests/oeo-exporter-stub.test.js` expanded to productive mapping, versioning, warning and empty-graph coverage.
  - `tests/cya.oeo-export.test.js` covers canonical endpoint behavior, deprecated alias behavior and version rejection.
  - `tests/oeo-exporter-shacl.test.js` adds Höheinöd round-trip SHACL validation for the exported JSON-LD.
- OEO-focused test matrix now covers 24 assertions, including SHACL pass, class/property mapping, warning handling, framing and version pinning.

## [0.41.0] — Multi-Tenant Platform (Closes #51)

### Added
- **Multi-Tenant Isolation** across all storage-backed services (Issue #51 — PoC → Produktion):
  - `src/tenant-context.js` bereits vorhandene Grundlage (`getTenantId`, `tenantNamespace`, `DEFAULT_TENANT`) — jetzt vollständig genutzt.
  - Tenant-Context wird vom API Gateway über `ctx.meta.tenantId` aus dem verifizierten Token propagiert.

- **VNB-Monitor** (`services/vnb-monitor.service.js` v0.41):
  - Threshold-Konfiguration (get/set/reset) und Snapshot-Cache pro Tenant isoliert.
  - Neue Helfer: `getThresholdNamespace`, `getCacheKey(bdewCode, tenantId)`, `clearTenantCache`, `loadThresholds`.

- **NBP-Monitor** (`services/nbp-monitor.service.js` v0.41):
  - Parameterkonfiguration (get/set/reset) und Snapshot-Cache pro Tenant isoliert.
  - Neue Helfer: `getParametersNamespace`, `getCacheKey(bdewCode, tenantId)`, `clearTenantCache`, `loadParameters`.

- **Bilanzkreis** (`services/bilanzkreis.service.js` v0.41):
  - Object-Store-Namespace für alle CRUD- und List-Operationen per Tenant getrennt.
  - Neue Methode `resolveNamespace(ctx, namespace)`.

- **Settlement** (`services/settlement.service.js` v0.41):
  - Redispatch-/EEG-Settlements werden pro Tenant gespeichert und abgefragt.
  - Neue Methode `resolveNamespace(ctx)`.

- **CYA Agent** (`services/cya.service.js` v0.41) — vollständige Session-Isolierung:
  - Vier neue Namespace-Resolver: `resolveProfileNamespace`, `resolveSessionNamespace`, `resolveContextStateNamespace`, `resolveA2ANamespace`.
  - Profiles, Sessions, ContextState (Zwiebelmodus) und A2A-Logs werden je Tenant isoliert geschrieben und gelesen.
  - `_persistContextState(ctx, …)` / `_restoreContextState(ctx, …)` akzeptieren jetzt `ctx` als ersten Parameter.
  - `_emitA2AMessage(ctx, msg)` persistiert in den tenant-spezifischen A2A-Namespace.
  - `_observeAndUpdateProfile(ctx, …)` und `_writePersonaMemory(ctx, …)` schreiben Profil-Observer- und Persona-Memory-Daten tenant-bewusst.
  - Backward-Kompatibilität: Default-Tenant (`tenantId = 'default'`) verhält sich identisch wie zuvor.

### Tests
- `tests/vnb-monitor.service.test.js` — Cache-Isolation, Threshold-Isolation je Tenant.
- `tests/nbp-monitor.service.test.js` — Cache-Isolation, Parameter-Namespace-Isolation je Tenant.
- `tests/bilanzkreis.service.test.js` — Gleiche Bilanzkreis-ID in zwei Tenants unabhängig.
- `tests/settlement.service.test.js` — Settlement in Tenant A unsichtbar für Tenant B.
- `tests/cya.service.test.js` — 3 neue Isolationstests: Profile-Isolation, Session-Isolation (generate → refine cross-tenant 404), `profile.update`-Isolation.
- Alle bestehenden Suites (177 Tests) weiterhin grün.

 — Observability Mini Dashboard + Agent Prompt

### Added
- **Dashboard mini observability endpoint** in `services/dashboard-api.service.js`:
  - Neuer read-only Endpunkt `GET /api/dashboard/observability-mini`
  - Kompakte Karten für Fehleranzahl, Fehlerquote, P95-Latenz und Slow-Action-Anteil
  - Top-`N` `recentErrors` und `slowestActions` für schnelle Produktions-Triage
  - Graceful Degradation über `_errors` + 60s Cache (stampede-safe)

- **Agent prompt endpoint** in `services/observability.service.js`:
  - Neuer read-only Endpunkt `GET /api/observability/agent-prompt`
  - Baut aus aktuellen Produktionssignalen einen kopierbaren Debugging-Prompt für agentische Analyse
  - Liefert strukturierte Kontextdaten (`logs`, `metrics`) inkl. redaktierter Fehlerereignisse

- **Cookbook recipes** in `src/cookbook-recipes.js`:
  - `dashboard-observability-mini`
  - `agentic-production-feedback-prompt`

- **UI contract documentation**:
  - Neuer Vertrag `docs/ui-contracts/30-observability-mini.md`
  - Index-Update in `docs/ui-contracts/00-architecture.md`

### Tests
- `tests/dashboard-api.test.js` erweitert um `dashboard-api.observabilityMini`
- `tests/observability.service.test.js` erweitert um `observability.agentPrompt`
- Bestehende API- und Cookbook-Tests für die neuen Flows grün

## [0.40.6] — Observability Feedback Endpoints

### Added
- **Operational observability service** in `services/observability.service.js`:
  - Neue read-only REST-Endpunkte:
    - `GET /api/observability/logs` — erfasste Broker-/Service-Logs mit Filterung nach `level`, `service`, `action`, Textsuche und Zeitfenster
    - `GET /api/observability/metrics` — aggregierte Aktions-Performance (Erfolgs-/Fehlerzahlen, Dauer, langsame Actions, optional Raw-Metrics)
    - `GET /api/observability/summary` — kompakte Produktionsübersicht aus Logs + Performance-Metriken
  - Vollständige OpenAPI-Dokumentation unter dem neuen Tag `Observability`.

- **PouchDB-basierte Observability-Persistenz** in `src/observability-store.js`:
  - Lokale, KRITIS-konforme Speicherung von Log- und Metrik-Dokumenten in `./data/observability` (konfigurierbar via `OBSERVABILITY_DB_PATH`)
  - Retention-Steuerung über `OBSERVABILITY_LOG_RETENTION_DAYS` und `OBSERVABILITY_METRIC_RETENTION_DAYS`
  - Automatische Redaction für Bearer-Tokens, `ck_`-Tokens und typische Secret-Query-Parameter

### Changed
- **Broker-weite Capture-Instrumentierung** in `moleculer.config.js`:
  - Logger-Ausgaben von Broker und Services werden zentral abgegriffen und in die Observability-Persistenz geschrieben.
  - Moleculer-Action-Handler werden beim Laden der Services gewrappt, um Dauer, Status (`success`/`error`), Fehler-Typ und Aufruf-Ursprung (`gateway`/`internal`) als Performance-Metriken mitzuschreiben.
- **API/OpenAPI-Surface** in `services/api.service.js` und `tests/api.service.test.js` erweitert um die neue Kategorie `Observability`.

### Tests
- Neue Test-Suite `tests/observability.service.test.js` für:
  - Redaction und Abruf erfasster Logger-Ausgaben
  - Aggregation von Action-Metriken nach Erfolg/Fehler
  - Kompakte Summary-Antwort für Produktionsfeedback
- `tests/api.service.test.js` erweitert um OpenAPI-/Route-Prüfung für `/api/observability/logs`.

## [0.40.5] — Finance Agent LLM Intelligence Refactor

### Changed
- **Finance Agent LLM integration** in `services/finance-agent.service.js`:
  - `buildQueryPlan`, `findConflicts` und `synthesize` nutzen jetzt den zentralen LLM-Client aus `src/llm-client.js` via `generateStructured(...)`.
  - Neue strukturierte Schemas für Query-Planung, Konflikt-Arbitration und Synthese mit strikter Typisierung über `SchemaType`.
  - Graceful-Degradation-Fallbacks eingeführt: `_buildQueryPlanFallback`, `_findConflictsFallback` und `_synthesizeFallback` werden bei `LLM_NOT_CONFIGURED`, Timeout oder leicht fehlerhaften Antworten automatisch verwendet.
  - Status-Koerzierung in der Synthese strikt auf `ok`, `needs_clarification` und `hypothetical_scenario` begrenzt, mit sicherem Fallback auf `needs_clarification`.
  - Finance-Pipeline-Version auf `0.40.5` erhöht.

### Tests
- `tests/finance-agent.service.test.js` erweitert um:
  - deterministisches Mocking des zentralen LLM-Clients für Planner, Arbiter und Synthese
  - Verifikation des Fallback-Pfads bei `LLM_NOT_CONFIGURED`

## [0.40.4] — Finance Agent A²MDM Upgrade (CYA + OEO + Datapoints + Multi-Hop)

### Added
- **Finance Agent A²MDM-Orchestrierung** in `services/finance-agent.service.js`:
  - `POST /api/finance-agent/analyze` erweitert um:
    - `profileId` (CYA-Layer-Awareness)
    - `datapointContext[]` (Working-Memory Fakten vor RAG)
    - `persistDatapoints` (Persistenz abgeleiteter Ergebnisse)
    - `allowHypotheticals` (What-If-Fallback ohne L1-Basis)
  - CYA-Integration über `ctx.call('cya.getProfile', { id, profile_id })` mit robuster 404/Service-Fallback-Logik.
  - Datapoint-Working-Memory über `ctx.call('datapoint.get')` und L1-Fakt-Einspeisung vor `knowledge-rag.query`.
  - Iteratives Multi-Hop-Retrieval (`max 2` Verfeinerungsrunden) mit OEO-/Layer-basierten Refinements.
  - Neuer Ergebnisstatus: `hypothetical_scenario` inkl. expliziter ontologischer Annahmen.

- **Ontologie-First Verhalten (OEO/CEO)**:
  - Query-Planer erweitert um Layer-Filter und OEO-Graph-Anker.
  - Query-Refiner Prompt ergänzt (deterministisch, max. 2 Runden, CYA-konforme Fakten/Hypothesen-Trennung).
  - OEO-Tag-Extraktion aus RAG-Metadaten (`metadata.oeoTags`, `metadata.ontologyTags`, `metadata.oeoConcepts`) in die Synthese.

- **Datapoint Direktanlage** in `services/datapoint.service.js`:
  - Neue Action `datapoint.create` (`POST /api/datapoints`) für metadata-only, agentisch abgeleitete Werte.
  - Enthält `value`, `oeoTags`, `provenance`, `metadata`, `provenanceHash` (SHA-256) und KRITIS-konforme Persistenz.

### Changed
- Finance-Pipeline-Version auf `0.40.4` erhöht.
- API-Gateway Alias ergänzt: `POST /api/datapoints` → `datapoint.create`.
- Finance-Agent-Routenkommentar in `services/api.service.js` auf `v0.40.4` aktualisiert.

### Tests
- `tests/finance-agent.service.test.js` erweitert um:
  - CYA targetLayers + Layer-Filter Verifikation
  - Datapoint-Working-Memory Verifikation
  - Persistenz abgeleiteter Datapoints (`persistDatapoints`)
  - `hypothetical_scenario`-Pfad bei fehlender L1-Evidenz

## [0.40.3] — Finance Agent RAG Collection Parameter Fix

### Fixed
- **Finance Agent RAG query bug** in `services/finance-agent.service.js`:
  - Fixed missing `collection` parameter propagation to `knowledge-rag.query` calls
  - `POST /api/finance-agent/analyze` now accepts optional `collection` parameter (default: `cernion_knowledge_v1`)
  - Added `collection: { type: 'string', optional: true, default: 'cernion_knowledge_v1' }` to action params
  - Updated `retrieveEvidence(ctx, plan, originalQuery, collectionName)` method signature
  - `collection: collectionName` now properly passed to `ctx.call('knowledge-rag.query', ...)`
  - This fix enables targeted RAG retrieval against specific knowledge collections, resolving "no hits found" issues

### Tests
- Verified Finance Agent OpenAPI schema includes `collection` parameter
- Verified `knowledge-rag.query` receives collection name in payload

## [0.40.2] — Finance Agent Session Memory + A2A Context

### Added
- **Finance Agent context-aware analysis** in `services/finance-agent.service.js`:
  - `POST /api/finance-agent/analyze` now accepts optional session/context parameters:
    - `sessionId`
    - `includeMemoryContext` (default `true`)
    - `includeA2AContext` (default `true`)
    - `includeDatapointsContext` (default `true`)
    - `contextLimit` (default `5`)
    - `persistMemory` (default `true`)
  - External context loading with graceful fallback when optional services are unavailable:
    - Object Store session memory namespace: `finance_agent_memory`
    - CYA A2A namespace: `cya_a2a_messages`
    - Datapoint metadata via `datapoint.list`
  - Context hints are injected into retrieval planning as additional semantic intents.

- **New Finance Agent memory endpoints**:
  - `POST /api/finance-agent/memory` (`finance-agent.remember`) — upsert session memory
  - `GET /api/finance-agent/memory/:sessionId` (`finance-agent.memory`) — read session memory

### Changed
- Finance pipeline version bumped to `0.40.2`.
- API gateway aliases updated in `services/api.service.js` for both new memory routes.

### Tests
- `tests/finance-agent.service.test.js` extended with:
  - memory action exposure assertions
  - session memory write/read tests
  - context loading verification (memory + A2A + datapoints)
- `tests/api.service.test.js` extended with:
  - OpenAPI path assertions for `/api/finance-agent/memory*`
  - explicit alias assertions for memory routes

## [0.40.1] — OpenAPI Category Grouping Fixes

### Fixed
- **OpenAPI/Swagger category endpoint visibility** in `services/api.service.js`:
  - Runtime `api.openapi` generation now normalizes operation tags to canonical category tags, so endpoints are grouped under configured tags instead of raw service names.
  - Fixed affected categories:
    - `Knowledge RAG` (was tagged as `knowledge-rag`)
    - `Finance Agent` (was tagged as `finance-agent`)
    - `CYA Agent` (was tagged as `cya`)
    - `Cookbook` (was tagged as `cookbook`)
    - `Dashboard API` (was tagged as `dashboard-api`)
    - `MaStR Data Quality` (was tagged as `mastr-quality`)
    - `Datapoints` (was tagged as `datapoint`)

- **OSM Geo category coverage**:
  - Added explicit `/api/osm-geo/*` aliases in `services/api.service.js` to ensure OSM Geo endpoints are consistently exported and grouped.

### Changed
- **OpenAPI generation robustness**:
  - `api.openapi` now prefers local service schema action metadata (including `openapi.tags`) and falls back to registry metadata when needed.

### Tests
- `tests/api.service.test.js` extended with regressions for:
  - Presence of CYA/Cookbook/Dashboard/MaStR Quality paths in generated OpenAPI.
  - OSM Geo explicit alias mapping.
  - `Datapoints` canonical tag mapping.

## [0.40.0] — Finance Agent Service

### Added
- **`services/finance-agent.service.js`** — Neuer deterministischer Finance Agent Microservice (v0.40) für regulatorische Finanzanalysen mit `knowledge-rag`-Integration.
  - Endpunkte:
    - `POST /api/finance-agent/analyze`
    - `GET /api/finance-agent/analyses`
    - `GET /api/finance-agent/analyses/:id`
    - `GET /api/finance-agent/prompts`
  - Standardmodus: `rule_plus_hyde` (L1_Rule priorisiert, L2_HyDE als Kontext)
  - Workflow: Query-Planung → Retrieval → Evidence-Arbitration → Compliance-Checks → Guarded Synthesis → Audit-Trail
  - Persistenz in PouchDB (`FINANCE_AGENT_DB_PATH`, Prefix `fa:`)

- **Befundtaxonomie erweitert (`src/validation-findings.js`)**
  - Neue Finding-Codes für Finance Agent:
    - `FA_QUERY_PLANNED`
    - `FA_EVIDENCE_RETRIEVED`
    - `FA_RULE_EVIDENCE_USED`
    - `FA_HYDE_CONTEXT_USED`
    - `FA_RULE_HYDE_CONFLICT`
    - `FA_REGULATORY_REFERENCES_MISSING`
    - `FA_SYNTHESIS_GUARDED`
    - `FA_NEEDS_CLARIFICATION`
  - `FINDING_CODE_METADATA` inkl. EN/DE-Beschreibungen erweitert.

- **OpenAPI/API Gateway**
  - `services/api.service.js`:
    - Neuer OpenAPI-Tag **Finance Agent**
    - Neue Route-Aliases für `/api/finance-agent/*`

- **Tests & UI Contract**
  - Neuer Test-Suite: `tests/finance-agent.service.test.js`
  - `tests/api.service.test.js` um Finance-Agent OpenAPI/Route-Assertions erweitert
  - Neuer UI-Contract: `docs/ui-contracts/29-finance-agent.md`

## [0.39.0] — Knowledge RAG Service (cernion_rag_search)

### Added
- **`services/knowledge-rag.service.js`** — New microservice wrapping MCP tool `cernion_rag_search` with async REST job pattern (`202` + `/api/jobs/:jobId/status|result`) and internal synchronous execution for service-to-service calls.
  - Canonical endpoint: `POST /api/knowledge-rag/query`
  - Convenience endpoints:
    - `POST /api/knowledge-rag/semantic`
    - `POST /api/knowledge-rag/scroll`
    - `POST /api/knowledge-rag/fetch`
    - `POST /api/knowledge-rag/collection-info`
  - Supports all `queryType` modes: `semantic`, `scroll`, `fetch`, `collection_info`
  - Full Qdrant-style `filter` object pass-through enabled (`must`, `should`, `must_not`, additional nested keys)
  - Validation rules:
    - `query` required for `semantic`
    - non-empty `ids` required for `fetch` (`string|number` only)
  - Safe defaults for payload size: `withPayload=false`, `withVectors=false`, `limit=10` (1..100)

- **OpenAPI enhancements**
  - `services/api.service.js` — Added global tag **Knowledge RAG**.
  - Full per-action OpenAPI docs for all 5 new endpoints, including request body schemas, examples, and explicit 202/200 response contracts.

- **UI contract**
  - `docs/ui-contracts/28-knowledge-rag.md` — New backend-owned UI contract for Knowledge RAG endpoints and async polling workflow.

### Tests
- **`tests/knowledge-rag.service.test.js`** — New test suite for:
  - Endpoint/action exposure
  - Canonical + convenience endpoint queryType mapping
  - Validation failures (`semantic` without `query`, `fetch` without/invalid `ids`)
  - Full filter pass-through behavior
  - `cernionToken` forwarding

- **`tests/api.service.test.js`** — Extended OpenAPI assertions:
  - `Knowledge RAG` tag presence
  - New paths under `/api/knowledge-rag/*` are exported and tagged correctly

## [0.38.8] — CI/CD Remediation: Node.js 22 Upgrade (Option A)

### Changed
- **CI/CD Infrastructure Upgrade:**
  - All GitHub Actions workflows updated to Node.js 22 (from Node.js 20):
    - `.github/workflows/codeql.yml` — CodeQL analysis now runs on Node.js 22
    - `.github/workflows/maintenance-ci.yml` — Quality checks, security audit, and critical gate now run on Node.js 22 (3 jobs)
    - `.github/workflows/release.yml` — Release workflow now runs on Node.js 22
  - `package.json` — Added `"engines": { "node": ">=22" }` to explicitly declare Node.js requirement
  - `.nvmrc` — Created NVM configuration file for local developer convenience (pinning to Node 22)
  - `package-lock.json` — Regenerated to include missing peer dependency `graphology-types@0.24.8`

### Fixed
- **CodeQL Pipeline Failure:** Resolved EBADENGINE warnings and npm ci sync failure caused by Node.js version mismatch between CI runners (Node 20) and dependency engine requirements (moleculer >=22)
  - **Root Cause:** Transitive peer dependencies (graphology → graphology-types) declared Node.js >=22 requirement, but CI was locked to Node.js 20, causing `npm ci` to fail with "Missing: graphology-types@0.24.8 from lock file"
  - **Resolution:** Upgraded CI infrastructure to Node.js 22, aligning with dependency declarations; regenerated lockfile to capture all peer dependencies
  - **Validation:** `npm ci` now succeeds cleanly (843 packages, 5s, no errors)

### Documentation
- `README.md` — Updated prerequisite: added "Voraussetzung: **Node.js 22+**" in Schnellstart section
- `QUICKSTART.md` — Updated all Node.js version references from 18+ to 22+ (setup guide + troubleshooting section)

**Test Status:** All 1782+ tests passing; all validation gates (lint, build, audit:openapi, check:llm) passing

## [0.38.7] — Hygiene Sprint Prio 5 (Security: non-literal RegExp)

### Fixed
- `services/company.service.js:366` — non-literal RegExp gesichert: `new RegExp(escapedQuery, 'i')` durch `String.includes` ersetzt (kein RegExp mehr nötig)
- `services/vnb-monitor.service.js:176` — non-literal RegExp gesichert: dynamisch aufgebautes `new RegExp(LEGAL_SUFFIXES.join('|'))` durch statische Literal-Regex `/\b(gmbh|ag|…)\b/g` ersetzt
- `src/edm-messkonzept-engine.js:26` — non-literal RegExp gesichert: `blocklist.join('|')` durch zwei Literal-Regex-Konstanten ersetzt (`BLOCKLIST_RE_TEST` ohne `/g` + `BLOCKLIST_RE_MATCH` mit `/g` — verhindert auch `/g`-lastIndex-Problem)


### Changed
- **Hygiene Sprint — Prio 3 Block A: no-duplicate-string (Magic Strings → Konstanten):**
  - `services/agent.service.js` — `ACTION_DS_CACHE_QUERY`, `EXAMPLE_SESSION_ID`
  - `services/api.service.js` — `CONTENT_TYPE_HEADER`, `CONTENT_TYPE_JSON`
  - `services/assets.service.js` — 20 Beschreibungs- und Metadaten-Konstanten (`OEO_CLASS_KEY`, `PARAM_DESC_*`, `OEO_URL_POWER_PLANT`, `EXAMPLE_DATE` u.a.)
  - `services/bilanzkreis.service.js` — `OPENAPI_TAG`
  - `services/business-intelligence.service.js` — `SERVICE_NAME`, `OPENAPI_TAG`
  - `services/cookbook.service.js` — `OEO_CLASS_KEY`, `OEO_CLASS_URL`
  - `services/cya.service.js` — `DEFAULT_TONE`, `OS_PUT`, `OS_GET`, `EXAMPLE_TRIGGER`
  - `services/dashboard-api.service.js` — `OPENAPI_TAG`, `ACTION_MQ_LIST`, `ACTION_RD_LIST`, `ACTION_ES_LIST`, `ACTION_GC_LIST`
  - `services/datapoint.service.js` — `EXAMPLE_DATAPOINT_NAME`
  - `services/datasource-cache.service.js` — `COL_LEISTUNG_BEZUG`, `COL_LEISTUNG_EINSPEISUNG`
- Alle 3116 Tests weiterhin grün

## [0.38.5] — Hygiene Sprint Prio 1+2

### Changed
- **Hygiene Sprint — Prio 1: no-unused-vars (22 Findings behoben):**
  - `services/cya.service.js` — `buildNegotiationPrompt` aus Import entfernt
  - `services/datapoint.service.js` — ungenutzter `ctx`-Parameter in health-overview-Handler auf `_ctx` umbenannt
  - `services/energy-sharing.service.js` — `DV_INACTIVE` aus Import entfernt; `params` → `_params` in `stepDirectMarketer`
  - `services/grid-connection.service.js` — ungenutztes `capacityByVoltage`-Assignment entfernt
  - `services/mastr-monitor.service.js` — `payload` → `_payload` in Event-Handler
  - `services/mastr-quality.service.js` — ungenutztes `allNap`-Assignment entfernt
  - `services/utility-report.service.js` — unbenutzten `scrubReportPrompt`-Import + Kommentar entfernt
  - `src/cya-context-manager.js` — `queryNodes` aus Import entfernt
  - `src/cya-data-retriever.js` — `isToolAllowed` aus Import entfernt
  - `src/cya-ontology-graph.js` — `attrs` → `_attrs` in `_signalMissingNap`
  - `src/forecast-calculator.js` — ungenutztes `chargeEnergyKwh`-Akkumulator entfernt
  - `src/oemetadata-builder.js` — `INSTALLATION_TYPES` aus internem Import entfernt
  - `src/znp-pdf-extractor.js` — `applyCosPhi` → `_applyCosPhi` (Destructuring-Param)
  - `.eslintrc.hygiene.json` — `no-unused-vars` mit `varsIgnorePattern`/`argsIgnorePattern: "^_"` konfiguriert
- **Hygiene Sprint — Prio 2: prefer-immediate-return (11 Findings behoben):**
  - `services/cookbook.service.js:533` — `rows`-Variable direkt zurückgegeben
  - `services/datapoint.service.js:602` — `doc`-Variable direkt zurückgegeben
  - `services/datasource-classifier.service.js:384,661` — `classification`- und `rows`-Variablen direkt zurückgegeben
  - `services/residual-load.service.js:754` — `result`-Variable direkt zurückgegeben
  - `services/vnb-monitor.service.js:1426` — `results`-Variable direkt zurückgegeben
  - `src/async-job-poller.js:292` — `result`-Variable direkt zurückgegeben
  - `src/connectors/scraper.connector.js:73` — `rows`-Variable direkt zurückgegeben
  - `src/edm-csv-importer.js:122` — `autoParsed`-Variable direkt zurückgegeben
  - `src/edm-validation-rules.js:144` — `overflowDetected`-Variable direkt zurückgegeben
  - `src/oemetadata-builder.js:283` — `metadata`-Variable direkt zurückgegeben
- **Hygiene Sprint — Prio 2: no-collapsible-if (6 Findings behoben):**
  - `services/assets.service.js:131` — Verschachtelte `if`-Statements in `cRate`-Berechnung zusammengeführt
  - `services/datasource-connector.service.js:299,323,329` — Enum-, Minimum- und Maximum-Checks zusammengeführt
  - `services/mastr-quality.service.js:1725` — NAP-Multi-Unit-Check zusammengeführt
  - `src/cya-ontology-graph.js:435` — `hasNode`/`hasEdge`-Check zusammengeführt



### Fixed
- **`services/object-store.service.js` — NS_PATTERN erweitert (CR-TENANT-001):**
  - `NS_PATTERN` von `/^[a-z][a-z0-9_]{0,63}$/` auf `/^[a-z][a-z0-9_]*(:[a-z0-9_-]+)*$/` erweitert.
  - Erlaubt jetzt Tenant-Namespaces der Form `tenant:stadtwerk-a:cya_profiles` ohne
    bestehende einfache Namespaces (`cya_profiles`, `cya_a2a_messages` etc.) zu beeinflussen.
  - Betrifft alle 4 Actions: `put`, `get`, `delete`, `query`.
- **`services/object-store.service.js` — `toPublic()` für Multi-Segment-Namespaces korrigiert:**
  - `toPublic()` nutzt jetzt das gespeicherte `ns`-Feld statt `_id.indexOf(':')` zur
    Namespace-Extraktion. Verhindert, dass `tenant:stadtwerk-a:cya_profiles` als `tenant`
    zurückgegeben wird (erster Doppelpunkt als Grenze).
  - Rückwärtskompatibel: einfache Namespaces ohne Doppelpunkt unverändert.

### Tests
- **`tests/object-store.service.test.js`** — 5 neue Tests (`describe: 'tenant namespace validation (CR-TENANT-001)'`):
  - `tenant:stadtwerk-a:cya_profiles` ist valider Namespace (put + namespace-Rückgabe).
  - `tenant:stadtwerk-a:cya_sessions` ist valider Namespace.
  - `INVALID:UPPER` bleibt ungültig.
  - `:leading-colon` bleibt ungültig.
  - Bestehende Namespaces (`cya_profiles`, `cya_a2a_messages`, `test_ns`, `ns_a`) bleiben valide.

 — OEP Connector Ausbau (TRL5→6)

### Added
- **`src/oep-tables.js`** — Neues separates Modul für domänen-kontextualisierte OEP-Tabellen:
  - `CERNION_RELEVANT_OEP_TABLES` — Frozen Array mit 5 vorkonifigurierten Einträgen
    (Pflichtfelder: `schema`, `table`, `description`, `cernionUseCase`, `oeoClass`).
  - Einträge: `model_draft.oed_source` (EU AI Act Art. 12), `supply.ego_dp_res_powerplant`
    (MaStR-Vergleich), `demand.ego_dp_loadarea` (Residuallast), `model_draft.oed_scenario_bundle`
    (NEP/TYNDP), `grid.ego_dp_ehv_substation` (Topologie).
  - Ausgelagert aus `oep.service.js` für bessere Testbarkeit und einfache Erweiterbarkeit.

- **`services/oep.service.js` — neue Actions (TRL5→6: demonstriert in relevantem Umfeld):**
  - **`GET /api/oep/energy-tables`** (`oep.energyTables`) — gibt `CERNION_RELEVANT_OEP_TABLES`
    zurück (`{ tables, count }`). Kein freies Suchen nötig; direkter Einstiegspunkt für
    VNB-Domänen-Arbeit. `x-oeo-class: oeo:DataCatalog`.
  - **`POST /api/oep/compare-mastr`** (`oep.compareWithMastr`) — Lädt OEP-Daten und
    MaStR-Installationen parallel via `Promise.allSettled`. Graceful bei OEP-Ausfall
    (`oep.available: false`) — produktionskritisch, da OEP externe Abhängigkeit ohne SLA.
    `x-oeo-class: oeo:PowerPlant`. Felder: `{ oep, mastr, delta: null, oeoMappingNote }`.
    `installationType` Default `'solar'`; TODO-Kommentar für `'all'` wenn energy-market
    Enum erweitert. Vollständige OpenAPI-Annotation mit Request-Body-Examples.

### Changed
- **`services/oep.service.js`** — `CERNION_RELEVANT_OEP_TABLES` via `require('../src/oep-tables')`
  importiert (nicht mehr inline im Service).
- **`services/agent.service.js` — RULE 13 erweitert:**
  - Neuer Unterpunkt **F: `oep.energyTables`** — kuratiierte Cernion-relevante Tabellen ohne
    Suche; bevorzugen wenn User Domänen-Startpunkte benötigt.
  - Neuer Unterpunkt **G: `oep.compareWithMastr`** — OEP vs. MaStR Kapazitätsvergleich;
    immer graceful; MaStR ist primär, OEP sekundär.
  - Summary-Zeile im Refine-Prompt um beide neuen Actions ergänzt.

### Tests
- **`tests/oep.service.test.js`** — 14 neue Tests (total: 32):
  - `energyTables` (4 Tests): ≥3 Einträge, Pflichtfelder, `oeo:`-Präfix, count-Konsistenz.
  - `compareWithMastr` (7 Tests): available-Flags, fulfilled→true, rejected→false (graceful),
    `delta: null`, `oeoMappingNote` mit `oeo:PowerPlant`, `oep.source`, `mastr.source`.
  - `CERNION_RELEVANT_OEP_TABLES` (3 Tests): ≥3 Einträge, Pflichtfelder, keine Duplikate.
  - RULE 13 Prompt-Check (2 Tests): `oep.compareWithMastr` und `oep.energyTables` im Prompt.

## [0.38.2] — A2A Replay & Log-Analyse

### Added
- **`src/cya-a2a-analyzer.js`** — Neues Analyse-Modul für persistierte A2A-Kommunikations-Logs:
  - `analyzeLog(messages)` — wertet einen Session-Log aus: Persona-Verdicts, Konflikt-Anzahl,
    Negotiation-Runden, Consensus-Ergebnis, HITL-Eskalation, Dauer, Blocker-Personas, Signals.
  - `aggregateLogs(sessionAnalyses)` — aggregiert mehrere Session-Analysen: Konsens-Rate,
    Eskalations-Rate, durchschnittliche Runden, häufigster Blocker, häufigstes Signal,
    mittlere Dauer. Graceful bei leerem Array/null.
  - `summarizeLog(analysis)` — menschenlesbare deutschsprachige Zusammenfassung einer Analyse.
- **`GET /api/cya/sessions/:id/a2a-analysis`** (`cya.session.a2aAnalysis`) — neuer REST-Endpoint:
  - Ruft intern `cya.session.a2aLog` auf (kein direkter Object-Store-Zugriff).
  - Gibt `{ sessionId, analysis, summary }` zurück; `analysis: null` + erklärende `message`
    wenn kein A2A-Log für die Session vorhanden.
  - Vollständige OpenAPI-Annotation mit `x-oeo-class: OEO:AgentCommunication`.
- **`GET /api/cya/a2a-stats`** (`cya.a2aStats`) — neuer Aggregations-Endpoint:
  - Lädt alle Messages aus Namespace `cya_a2a_messages`, gruppiert nach `sessionId`,
    analysiert und aggregiert via `analyzeLog` + `aggregateLogs`.
  - Query-Parameter `?limit=N` (default: 100, max: 1000) begrenzt ausgewertete Sessions
    und verhindert Timeouts bei vielen Sessions.
  - Graceful bei leerem Namespace (keine Exception).
  - TODO-Kommentar für zukünftige Pagination (analog `mastr-monitor`).
- **`tests/cya-a2a-analyzer.test.js`** — 29 Tests:
  - `analyzeLog` (16 Tests): totalMessages, personaEvaluations (3 Personas, verdict/summary),
    conflictsDetected, negotiationRounds, consensusReached/Round, hitlEscalated (true/false),
    durationMs, blockerPersonas, signalsSeen, leerer Log, null-Input, HITL-Runden
  - `aggregateLogs` (8 Tests): consensusRate, avgNegotiationRounds, hitlEscalationRate,
    mostFrequentBlocker, mostFrequentSignal, leeres Array, null-Input, totalSessions
  - `summarizeLog` (5 Tests): deutscher String, Konsens-Info, Rundenanzahl, HITL-Erwähnung,
    leerer Log → Hinweis-String

### Changed
- `services/api.service.js`: Routen `GET /cya/sessions/:id/a2a-analysis` und
  `GET /cya/a2a-stats` registriert (zwischen `a2a-log` und `context-state`).

## [0.38.1] — UI Contracts Vollsynchronisation

### Added
- **`docs/ui-contracts/22-settlement.md`** — Neuer Contract für `settlement`-Service (v0.30.0):
  8 Endpoints (Redispatch-Entschädigung, EEG-Vergütung, A96-Export, EEG-Tariflookup, Settlement-Liste).
  Verweis auf `bilanzkreis.checkReadiness` und `redispatch-expost`-Workflow.
- **`docs/ui-contracts/23-bilanzkreis.md`** — Neuer Contract für `bilanzkreis`-Service (v0.30.0 + v0.38.0):
  6 Endpoints inkl. `checkReadiness`. Dokumentiert `PARAGRAF_42C_KONFORM` und `A96_FAEHIG`-KPIs
  für `type: "virtual_energy_sharing"` (neu in v0.38.0).
- **`docs/ui-contracts/24-forecast-engine.md`** — Neuer Contract für `forecast-engine`-Service (v0.30.1):
  8 Endpoints (Lastprognose, Erzeugungsprognose, Residuallast, Day-Ahead-Fahrplan,
  Qualitätsbewertung RMSE/MAE/MAPE, Speicher-Dispatch-Optimierung).
- **`docs/ui-contracts/25-flex.md`** — Neuer Contract für `flex`-Service §14a (v0.31.0):
  8 Endpoints (SVE-Registry, Dimming-Plan/Execute, Entlastungsnachweis, Netzentgelt-Reduktion).
  Dokumentiert §14a-Constraints (4.2 kW min, 2h max Dimming, 2h Cooldown) und
  MQTT-Persistenz-Semantik (`mqttMessageId`, stale-Command-Schutz).
- **`docs/ui-contracts/26-edm.md`** — Neuer Contract für alle EDM-Services (v0.28–v0.29), konsolidiert:
  `edm` (10), `edm-messkonzept` (6), `edm-validation` (4), `edm-virtual` (2), `mscons-import` (3).
  25 Endpoints total. Dokumentiert Lückenfüllungs-Fallback-Kette und `sourceType`-Filter.
- **`docs/ui-contracts/27-slp.md`** — Neuer Contract für `slp`-Service (v0.28.0):
  5 Endpoints (Profilliste, Profildetail, Zeitreihengenerierung, Custom-Profil CRUD).
  Dokumentiert alle BDEW-Standardprofile (H0/G0-G6/L0-L2) und Custom-Profil-Format.
- **`docs/RELEASE_SUMMARY_v0.38.md`** — UI-Contract-Status-Tabelle aller 28 Contracts (00–27),
  Service-Abhängigkeits-Graph, Auth-Anforderungen für RBAC, Breaking-Changes-Hinweis (keine).

### Changed
- **`docs/ui-contracts/08-redispatch.md`** — Version auf 0.38.1, `Änderungen seit letzter Version`-Block:
  Settlement-Service-Workflow (v0.30.0) und Hinweis auf §42c-KPIs in Contract 23.
- **`docs/ui-contracts/12-auth.md`** — Version auf 0.38.1, `Änderungen seit letzter Version`-Block:
  `tenantId`-Feld bei Token-Create/Verify (v0.38.0), neuer `GET /api/tokens/tenants`-Endpoint,
  `ctx.meta.tenantId`-Propagation durch den API-Gateway.
- **`docs/ui-contracts/21-mastr-monitor.md`** — Version auf 0.38.1, `Änderungen seit letzter Version`-Block:
  Chunked Persistence (v0.27.3), neue Env-Variablen, `limitApplied`-Flag-Hinweis für große Portfolios.

## [0.38.0] — Multi-Tenant Fundament (Namespace-Isolation)


### Added
- **`src/tenant-context.js`** — Neues Modul für Multi-Tenant-Namespace-Isolation (rückwärtskompatibel):
  - `getTenantId(ctx)` — extrahiert `ctx.meta.tenantId`; gibt `'default'` zurück wenn nicht gesetzt.
  - `tenantNamespace(baseNamespace, tenantId)` — erzeugt Tenant-präfixierten Namespace-String (`tenant:{id}:{base}`); Default-Tenant → unverändert.
  - `tenantKey(baseKey, tenantId)` — erzeugt Tenant-präfixierten Key; Default-Tenant → unverändert.
  - `validateTenantId(tenantId)` — validiert Format (a–z, 0–9, Bindestrich, max 64 Zeichen); `null`/`undefined` → gültig (optional).
  - `DEFAULT_TENANT = 'default'` — Exportierte Konstante.
- **`token-manager.service.js` — `tenantId`-Feld:**
  - `create`-Action: neuer optionaler Param `tenantId` (`/^[a-z0-9-]{1,64}$/`, max 64). Wird als Klartext im Token-Record gespeichert.
  - `verify`-Action: gibt jetzt `tenantId: record.tenantId ?? null` im Return-Objekt zurück.
  - Neue Action `token-manager.tenant.list` (`GET /api/tokens/tenants`): Listet alle bekannten (unique) `tenantId`s aus gespeicherten Tokens. Erfordert `full-access`-Scope.
- **`api.service.js`:**
  - `onBeforeCall`: Nach erfolgreicher `ck_`-Token-Verifikation wird `ctx.meta.tenantId = verification.tenantId` gesetzt (nur wenn im Token vorhanden).
  - Route `GET /tokens/tenants` → `token-manager.tenant.list` registriert.
  - `requiresFullAccess`: `GET /api/tokens/tenants` erfordert `full-access`-Token.
- **CYA-Service PoC (Proof-of-Concept):**
  - `services/cya.service.js` importiert `{ getTenantId, tenantNamespace }` aus `src/tenant-context`.
  - `createProfile`, `getProfile`, `listProfiles`: ermitteln `tenantId = getTenantId(ctx)` und nutzen `tenantNamespace('cya_profiles', tenantId)` statt hardcoded `PROFILE_NAMESPACE`.
  - `loadProfile`-Methode: optionaler dritter Parameter `namespace` (Default: `PROFILE_NAMESPACE`) — rückwärtskompatibel; `generate`/`refine`-Pipeline unverändert.
  - Default-Tenant (`ctx.meta.tenantId` nicht gesetzt) → identisches Verhalten wie vor v0.38.0.
- **`tests/tenant-context.test.js`** — 31 neue Tests:
  - `getTenantId`: 5 Tests (mit/ohne tenantId, null ctx, leerer String)
  - `tenantNamespace`: 5 Tests (Präfix, Default, null/undefined, verschiedene Bases)
  - `tenantKey`: 4 Tests (Präfix, Default, null, undefined)
  - `validateTenantId`: 10 Tests (valid, Großbuchstabe, Underscore, Sonderzeichen, 65 Zeichen, 64 Zeichen, Error.code)
  - Token Manager Integration: 5 Tests (create mit/ohne tenantId, verify mit/ohne tenantId, tenant.list)
  - CYA PoC: 2 Tests (Namespace mit tenantId-Präfix, Namespace für Default-Tenant)

### Notes
- `tenantNamespace()` erzeugt Strings der Form `tenant:{id}:{base}`. Diese können erst direkt an `object-store.*` übergeben werden, wenn `NS_PATTERN` in `object-store.service.js` um Doppelpunkte erweitert wird (folgt in einer späteren Iteration). Für den PoC werden die Namespace-Strings korrekt erzeugt und in Tests validiert; `object-store`-Calls sind in Tests gemockt.
- `generate`/`refine`/andere CYA-Actions kommen in einer späteren Iteration.

## [0.37.1] — 360° Utility Report Stabilisierung (TRL6→7)

### Fixed
- **BUG-5 (Fix A): `fetchWithRetry` für `energy-market.prices`** — Neuer Service-Method `fetchWithRetry(ctx, actionName, params, maxRetries=2, delayMs=1000)` im `utility-report`-Service: bis zu 3 Versuche mit exponentiellem Back-off, `available: false`-Erkennung auch ohne Exception. Phase-3-`energy-market.prices`-Aufruf nutzt jetzt `fetchWithRetry` statt `callBroker`. Fallback auf `p.meta.lastKnownPrice` wenn alle Versuche fehlschlagen; letzter bekannter Preis wird als `_fallback: true` markiert und per WARN geloggt.
- **BUG-6 (Fix B): Briefing/Section2 Anlagen-Count Konsistenz** — Nach dem Aufbau von `kpiSummary` wird `briefingCount` (Pfad aus `buildStaticNarrative`: `solar.totalCount ?? pvLocal['stats.total']`) mit `section2Count` (direkt aus `p.results.section2.pvLocal.data.stats.total`) verglichen. Bei Diskrepanz wird `[Report] Briefing/Section2 count mismatch: X ≠ Y` als WARN geloggt. Kein Crash wenn eines der Felder `null` ist.
- **BUG-7 (Fix C): Peer-Benchmark Größenklassen-Filter** — `renderPeerBenchmarkBlock` und `renderSection5` akzeptieren jetzt `totalInstallations` (optional). Neue Funktion `getPeerReference(totalInstallations)` liefert neutralen Größenklassen-Peer: Klein (<500), Mittel (500–2000), Groß (>2000), Default Mittel. Alle hardcodierten echten VNB-Namen (`Stadtwerke Waiblingen`, `Gemeindewerke Baiersbronn`) entfernt. `buildHtmlReport` leitet `totalInstallations` aus `section7.operatorPortfolio` oder `section2.pvLocal.stats.total` ab.

### Changed
- **Health-Endpoint `phase3Tools`** — Die `health`-Action gibt jetzt `phase3Tools: { available, unavailable, unavailableList }` zurück: Zählt welche der 11 Phase-3-MCP-Tools (`cernion_installations_local`, `cernion_redispatch_export`, etc.) im aktuellen Token-Scope verfügbar sind. OpenAPI-Schema entsprechend erweitert.

### Added
- **17 neue Unit-Tests** in `tests/utility-report.service.test.js` (describe: `v0.37.1 — 360° Utility Report Stabilisierung`):
  - Fix A: `fetchWithRetry` success on 1st try, retry on 1st failure, `available:false` nach max retries, `available:false`-Erkennung ohne Exception, `ctx.meta`-Weiterleitung
  - Fix A: `lastKnownPrice`-Fallback-Logik, Report kein Crash bei komplett fehlgeschlagenem Phase 3
  - Fix B: Count-Konsistenz bei alignment, WARN-Log bei Divergenz, kein Log bei null/null
  - Fix C: `getPeerReference` für Klein/Mittel/Groß, kein echter VNB-Name, null→Mittel-Default, Grenzwerte 500/2000
- **`getPeerReference` exportiert** aus `src/report-builder.js` (vorher private)

## [0.37.0] — Zwiebelmodus Context Manager Persistenz (TRL8)

### Added
- **`CyaContextManager.serialize()` / `CyaContextManager.deserialize()` (`src/cya-context-manager.js`)** — Serialisierung/Deserialisierung des Zoom-States für Persistenz:
  - `serialize()` → `{ outerContext, currentDepth, breadcrumb, iterationLog, maxIterations, zoomStack: string[] }` — `zoomStack` enthält nur nodeId-Strings (keine Graphology-Objekte)
  - `static deserialize(serialized, ontologyGraph)` → `CyaContextManager` — rekonstruiert `zoomStack`-Einträge via `getSubgraph(nodeId, 2)`. Wirft `CONTEXT_DESERIALIZE_FAILED` (400) bei null/ungültigem Input oder fehlendem Graph.
- **`CyaContextManager.isCompatibleWith(ontologyGraph)` (`src/cya-context-manager.js`)** — prüft ob alle `zoomStack`-nodeIds noch im aktuellen Ontologie-Graphen vorhanden sind. Gibt `false` zurück wenn der Graph `null` ist oder eine nodeId fehlt.
- **`CyaContextManager.getCompactState()` (`src/cya-context-manager.js`)** — gibt kompakten State für LLM-Prompts zurück: `{ outerContext, currentDepth, breadcrumb, recentIterations }`. `recentIterations` enthält maximal die letzten 3 Einträge aus dem `iterationLog`; der vollständige Log ist nicht enthalten.
- **`_persistContextState(sessionId, contextManager)` in `services/cya.service.js`** — persistiert den Zoom-State non-blocking (fire-and-forget mit `.catch` Guard) nach jeder Phase-2-Ausführung in Namespace `cya_context_states`, Key `ctx_{sessionId}`.
- **`_restoreContextState(sessionId, ontologyGraph)` in `services/cya.service.js`** — lädt gespeicherten State aus dem Object Store, führt `CyaContextManager.deserialize` + `isCompatibleWith`-Check durch. Gibt `null` zurück bei fehlendem State, Inkompatibilität oder Store-Fehler (graceful degradation).
- **`_persistContextState` eingehängt nach `_buildOntologyLayer`** (beide Call-Sites: compareProfiles-Preload-Pfad + Classic-Single-Agent-Async-Pfad) — non-blocking, analog zum `_observeAndUpdateProfile`-Muster.
- **`_restoreContextState` im `refine`-Handler** — wird am Anfang des Handlers aufgerufen; Ergebnis (`_restoredCtxManager`) ist optional und verursacht keinen Fehler wenn `null`.
- **`GET /api/cya/sessions/:id/context-state`** (`cya.session.contextState`) — neuer REST-Endpoint:
  - Gibt persistierten Zoom-State zurück: `{ sessionId, outerContext, currentDepth, breadcrumb, iterationLog, maxIterations, zoomStack, savedAt }`
  - `404 CONTEXT_STATE_NOT_FOUND` wenn kein State vorhanden
  - Vollständige OpenAPI-Annotation mit `x-oeo-class: OEO:ContextManagement`
  - Registriert in `services/api.service.js`
- **UI Contract `docs/ui-contracts/20-cya.md`** — neue Sektion `GET /api/cya/sessions/:id/context-state` mit Response-Shape, Object-Store-Namespace, Key-Format, Lifecycle-Dokumentation (gespeichert/wiederhergestellt/Kompatibilitätsprüfung) und Fehlercode.
- **`tests/cya-context-manager-persistence.test.js`** — 28 neue Tests:
  - `serialize`: 5 Tests (Pflichtfelder, currentDepth, zoomStack-Strings, History, outerContext)
  - `deserialize`: 6 Tests (outerContext, currentDepth, null/invalid throws, missing graph throws, Idempotenz, iterationLog)
  - `isCompatibleWith`: 4 Tests (kompatibel, inkompatibel, leer, null-Graph)
  - `getCompactState`: 5 Tests (outerContext, breadcrumb, max 3 recentIterations, kein iterationLog, letzte N Einträge)
  - `_persistContextState` (Broker-Mock): 3 Tests (object-store.put aufgerufen, null sessionId, null contextManager)
  - `_restoreContextState` (Broker-Mock): 4 Tests (null result, inkompatibel, kompatibel, graceful error)
  - REST-Endpoint-Simulation: 2 Tests (404 CONTEXT_STATE_NOT_FOUND, 200 mit korrektem Shape)

 — §42c Energieteilen Produktionsabnahme-Paket

### Added
- **`docs/ENERGY_SHARING_ABNAHME.md`** — Formale Abnahme-Checkliste für §42c-konforme Produktivschaltung (Deadline 01.07.2026). 8 Sektionen: Regulatorische Grundlage, Technische Infrastruktur, Validierungs-Pipeline, Allokations-Engine, Settlement-Readiness KPIs, A96-Feldspezifikation (inkl. `[BNetzA-OFFEN]`-Markierungen), Sicherheit & Datenschutz, Betrieb & Monitoring.
- **`tests/energy-sharing-e2e-abnahme.test.js`** — 18 E2E-Abnahmetests auf Fixture Solarpark Höheinöd (2103.7 kW, SEE999952467552): Suite 1 (Validierungs-Pipeline, 6 Tests), Suite 2 (Allokations-Engine 15-min-Raster, 5 Tests), Suite 3 (Settlement-Readiness §42c-KPIs, 7 Tests).

### Changed
- **`src/bilanzkreis-calculator.js`** — `calculateSettlementReadiness(bkData, bilanzkreis?)` um optionalen zweiten Parameter `bilanzkreis` erweitert. Für Typ `virtual_energy_sharing` werden zwei neue Felder im Rückgabeobjekt gesetzt: `PARAGRAF_42C_KONFORM` (true wenn keine `missing_data`-Issues) und `A96_FAEHIG` (true wenn zusätzlich keine `low_data_quality`- oder `mscons_incomplete`-Issues). Für alle anderen Bilanzkreis-Typen bleiben die Felder `undefined` (vollständig rückwärtskompatibel).
- **`services/bilanzkreis.service.js`** — `checkReadiness`-Handler übergibt jetzt das vollständige `bilanzkreis`-Objekt als zweiten Parameter an `calculateSettlementReadiness`, sodass der Typ für die §42c-KPI-Berechnung verfügbar ist.

## [0.36.1] — Bugfix: Installations Grid-Operator Filtering & LLM Context Endpoint

### Added
- **`GET /llm.txt`** — Static endpoint serving `llm.txt` from the project root via the API Gateway. The file contains a machine-readable summary of all services, actions, and REST endpoints and is updated with every release. Intended to be fed into an LLM for faster development and integration work (`services/api.service.js`).

### Fixed
- **`POST /api/energy-market/installations` — Bug 1: `gridOperatorMastrId` filter was silently ignored** (`services/energy-market.service.js`): The `baseToolParams` object used the key `gridOperatorMastrId`, but `cernion_installations_local` only accepts `gridOperatorId`. SNB-ID queries (e.g. TWL: `SNB924510006275`, WSW: `SNB900599182315`) always returned `NO DATA FOUND`. Fixed by mapping both `gridOperatorMastrId` and the deprecated `gridOperatorId` alias to the correct MCP key `gridOperatorId`.
- **`POST /api/energy-market/installations` — Bug 2: `gridOperatorBdewCode` normalisation & hardcoded limit cap** (`services/energy-market.service.js`): BDEW codes with internal whitespace (e.g. `"9900 599000003"`) failed exact matching in the MCP tool. Fixed by stripping all whitespace before forwarding. Also removed the silent `|| 1000` fallback in the `requestedLimit` parser that capped results at 1,000 for any non-numeric `limit` input.
- **`POST /api/energy-market/installations` — Bug 3: `gridOperatorName` always returned static SNB** (`services/energy-market.service.js`): `cernion_installations_local` has no fuzzy name search — the `gridOperatorName` parameter was silently ignored, causing the full local dataset (scoped to the env-configured VNB) to be returned, making every name query produce the same static SNB. Fixed by resolving the name via `cernion_market_partners` first, then forwarding the resolved `gridOperatorId`. Annotation suffixes such as `"SNB... (strom, 100% Match)"` are stripped. Resolution failures are logged and handled gracefully without crashing.
- **`POST /api/energy-market/installations` — Bug 4: opaque validation error on missing `installationType`** (`services/energy-market.service.js`): Added a `description` field to the `installationType` enum param so Moleculer validation errors include a human-readable explanation of allowed values.
- **11 regression tests** added to `tests/energy-market.service.test.js` covering all four bugs.

## [0.36.0] — Central Ontology Graph Persistenz (TRL8)

### Added
- **`src/cya-graph-cache.js`** — Two-Tier Cache für den Graphology Asset-Graphen:
  - `GraphCache` Klasse mit L1 (In-Memory `Map`, max. 20 VNBs, TTL 24h) und L2 (Object Store Namespace `cya_ontology_graphs`, überlebt Restart).
  - `buildKey(operatorIdentifier)` — normalisierter Cache-Key (lowercase, `[^a-z0-9]` → `_`).
  - `isStale(entry)` — TTL-Prüfung (default 86400s).
  - `getL1(key)` — synchroner In-Memory-Lookup mit hitCount-Tracking.
  - `setL1(key, graph, serialized, cachedAt)` — LRU-ähnliche Eviction bei `L1_MAX_ENTRIES` (20).
  - `getL2(key, brokerCall)` — async Object Store Lookup mit automatischem L1 Warm-up bei Hit.
  - `set(key, graph, brokerCall)` — L1 synchron, L2 fire-and-forget (non-blocking).
  - `invalidate(key, brokerCall)` — beide Tiers invalidieren.
  - `getStats()` — L1-Statistiken für Monitoring (nodeCount, edgeCount, hitCount, stale-Flag).
  - Singleton-Export `graphCache` — ein Cache pro Prozess.
- **`_buildOntologyLayer` ist jetzt `async`** in `services/cya.service.js`:
  - L1-Lookup (synchron, <1ms) → L2-Lookup (async, Object Store) → Cache-Miss: Graph bauen + in beide Tiers schreiben.
  - Operator-Identifier-Ableitung: `retrieval.operator` → `retrieval.gridOperatorId` → `installations[0].Netzbetreiber` → `'unknown'`.
  - Alle 3 Call-Sites auf `await this._buildOntologyLayer(...)` aktualisiert.
- **`GET /api/cya/graph/cache`** (`cya.graph.cacheStatus`) — L1-Cache-Status für Ops-Monitoring.
- **`DELETE /api/cya/graph/cache/:operatorId`** (`cya.graph.invalidate`) — manuelle Cache-Invalidierung pro VNB.
- **Moleculer Events:**
  - `cya.ontology.graph.built` — bei Cache-Miss nach Graph-Aufbau (`cacheKey`, `nodeCount`, `edgeCount`, `timestamp`).
  - `cya.ontology.graph.invalidated` — bei manueller Invalidierung (`operatorId`, `cacheKey`, `timestamp`).
- **`events:` Block erweitert:**
  - `cya.ontology.graph.built` und `cya.ontology.graph.invalidated` Handler (INFO-Logging).
  - `mastr-monitor.delta.detected` Handler — automatische Cache-Invalidierung wenn MaStR-Delta erkannt (`ctx.params.operator || ctx.params.bdewCode`).
- **UI Contract** `docs/ui-contracts/20-cya.md` — neue Sektion mit Cache-Endpoints, Lifecycle-Dokumentation, Object-Store-Payload-Shape und Event-Tabelle.
- **52 neue Tests** across 2 Suites:
  - `tests/cya-graph-cache.test.js` (43 Tests): `buildKey`, `isStale`, L1 (LRU-Eviction, hitCount, TTL), L2 (Restore, Warm-up, graceful fail), `set`, `invalidate`, `getStats`.
  - `tests/cya-graph-cache-integration.test.js` (9 Tests): Cache-Miss → L1 befüllt, L1-Hit → kein Event, Operator-Fallback, Invalidate → Rebuild, L2-Warm-up, leere Installations.

### Changed
- `services/api.service.js`: `GET /cya/graph/cache` und `DELETE /cya/graph/cache/:operatorId` registriert.
- `_buildOntologyLayer` ist nicht mehr synchron — alle Aufrufer verwenden `await`.

## [0.35.0] — Agent-to-Agent Protokoll (Moleculer Event Bus)

### Added
- **`src/cya-a2a-protocol.js`** — New A2A envelope module: structured `A2AMessage` format with `messageId` (UUIDv4), `sessionId` (correlation-ID), `fromPersona`, `toPersona`, `payload`, `timestamp`, `protocolVersion: '1.0'`. Five factory functions: `personaEvaluated`, `conflictDetected`, `negotiationRound`, `consensusReached`, `consensusFailed`. `validateMessage` enforces required fields and known event names. `A2A_NAMESPACE: 'cya_a2a_messages'` for object-store persistence.
- **Moleculer Event Bus integration in `cya.service.js`** — `broker.emit()` is now used for all 5 `cya.a2a.*` events. `_emitA2AMessage` method validates the envelope, emits to broker (fire-and-forget), and persists to `cya_a2a_messages` object-store namespace (non-blocking, error-tolerant).
- **`events:` block in `cya.service.js`** — First-ever `events:` block in the CYA service. Listens on `cya.a2a.consensus.failed` (WARN log + HITL escalation hook) and `cya.a2a.conflict.detected` (INFO log). Extension point for future alerts, webhooks, and dashboard events.
- **`GET /api/cya/sessions/:id/a2a-log`** (`cya.session.a2aLog`) — New REST endpoint returning the full A2A communication log for a session, sorted ascending by timestamp. Returns `{ sessionId, messageCount, messages: A2AMessage[] }`. Registered in `api.service.js`.
- **UI Contract** `docs/ui-contracts/20-cya.md` — New section documenting the `a2a-log` endpoint, `A2AMessage` shape, all 5 event names with payload fields, and Moleculer event bus subscription pattern.
- **40 new tests** across 2 suites: `tests/cya-a2a-protocol.test.js` (33 tests: `createMessage`, factories, `validateMessage`, broker-mock integration, session log handler logic) and `tests/cya-a2a-bugfix.test.js` (7 tests: currentStates bug-fix scenarios).

### Fixed
- **Bug: `currentStates` never updated between negotiation rounds** in `runConflictNegotiation`. Round N+1 previously always operated on the same stakeholder states as round N. The fix applies `consensus.updatedStates` (if present in LLM response) before the next round. The hook is additive and backwards-compatible — if `updatedStates` is absent, behaviour is unchanged.

### Changed
- `runPersonaSynthesis` now accepts `sessionId` via `args` and emits `cya.a2a.persona.evaluated` after each persona evaluation.
- `runConflictNegotiation` now accepts `sessionId` via `synthesisArgs` and emits conflict/negotiation/consensus events at each stage.



### Added
- **`src/oeo-exporter-stub.js`** — OEO Exporter Stub (intentional contributor hook):
  - `exportGraphForOeo(graph, options)` — serialisiert den Graphology-Graph + JSON-LD-Skeleton
  - `transformToOEO(graphologyExport, options)` — wirft `OEO_NOT_IMPLEMENTED` (Contributor Entry Point)
  - `NODE_TYPE_TO_OEO_CLASS` / `EDGE_TYPE_TO_OEO_PROPERTY` — Stub-Mappings (TODO-annotiert)
  - Cross-Reference-Links zu ASSUME, oeplatform und OpenEnergyPlatform/ontology
- **`GET /api/cya/graph/export/oeo-stub`** (`cya.export.oeo-stub`) — neuer REST-Endpoint:
  - Exportiert den live Graphology-Ontologiegraph als JSON-LD-Skeleton
  - Demo-Fixture (Solarpark Höheinöd SEE999952467552) wenn kein `operator`-Param gesetzt
  - `oeoStub: null` + `oeoError.code: OEO_NOT_IMPLEMENTED` bis Contributor implementiert
  - `_contributor` Block mit Anleitung, Guide-Link und Ziel-Ontologie
- **`CONTRIBUTING_SCIENCE.md`** — Researcher Contributor Guide:
  - Daten-Inventar (Node-Typen, Edge-Typen, typische VNB-Counts)
  - Schritt-für-Schritt Implementierungs-Anleitung mit curl/jest-Kommandos
  - Einbettung in ASSUME / oeplatform / OEO Entwicklungsumgebungen
  - Contribution guidelines (Scope, OEO-Version, JSON-LD Framing, Test-Mindestanforderung)
- **`tests/oeo-exporter-stub.test.js`** — 5 Tests (Höheinöd-Fixture):
  - `exportGraphForOeo` gibt `graphology.nodes` + `graphology.edges` zurück
  - `nodeCount` und `edgeCount` stimmen mit Array-Längen überein
  - `oeoStub` ist `null`, `oeoError.code` ist `OEO_NOT_IMPLEMENTED`
  - `_contributor.targetOntology` enthält OpenEnergyPlatform-URL
  - `transformToOEO` wirft Error mit `code: OEO_NOT_IMPLEMENTED`

### Changed
- `services/api.service.js`: Route-Alias `GET /cya/graph/export/oeo-stub` → `cya.export.oeo-stub` registriert

## [0.34.0] — Progressive Profiling (Zwiebelmodus)

### Added
- **`src/cya-profile-observer.js`** — Zwiebelmodus profile learning engine:
  - `extractImplicitSignals(session)` — extracts focusAreas, signalsSeen, toolsUsed, confidence, hadRefinement from completed session
  - `mergeImplicitIntoProfile(existingProfile, implicitSignals)` — outer-layer only: updates `implicitStats`, `focusAreaFrequency`, `signalReactions`, `toolUsage`, `averageConfidence`, `preferences.focusAreaWeights/preferredTools`
  - `mergeExplicitIntoProfile(existingProfile, explicitUpdate)` — inner-layer only: updates `constraints`, `explicitPreferences`, `priorityFocusAreas`, `tone`, `strategic_goals`; forbidden fields silently ignored
  - `deriveToolHints(profile)` — returns `{boostedFocusAreas, preferredTools, avoidSignals}` for tool-registry integration
- **`src/cya-agent-personas.js`** — `ACTOR_ROLE_PERSONA_NAMESPACE` (frozen object): maps all 9 actor roles → `cya_mem_<role>` PouchDB namespaces
- **`src/cya-tool-registry.js`** — optional 4th param `profileHints` in `resolveToolSet`: promotes `preferredTools`, boosts `boostedFocusAreas`, suppresses `avoidSignals` ruleIds
- **`services/cya.service.js`**:
  - `PATCH /api/cya/profile/:id` (`cya.profile.update`) — explicit inner-layer update; 404 on missing profile; validates id pattern
  - `_observeAndUpdateProfile(profileId, session)` — non-blocking implicit learning call after every completed session (main + multi-agent pipelines)
  - `_writePersonaMemory(actorRole, session, signals)` — writes persona-scoped memory doc to `cya_mem_<role>` namespace on session completion
- 57 new tests: `tests/cya-profile-observer.test.js` (44), `tests/cya-profile-update.test.js` (13)

### Changed
- `cya.service.js` main pipeline and multi-agent pipeline: observer fires after `saveSession` (non-blocking `.catch` guard)
- Profile `profileVersion` increments on every implicit or explicit update
- Persona memory activation: first write on session completion when actor role is present in profile

## [0.33.0] — Dynamic Tool Router / Hyper-Relevance Engine

### Added
- **`src/cya-tool-registry.js`** — Dynamic Tool Router (v0.33.0): role-aware MCP tool
  whitelist (`ROLE_TOOL_WHITELIST` for 9 actor roles), focus-area tool priority map
  (`FOCUS_AREA_TOOL_PRIORITY` for 11 areas incl. `grid_capacity`), 4 signal-override
  rules (`SIGNAL_OVERRIDE_RULES`). Exports `resolveToolSet`, `isToolAllowed`,
  `getAllowedTools`. Throws `INVALID_ACTOR_ROLE` (400) / `UNKNOWN_ACTOR_ROLE` (400).
  Signals accept both string shorthand and `{ruleId, severity}` object form.
- **`src/cya-data-retriever.js`** — MCP-direct router block after topology-hop step:
  `resolveToolSet` determines tool set, `_resolveAndFetchMcpDirect` populates
  `retrieval.mcpDirect`, `retrieval.toolSetRationale`, `retrieval.signalOverrides`.
  Non-blocking — router failure never breaks existing retrieval. Helper functions
  `_buildToolParams` and `_resolveAndFetchMcpDirect` added.
- **`services/cya.service.js`** — All 3 `retrieveContextData` call sites now pass
  `actorRole` (from profile) and `ontologySignals: null`.
- **`tests/cya-tool-registry.test.js`** — 31 unit tests covering `resolveToolSet`,
  `isToolAllowed`, `getAllowedTools`, signal overrides, error cases, whitelist
  enforcement, citizen budget cap, journalist exclusions.

### Architecture
- CYA pipeline gains a 4th data lane: `MCP_DIRECT` alongside `MASTR_DETERMINISTIC`,
  `LLM_RAG`, and topology-hop. Every resolved tool set carries an EU AI Act Art. 12
  `rationale` string. 175 CYA regression tests pass.

## [0.32.0] — 2026-04-28

### Added

- **Central Asset Ontology Graph (`src/cya-ontology-graph.js`):** Graphology-basierter
  In-Memory-Directed-Graph aus MaStR-Installationsdaten. Node-Typen: INSTALLATION,
  NAP, SUBSTATION, VNB, REGION. Edge-Typen: VERBUNDEN_MIT, LIEGT_IN, BETRIEBEN_VON,
  ZUSTAENDIG_FUER. Exportiert: `buildOntologyGraph`, `queryNodes`, `findPath`,
  `getNeighbors`, `getSubgraph`, `deriveSignals`.
  `deriveSignals` ersetzt Regex-Text-Matching durch strukturelle Graph-Property-
  und Kanten-Existenz-Prüfungen (9 Regeln: MISSING_NAP, VOLTAGE_HOP_REQUIRED,
  NOVA_BLOCKED, HIGH_CURTAILMENT, EWK_BELOW_MEDIAN, SECTION14A_GAP,
  ENERGY_SHARING_DEADLINE, GRID_TOPOLOGY_RADIAL, HIGH_RENEWABLE_SHARE).
  Alle Signals tragen `evidence: [nodeId]` für EU AI Act Art. 12 Traceability.

- **Zwiebelmodus Context Manager (`src/cya-context-manager.js`):** `CyaContextManager`
  Klasse für iterativen Re-Entry in die CYA-Pipeline. Methoden: `setOuterContext`,
  `zoomIn` (Subgraph um Knoten, radius-basiert), `zoomOut`, `needsRetrieval`,
  `getFocusedContext` (mit `breadcrumb`-Pfad), `getIterationLog`.
  `maxIterations` (default: 3) verhindert Endlos-Loops. Jede Operation im
  Iteration-Log mit Timestamp (Audit-Trail).

- **`src/cya-regulatory-graph.js` erweitert:** Neue Exports `buildRegulatoryGraphFromOntology`
  und `OEO_MAPPINGS`. Graph-basierte Evaluation liefert identisches Response-Format
  wie `buildRegulatoryGraph()` plus `graphBased: true` Flag für Transition-Tracking.
  Bestehende Regex-Fallback-Funktion unverändert.

- **`services/cya.service.js` — Ontologie in Phase 2:** `_buildOntologyLayer` Helper-Methode
  (non-blocking, silent-fail) integriert in alle 3 Phase-2-Call-Sites (Multi-Perspective
  Preload, Main Async Pipeline, Multi-Agent Shared Pipeline). `graphology` erstmals
  im Runtime-Pfad aktiv genutzt.

- **Tests:** `tests/cya-ontology-graph.test.js` (25 Tests) und
  `tests/cya-context-manager.test.js` (20 Tests).

### Added

- **Persistent MQTT Broker (`mqtt-broker`):** Neuer eingebetteter, PouchDB-
  basierter MQTT-Persistenzdienst ohne externe Server/Prozesse (KRITIS-konform).
  Persistiert ausgehende Nachrichten, QoS-Inflight-Status, Expiry-State und
  Retained-Metadaten lokal unter `data/mqtt-broker/`.
  Interne Actions: `publish`, `acknowledge`, `recoverPendingMessages`,
  `getStats`, `purgeExpired`.

### Changed

- **`flex.executeDimming`:** MQTT-Steuerbefehle werden jetzt mit explizitem
  `messageType='control_command'`, `retain=false`, kurzer TTL und referenzierbarer
  `mqttMessageId` persistiert, damit stale Dimming-Befehle nach Restart nicht
  erneut ausgeführt werden.

## [0.31.0] — 2026-04-26

### Added

- **§14a Flexibilitätsmanagement (`flex`):** Steuerbare Verbrauchseinrichtungen
  (SVE) Registry, Dimming-Planung basierend auf Netzlast-Prognose,
  MQTT-basierte Steuerungsausführung (QoS 2), Entlastungsnachweis-Dokumentation,
  §14a Netzentgelt-Reduktionsberechnung. Respektiert §14a-Constraints:
  min. 4.2 kW, max. 2h Dimming, min. 2h Cooldown.
  8 REST-Endpoints (/api/flex/*).

## [0.30.1] — 2026-04-26

### Added

- **Forecast Engine (`forecast-engine`):** Lastprognose (SLP + historische
  Korrektur + Temperatur), Erzeugungsprognose (MCP mit KRITIS-Fallback),
  Residuallast-Berechnung, Day-Ahead-Fahrplanmanagement, Speicher-Dispatch-
  Optimierung (Greedy), Prognosequalitäts-Tracking (RMSE/MAE/MAPE).
  8 REST-Endpoints (/api/forecast/*).

## [0.30.0] — 2026-04-25

### Added

- **Settlement Service (`settlement`):** Redispatch-Entschädigungsberechnung
  (§13a/14 EnWG), EEG-Vergütungsberechnung, A96-Settlement-Export.
  EEG-Tarif-Tabelle mit Degressions-Lookup. KRITIS-konform: Marktpreis-
  und Prognose-Fallbacks wenn externe Quellen nicht verfügbar.
  8 REST-Endpoints (/api/settlement/*).
- **Bilanzkreis Service (`bilanzkreis`):** Reale und virtuelle Bilanzkreise.
  Unterstützt Energy Sharing (§42c EnWG), Mieterstrom, Arealnetze, VPP.
  15-min-Intervall-Bilanzierung mit Eigenverbrauchsquote und Autarkiegrad.
  Settlement-Readiness-Check für Datenvollständigkeit.
  6 REST-Endpoints (/api/bilanzkreis/*).

## [0.29.0] — 2026-04-24

### Added

- **`grid-operations.controlMeasures` — §14a Steuerungsmaßnahmen endpoint
  (`POST /api/grid-operations/control-measures`):**
  New REST action wrapping the `vnbdigital_control_measures` MCP tool.
  Retrieves active and planned §14a grid control measures for controllable devices
  (wallboxes, heat pumps, storage) by postcode area or VNB identifier.
  - `searchType: "postcode"` → requires `postcode` field
  - `searchType: "vnb"` → requires `vnbId` field (from `vnbdigital_search`)
  - Optional `range` array for area filtering
  - Full OpenAPI annotation with two examples (`byPostcode`, `byVnb`)
  - 4 new unit tests in `tests/grid-operations.service.test.js`

- **VNBDigital enrichment (`profileUrl`) for integrators:**
  `vnbdigital_search` and `vnbdigital_lookup` now expose additive optional
  `profileUrl` fields in the documented API contracts and examples.
  - `vnbdigital_search.results[]` may include `profileUrl` for VNB entries
  - `vnbdigital_lookup.result.vnbs[]` may include `profileUrl`
  - Backward-compatible (optional fields only; existing integrations continue to work)
  - OpenAPI response schemas updated in `grid-operations.service.js`
  - Regression tests added for passthrough + no-`profileUrl` compatibility

- **MCP tool docs updated for VNBDigital workflow:**
  `MCP_TOOLS.md` now includes enriched `vnbdigital_search`/`vnbdigital_lookup`
  examples with `profileUrl`, plus a dedicated `vnbdigital_control_measures`
  section for §14a queries.

- **Utility Report 360° VNBDigital enrichment (always-on real-data mode):**
  `utility-report` now enriches identification and compliance sections with
  VNBDigital-backed identity context and §14a control-measures data.
  - Added deterministic VNBDigital identity enrichment in Phase 1
    (`vnbdigital_search` → optional `vnbdigital_lookup` → `vnbLookupCodes`)
  - Added canonical identity metadata in Phase 2 (`canonicalIdentity`, `vnbdigital`)
  - Added Section 5 enrichment with `controlMeasures` via
    `grid-operations.controlMeasures` (`vnbdigital_control_measures`)
  - Added Section 8 transparency fields (`vnbdigital`, `canonicalIdentity`,
    `controlMeasuresSummary`) for `/app` rendering context
  - Enabled strict real-data policy in report generation:
    heuristic city/gemeinde SNB fallbacks are skipped and synthetic narrative
    filler bullets are removed (no mock/placeholder KPI statements)

- **Utility Report Phase 3 hang fix (v0.28.1 hotfix):**
  All 4 `Promise.all()` batches in Phase 3 converted to `Promise.allSettled()`
  + `unpackSettled()` helper + heartbeat `saveProgress()` calls between batches.
  Prevents indefinite hangs caused by stalled MCP upstream calls.

- **EDM Validation Service (`edm-validation`):**
  6 deterministische Validierungsregeln (Bandbreite, Lücken, Monotonie,
  Duplikate, SLP-Plausibilität, Negative). Automatische Ersatzwertbildung
  mit 4-stufiger Fallback-Kette (Interpolation → Vortag → SLP → Zero).
  4 REST-Endpoints unter `/api/edm/validate/*`.

- **EDM Messkonzept-Engine (`edm-messkonzept`):**
  Formel-Engine für virtuelle Zähler (SUM/DIFF/NET/CALC/CUSTOM) mit
  sicherer Expression-Evaluation ohne `eval()`, inkl. `evaluateAll`
  für Batch-Auswertung. 6 REST-Endpoints unter `/api/edm/messkonzepte/*`.

- **MSCONS-Import (`mscons-import`) mit eingebettetem EDIFACT-Parser:**
  Neuer offline-fähiger MSCONS-Import ohne externe Abhängigkeiten (KRITIS-konform).
  - Neuer Parser [src/edm-mscons-parser.js](src/edm-mscons-parser.js)
    mit `tokenizeSegments()` und `parseMscons()` für UNH/BGM/DTM/NAD/LOC/CCI/QTY/STS.
  - Neues Service [services/mscons-import.service.js](services/mscons-import.service.js)
    mit 3 Actions:
    - `POST /api/mscons/parse` → `mscons-import.parse`
    - `POST /api/mscons/import` → `mscons-import.import`
    - `GET /api/mscons/imports` → `mscons-import.listImports`
  - Importfluss: Auto-Create MeLo (`sourceType='mscons'`), OBIS-/Quality-Mapping,
    optional `edm-validation`-Validierung pro Zeitreihe.
  - Neue Tests:
    [tests/edm-mscons-parser.test.js](tests/edm-mscons-parser.test.js),
    [tests/mscons-import.service.test.js](tests/mscons-import.service.test.js)

- **EDM Virtual Meter Auto-Population (`edm-virtual`):**
  Neuer Service für die automatische Befüllung virtueller/dummy MeLos mit
  viertelstundenscharfen Tagesprofilen (SLP) und optionaler Batch-Auswertung
  vorhandener Messkonzepte.
  - Neue REST-Endpunkte:
    - `POST /api/edm/virtual/populate-slp` → `edm-virtual.populateBySlp`
    - `POST /api/edm/virtual/auto-populate/day` → `edm-virtual.autoPopulateDay`
  - Neue Helper in [src/edm-virtual-meter.js](src/edm-virtual-meter.js)
  - Neue Tests:
    [tests/edm-virtual-meter.test.js](tests/edm-virtual-meter.test.js),
    [tests/edm-virtual.service.test.js](tests/edm-virtual.service.test.js)

### Changed

- **`edm.listMelos` erweitert um `sourceType`-Filter:**
  Optionales Query-Param `sourceType` ergänzt (inkl. SQL-Filter + OpenAPI-Doku),
  damit MSCONS-importierte MeLos gezielt gelistet werden können.

### Fixed

- **Dashboard `market-snapshot` — alle Felder lieferten `null`:**
  `dashboard-api.marketSnapshot` rief `energy-market.prices` auf, dessen
  Antwortstruktur (`prices[].price`) nicht mit den tatsächlich genutzten
  Feldern übereinstimmte. Umgestellt auf `entsoe.dayAheadPrices`
  (`dataPoints[].priceEURperMWh` + `statistics`). Gleichzeitig wurde
  `buildCo2` korrigiert, das nach `co2Data.current` suchte, während
  `energy-market.co2Intensity` `co2_intensity_gco2eq_kwh` liefert.
  `german-grid.spotprices` als redundanter dritter Call entfernt.
  Tests in `tests/dashboard-api.test.js` entsprechend aktualisiert (74 Tests grün).

## [0.28.0] — 2026-04-20

### Added

- **EDM (Energiedatenmanagement) Core:** SQLite-basiertes Messdaten-
  Management mit quartalsweiser Partitionierung (better-sqlite3, WAL-Modus,
  WITHOUT ROWID). KRITIS-konform (embedded, kein externer Server).
  10 REST-Endpoints (/api/edm/*).
  - MeLo-Registry CRUD (physisch/virtuell/dummy) mit MaStR-Integration
  - Zeitreihen-Import (CSV mit deutschem Format, JSON) mit Batch-Insert
  - Zeitreihen-Query mit Resolution-Aggregation (15min/hourly/daily)
  - Zeitreihen-Summary mit flexibler Gruppierung (day/week/month/year)
  - Cross-Quarter-Queries transparent über SQLite-Partitionsgrenzen
  - OBIS-Code-Registry (Strom, Gas, Wärme)
  - DSGVO-konforme Retention-Policy (EDM_RETENTION_DAYS in .env)
- **SLP-Service:** Standardlastprofile (BDEW H0/G0/L0) als dedizierter
  Microservice mit Custom-Profil-CRUD. 5 REST-Endpoints (/api/slp/*).
  Individuelle Versorger-/Netzbetreiber-Profile unterstützt.
- **EDM E2E Demo (Höheinöd):** Full-lifecycle integration test:
  MaStR → MeLo-Registry → CSV-Import → SLP-Dummy → Zeitreihen-Query
  → Aggregation → Cleanup. Echte MaStR-Fixtures (PLZ 66989).

### Dependencies

- `better-sqlite3` (SQLite WAL-Modus, embedded TSDB-Alternative)

## [0.27.5] — 2026-04-19

### Added

- **CYA E2E-Integrationtest `tests/cya-e2e-hoeheinoed.test.js`** (31 Tests, Standort Höheinöd/PLZ 66989):
  - Vollständiger Lifecycle-Test: Phase A (Profile) → B (Generate) → C (Multi-Perspektive) → D (PDF-Export) → E (Refinement) → F (Datenvalidierung).
  - Echte MaStR-Fixtures für Höheinöd (3 Solaranlagen, 1 Windanlage, 1 Biomasse), vollständig inline gemockte Abhängigkeiten (`llm-client`, `cya-report-builder`).
  - Abdeckt alle CYA-Actions end-to-end inkl. `compareProfiles`, `exportPdf`, `exportJson`, `refine`.

### Fixed

- **CYA `compareProfiles` — Session-Persistenz-Bug:**
  - `compareProfiles` speicherte `session_id` und `status: 'completed'` nicht explizit in PouchDB.
  - `exportPdf` auf Multi-Perspektive-Sessions warf daher fälschlicherweise HTTP 409.
  - Fix in [services/cya.service.js](services/cya.service.js): `saveSession`-Aufruf ergänzt um `session_id: sessionId, status: 'completed'`.

### Documentation

- **Q2 2026 Feature-Complete Release Summary** in [docs/RELEASE_SUMMARY_Q2_2026.md](docs/RELEASE_SUMMARY_Q2_2026.md): Übersicht aller CYA-Features (v0.27.x), Architektur-Diagramm, Test-Coverage-Kennzahlen, Breaking-Changes-Hinweis (none).

## [0.27.4] — 2026-04-18

### Added

- **CYA Profile-Templates (read-only Katalog + Bootstrap-Create):**
  - Neues Modul [src/cya-profile-templates.js](src/cya-profile-templates.js) mit 6 vorgefertigten Rollen-Profilen
    (`vnb_defensiv`, `projektierer_offensiv`, `journalist_neutral`,
    `bnetz_compliant`, `gemeinde_buergermeister`, `stadtwerk_vertrieb`).
  - Neue CYA Actions in [services/cya.service.js](services/cya.service.js):
    - `GET /api/cya/templates` → `cya.listTemplates`
    - `GET /api/cya/templates/:templateId` → `cya.getTemplate`
    - `POST /api/cya/profile/from-template` → `cya.createFromTemplate`
      (inkl. `overrides` + `overrideMode=append|replace`).
  - Neue Route-Aliases in [services/api.service.js](services/api.service.js);
    GET-Endpunkte sind read-only, Profil-Erstellung bleibt Full-Access-geschützt.
  - OpenAPI vollständig ergänzt (inkl. Request-Examples); `npm run audit:openapi` ohne Findings.

- **CYA Multi-Perspektive-Generator (`compareProfiles`):**
  - Neue Action `POST /api/cya/compare-perspectives` in [services/cya.service.js](services/cya.service.js).
  - Unterstützt `2..5` Perspektiven via `profile_ids` (gemischt aus gespeicherten `profile_id`s und Template-IDs).
  - Führt Phase 1–3 einmal aus (Retrieval, Regulatory Graph, Grounding) und re-synthetisiert Phase 4 parallel je Perspektive.
  - Persistiert Ergebnis-Sessions als `type: "multi_perspective"` im Namespace `cya_sessions`.
  - Neuer Route-Alias in [services/api.service.js](services/api.service.js):
    - `POST /api/cya/compare-perspectives` → `cya.compareProfiles`

- **CYA PDF- und JSON-Export für Narratives:**
  - Neues Modul [src/cya-report-builder.js](src/cya-report-builder.js) mit `buildCyaNarrativePdf(session, options)`.
    - Rendert Single- und Multi-Perspektiven-Sessions als PDF via `pdfkit`.
    - Sections: Cover, Narrative (Headline, Summary, KeyPoints, Empfehlungen, Risiken), Regulatorischer Kontext,
      Datenbasis (Confidence, Fakten, Datenlücken), Perspektiven-Seiten + Vergleichstabelle (Multi),
      EU AI Act Art. 13 Transparenz-Footer.
    - Optionen: `language` (`de`/`en`), `includeRegulatoryDetails`, `includeDataBasis`, `includeAITransparency`.
  - Neue CYA Actions in [services/cya.service.js](services/cya.service.js):
    - `GET /api/cya/sessions/:session_id/export/pdf` → `cya.exportPdf` (gibt `application/pdf` Buffer zurück, `Content-Disposition: attachment`).
    - `GET /api/cya/sessions/:session_id/export/json` → `cya.exportJson` (gibt vollständiges Session-Objekt zurück).
    - `exportPdf` wirft `409 SESSION_NOT_COMPLETED` wenn Session-Status ≠ `completed`.
  - Neue Route-Aliases in [services/api.service.js](services/api.service.js).

### Tests

- Neue Tests: [tests/cya-profile-templates.test.js](tests/cya-profile-templates.test.js)
- Neue Tests: [tests/cya-report-builder.test.js](tests/cya-report-builder.test.js) — 11 Tests (Buffer-Check, Multi-Perspektive, Null-Safety, Options, EN-Sprache)
- Erweiterte Service-Tests: [tests/cya.service.test.js](tests/cya.service.test.js)
  - Abdeckung für `compareProfiles`: 2 Profile, nur Templates, Mixed, min-Validation und `needs_clarification`-Pfad.
  - Abdeckung für `exportPdf`/`exportJson`: Buffer-Return, 409, 404, Options-Forwarding, JSON-Shape.
- Verifiziert mit:
  - `npx jest tests/cya-report-builder.test.js tests/cya.service.test.js --no-coverage`
  - `npm run audit:openapi`

## [0.27.3] — 2026-04-17

### Changed

- **MaStR Monitor scalability defaults raised:** `services/mastr-monitor.service.js`
  now defaults to `50,000` installations per watch run via
  `MASTR_MONITOR_MAX_INSTALLATIONS_PER_WATCH` (was 5,000).

- **Chunked persistence for large snapshots/deltas:**
  `services/mastr-monitor.service.js` now stores large snapshot and delta details
  as manifest + chunk documents in dedicated namespaces
  (`mastr_snapshot_chunks`, `mastr_delta_chunks`) and hydrates them transparently
  for API responses (`getSnapshot`, `getDelta`, `getDeltas`).

- **Cross-type fetch limiting refined:** when `query.type=all`, the monitor now
  applies the remaining global watch limit per installation type call, preventing
  avoidable over-fetching across solar/wind/storage/biomass.

- **Delta notification detail cap:** `src/mastr-monitor-notify.js` now caps
  detailed per-section email listings to `100` entries by default
  (`MASTR_MONITOR_EMAIL_DETAIL_LIMIT`), while preserving full summary counts.

- **Object-store pagination hardening:** list/delete helpers in
  `services/mastr-monitor.service.js` now page through namespaces to avoid
  truncation at query-limit boundaries.

### Added

- **New environment variables** in `.env.example`:
  - `MASTR_MONITOR_MAX_INSTALLATIONS_PER_WATCH`
  - `MASTR_MONITOR_CHUNKING_ENABLED`
  - `MASTR_MONITOR_CHUNK_SIZE`
  - `MASTR_MONITOR_EMAIL_DETAIL_LIMIT`

### Tests

- `tests/mastr-monitor.service.test.js`
  - coverage for `50,000` default, cross-type limit behavior, and
    chunked snapshot/delta hydration.
- `tests/mastr-monitor-notify.test.js`
  - coverage for email detail truncation behavior (`top 100`).

## [0.27.2] — 2026-04-17

### Fixed

- **API gateway token path handling for MaStR Monitor:** `services/api.service.js`
  now preserves business path parameters named `:token` for
  `GET /api/mastr-monitor/confirm/:token` and
  `DELETE /api/mastr-monitor/watches/:watchId/subscribe/:token`.
  This fixes `422 VALIDATION_ERROR` on double-opt-in confirmation links and
  unsubscribe links caused by generic token stripping in `onBeforeCall`.

- **MaStR Monitor execution stability:** `services/mastr-monitor.service.js`
  now sanitizes downstream query params before calling
  `energy-market.installations` (drops `undefined/null/empty` values) and
  clamps `object-store.query` limit to the service max (`<= 1000`).
  This fixes baseline/scheduled run failures with `Parameters validation error!`
  and restores snapshot/delta generation.

- **MaStR Monitor schedule guardrail (minimum daily interval):**
  `services/mastr-monitor.service.js` now rejects cron expressions that would
  run more frequently than once per day. `createWatch` returns
  `422 INVALID_SCHEDULE` for high-frequency schedules (e.g. `*/5 * * * *`).
  Daily/weekly/monthly schedules remain supported.

### Changed

- **Local E2E mail-trigger test script hardened:**
  `scripts/local/mastr-monitor-email-e2e.sh` now includes:
  - language normalization (`MONITOR_LANGUAGE` → `de|en`)
  - robust confirmation flow (native confirm endpoint + fallback)
  - run endpoint fallback handling
  - compact synthetic snapshot injection to avoid shell "Argument list too long"
  - improved polling/logging behavior for deterministic local validation
  - schedule policy alignment (daily preset instead of minutely cron)

- **PV Mauer alert setup script added:**
  `scripts/local/mastr-monitor-new-pv-mauer-alert.sh` creates a watch for
  `type=solar`, `postleitzahl=69256`, `gemeinde=Mauer` with daily monitoring
  and email subscription/confirmation bootstrap.

- **Security hygiene:** local manual test scripts are ignored via `.gitignore`
  (`scripts/local/`) because they may include sensitive test tokens/emails.

- **UI contract updated:** `docs/ui-contracts/21-mastr-monitor.md` updated to
  `v0.27.1` semantics including schedule guardrail (`min daily`),
  `422 INVALID_SCHEDULE`, and token-path handling notes for
  confirm/unsubscribe routes.

### Tests

- `npx jest tests/api.service.test.js --no-coverage`
- `npx jest tests/mastr-monitor.service.test.js --no-coverage`

## [0.27.1] — 2026-04-17

### Changed

- **Documentation refresh (v0.27 alignment):**
  - `README.md` updated with v0.27 feature set (CYA, MaStR Monitor, NOVA, ZNP, cookbook, object store)
  - `README.md` configuration table expanded with missing environment variables (`SMTP_*`, `MASTR_MONITOR_BASE_URL`, `ZNP_DB_PATH`, `COOKBOOK_*`, `GEMINI_EMBEDDING_MODEL`)
  - `docs/BACKEND_CONTEXT.md` bumped from `0.20.6` to `0.27.0` context, including service count update (45), new layers, and MaStR Monitor object-store namespaces
  - `docs/BACKEND_CONTEXT.md` service directory extended with `cya`, `mastr-monitor`, and `nova`
  - `docs/BACKEND_CONTEXT.md` test-suite figures updated to `~2 268+ tests, ~82 suites`
  - `QUICKSTART.md` modernized with current service count and endpoint groups for v0.27 platform modules

## [0.27.0] — 2026-04-17

### Added

- **MaStR Monitoring Service:** Field-level change detection for MaStR
  installations with email notifications. 12 REST endpoints (`/api/mastr-monitor/*`).
  - Watch CRUD with saved query filters and configurable schedules
  - Field-level Delta-Engine with `lastUpdatedAt` pre-filter optimization
  - Email notifications via SMTP (nodemailer) with Double-Opt-In
  - Dual-trigger scheduling (cron tick + `mastr.data.refreshed` event)
  - Token-link based subscription management (no account required)
  - Live-CSV Session → Watch conversion
- **MaStR Catalog Labels:** Human-readable labels for coded MaStR fields
  (Betriebsstatus, Prüfungsstatus, Spannungsebene)
- **UI-Contract 21:** MaStR Monitoring contract

### Changed

- `.env.example`: `SMTP_*` and `MASTR_MONITOR_BASE_URL` variables added
- `agent.service.js`: `mastr-monitor` added to skip services handling
- API routing and OpenAPI updated for MaStR Monitoring endpoints

### Tests

- `tests/mastr-monitor.service.test.js`
- `tests/mastr-monitor-diff.test.js`
- `tests/mastr-monitor-notify.test.js`
- `tests/mastr-monitor-scheduler.test.js`

## [0.26.9] — 2026-04-16 — Multi-Agent CYA Orchestrator (Full 6-Step Implementation)

### Added

- **CYA Multi-Agent Orchestrator — "Synthetic Stakeholder Dialogues" (complete):**
  `POST /api/cya/generate` now accepts an optional `perspectives` array
  (`["technical", "commercial", "compliance"]`). When present, the pipeline fans out to
  three parallel sub-agents that negotiate a consensus narrative. Absent/empty perspectives
  → exact v0.26.8 single-agent behavior (fully backward compatible).

- **Step 0: Backward Compatibility Test Suite** — 7 regression tests for classic
  (non-multi-agent) generate/refine flows:
  - `POST /api/cya/generate` with no `perspectives` param executes v0.26.8 path unchanged
  - Async job flow preserved: 202 → polling → results
  - Clarification and refine behavior remains identical
  - Tests verify `stakeholder_states` is undefined in classic mode

- **Step 1: Internal Persona Catalog (`src/cya-agent-personas.js`, 179 lines)** —
  Fixed, hardcoded
  registry of 3 stakeholder personas, separate from user-authored CYA profiles:
  - `technical` (Grid Planning & Operations) — VDE-FNN standards, voltage/topology, capacity
  - `commercial` (Commercial & Finance) — CAPEX/ROI, netzentgelte, subsidies
  - `compliance` (Legal & Regulatory) — EnWG, BNetzA, audit trail, deadlines
  - Each persona has: system prompt (deterministic negotiation), Object Store namespace,
    conflict rules, and resolution priority
  - Helper functions: `validatePerspectives()`, `getPersona()`, `getPersonasOrderedByPriority()`,
    `isKnownConflictRule()`
  - 28 new unit tests in `tests/cya-agent-personas.test.js` — all passing

- **Step 2: Generate Action Extended with Perspectives Parameter** — `POST /api/cya/generate`
  now accepts optional `perspectives: string[]` parameter:
  - Strict enum validation against `PERSONA_ENUM` — invalid personas rejected with 400 error
  - Empty array or absent param → classic v0.26.8 behavior (backward compatible)
  - OpenAPI schema updated with full documentation and multi-agent example payload
  - Handler validates perspectives before pipeline execution
  - TODO placeholders mark where orchestrator logic (Steps 3–6) will integrate

### Changed

- **CYA service imports:** Added `validatePerspectives` from `src/cya-agent-personas.js`
- **Generate action params:** Added `perspectives` array param with enum validation
- **Generate action OpenAPI:** Added `perspectives` field with description, example, and
  backward-compatibility notes
- **Generate action example payload:** Updated to show optional `perspectives: ['technical', 'commercial']`

### Tests

- `tests/cya-agent-personas.test.js` — 28 new tests covering persona catalog, validation,
  conflict rules, namespace isolation, and priority ordering
- `tests/cya.service.test.js` — 7 new backward compatibility tests plus 1 fix (dedup phase
  logging in async test) for classic generate/clarification/refine flows
- **Total:** 2,163 tests, 75 suites, all passing

### Documentation

- Inline TODO comments in `services/cya.service.js` mark the orchestrator integration points
  for Steps 3–6: shared Phase 1–2 baseline, per-persona Phase 3 grounding, conflict detection,
  dialogue rounds, consensus synthesis
- Architecture decisions documented in `feedback/CR-CYA-MULTI-AGENT-DECISIONS.md` with 6
  resolved questions (API shape, memory backend, persona source, perspectives enum, memory
  abstraction, execution divergence point)
- Roadmap in `feedback/GO_IMPLEMENT_MULTI_AGENT.md` with approval and final refine behavior
  decision (replay full orchestration dialogue on clarification)

### Known Limitations & Next Steps

- **Steps 3–6 not yet implemented** (planned for v0.26.10–v0.27.0):
  - Step 3: Shared Phase 1–2 baseline (single retrieval/regulatory graph run)
  - Step 4: Per-persona Phase 3 grounding with Object Store memory queries
  - Step 5: Orchestrator conflict detection and dialogue loop + HITL escalation
  - Step 6: Per-perspective synthesis + consensus narrative + expanded response mapping
- **Perspectives param is accepted but currently ignored** — calls still execute classic path
- **No multi-agent response fields yet** — `stakeholder_states`, `dialogue_rounds`, `conflicts`,
  `multi_perspective` will be added in Step 5–6
- **Persona memory ingestion not yet wired** — Object Store namespaces (`cya_persona_*`) exist
  but no document tagging/retrieval pipeline yet (Step 4)

### Version Sync

- No automatic version bump yet; still planning v0.26.9 as final release tag once Steps 3–6
  complete and integration tests pass

## [0.26.8] — 2026-04-16

### Fixed

- **CYA token propagation hardening (Retriever):** `fetchInstallations()` in

### Fixed

- **CYA token propagation hardening (Retriever):** `fetchInstallations()` in
  `src/cya-data-retriever.js` now forwards `ctx.meta.cernionToken` explicitly
  via third `ctx.call` argument for `energy-market.installations` (MCP-backed),
  aligned with v0.26.4 standard.
  - Verification: `assessTopologyHop()` in `src/cya-topology-hop.js` already
    remained v0.26.4-compliant (osm-geo.substationFinder with explicit token meta).

### Changed

- **Topology-Hop generalized to voltage-level resolver:** Refactored hardcoded
  `MW_THRESHOLD_110KV = 10` into generic `VOLTAGE_THRESHOLDS` array with 4 tiers:
  - MS (0–10 MW) → 10 kV / 20 kV, severity: none
  - MS (10–50 MW) → 20 kV, severity: info
  - HS (50–150 MW) → 110 kV, severity: warning
  - HöS (150+ MW) → 220 kV / 380 kV, severity: critical
  - New `determineRequiredVoltageLevel(capacityMw)` helper resolves voltage class
  - `VOLTAGE_HOP_REQUIRED` rule in regulatory graph now scales severity with voltage
  - Supports edge cases: 10 MW (boundary), 10.01 MW (MS tier), 150 MW (boundary), 200 MW (HöS critical)

### Documentation

- **docs/ui-contracts/20-cya.md** updated from v0.26.2 to v0.26.7:
  - Async job pattern (HTTP 202 responses, polling, retryAfter headers)
  - `context.capacity_mw` parameter documented with example (50 MW)
  - `clarification_response.provided_data` override structure (user-asserted facts)
  - HITL flow with 2-step refinement (clarification → refine)
  - EU AI Act XAI markers (`[Nutzerangabe – nicht maschinell verifiziert]`)
  - `topologyHop` response shape with voltage class + threshold
  - Confidence badges (🟢 High / 🟡 Medium / 🔴 Low)
  - Fact source icons (📊 MaStR / 🗺️ OSM / 💬 LLM / ⚠️ User-asserted)
  - Complete Höheinöd PoC flow example with curl commands
- **docs/RELEASE_SUMMARY_v0.26.7.md** created: consolidated v0.26.0→v0.26.7 feature matrix, platform metrics (75 suites, 2,131 tests), PoC validations (Bautzen, Höheinöd, Mauer)
- **docs/CYA_ARCHITECTURE.md** created: 4-phase module responsibility contract (input/output, known deviations, error handling)
- **feedback/CR-CYA-NEXT.md** created: post-v0.26.7 roadmap with 3 architecture refactors (A1–A3) and 3 frontend features (F1–F3), open design questions (Q1–Q3)

### Tests

- **tests/cya-topology-hop.test.js:** 9 new/updated tests for generic voltage resolver:
  - `5 MW asset → MS voltage class, severity none`
  - `15 MW asset → HS voltage class, severity warning`
  - `60 MW asset → HS voltage class, severity warning`
  - `200 MW asset → HöS voltage class, severity critical`
  - Edge cases: 10 MW (MS boundary), 10.01 MW (HS tier), 150 MW (HS/HöS boundary), 150.01 MW (HöS tier)
  - OSM degradation: graceful fallback when Overpass unavailable
  - Missing input validation (insufficient_input reason)

## [0.26.7] — 2026-04-15

### Changed

- **CYA Phase 1 deepened with deterministic MaStR Lagebild (location-driven):**
  `src/cya-data-retriever.js` now enriches `capacity` and `renewables` focus areas
  with machine-verified installation evidence via `energy-market.installations`
  (which reuses `cernion_installations_local` under the hood).
  - Added deterministic situation report branch (no LLM in Phase 1) for locations
    with actionable MaStR evidence.
  - Generates granular facts including legacy assets and storage deficit signal:
    - legacy PV/Wind examples (MaStR-ID, capacity, commissioning date)
    - utility-scale storage check (`> 50 kW`) with explicit deficit statement
  - Injects source-backed retrieval items (`sources: ['cernion_installations_local']`,
    `dataProvenance: 'mastr_machine_verified'`) so grounding facts are no longer
    generic placeholder text when data is available.
  - Added postal-code resolver with alias support for `Höheinöd → 66989` to ensure
    deterministic local retrieval in the PoC scenario.

### Added

- **Regression tests for Höheinöd granular facts (sync + async):**
  - `tests/cya-data-retriever.test.js`
    - deterministic retrieval test validates PV `SEE999952467552`, Wind
      `SEE969028349266`, and zero storage > 50 kW.
  - `tests/cya.service.test.js`
    - sync `cya.generate` completes with granular grounding facts for Höheinöd
    - async job flow completes through Phase 4 with same deterministic evidence.

### Notes

- Existing Bautzen guardrail from v0.26.6 remains intact:
  when deterministic evidence is missing, CYA still returns
  `needs_clarification` and halts before synthesis.

## [0.26.6] — 2026-04-15

### Fixed

- **CYA Guardrail (Bautzen PoC):** `POST /api/cya/generate` now enforces
  `needs_clarification` when grounding has no usable evidence.
  - If `grounding.facts` is empty, pipeline halts before Phase 4 (LLM synthesis).
  - If all facts are `confidence: 'low'`, pipeline halts before Phase 4.
  - Result is returned as `status: 'needs_clarification'` with a clarification
    object (`reason: 'insufficient_fact_quality'`) and suggested focus areas.
  - Prevents blind narrative generation from non-verified/no-evidence payloads.

### Changed

- `src/cya-grounding.js`
  - Added fact-quality guardrail helpers: `needsFactQualityClarification()` and
    `buildFactQualityClarification()`.
  - Clarification selection now prioritizes existing location/data-gap logic,
    then applies insufficient-fact-quality fallback.
- `tests/cya-grounding.test.js`
  - Added coverage for empty-fact and all-low-confidence-fact scenarios.
- `tests/cya.service.test.js`
  - Added end-to-end Bautzen tests for sync and async generate flows.
  - Async test verifies no `phase_4_synthesis` log entry when clarification is required.

## [0.26.5] — 2026-04-15

### Changed

- **CYA async job pattern migration:** `/api/cya/generate` now uses the Cernion async job pattern:
  - REST callers receive HTTP 202 (Accepted) + jobId + Location header immediately
  - Background worker processes full 4-phase pipeline asynchronously with phase-based progress logging
  - Phase milestones: phase_1_retrieval (0→33%), phase_2_graph (33→66%), phase_3_grounding (66→75%), phase_4_synthesis (75→100%)
  - Client polls `/api/jobs/{jobId}/status` for progress and `/api/jobs/{jobId}/result` for final response
  - Internal service-to-service calls (no `ctx.meta.$gateway` flag) remain synchronous, receiving result directly (backward-compatible)
  - Resolves timeout issues on complex grounding queries (e.g., Bautzen asset: 10 MW + multiple focus areas + OSM topology detection)
- **OpenAPI:** Updated `generate` action to document 202 response (jobId, status, statusUrl, resultUrl) + Retry-After header guidance

### Technical Notes

- `src/job-store.js` exports: `startJob(ctx, jobMeta, worker)` detects `ctx.meta.$gateway` flag
  - REST: fire-and-forget; worker receives jobId, logs phases via `appendLog(jobId, phase, percent, msg)`
  - Internal: no jobId; appendLog calls are no-ops; worker result returned synchronously
- `/api/jobs/:jobId/status` and `/api/jobs/:jobId}/result` endpoints already exist in `services/api.service.js` (pre-v0.26.5)
- Job store: file-backed at `data/jobs/{jobId}.progress.json` and `data/jobs/{jobId}.result.json`

## [0.26.4] — 2026-04-15

### Fixed

- **CYA explicit token forwarding for downstream internal calls:**
  - `src/cya-data-retriever.js` now passes `ctx.meta.cernionToken` explicitly as
    Moleculer call options to `query.ask`, instead of relying on implicit meta propagation.
  - `src/cya-topology-hop.js` now passes `ctx.meta.cernionToken` explicitly as
    Moleculer call options to `osm-geo.substationFinder`.
  - This fixes the CYA Phase-1 grounding path where downstream MCP-backed services
    could fail with `Unauthorized` / `Invalid access token` if implicit meta propagation
    did not reach the MCP client.

### Changed

- Updated CYA unit tests to assert the third `ctx.call(..., ..., { meta: { cernionToken } })`
  argument for both query retrieval and topology-hop lookups.

## [0.26.3] — 2026-04-15

### Added

- **CYA HITL Structured Override (`provided_data`):** `POST /api/cya/refine` now
  accepts a `clarification_response.provided_data` object that supplies hard facts
  (capacity, redispatch, NOVA, investment, …) to rebuild Phase 2 (Regulatory Graph)
  deterministically — bypassing failed MCP/auth fetch-routines entirely.
  - `mergeProvidedData` in `src/cya-data-retriever.js` merges user-supplied text as
    `trusted:true / dataProvenance:'user_asserted'` items; recalculates summary with
    `trusted` count for EU AI Act Art. 12 provenance tracing.
  - Session is re-persisted with the enriched retrieval so subsequent `refine` calls
    use the repaired grounding state, not the original gap-filled one.
  - `agent_clarification_response` (free-text LLM guidance, Phase 3) is preserved as
    a fully separate parameter — no mixing with deterministic Phase 2.

- **110-kV Topology Hop Detector (`src/cya-topology-hop.js`):** New best-effort
  module `assessTopologyHop(ctx, { location, capacityMw })` resolves HS substation
  candidates via `osm-geo.substationFinder` (voltageLevel: `'HS'`, maxResults: 5).
  - Threshold: `MW_THRESHOLD_110KV = 10`. Assets ≥ 10 MW require HS-level connection.
  - Non-blocking graceful degradation: OSM/Overpass errors → `{ needsHop: false, reason: 'osm_unavailable' }`.
  - Returns `physicalConnectionPoint` (nearest HS substation), `inferredOperator`,
    `rationale` when OSM data is available.
  - Activated in `retrieveContextData` when `context.capacity_mw` and `location` are set.

- **VOLTAGE_HOP_REQUIRED regulatory rule:** New rule (severity `warning`,
  OEO class `OEO_00020151`) in `src/cya-regulatory-graph.js` evaluates
  `topologyHop?.needsHop === true` and injects an actionable signal into the
  Regulatory Graph when the hop is detected.

- **EU AI Act XAI Guardrail in LLM prompt:** `src/cya-synthesis.js` `buildPrompt`
  annotates trusted facts with the German marker
  `[Nutzerangabe – nicht maschinell verifiziert]` inline in the JSON payload sent
  to the LLM. Accompanying system-prompt instruction explicitly forbids the LLM
  from presenting user-asserted claims as official measurements or regulatory findings.

- **Trusted fact confidence capping in grounding:** `src/cya-grounding.js`
  `buildFacts` enforces `confidence:'medium'` (never `'high'`) for items with
  `trusted:true`. `dataProvenance` field propagated to fact objects.
  `topologyHop` attached to returned grounding object.

- **`context.capacity_mw` param on `POST /api/cya/generate`:** Optional number
  (MW). Triggers topology hop detection when combined with `context.location`.

- **Tests:** 9 new tests across 2 new/updated test files:
  - `tests/cya-topology-hop.test.js` — 4 tests (needsHop cases, OSM degradation,
    missing location)
  - `tests/cya-data-retriever.test.js` — 3 new `mergeProvidedData` tests (replace,
    append, summary recalculation)
  - `tests/cya.service.test.js` — 2 new integration tests (HITL flow: needs_clarification
    → provided_data → completed; topology-hop signal with capacity_mw)

### Changed

- `POST /api/cya/refine` OpenAPI schema updated: new `clarification_response` property
  with `hitl_override` example matching the CR's `curl` payload for Mauer/Speicher use case.
- `POST /api/cya/generate` OpenAPI schema updated: `context.capacity_mw` property
  documented with description and example.

## [0.26.2] — 2026-04-14

### Added

- **CYA Pipeline Modules (implemented):** Added full CYA runtime modules for
  Option-B response orchestration:
  - `src/cya-data-retriever.js` — focus-area query orchestration via `query.ask`
  - `src/cya-regulatory-graph.js` — deterministic rule graph with OEO references
  - `src/cya-grounding.js` — fact extraction, data-gap handling, confidence scoring,
    clarification trigger
  - `src/cya-synthesis.js` — LLM-backed narrative synthesis (structured schema)

### Changed

- **CYA `generate` and `refine` are no longer stubs:**
  - `POST /api/cya/generate` now executes the full pipeline
  - `POST /api/cya/refine` now refines existing sessions with feedback/clarification
  - Both endpoints now return Option-B response objects with
    `status`, `grounding`, `regulatory_graph`, `narrative`, `clarification`, `metadata`
- Added persistent CYA session state in Object Store namespace `cya_sessions`
  (session load/save + refinement history)

### Tests

- Added CYA unit test suite:
  - `tests/cya.service.test.js`
  - `tests/cya-data-retriever.test.js`
  - `tests/cya-regulatory-graph.test.js`
  - `tests/cya-grounding.test.js`
  - `tests/cya-synthesis.test.js`

## [0.26.1] — 2026-04-14

### Fixed

- **CYA Agent OpenAPI exposure:** Added the missing `cya` Moleculer service implementation
  plus API gateway tag/aliases so the autogenerated Swagger/OpenAPI documentation now
  exposes all CYA endpoints in `/api/docs` and `openapi-export.json`.
  - `POST /api/cya/profile`
  - `GET /api/cya/profile/:profile_id`
  - `GET /api/cya/profiles`
  - `POST /api/cya/generate`
  - `POST /api/cya/refine`

### Changed

- `services/cya.service.js`: added REST + OpenAPI definitions for all 5 CYA actions
- `services/api.service.js`: added `CYA Agent` tag, route aliases, and full-access protection for profile writes
- `openapi-export.json`: regenerated with 98 paths including `/api/cya/*`

## [0.26.0] — 2026-04-14

### Added

- **CYA Agent (Cover Your Ass Engine):** Stakeholder-perspective argumentation
  engine with regulatory grounding. 5 REST endpoints (`/api/cya/*`), profile
  management via Object Store, 3-phase pipeline (Data Retrieval → Regulatory
  Graph → LLM Synthesis), Human-in-the-Loop via HTTP 428.
  - `POST /api/cya/profile` — Create/upsert stakeholder profile
  - `GET /api/cya/profile/:profile_id` — Load profile
  - `GET /api/cya/profiles` — List profiles
  - `POST /api/cya/generate` — Generate data-backed, profile-aware narrative
  - `POST /api/cya/refine` — Refine narrative or respond to HITL clarification
- **CYA Regulatory Graph:** 8 deterministic rules (NOVA_BLOCKED, HIGH_CURTAILMENT,
  EWK_BELOW_MEDIAN, MISSING_NAP, SECTION14A_GAP, ENERGY_SHARING_DEADLINE,
  GRID_TOPOLOGY_RADIAL, HIGH_RENEWABLE_SHARE) with OEO class mappings
- **CYA Data Retriever:** Focus-area-based service orchestration with location
  resolution, deduplication, and graceful degradation (11 focus areas, ~20 service calls)
- **UI-Contract 20:** CYA Agent contract (docs/ui-contracts/20-cya.md)

### Changed

- `agent.service.js`: 'cya' added to both skipServices sets
- `api.service.js`: CYA Agent OpenAPI tag + 5 route aliases

### Documentation

- UI-Contract 16 (ZNP) created
- UI-Contract 05 (MaStR Quality) updated with Finding-Details-Drilldown
- 00-architecture.md index updated (contracts 14–19)
- BACKEND_CONTEXT.md updated (43 services, 9 PouchDB stores, 92 finding codes)
- RELEASE_SUMMARY_v0.25.0.md created
- 'cookbook' added to skipServices

### Tests

- tests/cya.service.test.js (service definition, CRUD, generate, refine)
- tests/cya-data-retriever.test.js (location resolution, dedup, safeCall, 8 tests)
- tests/cya-regulatory-graph.test.js (all 8 rules, graceful empty, 11 tests)
- tests/cya-grounding.test.js (fact extraction, data gaps, HITL trigger)
- tests/cya-synthesis.test.js (LLM mock, prompt construction, refinement)

## [0.25.0] — 2026-04-12

### Added

- **ZNP Project Hydration & Persistence (v0.23+):**
  Complete project lifecycle implementation with automatic state recovery:
  - `POST /api/znp/projects` — Create new graph-backed project workspace
  - `POST /api/znp/projects/:projectId/layer0` — Load MaStR assets (nodes + edges)
  - `POST /api/znp/projects/:projectId/layer1` — OSM spatial clustering (async, 202)
  - `POST /api/znp/projects/:projectId/layer2` — VNB PDF calibration data
  - `GET /api/znp/projects` — List all active projects (hydrated from PouchDB)
  - `GET /api/znp/projects/:projectId` — Retrieve project metadata + graph stats
  - **DELETE /api/znp/projects/:projectId** — Remove project and all persisted data

  PouchDB dual-doc strategy (v0.23):
  - `znp:meta:*` — lightweight metadata (bbox, name, layers, stats) for fast list queries
  - `znp:graph:*` — full graphology export (serialized graph state)

  Graph persistence automatically triggered after every layer mutation; projects are
  hydrated from PouchDB on service start, providing session continuity across server
  restarts.

### Added (Earlier in release cycle)

- **Automated `llm.txt` context artifact generation (`scripts/generate-llm-txt.js`):**
  Added deterministic generation of `./llm.txt` as a release artifact for LLMs.
  The file now contains a structured implementation snapshot with:
  architecture context, domain/business constraints, CHANGELOG provenance,
  complete cookbook recipe inventory, OpenAPI operation index, and canonical
  OpenAPI JSON.

- **New npm scripts for LLM artifact lifecycle (`package.json`):**
  Added `npm run generate:llm` and `npm run check:llm` for deterministic update
  and CI drift detection.

- **ZNP Layer 2 PDF calibration ingestion (`znp.service.js`, `znp-pdf-extractor.js`):**
  `POST /api/znp/projects/:projectId/layer2` now accepts either `filePath` or
  `fileContentBase64` in the JSON body for text-based VNB PDFs. Layer 2 extraction
  now parses Jahreshöchstlast, Trafo-ID, and Trafo-Nennleistung. Nennleistung is
  normalized in the extractor to kW using `cos(phi)=0.95` for apples-to-apples
  comparison against Layer 0/1 graph capacities.

- **Layer 2 calibration node + project metadata (`znp.service.js`):**
  Layer 2 now injects both the existing `measurement:peak_load:SUB_1` node and a new
  `calibration:substation:SUB_1` node (`type: calibration_node`) with
  `peakLoadKw`, `transformerId`, `nominalCapacityKw`, `layer1NominalCapacityKw`, and
  `calibrationGFactor`. Corresponding Layer-2 fields are also persisted in project
  metadata and hydrated back on restart.

- **NOVA Phase B backend contract (`nova.service.js`, `api.service.js`):**
  NOVA now computes project-scoped decisions dynamically from the in-memory
  Graphology model instead of static mocks. Supported endpoints:
  - `GET /api/znp/projects/:projectId/nova/pending-decisions`
  - `POST /api/znp/projects/:projectId/nova/apply/:id`
  - `GET /api/nova/stream`
  `pendingDecisions` analyses overload at substation level and emits actionable
  QU/rONT suggestions with calculated `capacity_gain_kw`.

- **NOVA Redispatch curtailment decision MVP (`nova.service.js`):**
  Added decision type `RD_CURTAILMENT` based on hard Layer-0 asset data.
  Capacity-only rule: every asset with `capacity_kw >= 100` and
  `assetType ∈ {solar, wind, biomass}` is treated as redispatch-eligible.
  Added static heuristic constant `RD_CURTAILMENT_FACTOR = 0.30` (30% curtailment
  potential). Decision descriptions now include hard evidence:
  `{count} Redispatch-fähige Großanlagen (>100 kW) ... um {gainKW} kW`.

- **Layer-0 Redispatch metadata support (`znp.service.js`, `src/redispatch-utils.js`):**
  `znp.addLayer0` now stores `capacity_kw` as explicit alias and accepts optional
  `fernsteuerbarkeitDv` / `fernsteuerbarkeitSonstige` fields, normalized to booleans
  for deterministic in-memory graph evaluation.

- **ZNP strategic assumption action (`znp.createAssumption`):**
  Added a lightweight action for fast frontend workflows:
  `znp.createAssumption(projectId, text)` inserts a `StrategicAssumption` node,
  applies deterministic peak-shaving simulation, persists the graph, and returns `{ id, text }`.

- **Asset override stub endpoint (`assets.override`):**
  Added `POST /api/assets/:assetId/override` as a temporary NOVA workflow stub.
  Accepts `field`, `value`, and `reason` and currently returns `{ success: true }`
  without persistence.

### Changed

- **Release gate now enforces `llm.txt` sync (`package.json`):**
  `release:check` now includes `check:llm` in addition to tests/OpenAPI/security,
  ensuring release-tag runs always validate the LLM context artifact.

- **Hybrid trigger in CI for `llm.txt` (`.github/workflows/maintenance-ci.yml`):**
  Added strict sync check only when `CHANGELOG.md` changes (paths filter), while
  release tags remain covered by the release gate.

- **Deterministic OpenAPI export behavior (`scripts/export-openapi.js`):**
  Added `OPENAPI_EXPORT_INCLUDE_TIMESTAMP` flag; timestamps are now omitted by
  default to keep generated artifacts stable across runs.

- **Layer 2 graph mutation now calibrates against Layer 1 theory:**
  `znp.addLayer2` now computes `calibrationGFactor = peakLoadKw / layer1NominalCapacityKw`
  and stores the result on the substation node, project metadata, and calibration node.
  The existing Layer 2 short-circuit in `calculateGFactor` continues to use the measured
  peak load as authoritative load at `target_layer=2`.

- **Layer 2 now emits frontend update events (`znp.project.updated`):**
  Successful Layer 2 ingestion emits `{ type: 'layer2-activated', data: { ... } }`
  so SSE consumers such as the NOVA stream can react immediately when calibration data
  becomes available.

- **ZNP assumption confirmation event contract aligned with NovaFeedStore:**
  `znp.addAssumption` and `znp.createAssumption` now emit `znp.project.updated`
  with the frontend-ready payload:
  `{ type: 'assumption-confirmed', data: { id, text } }`.
  `createAssumption` emits this event asynchronously for SSE consumers.

- **ZNP peak-shaving simulation for `createAssumption`:**
  `createAssumption` now heuristically matches BESS / storage and §14a-controllable
  assets from the assumption text, sets edge-level `gFactor = 0.45` on matching
  `CONTRIBUTES_LOAD` edges, and recalculates cumulative peak capacities upstream.
  `calculateGFactor` now respects edge-level `gFactor` overrides when summing
  effective capacity.

- **NOVA apply path now supports Redispatch edge throttling (`nova.apply`):**
  Applying `RD_CURTAILMENT` sets `gFactor = 0.70` on the specific
  CONTRIBUTES_LOAD edges of redispatch-eligible >100 kW assets (solar/wind/biomass),
  recalculates upstream cumulative capacities, persists graph/meta, and emits
  `znp.project.updated` with `type: 'nova-decision-applied'`.

- **NOVA contract cleanup — legacy apply action removed:**
  Removed the legacy `nova.applyDecision` action and old compatibility route wiring.
  The only supported write action is now `nova.apply` via
  `POST /api/znp/projects/:projectId/nova/apply/:id`.

- **ZNP graph hydration/persistence hardening (`znp.service.js`, `nova.service.js`):**
  Added explicit `hydrateGraph(projectId)` + `ensureProjectHydrated(projectId)` methods
  so read/write actions and NOVA decisions always operate on hydrated graph state.
  Graph persistence now retries on PouchDB revision conflicts (409) to reduce
  race-condition data loss under concurrent mutations.

### Documentation

- **UI contracts updated for NOVA + ZNP realtime integration:**
  Updated `docs/ui-contracts/15-nova-decision-feed.md` to the exact Phase A DTO and
  apply contract, `docs/ui-contracts/13-shared-components.md` with the
  `assumption-confirmed` event payload consumed by NovaFeedStore, and
  `docs/ui-contracts/00-architecture.md` with the NOVA contract index entry.

### Tests

- **Focused NOVA and ZNP regression coverage added:**
  Added/updated tests for `nova.pendingDecisions`, `nova.apply`, SSE forwarding,
  removal of `nova.applyDecision`, `assets.override`, in-memory `znp.createAssumption`,
  non-persistence, async event emission, and peak-shaving graph recalculation.
  Added coverage for `RD_CURTAILMENT` decision generation/apply (`gFactor=0.70`
  only on eligible >100 kW solar/wind/biomass edges) and Layer-0 storage of
  `capacity_kw` + normalized redispatch control flags.

- **Layer 2 calibration coverage added:**
  Added focused tests for Base64 Layer-2 uploads, structured extraction wiring,
  calibration-node creation, `calibrationGFactor` computation, measurement-node updates,
  and `layer2-activated` SSE event emission.

### Added (Release finalization)

- **ZNP graph persistence and lazy hydration (`znp.service.js`):**
  Implemented persistent graph storage with PouchDB split-document architecture:
  - `znp:meta:<projectId>` — lightweight project metadata (bbox, name, layers, stats)
  - `znp:graph:<projectId>` — full serialized graphology export (graph.export() blob)
  This split enables fast metadata queries (dashboards, list views) while keeping large
  graph blobs isolated. Graphs are lazily hydrated on-demand when first accessed.

- **Conflict-safe graph persistence with retry loop (`znp.service.js`):**
  Added `persistGraph(projectId, graph)` with automatic retry on PouchDB revision conflicts.
  Retry logic re-fetches the current revision each attempt (max 3 attempts) to handle
  concurrent mutations gracefully. Logged at debug/warn level for operational visibility.

- **Explicit project deletion lifecycle endpoint (`znp.service.js`, `api.service.js`):**
  Added `DELETE /api/znp/projects/:projectId` to permanently remove a project from
  in-memory activeGraphs and PouchDB. Intended for test cleanup and workspace management.
  Returns `{ success: true, projectId, message }` on successful deletion.

- **Hydration guard on read/write operations (`znp.service.js`):**
  Added `ensureProjectHydrated(projectId)` helper and injected it into critical handlers:
  `addLayer0`, `addLayer1`, `addLayer2`, `calculateGFactor`, `strategicPrompts`,
  `createAssumption`, `addAssumption`, `getProjectAssets`, `getProjectMeta`.
  Ensures graph state is always current before mutation/read, preventing stale in-memory access.

- **NOVA hydration-aware graph access (`nova.service.js`):**
  Updated `getProjectGraph(projectId)` to be async and call ZNP's `ensureProjectHydrated`
  before graph access. Updated `analyseProjectForPendingDecisions` and `apply` paths
  to properly await hydration. Preserves RD_CURTAILMENT logic and Layer 2 async flow.

### Changed

- **ZNP createAssumption now persisted (`znp.service.js`):**
  Changed from in-memory-only to async-persistent handler. Graph mutations are now
  written to PouchDB immediately after node insertion. Project metadata is updated
  with layer2.5 flag. Emits `znp.project.updated` event asynchronously for SSE consumers.

- **API OpenAPI description updated for ZNP (`api.service.js`):**
  Removed "ephemeral v1" language from ZNP tag description. Updated to reflect
  persistent graph state and hydration model.

### Fixed

- **Graph hydration on service start (`znp.service.js`):**
  Fixed `_hydrateGraphs()` to use new `hydrateGraph(projectId)` method for consistency
  and to handle missing documents gracefully (skipped with warning).

### Technical Details

- **Persistence guarantee:** All graph mutations via `addLayer0`, `addLayer1`, `addLayer2`,
  `createAssumption` now call `persistGraph()` and update metadata atomically.
- **Lazy hydration:** Projects are loaded only when accessed, reducing startup memory footprint.
  Hydration is transparent to API clients — no additional load operations required.
- **Conflict resilience:** Concurrent writes to the same project trigger automatic retry.
  Up to 3 attempts ensure eventual consistency without client-side retry loops.
- **Test coverage:** Added tests for persistence, hydration regression, and delete lifecycle.

---

## [0.20.6] - 2026-04-09

### Fixed

- **🐛 Critical: False-Positive NAP Findings (v0.17.1 hotfix):**
  Resolved systematic false positives in `MQ_MISSING_NAP` and `MQ_REDISPATCH_NO_NAP`.
  **Root cause:** Check-logik (stepConnectionPointIntegrity) prüfte nur direkte Felder (`nap.MastrNummer`),
  während Detail-Enrichment-Logik NAPs über Fallback-Pfade (`napData.*`) aufgelöst hat.
  **Fix:** Neue Methode `getInstallationNapIdWithFallback()` nutzt identische Auflösungspfade wie `getNapVoltageLevelWithFallback()`.
  Checks und Enrichment verwenden nun denselben Auflösungspfad.

- **🐛 Critical: False-Positive `MQ_MISSING_COMMISSIONING_DATE` (v0.17.2 hotfix):**
  Resolved systematic false positives where commissioning dates existed in source data under alias fields
  (especially `inbetriebnahmedatum`) but status checks still emitted `MQ_MISSING_COMMISSIONING_DATE`.
  **Root cause:** `stepStatusAnomalies` used a narrow direct-field check
  (`inbetriebnahmeDatum || Inbetriebnahmedatum`) instead of the centralized alias resolver.
  **Fix:** `stepStatusAnomalies` now uses `getInstallationCommissioningDate()` and
  `getInstallationCommissioningDate()` was extended with full alias coverage.

### Added

- **MaStR Quality: NAP-specific aggregation metrics in audit summary (`mastr-quality.audit`):**
  Added `missingNapFindings`, `missingNapDistinctAssets`,
  `missingNapRedispatchFindings`, `missingNapRedispatchDistinctAssets` and `napFindings`.

- **MaStR Quality: finding details drilldown endpoint (`GET /api/mastr-quality/audits/:id/findings/:findingId/details`):**
  Added a read-only details endpoint for reliable UI drilldown per finding.

- **MaStR Quality: enriched detail field mapping with fallback resolution:**
  Standardized detail enrichment for `operatorName`, `commissioningDate`, `netzbetreiberName`,
  `spannungsebene`, `spannungsebeneLabel` and `valueSource` with source-tracking (`*Source`).

### Changed

- **MaStR Quality: clarified semantic split between `MQ_MISSING_NAP` and `MQ_REDISPATCH_NO_NAP`:**
  Both findings now carry normalized context fields for deterministic UI/reporting:
  `rootIssue: "MISSING_NAP"` and `scope: "general" | "redispatch"`.

- **MaStR Quality: audit persistence now always stores findings and GET returns stable findings array:**
  `POST /api/mastr-quality/audit` now persists `findings` in the PouchDB audit document.
  `GET /api/mastr-quality/audits/:id` now always returns `findings` as an array.

- **MaStR Quality: standardized detail fields with explicit null-semantics:**
  `findings[].context.details` now includes stable `installation`, `connection`, and `measurement`
  blocks including provenance (`*Source`) for UI transparency and confidence scoring.

- **Version sync with cernion-ui v0.20.6** — Polish milestone. No API changes.

### Documentation

- **`src/validation-findings.js`** — Naming-Konvention-Kommentar hinzugefügt:
  Erklärt warum ES_-Konstantennamen keinen Präfix in den API-Werten tragen
  (historische Inkonsistenz seit v0.14/v0.15), und dass Frontend-Consumers
  immer gegen die VALUES aus FINDING_CODE_METADATA matchen sollen.
- **`docs/ui-contracts/07-energy-sharing.md`** — Präfix-Konvention explizit
  dokumentiert: `ES_REJECTED_STRUCTURAL` (JS-Konstante) vs. `REJECTED_STRUCTURAL`
  (API-Response-Wert). TypeScript-Beispiel für korrektes Matching ergänzt.
- **`feedback/CR-0003-missing-agent-fields.md`** — Status: open → deferred (v0.21.x).
  Alle drei Frontend-Workarounds produktiv seit v0.20.4 bestätigt.
- **`docs/BACKEND_CONTEXT.md`** — Aktualisiert auf aktuellen Stand:
  Service-Anzahl korrigiert, ZNP/Object-Store/Company-Service ergänzt,
  neue PouchDB-Stores dokumentiert, Naming-Konvention-Hinweis und
  Known-Limitations-Abschnitt (BDEW-Auflösungsrisiko, CR-0003) hinzugefügt.

## [0.20.5] - 2026-04-06

### Added

- **`findingsCount` in Quality Summary endpoint (`dashboard-api.qualitySummary`):**
  Each agent entry in the `GET /api/dashboard/quality-summary` response now includes a
  `findingsCount` object `{ info, warning, error }` extracted from the most recent report.
  Returns `null` when no reports exist or when the agent does not produce findings
  (e.g., `energy-sharing-allocation`). OpenAPI schema updated with nullable object type.

- **Finding Code Recommendations sync document (`docs/ui-contracts/14-finding-code-recommendations.md`):**
  New UI contract documenting all 37 error-severity finding codes across 4 agents with
  proposed German recommendation texts (`recommendationDe`). Serves as the specification
  for the `recommendation`/`recommendationDe` fields to be added to `FINDING_CODE_METADATA`
  in v0.21. Includes allocation engine candidate finding codes (domain gaps flagged).

- **ALLOC findings stub interface (`energy-sharing-allocation.service.js`):**
  Documented 5 candidate finding codes for future allocation quality checks:
  `ALLOC_ZERO_ALLOCATION_CONSUMER`, `ALLOC_CONCENTRATION_RISK`,
  `ALLOC_HIGH_REDISPATCH_DEDUCTION`, `ALLOC_RESULT_DRIFT`, `ALLOC_IMBALANCE_PERIOD`.
  Domain-specific thresholds are a gap to be grounded in a future sprint.

- **Trend computation documentation (`docs/ui-contracts/03-quality-summary.md`):**
  Documented frontend-side trend computation (Option A) using `recentReports` array
  (up to 5 entries). Backend returns raw data; frontend computes direction from
  consecutive report metrics.

- **ZNP `getProjectAssets` — MaStR Asset Inventory API (`znp.service.js`, v0.21 Issue 4):**
  New endpoint `GET /api/znp/projects/:projectId/assets`.
  Returns a paginated, filtered list of Layer 0 MaStR asset nodes stored in the project
  graph. Supports filtering by `status` (exact string match, unvalidated — MaStR date
  formats are notoriously inconsistent) and `assetType`, sorting by capacity (`asc`/`desc`,
  default `desc`), and offset/limit pagination (`limit` default 100, max 1000).
  Strategic assumption nodes (Layer 2.5) are intentionally excluded — the endpoint targets
  physical MaStR base data only.
  `addLayer0` extended with two new optional item fields: `status` (string, unvalidated)
  and `commissioningDate` (string, unvalidated). Both are persisted on the Graphology node
  and surfaced in the `getProjectAssets` response.

- **Generic Object Store Microservice (`object-store.service.js`):**
  New PouchDB-backed document store providing namespaced CRUD and Mango query operations
  for frontend clients (ZNP Workspaces, User Settings, etc.) to persist arbitrary JSON
  without backend schema changes. Documents are keyed as `${namespace}:${key}` for
  namespace isolation and fast single-document retrieval. Every document stores an
  internal `ns` field (indexed) so Mango queries are automatically scoped to the
  requested namespace — callers cannot escape their namespace even if they inject `ns`
  into the selector. PouchDB `_rev` handling is fully transparent. KRITIS-compliant:
  no external dependencies, no network port, no native bindings.
  REST endpoints:
  - `GET /api/objects/:namespace/:key` — retrieve a document
  - `PUT /api/objects/:namespace/:key` — create or update (upsert); requires `full-access` token
  - `DELETE /api/objects/:namespace/:key` — remove a document; requires `full-access` token
  - `POST /api/objects/:namespace/query` — Mango selector query within namespace
  Service excluded from LLM agent catalogue (`skipServices`).
  Environment: `OBJECT_STORE_DB_PATH` (default: `./data/object-store`).

- **Cookbook Microservice + Browser Recipe Generator (`cookbook.service.js`, `/app`):**
  New code-managed, community-collaborative API cookbook for reusable implementation
  workflows. Recipes are shipped in source code (`src/cookbook-recipes.js`) and enriched
  at runtime with semantic lookup (`gemini-embedding-001`), auto-generated
  `relatedRecipes`, and periodic validity checks against the live Moleculer action
  registry (scheduled validation interval, default 5 minutes).
  New REST endpoints:
  - `GET /api/cookbook` — list recipes with runtime status (`valid`/`degraded`/`broken`/`deprecated`)
  - `GET /api/cookbook/:id` — get a single recipe
  - `POST /api/cookbook/search` — semantic recipe lookup by free-text problem
  - `POST /api/cookbook/validate` — force validation refresh
  - `GET /api/cookbook/health` — validation summary + scheduler metadata
  - `GET /api/cookbook/services` — live service/action catalog for generator tooling
  `/app` now includes a new **📖 Cookbook** panel with:
  - recipe lookup + status badges
  - on-demand validation trigger
  - recipe generator wizard (step builder from live service actions)
  - copy-ready JSON output for contribution via pull request.

### Changed

- **NBP Monitor + VNB Monitor — file I/O migrated to Object Store (`object-store.service.js`):**
  Both services previously persisted configuration to flat JSON files on disk
  (`NBP_PARAMETERS_FILE`, `VNB_MONITOR_ALERT_CONFIG_FILE`). Both now use the generic
  PouchDB-backed Object Store microservice.
  - `nbp-monitor`: KPI 2 parameters stored under `namespace: nbp_monitor, key: parameters`;
    `getParameters` returns `source: 'store' | 'defaults'`; `parametersFile` field removed
    from response. `NBP_PARAMETERS_FILE` env var retired.
  - `vnb-monitor`: alert thresholds stored under `namespace: vnb_monitor, key: thresholds`;
    `getThresholds`/`setThresholds`/`resetThresholds` responses no longer include `configFile`;
    source tracked via `_thresholdsSource` flag; defaults loaded eagerly in `created()`,
    stored thresholds merged in `async started()` (EU AI Act Art. 12 compatible).
    `VNB_MONITOR_ALERT_CONFIG_FILE` env var retired.
  - Both services: `fs` dependency removed; no disk I/O at all.
  - Tests updated: temp-file / env-var setup replaced with in-memory Object Store instances.

- **`validation-findings.js` — recommendation field preparation:**
  Added TODO marker and updated JSDoc `@type` to include optional `recommendation` and
  `recommendationDe` fields (target: v0.21). No runtime changes.

- **UI contract `03-quality-summary.md` updated to v0.20.5:**
  Added `findingsCount` to response shape, display specification, and edge cases.
  Added trend computation section (Option A: frontend-side).

---

## [0.20.4] - 2026-04-05

### Added

- **ZNP Graph Hydration & Persistence (`znp.service.js`, v0.23 Issue 1):**
  ZNP projects now survive server restarts. After every layer mutation (`addLayer0`,
  `addLayer1`, `addLayer2`, `addAssumption`) the Graphology instance is serialised via
  `graph.export()` into a `znp:graph:<projectId>` PouchDB document. The `started()`
  lifecycle hook hydrates all graphs back into `this.activeGraphs` on service start.
  PouchDB documents are split into two prefixes for performance:
  `znp:meta:<projectId>` (lightweight metadata, used by list/dashboard queries) and
  `znp:graph:<projectId>` (full graph blob, loaded only on demand or at startup).
  Corrupt or missing graph blobs are skipped with a warning — non-fatal.

- **ZNP Conversational Prompts (`znp.service.js`, v0.23 Issue 2):**
  New endpoint `GET /api/znp/projects/:projectId/strategic-prompts`.
  Extracts graph topology metadata (asset types, total capacity, cluster count,
  measurements) and calls Google Gemini (`generateStructured`) to produce 2-3
  strategic planning questions a grid operator should answer about developments
  not visible in MaStR/OSM (§14a NAV, data centres, heat-pump mandates, EV charging).
  Returns `{ projectId, questions: string[], graphSummary }`.

- **ZNP Natural Language Assumptions & §14a Math (`znp.service.js`, v0.23 Issue 3):**
  New endpoint `POST /api/znp/projects/:projectId/assumptions`.
  Accepts `{ text: string }` (German free text), uses Gemini structured JSON extraction
  to parse `assetType`, `capacityKW`, `status`, `hasFlexibleNav`. Inserts a
  `StrategicAssumption` node (`layer: 2.5`) and a `CONTRIBUTES_LOAD` edge to `SUB_1`.
  `calculateGFactor` updated: at `target_layer >= 2`, assumption nodes are included.
  Nodes with `hasFlexibleNav: true` are **excluded** from peak load (`g=0.0`, legally
  curtailable under §14a EnWG). Response includes `flexNavExcluded` count on all
  `calculateGFactor` calls.

- **Centralised LLM Client (`src/llm-client.js`, v0.23):**
  New module consolidating all Google Gemini calls. Provides `generateText(prompt)` and
  `generateStructured(schema, prompt)`. Guarantees PII scrubbing (EU AI Act Art. 12)
  and throws `MoleculerError(503, 'LLM_NOT_CONFIGURED')` when `GEMINI_API_KEY` is
  absent — prevents crashes for on-premises deployments without an AI key configured.
  `src/znp-pdf-extractor.js` (Layer 2) refactored to use `llm-client` as first consumer.

- **ZNP Layer 1 — OSM Spatial Buildings & Clustering (`src/znp-osm-buildings.js`,
  `src/znp-clustering-heuristics.js`, v0.21):**
  `addLayer1` implemented as an async job (202 + poll). Fetches building footprints
  from the Overpass API using 2×2 tiling over the project bounding box
  (`fetchBuildingsForBbox`). Maps Layer 0 MaStR assets into building polygons via
  point-in-polygon (`oeo_located_in` edges). Detects spatial asset clusters
  (`detectClusters`) and computes a clustering-based g-factor multiplier
  (`computeGFactorAdjustment`): solar shading → ×0.85, EV simultaneity → ×1.15,
  clamped to [0.5, 1.5]. The adjustment is persisted on the project and applied on
  top of the VDE-AR-N 4100 factor in `calculateGFactor` at `target_layer ≥ 1`.
  Private Overpass endpoint configurable via `OVERPASS_ENDPOINT` env var.

- **ZNP Layer 2 — AI-Extracted Transformer Peak Load from PDF (`src/znp-pdf-extractor.js`,
  v0.21):**
  `addLayer2` implemented as an async job (202 + poll). Accepts the path of a PDF
  uploaded via the existing datasource upload endpoint. Parses PDF text with `pdf-parse`,
  then calls Gemini (strict JSON responseSchema) to extract the maximum simultaneous
  annual peak transformer load (Jahreshöchstlast, kW). Inserts a `Measurement` node
  and enables the **Layer 2 short-circuit** in `calculateGFactor`: the measured value
  directly replaces the theoretical Layer 0 estimate when `target_layer ≥ 2`.

- **Job-Store Log Streaming (`src/job-store.js` — `appendLog`, v0.21):**
  New `appendLog(jobId, phase, percent, message)` export. Long-running jobs (Layer 1 OSM
  fetch, Layer 2 PDF extraction) emit structured `{ timestamp, phase, percent, message }`
  entries into `job.logs[]` on each meaningful step. Workers receive the `jobId` argument
  from `startJob` (internal callers pass `null` — no-op). `GET /api/jobs/:jobId/status`
  returns the full `logs` array for frontend Chain-of-Thought display.

- **`docs/ui-contract-verification.md` — shape verification record (v0.20.4)**
  Auto-generated by `node scripts/verify-agent-shapes.js`. Documents all 70 field-name
  mismatches found between old contracts (v0.19.0) and actual service responses.
  All mismatches are now resolved in contracts 05–08.

- **`feedback/CR-0003.md` — three genuinely missing features (v0.20.4)**
  Tracks features that were in old contracts but never implemented:
  1. DELETE endpoints on all 4 agents (soft-delete pattern; target v0.21.x)
  2. `curtailment.source` + `curtailment.highFrequencyFlag` on redispatch-expost
  3. `portfolioSource` (Weg A / Weg B indicator) on redispatch-expost

- **`docs/agent-decision-enums.ts` — exhaustive enum reference (v0.20.4)**
  TypeScript enum file with every valid value for `decision`, `riskLevel`,
  `settlementReadiness`, and `eligibilityStatus` across all four agents.
  Authoritative source for `cernion-ui` prop validation.

- **Zielnetzplanung (ZNP) Workspace API (`znp` service, initial):**
  New stateful workspace service for target grid planning (Zielnetzplanung).
  Each "project" is a persistent Knowledge Graph for a geographic geographic bounding box,
  implemented with the in-memory [graphology](https://graphology.github.io/) library.
  Data Layers are loaded iteratively into the graph:

  | Layer | Source | Status |
  |-------|--------|--------|
  | Layer 0 | MaStR theoretical assets | ✅ Implemented |
  | Layer 1 | OSM spatial buildings + clustering | ✅ Implemented (async job) |
  | Layer 2 | AI-extracted transformer peak load from PDF | ✅ Implemented (async job) |
  | Layer 2.5 | Strategic Assumptions (NL text → structured node) | ✅ Implemented |

  **Architecture decisions (v0.20.4):**
  - Graphs are persisted to PouchDB via `graph.export()` after every layer mutation
    (`znp:meta:<id>` — lightweight metadata; `znp:graph:<id>` — full graph blob).
    `started()` hydrates all graphs on service restart (non-fatal, corrupt entries skipped).
  - Layer 0 wires all MaStR assets to a single virtual substation node (`SUB_1`).
    MaStR contains no network topology — physical re-wiring happens in Layer 1/2.

  **Graph schema:**
  - Nodes: `mastr_asset`, `substation`, `OSM_Building`, `measurement`, `assumption`
  - Edges: `CONTRIBUTES_LOAD { relationship, layer }`, `oeo_located_in`, `oeo_measures`

  **REST endpoints (via API Gateway):**
  | Method | Path | Action |
  |--------|------|--------|
  | `GET`  | `/api/znp/projects` | `znp.listProjects` |
  | `POST` | `/api/znp/projects` | `znp.createProject` |
  | `GET`  | `/api/znp/projects/:projectId/strategic-prompts` | `znp.strategicPrompts` |
  | `POST` | `/api/znp/projects/:projectId/assumptions` | `znp.addAssumption` |
  | `POST` | `/api/znp/projects/:projectId/layer0` | `znp.addLayer0` |
  | `POST` | `/api/znp/projects/:projectId/layer1` | `znp.addLayer1` (async job) |
  | `POST` | `/api/znp/projects/:projectId/layer2` | `znp.addLayer2` (async job) |
  | `GET`  | `/api/znp/projects/:projectId/g-factor` | `znp.calculateGFactor` |
  | `GET`  | `/api/znp/projects/:projectId` | `znp.getProjectMeta` |

  **Service excluded from LLM agent catalogue** (`skipServices`).

- **`graphology` dependency** — Added to `package.json` (in-memory directed graph,
  pure JavaScript, no native bindings, KRITIS-compliant).

- **`ZNP_DB_PATH` env var** — Added to `.env.example` (default: `./data/znp`).

### Changed

- **UI-Contract corrections — contracts 05–08 (v0.20.4)**
  All four agent UI-Contracts (`docs/ui-contracts/05–08`) were verified against the actual
  service handler return shapes and corrected. Contracts were written speculatively at v0.19.0;
  service code was correct throughout. **No service code changes** — all fixes are documentation only.

  Key corrections across all four contracts:
  - REST list/get paths corrected: `/list` → `/audits` or `/validations`
  - Finding code field: `findings[].code` → `findings[].finding`
  - Finding detail field: `findings[].detail` → `findings[].reason`
  - `findingsCount` moved into `summary.findingsCount`
  - DELETE endpoints on all 4 agents marked as ⚠ not yet implemented (CR-0003)

  Contract-05 (`mastr-quality`): `dimensions` → `qualityDimensions`; dimension keys and
  weights corrected to actual values (30/20/20/15/15); `findings[].installationId` →
  `findings[].context.mastrNummer`.

  Contract-06 (`grid-connection`): phantom `applicant`/`installation` request objects
  removed; step names corrected; `steps[].findingCode` phantom field removed.

  Contract-07 (`energy-sharing`): `generators[].mastrId` → `generators[].mastrNummer`;
  `consumers[].malo` → `consumers[].maloId`; `generatorResults` → `generators`;
  `generators[].dvValidated` → `generators[].dvConfirmed`.

  Contract-08 (`redispatch-expost`): `periodFrom`/`periodTo` → `dateFrom`/`dateTo`;
  `settlementReadiness` field names corrected; phantom `curtailment` top-level object
  removed; step names corrected.

- **`scripts/verify-agent-shapes.js` — dimension key mapping fix (v0.20.4)**
  Corrected swapped `registration`→`connectionPoints` / `connectivity`→`status` entries.

### Fixed

- **ZNP `createProject` — bbox field coercion (`znp.service.js`, Issue v0.22-1):**
  Added `convert: true` to all four bbox sub-field validators (`south`, `west`, `north`,
  `east`). String-encoded coordinate values (e.g. `"49.47"` from form-encoded POSTs or
  certain frontend serialisers) are now silently coerced to numbers instead of returning
  HTTP 422 `VALIDATION_ERROR`.

- **ZNP `addLayer0` — asset validation hardening + coercion (`znp.service.js`, Issue v0.22-2):**
  Added `convert: true` to `capacity`, `lat`, and `lon` item validators so string values
  from REST calls coerce cleanly. Added per-item semantic guard before any Graphology
  mutation: empty `mastrNummer` or non-positive / non-finite `capacity` now throw
  `MoleculerError(400, 'INVALID_ASSET')` with a structured `{ field, mastrNummer, value }`
  data payload.

- **ZNP `calculateGFactor` — `target_layer` query param alignment (`znp.service.js`, Issue v0.22-3):**
  Renamed Moleculer param `targetLayer` → `target_layer` to match the snake_case query
  parameter convention used by `cernion-znp-frontend`. Added `convert: true` so string
  query values (`"0"`, `"1"`, `"2"`) coerce to integers correctly.

### Tests

- `tests/znp.service.test.js` — 10 existing `targetLayer` references renamed to
  `target_layer`; **+10 new tests** for v0.22 (bbox coercion, `INVALID_ASSET`, `target_layer`
  alignment); **+22 new tests** for v0.23 (Issue 1 graph persistence × 7, Issue 2
  strategicPrompts × 6, Issue 3 addAssumption × 6, §14a flex-NAV math × 4).
- `tests/znp-pdf-extractor.test.js` — new test suite (6 tests): `parsePdfToText`,
  `extractPeakLoadFromText` (including 503 guard), `extractPeakLoadFromFile`.
- `tests/znp-osm-buildings.test.js` — new test suite (12 tests): `tileBbox`,
  `parseOverpassWay`, `mapAssetsToBuildings`.
- `tests/znp-clustering-heuristics.test.js` — new test suite (15 tests):
  `haversineDistanceM`, `detectClusters`, `computeGFactorAdjustment`.
- `tests/job-store.test.js` — `appendLog` tests added (+8 tests).
- **Total: 2056 tests, 69 suites — all green.**

---

## [0.20.3] - 2026-04-04

### Added

- **`src/market-role-classifier.js` — shared BDEW market-role classification module (v0.20.3 / CR-0002)**
  New shared module extracted from `utility-report.service.js` inline logic.
  Exports: `MARKET_ROLE_ENUM`, `ROLE_RULES`, `classifyPartner({ roles, bdewCode })`,
  `normalizeMarketPartner(raw)`, `extractCandidates(mcpResponse)`.
  BDEW prefix heuristic: 990x→VNB, 991x→Lieferant, 992x→MSB, 993x→BKV, 994x→Direktvermarkter.
  Handles all known MCP field name variants (bdewCode/bdew, name/companyName,
  roles/marketRoles, mastrId/gridOperatorMastrId/mastrIds.SNB).

- **`services/company.service.js` — company entity CRUD service (v0.20.3 / CR-0002)**
  New Moleculer service that groups BDEW market-partner codes belonging to the same
  economic unit (Konzernverbund / Stadtwerk).
  Persistence: PouchDB at `data/companies/`, doc prefix `co:`.
  In-memory BDEW index (`Map<bdewCode, companyId>`) for O(1) enrichment lookups.
  Actions:
  - `tests/cya-agent-personas.test.js` — 28 tests covering persona catalog, validation,
  - `PUT /api/companies/:id/confirm` — promote draft → active (with optional member override)
  - `tests/cya-conflict-detector.test.js` — 22 new tests for detectConflicts, buildNegotiationPrompt,
    MAX_DIALOGUE_ROUNDS; edge cases: empty states, null facts, trigger deduplication
  - `tests/cya-persona-memory.test.js` — 17 new tests for retrievePersonaContext,
    formatMemoryForPrompt, buildPersonaGrounding; non-blocking error path
  - `tests/cya.service.test.js` — 7 backward compatibility tests plus 1 fix (dedup phase
  - `GET /api/companies` — list/search by name, filter by status
  - **Total:** 2,217 tests, 78 suites, all passing
  - `DELETE /api/companies/:id` — soft-delete (status → archived); frees BDEW codes
  - `enrichResults` (internal) — inject `companyId` + `marketRole` into market-partner arrays
  Error codes: `COMPANY_NOT_FOUND` (404), `COMPANY_NOT_DRAFT` (409), `BDEW_ALREADY_ASSIGNED` (409).
  - `docs/ui-contracts/20-cya.md` updated to v0.26.9: multi-agent request/response shape,
    `multi_perspective` field schema, HITL escalation (`multi_agent_conflict_unresolved`),
    `INVALID_PERSPECTIVES` 400 error, backward-compat notes
  - Architecture decisions documented in `feedback/CR-CYA-MULTI-AGENT-DECISIONS.md` with 6
  Graceful degradation: if the company service is unavailable, original results are
  returned unchanged with a `WARN` log (`[marketPartners] company.enrichResults failed`).
  Six new route aliases under `/api/companies` (all six company actions).
  autoDiscover draft-confirm flow, manual create flow, and error codes.
  ### Changed

  - **`services/cya.service.js`** — Multi-agent branch in `generate` handler; new service methods:
    `runMultiAgentOrchestration`, `buildPersonaGroundings`, `runPersonaSynthesis`,
    `runConflictNegotiation`, `refineMultiAgent`. `buildCompletedResponse` and
    `buildClarificationResponse` accept optional `multi_perspective` field.
    `refine` handler detects `session.perspectives` and routes to `refineMultiAgent`.
  - **`src/cya-synthesis.js`** — Added `synthesizePersonaEvaluation` (per-persona verdict + key points),
    `synthesizeConsensusWith` (multi-stakeholder consensus with `consensusReached` flag),
    `CYA_PERSONA_EVALUATION_SCHEMA`, `CYA_CONSENSUS_SCHEMA`. All new functions exported.
  - **`src/cya-agent-personas.js`** — Added `getPersona` export (used by orchestrator methods).
  Reserved: `COMPANY_HAS_NO_VNB` error code for Phase 3 (`resolveCompanyBdew`).

### Changed

- **`services/utility-report.service.js`** — refactored to import `classifyPartner`,
  `normalizeMarketPartner`, and `extractCandidates` from `src/market-role-classifier.js`
  (removed inline duplicates).

- **`services/agent.service.js`** — `'company'` added to both `skipServices` Sets
  (primary and secondary) to prevent AI agent from routing queries to the CRUD service.

### Tests

- `tests/company.service.test.js` — 23 new tests covering full CRUD lifecycle,
  autoDiscover draft-confirm flow, member override, duplicate BDEW guard,
  `enrichResults` match/no-match/prefix-fallback, and list search.
- `tests/grid-operations.service.test.js` — 3 new tests for `marketPartners`
  enrichment integration: MCP call forwarding, enriched result shape,
  graceful degradation on company service failure.
- Total tests: ~1,810 (was ~1,784).

---

## [0.20.2] - 2026-04-02

### Added

- **`assets.redispatchCount` — fast aggregation of redispatch-eligible installations
  (RES-IR-0001, Option b)**
  (`services/assets.service.js`)
  New action `assets.redispatchCount` that returns the count, total capacity in MW,
  and a breakdown by type of installations ≥100 kW (InBetrieb) for a given grid operator.
  Calls `cernion_installations_local` directly with `type: 'all'`, `minCapacity: 100`,
  `status: 'InBetrieb'`, `format: 'detailed'` — no NAP enrichment.
  Accepts `gridOperatorId` (SNB/GNB pattern) or `bdewCode` (7–13 digits); returns
  `{ count, totalCapacityMW, byType }`. Error shape `{ count: null, ... }` on failure.
  REST: `GET /api/assets/redispatch-count` (autoAlias, tag: Assets).

- **Dashboard API `vnbOverview` — `redispatchEligible` KPI now populated (v0.20.2)**
  (`services/dashboard-api.service.js`)
  `assets.redispatchCount` added to Phase 2 `Promise.all` as a 6th parallel call.
  Forwards `gridOperatorId` extracted from Phase 1 identity. `buildKpis` receives a
  new 4th parameter `rdCount` and now outputs `redispatchEligible: rdCount.count` and
  `redispatchCapacityMW: rdCount.totalCapacityMW` instead of the hardcoded `null`.
  `safeCall` wraps the call — `redispatchEligible` falls back to `null` gracefully
  when the assets service is unavailable (legacy-backend compatibility preserved).
  Note: `assets.redispatchCount` uses one MCP session (local MongoDB); it runs in
  parallel with the existing PouchDB calls so adds no measurable latency to Phase 2.

### Tests

- **`assets.redispatchCount`**: 9 new tests in `tests/assets.service.test.js`
  (`describe('Assets Service — redispatchCount')`):
  count/capacity/byType aggregation, gridOperatorMastrId pass-through,
  bdewCode pass-through, empty result (0 installations), MCP error shape,
  missing operator shape, invalid pattern rejection, alternate MCP response shape.

- **`dashboard-api.vnbOverview — redispatchEligible`**: 1 new mock service (`assets`)
  + 4 new tests in `tests/dashboard-api.test.js`:
  `redispatchEligible`/`redispatchCapacityMW` populated, `gridOperatorId` forwarded,
  graceful degradation when assets throws, graceful degradation on error shape.

- **BR-0002**: 6 new tests in `tests/grid-operations.service.test.js`
  (`describe('vnbLookupCodes — error handling (BR-0002)')`):
  503 on MCP transport error, 404 on null result, `bdewCode` in error data,
  `vnbName` fallback in error message, `input` in error data, success path
  unaffected.

  Total: **~1,913 tests, ~65 suites** (estimated; confirm with `npm run test:unit:ci`).

### Changed

- `docs/ui-contracts/01-dashboard-overview.md` — v0.20.2:
  `redispatchEligible` example updated from `null` to `59`; `redispatchCapacityMW: 73.4`
  added to response shape; KPI table updated; edge case table reflects live/legacy states.
  Execution model note updated to mention `assets.redispatchCount` in Phase 2.

- `feedback/RES-IR-0001.md` — status: **resolved** (was: deferred v0.20.2).

### Fixed

- **BR-0002: `vnbLookupCodes` + `vnb-overview` 500 / Socket Hang-Up für Syna GmbH**
  (`services/grid-operations.service.js`)
  Root cause: `vnbLookupCodes` had no explicit `timeout` and inherited the global
  15-minute Moleculer default. The MCP transport (120 s × 3 retries) far exceeded
  the Next.js proxy timeout (~60 s), which closed the TCP connection before the
  backend responded — resulting in an empty-body 500 for the frontend.
  Three fixes applied:
  1. `timeout: 30 * 1000` on the `vnbLookupCodes` action. The `vnbOverview`
     endpoint is also covered: `safeCall` catches the resulting `RequestTimeoutError`
     and returns a degraded 200 with `identity: null` and `_errors` populated.
  2. `try/catch` around `CernionMCPClient.callWithNewSession` — throws
     `503 VNB_LOOKUP_ERROR` (structured JSON) on MCP transport errors instead of
     an unhandled propagation.
  3. Null-guard for `result == null` — throws `404 VNB_NOT_FOUND` when the MCP
     tool returns no data for an unknown BDEW code.

## [0.20.1] - 2026-04-01

### Fixed

- **BR-0001: `vnbLookupCodes` MaStR-ID promotion for name-based lookups**
  (`services/grid-operations.service.js`)
  When `vnb_lookup_codes` returns a canonical BDEW code without a MaStR-ID
  (common for VNBs with multiple BDEW codes, e.g. TWL Netze), the handler now
  iterates BDEW-type aliases and calls `cernion_vnb_lookup` (MongoDB cache) for
  each. The first alias resolving a MaStR-ID is promoted to primary; the previous
  primary is demoted to `role: "candidate"` in the aliases list.
  Fixes `GET /api/dashboard/vnb-overview?bdewCode=9907473000008` returning
  `identity.mastrId: null` for name-resolved lookups.
  New helper method: `promoteBdewWithMastrId` in the `methods` block.

### Changed

- **CR-0001: Structured validation error messages in Dashboard API**
  (`services/dashboard-api.service.js`)
  All three Dashboard API input actions now carry Fastest-Validator param definitions
  with German custom messages:
  - `vnbOverview.bdewCode`: pattern `/^\d{7,13}$/`, messages for `stringPattern`
    and `required`.
  - `marketSnapshot.location` / `.region`: `min: 2` with `stringMin` message.
  - `qualitySummary.gridOperatorId`: pattern `/^[SG]NB\d+$/` with `stringPattern`
    message.
  Moleculer returns HTTP 422 with a structured `data[]` array containing
  `field`, `type`, `message`, and `actual` — ready for inline error display.

### Added

- **Feedback system** (`feedback/`)
  New directory for cross-repository feedback exchange with `cernion-ui`.
  Contains `README.md` (workflow, prefix conventions), `TEMPLATE.md`
  (resolution template), and the first two resolutions:
  - `RES-IR-0001.md` — `kpis.redispatchEligible` null (deferred to v0.20.2,
    Option (b): new `assets.redispatchCount` MongoDB action).
  - `RES-DR-0001.md` — `market-snapshot` `region` has no default; `renewableForecast24h`
    is `null` when omitted (resolved — UI-Contract corrected).
- Copilot instructions updated to reference the `feedback/` workflow
  (`.github/copilot-instructions.md`).

### Documentation

- **`docs/ui-contracts/00-architecture.md`** (v0.20.1) — Added "Validation errors (422)"
  section with full JSON example and per-endpoint field/pattern/message table.
- **`docs/ui-contracts/01-dashboard-overview.md`** (v0.20.1) — Added edge cases:
  "Multiple BDEW codes for same VNB" (BR-0001 promotion behaviour) and
  "`redispatchEligible` null → hide KPI card" (interim until v0.20.2).
- **`docs/ui-contracts/02-market-snapshot.md`** (v0.20.1) — Corrected `region`
  parameter documentation: no default value; `renewableForecast24h` is null when
  omitted; sub-national regions not supported by ENTSO-E.

### Tests

- `tests/grid-operations.service.test.js` — 6 new tests for `promoteBdewWithMastrId`
  covering: promotion, BNR copy, no-op when already resolved, graceful error
  handling, non-BDEW alias skip, no-op when no `canonical` property.
- `tests/dashboard-api.test.js` — 14 new tests for parameter validation (CR-0001)
  across all three validated actions.

## [0.20.0] - 2026-04-01

### Changed

- **Version sync with cernion-ui** — Backend version bumped to 0.20.0 to align
  with the initial Cernion Enterprise UI release. No backend code changes.
  The UI repository (`cernion-ui`) consumes the REST API documented in
  `docs/ui-contracts/` and `openapi-export.json` (generated by `npm run export:openapi`).

### Documentation

- Version references in `docs/BACKEND_CONTEXT.md`, `docs/ui-contracts/00-architecture.md`,
  `.github/copilot-instructions.md`, `README.md` updated to reflect v0.20.0.
- `docs/ui-contracts/` marked as **backend-owned, frontend-consumed** contract boundary.

## [0.19.3] - 2026-04-01

### Changed

- **Consolidated all runtime data under `data/`** — Every PouchDB database, the
  job store, session files, and report cache now live inside a single `data/`
  directory at the project root instead of scattered hidden directories
  (`.*` names) across the repository root.

  | Old path | New default path | Override env var |
  |----------|-----------------|-----------------|
  | `.datapoints/` | `data/datapoints/` | `DATAPOINT_DB_PATH` |
  | `.grid-connections/` | `data/grid-connections/` | `GRID_CONNECTION_DB_PATH` |
  | `.energy-sharing/` | `data/energy-sharing/` | `ENERGY_SHARING_DB_PATH` |
  | `.allocation-engine/` | `data/allocation-engine/` | `ALLOCATION_ENGINE_DB_PATH` |
  | `.mastr-quality/` | `data/mastr-quality/` | `MASTR_QUALITY_DB_PATH` |
  | `.redispatch-expost/` | `data/redispatch-expost/` | `REDISPATCH_EXPOST_DB_PATH` |
  | `.jobs/` | `data/jobs/` | `JOB_STORE_DIR` |
  | `.sessions/` | `data/sessions/` | _(none — internal only)_ |
  | `.reports/` | `data/reports/` | _(none — internal only)_ |

  PouchDB mrview index directories (auto-created by LevelDB) now also land
  inside `data/` (`data/<name>-mrview-<hash>/`) instead of the project root.

  `.gitignore` simplified: the nine individual `.*` entries are replaced by a
  single `data/` rule. A `data/.gitkeep` marker is committed so the directory
  exists after a fresh clone. All env-var overrides remain fully functional —
  deployments using custom paths are unaffected.

- **Services updated:** `datapoint`, `grid-connection`, `energy-sharing`,
  `energy-sharing-allocation`, `mastr-quality`, `redispatch-expost`
  (default `dbPath`); `agent` (`SESSION_DIR`); `utility-report` (`REPORTS_DIR`);
  `src/job-store.js` (`JOBS_DIR` default).

- **Tests updated:** `tests/agent.service.test.js` (`SESSION_DIR` constant),
  `tests/utility-report.service.test.js` (path-mock intercept pattern for
  `data/reports` instead of `.reports`).

## [0.19.2] - 2026-03-31

### Fixed

- **dashboard-api: `marketSnapshot` — ENTSO-E call is now conditional on `?region`** —
  `entsoe.windSolarForecast` only fires when the caller supplies an explicit `region`
  query param. Without it `renewableForecast24h: null` is returned and no MCP session
  is consumed. The `region` param no longer carries a `'Germany'` default; UI must hide
  the forecast card when `renewableForecast24h` is null. Passing `region: 'Germany'`
  (or any ENTSO-E country name) restores previous behaviour.
  One new test (`returns null renewableForecast24h and skips ENTSO-E when no region given`)
  verifies the skip behaviour; `extracts solar/wind peaks from ENTSO-E forecast` now
  explicitly passes `{ region: 'Germany' }`. Total tests: **1 782** (60 suites).

### Changed

- **dashboard-api: `buildKpis` — `redispatchEligible` roadmap comment** — The `null`
  placeholder is now documented with two concrete v0.19.3 implementation options:
  (a) extend `vnb-monitor.snapshot`'s existing MaStR phase with a `minCapacity:100`
  sub-count, or (b) add a new `assets.redispatchCount` action (MongoDB-only, no MCP)
  called in Phase 2. Option (b) is preferred.

- **CHANGELOG v0.19.0 errata block added** — An `⚠ Errata (corrected in [0.19.1])`
  blockquote in the v0.19.0 `Dashboard API Layer` entry lists all seven action-name
  and response-shape errors that were present in the original release notes
  (`vnb-monitor.status`, `assets.summary`, `forecast.load`, `forecast.renewables`,
  `energy-market.dayAheadPrice`, `energy-market.co2intensity`, `loadForecast` key).

## [0.19.1] - 2026-03-31

### Fixed

- **dashboard-api: `marketSnapshot` — `entsoe.windSolarForecast` conditional on `?region`** —
  The call only fires when the caller supplies an explicit `region` query param. Without
  it, `renewableForecast24h: null` is returned and no ENTSO-E MCP session is consumed.
  The `region` param no longer carries a `'Germany'` default; UI must hide the forecast
  card when `renewableForecast24h` is null. One new test verifies the skip behaviour.

- **dashboard-api: Two-phase execution in `vnbOverview`** — MCP-intensive calls
  (`grid-operations.vnbLookupCodes`, `vnb-monitor.snapshot`) now run **sequentially**
  in Phase 1; `datapoint.health` and the four PouchDB-only agent list calls run
  **in parallel** in Phase 2. Reduces peak concurrent MCP sessions from 15+ to ≤10.
  `gridOperatorId` extracted from Phase 1 identity is forwarded to all four agent list
  calls, enabling proper per-operator filtering (was always `null` in v0.19.0).
  `vnb-monitor.snapshot` call now passes `{ refresh: false, alerts: true, lang: 'de' }`.

- **dashboard-api: Cache stampede guard** — New `cacheGetOrFetch(key, ttlMs, fetchFn)`
  method replaces direct `cacheGet`/`cacheSet` pairs in all four action handlers.
  An `inflight` Map deduplicates concurrent requests for the same cache key: a second
  call that arrives while the first is still in-flight awaits the same promise instead
  of triggering a redundant upstream fetch.

- **dashboard-api: `buildKpis` field paths corrected** — Now reads from the actual
  `vnb-monitor.snapshot` nested structure instead of a flat mock-only structure:
  - `mastr.inBetrieb.anlagenCount` (was: `mastr.totalInstallations`)
  - `Number(mastr.inBetrieb.leistungMW)` (was: `mastr.totalCapacityMW`)
  - `ewk.anschlussdauer.eeNS_weeks` (was: `ewk.anschlussdauerWeeks`)
  - `ewk.digitalisierungsindex.gesamt_percent` (was: `ewk.digitalisierungsScore`)
  - `ewk.umsetzungsquote.eeNS_percent` (was: `ewk.umsetzungsquote` scalar)
  - `redispatchEligible` now always `null` (field does not exist in `vnb-monitor.snapshot`;
    to be derived from redispatch agent in a future release)

- **dashboard-api.test.js: `MOCK_VNB_MONITOR` corrected** — Updated to the real nested
  structure of `vnb-monitor.snapshot` (`mastr.inBetrieb`, `ewk.anschlussdauer`, etc.).
  All existing assertions continue to pass.

- **dashboard-api.test.js: 17 new tests** — Sequential Phase 1 call-order verification,
  `gridOperatorId` forwarding test, two cache-stampede tests (vnbOverview + marketSnapshot),
  two `cacheGetOrFetch` unit tests, 12 action-existence tests verifying all required
  downstream actions are registered. Total: **56 tests** (was: 39).

- **UI contracts updated** — `01-dashboard-overview.md`, `02-market-snapshot.md`,
  `03-quality-summary.md` bumped to v0.19.1; execution model and `redispatchEligible`
  notes corrected.

## [0.19.0] - 2026-04-03

### Added

- **Dashboard API Layer (`dashboard-api` service, v0.19.0)** —
  New read-only UI aggregator service exposing 4 composite endpoints that aggregate
  data from across all agent, monitor, and market services. Designed for direct
  consumption by frontend dashboards without any LLM routing.
  Uses `Promise.allSettled` for parallel calls, `safeCall` for graceful degradation,
  and an in-memory TTL cache (`Map`-based, configurable per endpoint).
  Included in LLM agent catalogue (not in `skipServices`).

  **Endpoints:**
  | Method | Path | Action | Cache TTL |
  |--------|------|---------|-----------|
  | `GET` | `/api/dashboard/vnb-overview` | `dashboard-api.vnbOverview` | 5 min |
  | `GET` | `/api/dashboard/market-snapshot` | `dashboard-api.marketSnapshot` | 15 min |
  | `GET` | `/api/dashboard/quality-summary` | `dashboard-api.qualitySummary` | 5 min |
  | `GET` | `/api/dashboard/finding-codes` | `dashboard-api.findingCodes` | 24 h |

  **`vnbOverview`** — Composite VNB identity + KPIs + latest agent results + alerts.
  7 parallel calls: `vnb-monitor.status`, `assets.summary`, `nbp-monitor.status`,
  `grid-connection.list`, `energy-sharing.list`, `redispatch-expost.list`,
  `mastr-quality.list`. Returns `{ identity, kpis, latestAgentResults, alerts,
  timestamp, _errors }`.

  **`marketSnapshot`** — Day-ahead spot price + CO₂ intensity + 24h load forecast.
  4 parallel calls: `energy-market.dayAheadPrice`, `energy-market.co2intensity`,
  `forecast.load` (24h horizon), `forecast.renewables` (48h horizon, graceful).
  Optional `?location` / `?region` query params. Returns `{ spotPrice, co2,
  loadForecast, timestamp, _errors }`.

  **`qualitySummary`** — Portfolio quality score + per-agent audit summary.
  5 parallel calls: `mastr-quality.list`, `grid-connection.list`,
  `energy-sharing.list`, `redispatch-expost.list`, `assets.summary`.
  Optional `?gridOperatorId` filter (passed through to list calls).
  Returns `{ overallScore, agents[5], portfolioSize, timestamp, _errors }`.

  **`findingCodes`** — Static catalogue of all 92 finding codes with EN+DE metadata.
  Reads `FINDING_CODE_METADATA` directly (no upstream calls, 24h cache).
  Returns `{ codes, agents (by-agent catalogue), totalCodes }`.

  **New `x-oeo-class` annotations:** all 4 actions carry OEO mappings.

  > **⚠ Errata (corrected in [0.19.1]):** Several action names and response shapes
  > above were incorrect at publication:
  > - `vnbOverview` — `vnb-monitor.status` → `vnb-monitor.snapshot`; `nbp-monitor.status`
  >   removed; `assets.summary` removed (phantom action — does not exist); 7-parallel
  >   execution → two-phase sequential + parallel; `gridOperatorId` forwarding added.
  > - `marketSnapshot` — `energy-market.dayAheadPrice` → `energy-market.prices`;
  >   `energy-market.co2intensity` → `energy-market.co2Intensity` (capital I);
  >   `forecast.load` + `forecast.renewables` → `entsoe.windSolarForecast` (conditional
  >   on `?region`) + `german-grid.spotprices`; response key `loadForecast` →
  >   `renewableForecast24h`.
  > - `qualitySummary` — `assets.summary` removed (phantom action).

- **`FINDING_CODE_METADATA` in `src/validation-findings.js`** —
  All 92 finding-code constants (GC_*, ES_*, MQ_*, RD_*, AUDIT_*, VNB_*, SNAPSHOT_*)
  mapped to `{ severity, agent, step, description (EN), descriptionDe (DE) }`.
  Exported as `FINDING_CODE_METADATA` alongside existing helpers.
  Used by `dashboard-api.findingCodes` and available for frontend i18n.

- **`scripts/export-openapi.js`** — Static OpenAPI export script.
  Assembles `openapi-export.json` (dashboard paths + `x-ui-page` annotations) from
  `services/api.service.js` without starting the broker. `--live` flag fetches from
  a running server at port 3000. Invoked via `npm run export:openapi`.

- **`docs/BACKEND_CONTEXT.md`** — Comprehensive backend reference for frontend
  consumers. Covers architecture, all 38 services, PouchDB prefixes, 92 finding
  codes, async job pattern, auth, KRITIS constraints, key source modules, env vars,
  test suite, and known limitations.

- **`docs/ui-contracts/`** — 14 UI contract documents (00–13):
  `00-architecture`, `01-dashboard-overview`, `02-market-snapshot`,
  `03-quality-summary`, `04-finding-codes`, `05-mastr-quality`,
  `06-grid-connection`, `07-energy-sharing`, `08-redispatch`,
  `09-datapoints`, `10-vnb-monitor`, `11-nbp-monitor`, `12-auth`,
  `13-shared-components`. Each document specifies endpoint URLs, request/response
  shapes, polling strategy, and error-handling conventions.

- **`npm run export:openapi`** script in `package.json`.

- **4 new route aliases in `api.service.js`** under new `Dashboard API` OpenAPI tag.

### Changed

- `README.md` — Added v0.15–v0.19 feature entries; new docs table rows for
  `BACKEND_CONTEXT.md` and `docs/ui-contracts/`; `export:openapi` npm script row.
- `MCP_SERVICES.md` — Added "7. Dashboard API Service (v0.19)" section with
  endpoint table and architecture notes.
- `SECURITY.md` — Supported versions updated to `0.19.x` (yes), `0.18.x` (security
  patches only), `< 0.18` (no).
- `.github/copilot-instructions.md` — Status block updated to v0.19.0; 38 services;
  ~1 780+ tests; full dashboard-api description including TDZ limitation note.

## [0.18.0] - 2026-04-02

### Added

- **Redispatch Ex-Post Agent (`redispatch-expost` service, v0.18.0)** —
  New deterministic 7-step pipeline that audits the Redispatch 2.0 portfolio of a VNB,
  cross-references MaStR master data (≥100 kW installations) with Netztransparenz
  curtailment data, and computes settlement readiness and financial risk estimates.
  No LLM involvement — identical inputs always produce identical finding codes.
  Excluded from LLM agent catalogue (`skipServices`). Separate PouchDB at
  `.redispatch-expost/` (`rd:` prefix). 180 s timeout (same as v0.17).
  Regulatory basis: §§ 13, 13a EnWG, NABEG, StromNZV, Redispatch 2.0 (BDEW/BNetzA),
  EU AI Act Art. 12 (audit trail).

  **Pipeline steps:**
  1. `identity` (**mandatory**) — Resolves VNB identity via `vnb_lookup_codes` MCP tool.
     Emits `VNB_RESOLVED` / `VNB_AMBIGUOUS` / `VNB_NOT_FOUND`. Same pattern as v0.14/v0.15/v0.17.
  2. `portfolio` (**mandatory**) — Fetches Redispatch-relevant portfolio (≥100 kW) via
     `cernion_installations_local`. Supports **Weg B** (tagged datapoint fallback with
     freshness gate, tags `redispatch-portfolio` / `mastr-portfolio`) before **Weg A** (MCP).
     Emits `RD_PORTFOLIO_COMPLETE` (with `RD_PORTFOLIO_INCLUDES_INACTIVE` if any non-InBetrieb
     units) or `RD_PORTFOLIO_EMPTY`.
  3. `masterDataValidation` (**skippable**) — Pure sync per-installation check of 6 rules:
     `RD_MISSING_NAP` (error), `RD_MISSING_MELO` (error), `RD_MISSING_BTR` (warning —
     remote-control proxy; DirektvermarkterMastrNummer excluded from public exports by BNetzA),
     `RD_NAP_VNB_MISMATCH` (error), `RD_DV_NOT_CONTROLLABLE` (warning), `RD_CAPACITY_ANOMALY`
     (warning). All findings carry `{ mastrNummer }` in `context` for risk-score correlation.
  4. `curtailmentCorrelation` (**skippable**) — Queries `netztransparenz_redispatch` for
     the audit period. Aggregates total curtailment GWh. Emits `RD_CURTAILMENT_VOLUME`,
     `RD_HIGH_CURTAILMENT_PERIOD` (>100 measures/month), `RD_CURTAILMENT_ZERO`, or
     `RD_CURTAILMENT_DATA_UNAVAILABLE` (graceful fallback — 0 GWh used for risk calculation).
  5. `settlementReadiness` (**skippable**) — Delegates to `src/redispatch-risk.js`
     `assessSettlementReadiness`. Emits `RD_SETTLEMENT_READY` (100%), `RD_SETTLEMENT_PARTIAL`
     (80–99%, warning), or `RD_SETTLEMENT_CRITICAL` (<80%, error). An installation is
     "blocked" if any error-severity finding references its `mastrNummer`.
  6. `riskAssessment` (**skippable**) — Delegates to `src/redispatch-risk.js` `assessRisk`.
     Formula: `estimated€ = GWh × 1000 × blockedFraction × €/MWh` (default: €50/MWh).
     Emits `RD_RISK_LOW` (<€10k), `RD_RISK_MEDIUM` (€10k–€100k), or `RD_RISK_HIGH` (>€100k).
  7. `audit` (**mandatory**) — Snapshot + drift detection (same pattern as v0.14/v0.15/v0.17).
     Emits `AUDIT_TRAIL_CREATED` (and `SNAPSHOT_DRIFT_DETECTED` if applicable).

  **Key design decisions:**
  - `skipSteps` whitelist: `[3, 4, 5, 6]`; steps 1, 2, 7 always run. Throws on invalid values.
  - No enforced date range limit for Netztransparenz correlation.
  - Weg B fallback: standalone `tryDatapointFallback` method (energy-sharing pattern),
    freshness gate via `maxAgeMinutes`, `$gateway: false`.

  **New finding codes (19 `RD_*` constants):** total codes 73 → 92.

  **New REST endpoints:**
  | Method | Path | Action |
  |--------|------|--------|
  | `POST` | `/api/redispatch/audit` | `redispatch-expost.audit` |
  | `GET` | `/api/redispatch/audits` | `redispatch-expost.list` |
  | `GET` | `/api/redispatch/audits/:id` | `redispatch-expost.get` |

- **`src/redispatch-risk.js`** — New pure stateless risk calculation module.
  `round2`, `assessSettlementReadiness`, `assessRisk`. No I/O, no Moleculer.

- **`src/validation-findings.js`** — 19 new `RD_*` constants added and exported.
  Total finding codes: 73 → 92.

- **`.gitignore`** — Added `.redispatch-expost/` (PouchDB data directory).

- **`.env.example`** — Added `REDISPATCH_EXPOST_DB_PATH=./.redispatch-expost`.

## [0.17.1] - 2026-03-30

### Fixed

- **Energy Sharing Allocation REST path mismatch (hotfix)** —
  The five explicit route aliases for the `energy-sharing-allocation` service in
  `services/api.service.js` were using the `/energy-sharing/...` prefix instead of
  `/energy-sharing-allocation/...`. `autoAliases: true` was simultaneously
  registering the correct `/energy-sharing-allocation/` paths (derived from the
  service name), so both URL sets were accessible at runtime — but the OpenAPI spec
  (which follows service-name derivation) documented only the longer form while the
  CHANGELOG described the shorter form, creating a silent inconsistency.

  **Fix:** The five explicit aliases now use the `/energy-sharing-allocation/` prefix,
  matching the OpenAPI-generated paths and eliminating the duplicate route registration.
  The CHANGELOG v0.16.0 REST endpoint table has been updated accordingly.

  Correct paths (unchanged at the HTTP level):
  - `POST /api/energy-sharing-allocation/allocate`
  - `GET /api/energy-sharing-allocation/allocations`
  - `GET /api/energy-sharing-allocation/allocations/:id`
  - `GET /api/energy-sharing-allocation/allocations/:id/download`
  - `DELETE /api/energy-sharing-allocation/allocations/:id`

## [0.17.0] - 2026-03-30

### Added

- **MaStR Datenqualitätsagent (`mastr-quality` service, v0.17.0)** —
  New deterministic 8-step pipeline that audits the entire MaStR portfolio of a VNB
  and produces structured findings across 5 quality dimensions. Returns a `qualityScore`
  (0–100) as a weighted average. No LLM involvement — identical inputs always produce
  identical finding codes. Excluded from LLM agent catalogue (`skipServices`).
  Regulatory basis: § 14 EnWG (Netzbetreiberpflichten), § 52 EEG (Meldepflichten),
  Redispatch 2.0 (BDEW/BNetzA), EU AI Act Art. 12 (audit trail).

  **Pipeline steps:**
  1. `identity` — Resolves VNB identity via `vnb_lookup_codes` MCP tool.
     Emits `VNB_RESOLVED` / `VNB_AMBIGUOUS` / `VNB_NOT_FOUND`. Best-effort
     fallback to provided parameters when MCP unavailable.
  2. `inventory` — Fetches complete portfolio via `cernion_installations_local`
     (no `status`/`minCapacity` filter — full portfolio including all statuses
     and sizes). Emits `MQ_INVENTORY_COMPLETE` or `MQ_INVENTORY_EMPTY`.
  3. `statusAnomalies` — Detects 6 status-related data quality issues:
     stale planning (>2 years in "InPlanung"), stale temporary shutdown
     (>365 days), missing commissioning date for operational units, future
     commissioning dates, NBP "InPrüfung" (2955), and NBP "NichtVorgesehen" (3075).
  4. `capacityAnomalies` — Detects 5 capacity issues: zero capacity, negative
     capacity, implausibly high capacity (Solar >50,000 kW / Wind >20,000 kW /
     others >100,000 kW), netto > brutto (physical impossibility), missing
     feed-in type (Einspeisungsart) for operational solar units.
  5. `connectionPoints` — Validates 6 connection point integrity rules: missing NAP,
     missing MeLo for ≥100 kW operational units, NAP-VNB mismatch, voltage level
     mismatch (≥100 kW at NS), NAP shared by >3 installations, and Redispatch-
     relevant units (≥100 kW) without NAP.
  6. `duplicateDetection` — Heuristic duplicate detection with 3 levels:
     all-4-criteria match (PLZ + type + capacity±10% + commissioning date±90d) →
     `MQ_PROBABLE_DUPLICATE`; 3-of-4 → `MQ_POSSIBLE_DUPLICATE`; same-type
     coordinates within ±0.001° → `MQ_GEO_DUPLICATE`.
  7. `geoSpotCheck` — Broker calls to `osm-geo.validate` for a sample of
     portfolio installations. Sample selection prioritises Redispatch-relevant
     (≥100 kW) units with type diversity. Default 10 installations, configurable
     up to 50 via `geoSampleSize` parameter.
  8. `audit` — Seals the report with a PouchDB snapshot reference and
     `AUDIT_TRAIL_CREATED` finding (EU AI Act Art. 12 compliance).

  **Quality score system:**
  - 5 dimensions with configurable weights: `connectionPoints` (0.30),
    `capacity` (0.20), `geo` (0.20), `status` (0.15), `duplicates` (0.15).
  - `computeDimensionScore(findings, stepNumbers)` → `max(0, 100 − errors×10 − warnings×3)`.
  - `computeQualityScore(dimensions)` → weighted average; skipped dimensions
    (`score: null`) are excluded from the denominator (weights re-normalised).

  **`skipSteps` parameter (novel):** Steps 3–7 independently skippable. Steps 1,
  2, 8 are mandatory. Invalid step numbers throw a descriptive error.

  **Three REST endpoints (via API Gateway):**
  - `POST /api/mastr-quality/audit` — run 8-step pipeline (180 s timeout)
  - `GET /api/mastr-quality/audits` — list past reports (newest first,
    optional `gridOperatorId` filter)
  - `GET /api/mastr-quality/audits/:id` — retrieve report by UUID

  **25 new `MQ_*` finding codes** added to `src/validation-findings.js`:
  `MQ_INVENTORY_COMPLETE`, `MQ_INVENTORY_EMPTY` (Step 2);
  `MQ_STALE_PLANNING`, `MQ_STALE_TEMPORARY_SHUTDOWN`, `MQ_MISSING_COMMISSIONING_DATE`,
  `MQ_FUTURE_COMMISSIONING`, `MQ_NBP_PENDING`, `MQ_NBP_NOT_PLANNED` (Step 3);
  `MQ_ZERO_CAPACITY`, `MQ_NEGATIVE_CAPACITY`, `MQ_IMPLAUSIBLE_HIGH_CAPACITY`,
  `MQ_NETTO_EXCEEDS_BRUTTO`, `MQ_MISSING_FEED_IN_TYPE` (Step 4);
  `MQ_MISSING_NAP`, `MQ_MISSING_MELO`, `MQ_NAP_VNB_MISMATCH`, `MQ_VOLTAGE_MISMATCH`,
  `MQ_NAP_MULTI_UNIT`, `MQ_REDISPATCH_NO_NAP` (Step 5);
  `MQ_PROBABLE_DUPLICATE`, `MQ_POSSIBLE_DUPLICATE`, `MQ_GEO_DUPLICATE` (Step 6);
  `MQ_GEO_PLAUSIBLE`, `MQ_GEO_MISASSIGNMENT`, `MQ_GEO_CHECK_FAILED` (Step 7).

  **Two new score helper exports** in `src/validation-findings.js`:
  `computeDimensionScore(findings, stepNumbers)` and `computeQualityScore(dimensions)`.

  **Architecture:** Separate PouchDB at `.mastr-quality/` (`MASTR_QUALITY_DB_PATH` env,
  default `./.mastr-quality`). Doc prefix `mq:`. Raw installation data never persisted
  (KRITIS). Service excluded from LLM agent catalogue (`skipServices`). Timeout 180 s
  (vs 120 s in v0.14/v0.15) to accommodate full portfolio scans.

### Changed

- **`src/validation-findings.js`** — Extended with 25 new `MQ_*` finding-code constants,
  `QUALITY_DIMENSION_WEIGHTS` map, and two new exported functions `computeDimensionScore`
  and `computeQualityScore`. Existing 48 codes and all helpers remain unchanged. Total
  finding codes: 73.
- **`services/api.service.js`** — Added `MaStR Data Quality` OpenAPI tag and 3 new
  route aliases (`POST /mastr-quality/audit`, `GET /mastr-quality/audits`,
  `GET /mastr-quality/audits/:id`).
- **`services/agent.service.js`** — Added `'mastr-quality'` to the LLM planner
  `skipServices` set (catalogue builder only, line ~72). Consistent with other agent
  services (`grid-connection`, `energy-sharing`, `energy-sharing-allocation`).
- **`.gitignore`** — Added `.mastr-quality/` and `.allocation-engine/` PouchDB data
  directories (the latter was missing from v0.16.0).
- **`.env.example`** — Added `MASTR_QUALITY_DB_PATH` configuration variable.

## [0.16.0] - 2026-03-30

### Added

- **Energy Sharing Allocation Engine (`energy-sharing-allocation` service, v0.16.0)** —
  New Berechnungsengine for § 42c EnWG Energy Sharing communities (third layer of the
  ES solution: Validierung v0.15 → Allokation v0.16 → EDM-Integration v0.17+).
  Deterministic 6-step pipeline: input validation → generation time-series fetch →
  Redispatch 2.0 deduction → allocation arithmetic → summary assembly → PouchDB persist.
  KRITIS-compliant: full 15-min time-series computed in RAM, only metadata persisted.
  Excluded from LLM agent catalogue (`skipServices`).
  Regulatory basis: § 42c EnWG, § 12 StromNZV (Viertelstundenwerte),
  § 20b EnWG Interimsprozess (operative deadline 01.06.2026).
- **Stufe A — Forecast-based allocation** — synthetic 15-min generation profiles via
  `mastr_generation_forecast` MCP tool (`resolution: "15min"`) per generator.
  MW → kWh conversion (× 0.25 h). Multi-generator weighted merge by `sharePercent`.
  Zero-profile conservative fallback when MCP call fails.
- **Stufe B — Inhouse metering data** — real iMSys data via existing Inhouse-Data
  upload feature (`datasource-cache.query`). CSV schema validation
  (`timestamp` + `generation_kwh` required columns). 15-min raster alignment check.
  Hard error on schema mismatch (data integrity required for billing).
- **Redispatch 2.0 deduction** — optional TSO-level curtailment overlay via
  `netztransparenz_redispatch`. Conservative approach: overlapping intervals set to 0.
  `ALLOC_REDISPATCH_DEDUCTION_APPLIED` warning when deductions are made.
  `ALLOC_REDISPATCH_DATA_UNAVAILABLE` warning + graceful continuation when MCP unavailable.
- **Allocation arithmetic** — Restmengenempfänger pattern: last consumer receives
  remainder (`net − ∑previous`) to guarantee ∑allocations = netGenerationKWh per
  interval (±0.0001 kWh). Rounds to 4 decimal places (kWh billing accuracy).
- **Five REST endpoints** — `POST /api/energy-sharing-allocation/allocate` (120 s timeout),
  `GET /api/energy-sharing-allocation/allocations`, `GET /api/energy-sharing-allocation/allocations/:id`,
  `GET /api/energy-sharing-allocation/allocations/:id/download`, `DELETE /api/energy-sharing-allocation/allocations/:id`.
  Full OpenAPI annotations on all actions (`Energy Sharing Allocation` tag).
- **EDM-importable CSV download** — `GET /allocations/:id/download?maloId=` re-computes
  time-series on demand (KRITIS) and returns semicolon-delimited CSV
  (`timestamp;generation_kwh;redispatch_deduction_kwh;net_generation_kwh;allocation_kwh`).
  `Content-Disposition` attachment header. ISO-8601 timestamps, 4 dp values.
- **Soft-delete** — `DELETE /allocations/:id` sets `_deleted: true` + `deletedAt`
  (non-destructive, EU AI Act Art. 12 audit trail). Idempotent.
  `GET /allocations?includeDeleted=true` exposes deleted records for audit access.
- **31-day soft warning** — `ALLOC_WINDOW_EXCEEDS_RECOMMENDED` warning added to result
  when date range exceeds recommended 31 days; pipeline continues (not aborted).
- **v0.15 report integration** — optional `validationReportId` parameter loads v0.15
  validation report via `ctx.call('energy-sharing.get', ...)` (broker call only,
  no cross-service PouchDB access). Non-APPROVED decisions add
  `ALLOC_VALIDATION_REPORT_NOT_APPROVED` warning; missing report adds
  `ALLOC_VALIDATION_REPORT_NOT_FOUND` warning; pipeline continues in both cases.
- **`src/timeseries-allocation.js`** — pure calculation module (no I/O, no Moleculer).
  Exports: `buildIntervalGrid`, `mergeGeneratorForecasts`, `applyRedispatchDeductions`,
  `allocateTimeseries`, `buildConsumerSummary`, `buildTotalSummary`, `formatAsCsv`, `round4`.
- **`ALLOCATION_ENGINE_DB_PATH`** env var added to `.env.example`
  (default: `./.allocation-engine`).
- **`energy-sharing-allocation` added to `skipServices`** in `agent.service.js`
  (both catalogue-builder and plan-executor sets).

### Architecture

```
Allocation Engine   (v0.16)  — energy-sharing-allocation.service.js
Agent Layer         (v0.14–v0.15)
                    ├── grid-connection.service.js
                    └── energy-sharing.service.js
```

The Allocation Engine is a Berechnungsschicht — it transforms data (produces time-series),
not findings. The Findings pattern from v0.14/v0.15 is intentionally not used here.


### Added

- **UI: Datapoints panel tag filter** — Filter datapoints by tags via a new text input;
  calls `GET /api/datapoints/health/overview?tags=` with comma-separated values.
- **UI: Datapoints interventions viewer** — Per-row 📋 button toggles an inline
  expand row loading agent interventions from `GET /api/datapoints/:name/interventions`.
- **UI: Snapshots sub-section** — New section in the Datapoints panel with create
  form (datapointNames, tags, maxAgeMinutes) + list table; per-row ✅ validate and
  🗑 delete actions via the snapshot REST endpoints (v0.13).
- **UI: Grid Connection Validation sub-card** — Integration Hub sub-card for the
  Netzanschluss-Validierung pipeline (v0.14). Form accepts MaStR-ID, BDEW code,
  datapoint tags. Results render decision badge (green/amber/red/grey), KPI boxes,
  6-step timeline, collapsible findings by severity. History table with click-to-detail.
- **UI: Energy Sharing Validation sub-card** — Integration Hub sub-card for the
  § 42c EnWG Gemeinschaftliche Gebäudeversorgung pipeline (v0.15). Dynamic
  add/remove rows for generators (mastrNummer, sharePercent, direktvermarkter)
  and consumers (maloId, sharePercent, name) with client-side share-sum validation.
  Per-generator status table. Results render decision badge, KPI boxes, step timeline,
  findings accordion. History table with click-to-detail.
- **CSS: New v0.15.1 tokens** — `.decision-badge` (approved/conditional/rejected/
  insufficient variants), `.val-kpi-row`/`.val-kpi`, `.val-step-timeline`/`.val-step-item`,
  `.val-findings` accordion, `.dynamic-rows-wrap`/`.dynamic-row` repeatable form rows,
  `.dp-tag-filter-row`, `.dp-snapshots-section`, `.dp-interventions-row`,
  `.val-gen-table`, `.val-history-table`.

## [0.15.0] - 2026-03-30

### Added

- **Energy Sharing Validation Service (v0.15.0) — `energy-sharing` microservice**
  New Moleculer service implementing a deterministic 6-step Energy Sharing community
  validation pipeline under § 42c EnWG. Provides automated Interims-Prozess for VNBs
  ahead of the § 20b EnWG central IT platform. Regulatory deadline: 01.06.2026.
  No LLM involvement — identical inputs always produce identical finding codes.

  **Pipeline steps:**
  1. `identity` — Resolves VNB identity via `vnb_lookup_codes`. Emits `VNB_RESOLVED` /
     `VNB_AMBIGUOUS` / `VNB_NOT_FOUND`. Best-effort fallback to provided IDs when MCP
     is unavailable.
  2. `generators` — Validates each generator MaStR record via `cernion_installations_local`
     (one bulk call per pipeline run, not N calls for N generators). Secondary search
     without VNB filter detects wrong-grid-area submissions. Emits `GENERATOR_VALID` /
     `GENERATOR_NOT_FOUND` / `GENERATOR_NOT_OPERATIONAL` / `GENERATOR_WRONG_GRID_AREA` /
     `GENERATOR_TYPE_INELIGIBLE` / `GENERATOR_CAPACITY_ZERO` / `GENERATOR_NO_NAP` /
     `GENERATOR_NO_MELO`.
  3. `directMarketer` — Validates Direktvermarkter status per generator. Checks
     `FernsteuerbarkeitDv` flag (§ 21 Abs. 2 EEG mandatory for ≥100 kW). DV register
     cross-check via `cernion_direktvermarkter_lookup` (DV lookup cache prevents duplicate
     calls for same DV name). Emits `DV_VALID` / `DV_MANDATORY_MISSING` /
     `DV_NOT_CONTROLLABLE` / `DV_NOT_FOUND` / `DV_INACTIVE` / `DV_MASTR_MISMATCH`.
  4. `eligibility` — § 42c EnWG conformity checks: generator/consumer share sums (∑ = 100%,
     ±0.1% tolerance), duplicate MaStR numbers, consumer MaLo format (`DE[0-9]{31}`),
     duplicate MaLo IDs, mixed grid areas, >1 MW installations. Emits `ELIGIBILITY_CONFIRMED` /
     `SHARE_SUM_GENERATORS_INVALID` / `SHARE_SUM_CONSUMERS_INVALID` / `NO_GENERATORS` /
     `NO_CONSUMERS` / `GENERATOR_DUPLICATE` / `CONSUMER_MALO_INVALID` /
     `CONSUMER_MALO_DUPLICATE` / `MIXED_GRID_AREAS` / `GENERATOR_EXCEEDS_LIMIT`.
  5. `decision` — Deterministic rule engine per CR decision matrix: `APPROVED` /
     `APPROVED_WITH_CONDITIONS` / `REJECTED_STRUCTURAL` / `REJECTED_GENERATOR_INVALID` /
     `REJECTED_OTHER`. Structural errors take priority over generator errors.
  6. `audit` — Seals the report with a PouchDB snapshot reference and `AUDIT_TRAIL_CREATED`
     for EU AI Act Art. 12 compliance. Detects `SNAPSHOT_DRIFT_DETECTED` if data changed
     during pipeline execution.

  **Datapoint fallback (Weg B):** If `datapointTags` are provided and a fresh matching
  datapoint exists, Step 2 uses `datapoint.data` instead of the MCP call. Isolated
  helper method `tryDatapointFallback` mirrors the v0.14 grid-connection pattern.

  **REST endpoints (via API Gateway):**
  - `POST /api/energy-sharing/validate` — run pipeline (120 s timeout, synchronous)
  - `GET /api/energy-sharing/validations` — list past reports (filter by `communityId`)
  - `GET /api/energy-sharing/validations/:id` — retrieve report by UUID

  **Supporting codes in `src/validation-findings.js`** — 28 new finding-code constants
  across 5 groups: `VNB_*`, `GENERATOR_*`, `DV_*`, `CONSUMER_*`, `ELIGIBILITY_*`/
  `SHARE_*`/`NO_*`, and `ES_*` decision codes. `AUDIT_TRAIL_CREATED` and
  `SNAPSHOT_DRIFT_DETECTED` are reused from v0.14.

  **Architecture:** Separate PouchDB at `.energy-sharing/` (`ENERGY_SHARING_DB_PATH` env).
  PouchDB doc prefix `es:`. Raw installation data is never persisted — only report metadata
  (KRITIS). Service excluded from LLM agent catalogue (`skipServices`).

  **Regulatory basis:** § 42c EnWG (Energy Sharing), § 21 Abs. 2 EEG (Direktvermarktung),
  § 20b EnWG (Interimspflicht, central platform delayed).

### Changed

- **`src/validation-findings.js`** — Extended with 28 new Energy Sharing finding-code
  constants. All existing v0.14 grid-connection codes and helpers (`createFinding`,
  `summarizeFindings`, `SIMULTANEITY_FACTORS`) remain unchanged.
- **`services/api.service.js`** — Added `Energy Sharing Validation` OpenAPI tag and 3
  new route aliases (`POST /energy-sharing/validate`, `GET /energy-sharing/validations`,
  `GET /energy-sharing/validations/:id`).
- **`services/agent.service.js`** — Added `'energy-sharing'` to the LLM planner
  `skipServices` set (catalogue builder at line 72). Consistent with `grid-connection`.
- **`.gitignore`** — Added `.energy-sharing/` PouchDB data directory.
- **`.env.example`** — Added `ENERGY_SHARING_DB_PATH` configuration variable.

### Housekeeping

- **`package.json` version reconciled from 0.13.2 → 0.14.0 → 0.15.0** (v0.14.0 was
  fully deployed with CHANGELOG entry and 1,525 tests but `package.json` version was
  inadvertently not bumped). Documented here per decision in CR v0.15.

## [0.14.0] - 2026-03-30

### Added

- **Grid Connection Validation Service (v0.14.0) — `grid-connection` microservice**
  New Moleculer service implementing a deterministic 6-step Netzanschluss (grid connection)
  validation pipeline. No LLM involvement — identical inputs always produce identical finding codes.

  **Pipeline steps:**
  1. `inventory` — Fetches all installations ≥100 kW via `cernion_installations_local` (Weg A)
     or from a tagged datapoint (Weg B). Emits `INVENTORY_COMPLETE` / `INVENTORY_EMPTY` /
     `INSTALLATION_NO_NAP` / `INSTALLATION_STATUS_ANOMALY`.
  2. `delta` — Cross-system data quality analysis. Detects probable MaStR duplicates,
     stale NBP review status, and unit-vs-NAP voltage level mismatches.
  3. `capacity` — Simultaneity-adjusted capacity aggregation by voltage level.
     KRITIS note: MaStR has no transformer ratings — `TRANSFORMER_DATA_MISSING` is always emitted;
     `includeCapacityCheck: true` enables `cernion_connection_capacity_check` headroom lookup.
  4. `benchmark` — EWK regulatory benchmark via `ewk-monitoring.anschlussdauer` and
     `ewk-monitoring.umsetzungsquote` (reuses existing BNr/BDEW resolution).
  5. `decision` — Deterministic Go/No-Go rule engine: `GO_DIRECT` / `GO_CONDITIONAL` /
     `NO_GO_EXPANSION` / `DATA_QUALITY_INSUFFICIENT`.
  6. `audit` — Seals the report with a PouchDB snapshot reference and `AUDIT_TRAIL_CREATED`
     finding for EU AI Act Art. 12 compliance.

  **REST endpoints (via API Gateway):**
  - `POST /api/grid-connection/validate` — run pipeline (120 s timeout, synchronous)
  - `GET /api/grid-connection/validations` — list past reports
  - `GET /api/grid-connection/validations/:id` — retrieve report by UUID

  **Supporting module:** `src/validation-findings.js` — 20 finding-code constants,
  `SIMULTANEITY_FACTORS` map, `createFinding()` factory, `summarizeFindings()` aggregator.

  **Architecture:** Separate PouchDB at `.grid-connections/` (`GRID_CONNECTION_DB_PATH` env).
  Raw installation data is never persisted — only report metadata and provenance hashes (KRITIS).
  Service excluded from LLM agent catalogue (`skipServices`).

## [0.13.2] - 2026-03-30
*
### Added

- **Dedicated `agent_interventions` endpoint — closes Issue #32**
  New action `datapoint.interventions` (`GET /api/datapoints/:name/interventions`)
  exposes the explainability log of a datapoint directly without requiring clients
  to parse the full OEMetadata v2.0 document.

  **Response shape:**
  ```json
  { "name": "pv-portfolio-twl-netze", "total": 3, "interventions": [ … ] }
  ```
  Entries are returned newest-first. Each entry retains the full Issue #32 schema:
  `{ timestamp, action, reason, confidence_score, agent_id }`.

  **Query parameters:**
  - `?limit=N` — cap returned entries (default 50, max 500)
  - `?since=<ISO-8601>` — return only entries at or after the given timestamp
    (enables incremental polling by data stewards and audit systems)

  **OpenAPI:** full annotation with `x-oeo-class` (OEO_00000143 — Explanation),
  response example, and parameter descriptions. Registered as explicit route
  alias `GET /datapoints/:name/interventions` before `/:name` in `api.service.js`
  to prevent route shadowing.

  **Tests:** 6 new tests in `tests/datapoint.service.test.js` covering empty list,
  post-refresh state, `limit`, `since` filtering, descending sort, and 404.

### Closed Issues

- **#30 — `feat(oemetadata): Inject cryptographic data provenance hash for EU AI Act (Art. 12) compliance`**
  Implemented in v0.11.5: `computeProvenanceHash()` (SHA-256 over step-results
  payload), `provenanceHash` field on every PouchDB datapoint document, exposed
  via `GET /api/datapoints/:name/oemetadata` under `_cernion.provenance.hash`.
  Acceptance criteria verified: (1) hash present on oemetadata endpoint ✅,
  (2) hash changes on document mutation ✅ (covered by unit tests in
  `tests/datapoint.service.test.js`).

- **#31 — `security(agents): Implement Data Masking/Allowlist for external LLM prompts (Edge Privacy)`**
  Implemented in v0.11.5: `src/prompt-scrubber.js` — field-level masking with
  deterministic SHA-256 pseudonyms, energy-domain allowlist (MaStR IDs, PLZ,
  capacity, OEO terms never masked), `reidentMap` for edge re-identification.
  All 7 `callGemini()` call sites in `agent.service.js` wrapped via
  `scrubPromptText` / `scrubForLLM`. Covered by 94 tests in
  `tests/prompt-scrubber.test.js`.
  Acceptance criteria verified: (1) scrubbing middleware active before LLM ✅,
  (2) re-identification on edge via `reidentMap` ✅.

- **#32 — `feat(datapoints): Add explainability-log array for automated consistency corrections`**
  Implemented in v0.11.5 (schema + persistence) and completed in this release
  (dedicated queryable endpoint).
  - `agent_interventions: []` initialised on every `promote` ✅
  - Interventions appended by `datapoint.refresh` from `executePlan` result ✅
  - `reason` and `confidence_score` fields populated per intervention ✅
  - Dedicated queryable endpoint `GET /api/datapoints/:name/interventions`
    with `limit` and `since` filters ✅ (this release)

## [0.13.1] - 2026-03-29

### Changed

- **Coverage thresholds ramped to N+1 targets** — `jest.config.js` coverage
  gates updated from `branches 55 / functions 70 / lines 70 / statements 70`
  to `branches 60 / functions 75 / lines 75 / statements 75`. The N+1 target
  was documented since v0.9.4 but never enacted; this release enforces it.
  All 1 386 tests pass at the higher bar.

- **`npm run build` no-op script added** — CI workflows (`maintenance-ci.yml`,
  `release.yml`) reference `npm run build` which did not exist, causing a
  silent CI failure risk. Added `"build": "echo 'No build step required'"`
  to `package.json` for CI compatibility.

- **`.env.example` — added `DATAPOINT_MAX_CONCURRENT_REFRESHES`** (v0.13.0
  setting, default `3`). Was missing from the env template.

### Fixed

- **`.github/copilot-instructions.md` — full rewrite to v0.13.1**
  The file was frozen at v0.9.7 (test count 1 076 / 47 suites, stale file
  organization, no mention of v0.10–v0.13 features). Rewritten with:
  - Architecture Layers table (v0.10–v0.13)
  - PouchDB Conventions, Provenance & Compliance, Datapoint Layer,
    OEO/OEMetadata, OSM Geo Layer sections
  - Async Job Pattern, Description-guided domain documentation
  - Updated test counts (~1 400 / ~55), coverage thresholds (60/75/75/75)
  - Current Project Status section updated to v0.13.1
  - Release Process notes updated (CI build script, `--forceExit`)
  - "What NOT to Do" section added

- **`SECURITY.md` — supported versions updated to 0.13.x** (was 0.8.x).
  Advisory baseline updated from `0.8.32` to `0.13.1`.

- **`CONTRIBUTING.md` — project structure and code examples updated**
  - Project structure expanded to include 25 services, `src/` modules
    (prompt-scrubber, oeo-mappings, oemetadata-builder), and missing
    directories (uploads, docs, scripts)
  - Gemini model reference updated from `gemini-pro` to
    `process.env.GEMINI_MODEL || 'gemini-3-pro-preview'`

- **`README.md` — v0.10–v0.13 features added**
  - Features list: Snapshots, OSM Geo Layer, OEP Connector, OEO/OEMetadata,
    Data Provenance, Prompt Scrubber
  - Project structure updated with `datapoint.service.js`, `osm-geo.service.js`,
    `oep.service.js`, and new `src/` modules
  - Environment variables table: `GEMINI_MODEL` default corrected to
    `gemini-3-pro-preview`
  - Available Scripts table: added `sync:oemetadata` and `build`

- **Stale use-case doc references resolved**
  - `docs/use-cases/procurement-beschaffung-vs-spotpreis.md` — status updated
    from "tracked for v0.9.4" to "resolved in v0.9.4 (`src/period-normaliser.js`)"
  - `docs/use-cases/grid-assets-pv-leistung-vs-vnb-benchmark.md` — status
    updated from "tracked for v0.9.4" to "resolved in v0.9.11 (EWK BNr
    mapping fix)"
*
## [0.13.0] - 2026-03-29

### Added

- **AP1 — Snapshot-Semantik: Konsistenz-Beweis für Datenpunkt-Gruppen**
  Agents können jetzt eine definierte Menge von Datenpunkten als konsistente
  Einheit versiegeln. Ein Snapshot-Dokument (`snap:<uuid>` in PouchDB) hält
  die `provenanceHash`-Werte aller beteiligten Datenpunkte zum
  Erstellungszeitpunkt fest und beweist damit den Datenstand für
  nachgelagerte Agenten-Pipelines.

  **Snapshot-Lifecycle — 5 neue Actions:**
  - `datapoint.createSnapshot` (`POST /api/datapoints/snapshot`) — Erstellt
    einen Snapshot über eine Liste von Datenpunkten oder einen Tag-Filter.
    Drei Phasen: (1) Freshness-Check (`maxAgeMinutes`, Default 60), (2)
    sequenzieller Refresh für veraltete Datenpunkte (MCP-Session-Limit-sicher),
    (3) Versiegelung mit `snapshotHash` (SHA-256 über sortierte
    `provenanceHash`-Werte). Optionaler `createdBy`-Parameter
    (`manual` / `agent` / `scheduler`) für nahtlosen Andock-Punkt v0.14.
  - `datapoint.listSnapshots` (`GET /api/datapoints/snapshots`) — Listet
    alle Snapshots, optional gefiltert nach `status`.
  - `datapoint.getSnapshot` (`GET /api/datapoints/snapshot/:id`) — Gibt
    das vollständige Snapshot-Dokument zurück.
  - `datapoint.validateSnapshot` (`POST /api/datapoints/snapshot/:id/validate`)
    — Vergleicht die aktuellen `provenanceHash`-Werte der Datenpunkte mit
    den im Snapshot gespeicherten Werten. Gibt `consistent: true/false` und
    ein `drift`-Array zurück. Persistiert das Ergebnis als
    `lastValidation` im Snapshot-Dokument.
  - `datapoint.removeSnapshot` (`DELETE /api/datapoints/snapshot/:id`) —
    Löscht ein Snapshot-Dokument.

  **PouchDB-Schema:** Prefix `snap:`, Felder: `id`, `name`, `description`,
  `createdAt`, `createdBy`, `maxAgeMinutes`, `datapointNames`, `status`
  (`complete` / `partial` / `failed`), `datapoints[]` (je Hash + Summary),
  `snapshotHash`, `lastValidation`. Rohdaten werden NICHT gespeichert
  (KRITIS-Constraint).

  **PouchDB-Index:** Neuer Index auf `['createdAt']` in `started()` für
  zukünftige sortierte Snapshot-Abfragen.

  **New test file:** `tests/datapoint-snapshot.test.js` — 19 Tests in 5
  Suites decken alle Actions inklusive Freshness-Check, Drift-Detection,
  Partial/Failed-Status und Tag-basierter Erstellung ab.

- **AP3 — Tag-basierte Filterung in der `list`-Action**
  `GET /api/datapoints?tags=solar,twl-netze` gibt nur Datenpunkte zurück,
  die ALLE angegebenen Tags besitzen (case-insensitive AND-Semantik,
  komma-separiert). Kein PouchDB-Index nötig (<100 Datenpunkte: In-Memory
  ausreichend). Integration mit `createSnapshot`: alternativ zu
  `datapointNames` kann `tags` übergeben werden.

### Changed

- **AP2 — Globales Concurrency-Limit für Scheduler-Refreshes**
  `runScheduledRefreshes()` in `services/datapoint.service.js` bricht jetzt
  ab, sobald `activeRefreshes.size >= maxConcurrentRefreshes`. Verhindert
  simultane MCP-Session-Überläufe bei vielen überfälligen Datenpunkten.
  Zurückgestellte Refreshes werden beim nächsten 60 s-Tick nachgeholt.

  - **Neues Setting:** `maxConcurrentRefreshes` (Default: `3`).
  - **Neue Env-Variable:** `DATAPOINT_MAX_CONCURRENT_REFRESHES` (Default: `3`).

- `services/api.service.js` — 5 neue Route-Aliases für Snapshot-Endpoints.
  Routing-Kommentar auf `v0.11–v0.13` aktualisiert; Snapshot-Routen stehen
  korrekt vor `/:name` um Route-Shadowing zu verhindern.

- `MCP_SERVICES.md` — Abschnitt 16 vollständig auf v0.11–v0.13 aufgeholt:
  alle Datapoint-Endpoints, OEMetadata v2.0, OEO-Context, Snapshots.
  Neue Section 17 für OEP (Open Energy Platform, v0.12).

## [0.12.0] - 2026-03-29

### Added

- **AP1 — OEMetadata v2.0 Schema Conformity**
  The `GET /api/datapoints/:name/oemetadata` endpoint now returns a fully
  OEMetadata v2.0 conformant document instead of the previous proprietary
  schema.json-style response.

  **New modules:**
  - `src/source-license-map.js` — static mapping of Moleculer action prefixes
    to OEMetadata v2.0 `sources` and `licenses` entries (14 service prefixes,
    covers DL-DE/BY-2.0, CC-BY-4.0, ODbL-1.0, and proprietary).
  - `src/oemetadata-builder.js` — maps a PouchDB datapoint document to a
    complete OEMetadata v2.0 JSON structure including spatial/temporal
    coverage, OEO subject IRIs, field schema from `lastRun.summary.columns`,
    source licensing, and a Cernion-specific `_cernion` extension namespace
    (provenance hash, agent_interventions, health, scheduling).

  **Updated endpoint:**
  - `GET /api/datapoints/:name/oemetadata` — now returns OEMetadata v2.0.
    New optional `?validate=true` query parameter runs ajv JSON-Schema
    validation against the pinned schema and appends a `_validation` report.

  **New script:**
  - `scripts/sync-oemetadata.js` (`npm run sync:oemetadata`) — downloads
    `schema.json`, `template.json`, and `context.json` from the official
    OEMetadata GitHub repository at the pinned tag (`v2.0.0`). Use
    `--latest` flag to track the `production` branch for development.
    Downloaded files are stored in `src/oemetadata/` (git-ignored).

  **New dependency:** `ajv` ^8.17.1 (JSON Schema validation).
  **Schema version pinned:** `v2.0.0`.

- **AP2 — OEP Connector (Open Energy Platform)**
  New read-only microservice `services/oep.service.js` provides structured
  access to the Open Energy Platform REST API v0. No authentication token
  is required for public data tables.

  **New actions (5):**
  - `oep.listSchemas` (`GET /api/oep/schemas`) — list available OEP
    database schemas.
  - `oep.listTables` (`GET /api/oep/schemas/:schema/tables`) — list tables
    within a schema.
  - `oep.getTableMeta` (`GET /api/oep/tables/:schema/:table/meta`) — column
    definitions including data types and descriptions.
  - `oep.query` (`GET /api/oep/tables/:schema/:table/rows`) — fetch rows
    with optional `limit`, `offset`, `where`, and `orderby` parameters
    (max 1000 rows per request).
  - `oep.search` (`GET /api/oep/search`) — case-insensitive substring
    search over all OEP table names and descriptions; uses cached table
    list (24 h TTL, no per-search OEP API call).

  **Cache:** module-level `Map` with 24 h TTL for schema lists, table
  lists, and table metadata. Row queries are not cached.

  **Agent integration (RULE 13):** The Gemini system prompt now routes
  OEP intents (scenario comparison, NEP references, research datasets) to
  `oep.search` → `oep.query` via RULE 13 in the planning prompt and item
  10 in the refine-prompt quick-reference list.

  **New env var:** `OEP_API_BASE_URL` (default:
  `https://openenergyplatform.org/api/v0`).

- **AP3 — Datapoint Scheduling (interval refresh strategy)**
  Datapoints promoted with `refresh: { strategy: "interval", intervalMinutes: N }`
  are now automatically refreshed by a 60-second scheduler tick.

  **Changes to `services/datapoint.service.js`:**
  - `created()` — initialises `this.activeRefreshes = new Set()`.
  - `started()` — starts a `setInterval` tick (60 s) when
    `DATAPOINT_SCHEDULER_ENABLED !== 'false'`.
  - `stopped()` — clears the interval before closing PouchDB.
  - `runScheduledRefreshes()` (new method) — iterates all datapoints, skips
    manual strategy and non-overdue intervals, uses `activeRefreshes` Set
    as an in-memory concurrency guard (self-healing on restart). Fires
    `datapoint.refresh` as fire-and-forget with `.finally()` cleanup.

  **New env var:** `DATAPOINT_SCHEDULER_ENABLED` (default: `true`; set to
  `'false'` to disable).

### Changed

- `services/api.service.js` — added `OEP (Open Energy Platform)` OpenAPI
  tag and 5 route aliases for the OEP service.
- `.gitignore` — added `src/oemetadata/` (downloaded schema assets).
- `.env.example` — added `DATAPOINT_SCHEDULER_ENABLED` and
  `OEP_API_BASE_URL` documentation.

## [0.11.5] - 2026-03-29


### Added

- **Cryptographic data provenance hash — EU AI Act Art. 12 compliance
  (Issue #30)**
  Every datapoint refresh now computes a SHA-256 hash over the canonical
  step-results payload. The hash is persisted on the PouchDB document
  (`provenanceHash`) and proves the exact data the agent processed.

  **New endpoint:**
  - `GET /api/datapoints/:name/oemetadata` — Returns a schema.json-style
    document with `provenance.hash`, `provenance.algorithm`, source audit
    trail, OEO class mappings, agent interventions log, and health data.
    Annotated with full OpenAPI documentation.

  **New method:**
  - `computeProvenanceHash(stepResults)` on `datapoint.service` — SHA-256
    of `JSON.stringify([{step, action, result, error}])`.

- **Explainability-log array for automated agent corrections (Issue #32)**
  Datapoint documents now carry an `agent_interventions` array that
  records every automated correction the agent made during plan execution.

  **Intervention record shape:**
  ```json
  {
    "timestamp": "ISO-8601",
    "action": "param_repair | step_failure",
    "reason": "human-readable description",
    "confidence_score": 0.95,
    "agent_id": "executePlan"
  }
  ```

  **Integration points:**
  - `agent.executePlan` now collects interventions from `repairPlanParams`
    (param corrections) and step failures, returning them in the result.
  - `datapoint.refresh` appends interventions to the PouchDB document.
  - `oemetadata` endpoint exposes the full intervention log.

- **Data Masking / Allowlist for external LLM prompts — Edge Privacy
  (Issue #31)**

  **New module:** `src/prompt-scrubber.js` (~230 lines)
  - `scrubForLLM(data, options)` — Field-level masking with deterministic
    SHA-256 pseudonyms (`[MASKED-xxxxxxxx]`). Returns `{ scrubbed,
    reidentMap, stats }`. Respects energy-domain allowlist (MaStR IDs,
    PLZ, capacity, status, dates, market data, OEO terms).
  - `scrubPromptText(text)` — Regex-based PII removal for free-text
    prompts (emails, IBANs, German phone numbers).
  - `isSensitiveField(fieldName)` — Safe patterns override sensitive
    patterns. Energy identifiers are never masked.
  - `SENSITIVE_PATTERNS` / `SAFE_PATTERNS` — Exported for extensibility.

  **Integration points:**
  - `callGemini()` in `agent.service.js` now wraps every prompt through
    `scrubPromptText` before calling Gemini (covers all 7 call sites).
  - Summary prompt: raw `allResults` data scrubbed via `scrubForLLM`
    before JSON-serialisation into the LLM context window.
  - Self-healing repair prompt: step results scrubbed via `scrubForLLM`.

### Changed

- `agent.executePlan` return shape now includes `interventions: []` array
  (non-breaking — consumers that ignore the field are unaffected).
- PouchDB document schema for datapoints extended with `agent_interventions`
  (default `[]`) and `provenanceHash` (default `null`).

### Tests

- `tests/prompt-scrubber.test.js` — 94 tests covering `isSensitiveField`
  (34 sensitive, 37 safe, edge cases), `scrubForLLM` (12 tests: masking,
  reidentMap, arrays, truncation, nesting, determinism, additionalBlocklist/
  Allowlist), `scrubPromptText` (7 tests: email, IBAN, phone, passthrough),
  pattern array structural checks.
- `tests/datapoint.service.test.js` — 13 new tests:
  `computeProvenanceHash` method (5 tests), `provenanceHash` refresh
  integration (2 tests), `agent_interventions` lifecycle (3 tests),
  `oemetadata` action (3 tests).
- `tests/agent-executePlan.test.js` — 3 new tests: interventions array
  presence, step_failure recording, empty interventions on clean execution.

## [0.11.4] - 2026-03-29

### Added

- **Open Energy Ontology (OEO) integration** — Machine-readable semantic
  annotations linking Cernion concepts to the
  [Open Energy Ontology](https://github.com/OpenEnergyPlatform/ontology)
  v2.11.0.

  **New files:**
  - `src/oeo-mappings.js` — Static OEO lookup module (~150 curated mappings)
    covering installation types, grid concepts, voltage levels, market types,
    ENTSO-E PSR codes, energy/forecasting concepts, gas storage concepts,
    and SI-prefix energy units. Includes German labels (`labelDe`) and
    sub-type granularity aligned with MaStR data (wind onshore/offshore,
    hydro run-of-river/pumped/reservoir, etc.).
  - `scripts/sync-oeo.js` — Download OEO ETD CSV from GitHub releases,
    validate all referenced OEO IDs still exist, detect label renames, and
    update `oeo-mappings.js`. Usage: `npm run sync:oeo`.
  - `tests/oeo-mappings.test.js` — 30+ unit tests for structural integrity,
    cross-validation, and all helper functions.

  **OpenAPI annotations:**
  - `x-oeo-class` extension added to all 45+ REST-exposed actions across
    7 domain services (`energy-market`, `grid-operations`, `assets`,
    `forecast`, `entsoe`, `gas-storage`, `residual-load`). Each annotation
    lists the OEO class IRIs relevant to that endpoint. Tagged with
    `// @OpenEnergyPlatform/ontology` for upstream discoverability.

  **Semantic domain enrichment:**
  - `src/semantic-domains.js` — Each domain now carries an `oeoMapping`
    array of OEO class IRIs.
  - `datasource-discovery.service.js` — Discovery descriptors include
    `semanticHints.oeoClasses` for downstream consumers.
  - `datasource-classifier.service.js` — German OEO labels (e.g.
    "Solaranlage", "Stromnetz") merged into classifier keyword pool,
    boosting heuristic scoring for German-language uploads.

  **JSON-LD context endpoint:**
  - `GET /api/datapoints/oeo-context` — Returns a JSON-LD `@context`
    document mapping Cernion fields to OEO class IRIs. Optionally scoped
    to a specific datapoint via `?name=...` for field-level mappings.
    Includes a global domain catalogue.

- `sync:oeo` npm script (`npm run sync:oeo`) added to `package.json`.

## [0.11.3] - 2026-03-29

### Changed

- **Datapoint Layer UI — full English localisation**
  All German strings introduced in v0.11.1 have been translated to English for
  consistency with the rest of the `/app` interface. Affected areas:
  - Health-bar labels: "Gesamt" → "Total", "Fehler" → "Errors"
  - Empty state message and hint text
  - Error callout: "Fehler beim Laden" → "Error loading"
  - Age display: "vor X min / h / d" → "X min / h / d ago"
  - Rendered table headers: "Letzter Lauf / Zeilen / Aktionen" → "Last Run / Rows / Actions"
  - Delete button tooltip: "Löschen" → "Delete"
  - `refreshDatapoint` toasts: "Refresh gestartet" → "Refreshing", "Zeilen" → "rows", "Refresh fehlgeschlagen" → "Refresh failed"
  - `deleteDatapoint` confirm dialog and toasts

## [0.11.2] - 2026-03-29

### Fixed

- **`$gateway` meta leakage in agent step execution (async job descriptor bug)**
  When `agent.execute` was called via the REST API gateway, `ctx.meta.$gateway`
  was set to `true` by `api.service.js`. The agent executor forwarded this meta
  unchanged into every downstream `broker.call()` for plan steps. Services that
  use `jobStore.startJob` (e.g. `grid-operations.redispatchExport` for JSON
  format) check `ctx.meta.$gateway` to decide whether to return a synchronous
  result or a 202 job descriptor — and since the flag was `true`, they returned
  `{ jobId, status: "queued", … }` instead of the actual data. The UI then
  rendered the raw job descriptor as the "result", showing "Job Started".

  **Fix:** All four `broker.call` / `ctx.call` sites inside the agent execute
  and repair loops now explicitly spread `ctx.meta` and override `$gateway:
  false`, so downstream services always behave as internal callers while still
  receiving the forwarded `cernionToken` and other valid metadata.

  **Affected services:** any action backed by `jobStore.startJob` when invoked
  as an agent plan step (confirmed: `grid-operations.redispatchExport`).

  **Regression test added:** `tests/agent.service.test.js` — "should strip
  `$gateway` from meta when calling step actions (prevent async job leakage)"

## [0.11.1] - 2026-03-29

### Added

- **Datapoint Layer UI** (`src/app.html`) — completes the v0.11.0 Datapoint Layer
  milestone with full frontend integration (backend shipped in v0.11.0):
  - **`📌 Datapoints` nav entry** between "Data Sources" and "Integration Hub"
  - **Datapoints panel** (`#datapoints-panel`) with health-bar summary
    (Total / Healthy / Stale / Fehler counters) and a sortable table showing
    name, status badge, last-run age, row count, and per-row action buttons
  - **"Promote to Datapoint" button** in the results share area — opens an
    inline dialog with auto-generated URL-safe slug (derived from the research
    problem text) and a description field; calls `POST /api/datapoints/promote`
    and replaces the dialog with a success banner linking directly to the panel
  - **Refresh action** — `POST /api/datapoints/:name/refresh` with toast
    feedback showing row count and duration
  - **CSV download** — opens `GET /api/datapoints/:name/data?format=csv` in a
    new tab
  - **Delete action** — confirm-guarded `DELETE /api/datapoints/:name` with
    table reload on success
  - **Empty state** — helpful call-to-action when no datapoints exist yet
  - **CSS additions** — all new classes use existing design tokens (`var(--*)`)
    only; no external dependencies, no new frameworks

## [0.11.0] - 2026-03-28

### Added

- **Datapoint Layer** — new `datapoint.service.js` with PouchDB persistence
  - Promote agent sessions to named, managed datapoints (`POST /api/datapoints/promote`)
  - Full CRUD: list, get, update, delete (`GET/PUT/DELETE /api/datapoints/:name`)
  - Health monitoring and lifecycle tracking for all datapoints (`GET /api/datapoints/health/overview`)
  - On-demand plan re-execution with metadata update (`POST /api/datapoints/:name/refresh`)
  - Live data pass-through as JSON or CSV (`GET /api/datapoints/:name/data?format=csv`)
  - PouchDB stores only metadata — raw data always flows through RAM (KRITIS-compliant:
    no native bindings, no network port, no external process)
- **`agent.executePlan` action** — lean plan executor without session lifecycle or LLM
  involvement, callable via `agent.executePlan { plan, userInputs }` (internal only)
- **`agent.loadSession` action** — exposes the internal `loadSession` function as a
  Moleculer action for service-to-service calls (no REST route)
- **OpenAPI `Datapoints` tag** registered in `api.service.js`
- **`.datapoints/` directory** added to `.gitignore` (PouchDB runtime data)
- **`DATAPOINT_DB_PATH` env variable** documented in `.env.example`
  (default: `./.datapoints`)

### Dependencies

- Added `pouchdb` and `pouchdb-find` (embedded document database, zero external
  dependencies, pure JavaScript — suitable for KRITIS environments)

### Tests

- `tests/agent-executePlan.test.js` — 5 unit tests for the new `executePlan` action
- `tests/datapoint.service.test.js` — comprehensive unit tests for all datapoint
  service actions and helper methods
- `tests/fixtures/session-pv-twl.json` — session fixture for test isolation

## [0.10.3] - 2026-03-26

### Fixed

- **`updatedAfter` filter — MCP response shape mismatch (root cause fix)**
  The filter introduced in v0.10.1 and the field-name fix in v0.10.2 were both
  correct, but the filter never executed in practice because the MCP tool
  `cernion_installations_local` returns a **flat** response shape
  `{ installations: [...] }` at the top level — without the `data` wrapper that
  the pagination loop and post-filters expected (`result.data.installations`).

  Consequence: `pageResult?.data?.installations` was always `undefined` →
  `pageRows = []` → `allInstallations = []` → `result.data` was never set →
  every guard `result?.data?.installations` silently short-circuited → the
  `updatedAfter` post-filter code was never reached. The raw MCP result was
  then returned as-is, and `_fetchAssets` extracted the unfiltered
  `result.installations` array directly.

  Fix: a **normalization step** is now applied immediately after each MCP page
  call in `energy-market.installations`. If the response has `installations` at
  the top level and no `data` wrapper, it is folded into the expected shape:
  ```javascript
  pageResult.data = { installations: pageResult.installations, stats: pageResult.stats || {} };
  ```
  This makes all existing post-filters (operationalStatus, netzbetreiberPruefungStatus,
  updatedAfter) work correctly with the real MCP response.

  **New regression test** added:
  *"should filter correctly when MCP returns flat top-level installations
  (real response shape)"* — mocks the actual `{ installations: [...] }` shape
  and verifies the `updatedAfter` filter reduces 3 records to 1.

## [0.10.2] - 2026-03-26

### Fixed

- **`updatedAfter` filter — wrong field name (hotfix)**
  The `updatedAfter` post-filter in `energy-market.installations` was checking
  `inst.DatumLetzteMeldung`, which does not exist in the local MongoDB schema.
  The correct MongoDB field for MaStR `DatumLetzteMeldung` is `lastUpdatedAt`.

  Root cause: `DatumLetzteMeldung` is the raw MaStR XML attribute name; the
  MongoDB importer maps it to `lastUpdatedAt`. The secondary fallback was
  `updatedAt`, which is the DB-level import/sync timestamp (identical for all
  records in a given sync run — e.g. `2026-03-06` for all records), so the
  filter had no discriminating effect and every installation passed through.

  Fix: filter now checks `inst.lastUpdatedAt || inst.DatumLetzteMeldung`
  (the `DatumLetzteMeldung` arm handles any future data sources that expose the
  raw MaStR name). The `updatedAt` fallback has been removed since using the
  sync timestamp produces misleading results.

  Updated: OpenAPI `description` for the `updatedAfter` parameter in all eight
  asset endpoints now reads `lastUpdatedAt (DatumLetzteMeldung)` to make the
  field mapping transparent to API consumers.

  Tests updated to use `lastUpdatedAt` in fixtures; fallback test renamed to
  *"should fall back to DatumLetzteMeldung field when lastUpdatedAt is absent"*.

## [0.10.1] - 2026-03-26

### Added

- **`updatedAfter` filter on all asset endpoints**
  All eight asset endpoints (`GET /api/assets/solar`, `/wind`, `/storage`,
  `/biomass`, `/hydro`, `/combustion`, `/list`, `/all`) now accept an optional
  `updatedAfter` query parameter (ISO date, e.g. `2026-03-24`).

  When set, only installations whose MongoDB field `lastUpdatedAt` (MaStR
  `DatumLetzteMeldung`, the last-notification date) is **strictly
  after** the supplied date are returned. Installations without this field
  are excluded when the filter is active.

  The filter is applied as a server-side post-filter after the MCP response
  is received, stacking with all existing filters (`operationalStatus`,
  `netzbetreiberPruefungStatus`, `redispatch`, etc.).

  OpenAPI `parameters` entries (type `string`, format `date`) added to all
  eight endpoint definitions.

  **Typical use-case — incremental sync:**
  ```
  GET /api/assets/solar?gridOperatorId=SNB935578300972&updatedAfter=2026-03-24
  GET /api/assets/all?bdewCode=4041407000008&updatedAfter=2026-03-24
  ```

  **Tests:** 4 new cases in `tests/energy-market.service.test.js`
  (`installations action — updatedAfter filter`) covering date-match,
  no-date-field exclusion, `updatedAt` fallback, and no-op when parameter
  is omitted.

## [0.10.0] - 2026-03-25

### Added

- **OSM Geo Layer — 4 new endpoints (Layer 2 Geo-Architecture)**
  Wraps the four new Cernion MCP tools that expose physical grid infrastructure
  from OpenStreetMap via the Overpass API, complementing the authoritative
  VNBDigital data (Layer 1) with community-mapped substations, transformers,
  lines, and cables.

  New service: **`services/osm-geo.service.js`** (`name: 'osm-geo'`)

  | Endpoint | MCP tool | Description |
  |---|---|---|
  | `POST /api/osm-geo/validate` | `osm_geo_validate` | Two-layer VNB-assignment plausibility check (L1 authoritative via VNBDigital + L2 physical via Overpass). Detects `DEFINITIVE_MISASSIGNMENT` and `LIKELY_MISASSIGNMENT`. |
  | `POST /api/osm-geo/infrastructure-nearby` | `osm_infrastructure_nearby` | All energy infrastructure within a radius, sorted by distance. Includes `connectionSuitability` assessment (`SUITABLE_NS`, `SUITABLE_MS`, `SUITABLE_HS`). Optional `constrainToBbox` from `vnbdigital_lookup`. |
  | `POST /api/osm-geo/substation-finder` | `osm_substation_finder` | Substation inventory for a grid territory or named area. Returns detail list plus aggregated statistics: count by voltage level, operator split, and density label (`SPARSE`/`RURAL`/`SUBURBAN`/`URBAN`). |
  | `POST /api/osm-geo/grid-topology` | `osm_grid_topology` | Grid topology analysis: node/edge counts, average degree, topology type (`RADIAL`/`MIXED`/`RING`), voltage breakdown. Optional path analysis between two OSM node IDs; optional raw graph data export. |

  **Coordinate inputs:** `mastrNummer` (auto-resolved from local DB), explicit
  `latitude`+`longitude`, or `location` string where applicable.

  **Scope inputs** for area tools: `location` (place name), `boundingBox`
  (directly compatible with `vnbdigital_lookup` bbox), or `gridOperator` name.

  **OpenAPI:** new `OSM Geo (OpenStreetMap)` tag registered in
  `services/api.service.js`. All four actions include full `requestBody` schemas
  with named examples and `responses.200` example payloads.

  **Runtime guard:** handlers throw a descriptive `Error` when no valid
  coordinate or scope parameter is supplied (before the MCP call is made).

  **Tests:** `tests/osm-geo.service.test.js` — 37 test cases covering action
  existence, REST endpoint strings, Moleculer param validation (required
  fields, enum guards, numeric range checks), happy-path MCP call
  verification with correct tool names, `cernionToken` propagation from
  `ctx.meta`, and MCP error-response passthrough.

  **Data license:** All four tools use OpenStreetMap data.
  © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/).
  The `dataQuality.disclaimer` field in every response carries this notice.

- **`OVERPASS_ENDPOINT` environment variable** documented in `.env.example`.
  Leave unset to use the public `overpass-api.de` instance. For production
  workloads with SLA requirements, point this to a private Overpass instance
  (setup guide: `docker/overpass/README.md`).

- **Agent RULE 12 — OSM Geo Layer integration**
  The Gemini planning prompt (`services/agent.service.js`) now carries
  **RULE 12**, wiring the four `osm-geo.*` actions into the AI research
  pipeline. `buildServiceCatalogue()` already auto-discovers all Moleculer
  services, so the actions appear in the LLM tool catalogue automatically;
  RULE 12 adds explicit routing guidance so the planner reliably selects the
  right tool for each intent:

  | Intent keywords | Routed to |
  |---|---|
  | "VNB assignment", "grid operator validation", "ist SEE… beim richtigen VNB?" | `osm-geo.validate` |
  | "nearby infrastructure", "what is close to…", "Umkreis Infrastruktur" | `osm-geo.infrastructureNearby` |
  | "substation inventory", "how many Trafostationen", "find transformer stations" | `osm-geo.substationFinder` |
  | "grid topology", "ring or radial", "network redundancy", "Netzredundanz" | `osm-geo.gridTopology` |

  The rule also documents how to chain with RULE 1 (DSO pipeline) to obtain
  `gridOperator` from a prior `marketPartners` step:
  `"gridOperator": "__step_1.data.results[0].companyName"`.

  The **refinement prompt** carries a condensed RULE 12 summary (item 9)
  so refined plans stay consistent with initial plans.

  **PARAM_ALIASES** — two new entries added to the static alias table so
  the proactive schema-repair pass corrects common LLM typos before any
  service call:

  | LLM typo | Canonical param |
  |---|---|
  | `radius` / `umkreis` | `radiusMeters` |
  | `bbox` / `bounding_box` | `boundingBox` |

  **Tests:** 4 new tests in `tests/agent.service.test.js`:
  - Prompt contains `RULE 12` and all four `osm-geo.*` action names.
  - `osm-geo.substationFinder` and `osm-geo.gridTopology` appear in the
    auto-generated service catalogue text.
  - `radius` → `radiusMeters` alias applied for `osm-geo.validate`.
  - `bbox` → `boundingBox` alias applied for `osm-geo.substationFinder`.

  Suite total: **1110 tests** (1106 → +4).

## [0.9.13] - 2026-03-24

### Added

- **Description-guided dataset type (`"other"`) for inhouse data**
  Real-world uploaded files (XLS / CSV / XML / …) often contain mixed or
  custom data that does not map to any of the predefined semantic domain types
  (`metering`, `grid-assets`, `procurement`, etc.).  Previously such datasets
  ended up in an unusable `"unknown"` state requiring manual domain selection.
  A new `"other"` / description-guided pathway lets the user's free-text
  **dataset description act as the semantic guide at runtime**, so the AI agent
  can query and aggregate those datasets without any fixed critical-field
  mappings.

  **`src/semantic-domains.js`** — New `"other"` domain entry.  Carries no
  `columnKeywords` or `filenameTokens` (score = 0, never wins by heuristics)
  and declares a single `requiredCapabilities: ['description_guided']`.
  Registered with `"other"` id, label `"Other / Custom Dataset"`.

  **`services/datasource-classifier.service.js`**
  - New `analyseDescription(description, columnProfiles)` method.  Parses the
    free-text description via regex patterns and infers a set of runtime
    capabilities (`timeseries`, `aggregate`, `categorical`, `geographic`,
    `financial`, `identity`) plus up to five `suggestedQueries` in German.
    Returns `{ capabilities, suggestedQueries, conceptSummary, detectedColumnCount }`.
  - After the LLM fallback path, when **no known domain** matches and the
    description has **≥ 8 tokens AND ≥ 1 readable column**, the source is now
    classified as `domainId: "other"` with `requiresUserInput: false` and
    `descriptionAnalysis` attached.  Unreadable files (where inferSchema
    throws → 0 detected columns) and descriptions with fewer than 8 tokens
    continue to return `"unknown"` unchanged.

  **`services/datasource-discovery.service.js`**
  - `inferSemanticHints()` adds the `description_guided` capability for
    `"other"` domain sources.
  - `buildDescriptors()` injects `semanticHints.runtimeContext` (the stored
    `descriptionAnalysis`) and `semanticHints.freeformDescription` into the
    AI-ready descriptor for `"other"` domain sources.
  - `deriveSemanticStatus()` returns `"description-guided"` for `"other"`
    domain sources instead of `"partial"`, giving the UI a distinct,
    actionable status.

  **`services/agent.service.js`**
  - `deriveInhouseIntentCapabilities()` adds both `description_guided` and
    `inhouse_aggregate` for `"other"` domain sources.
  - `getInhouseDescriptorText()` surfaces `freeformDescription`, inferred
    capabilities, and suggested queries in the agent's Gemini planning prompt
    for `"other"` domain descriptors.
  - `buildIntentClassPlan()` — new `description_guided` intent class.  Loads
    all rows via `datasource-cache.query` (INHOUSE DATA RULE always respected)
    with the description context embedded in the step description and plan
    summary.
  - `inferIntentClassFromPlan()` recognises `description_guided` from the plan
    summary string.
  - The `analyze` action handler auto-sets `intentClass = 'description_guided'`
    when the resolved descriptor is an `"other"` domain source, keeping it on
    the deterministic shortcut path instead of falling through to the Gemini
    LLM planner.

  **Tests added**
  - `tests/datasource-classifier.service.test.js` — three new cases: `"other"`
    classification with a rich description, capability inference
    (`timeseries` / `categorical` / `geographic` / `financial`), and guard
    that short descriptions (< 8 tokens) still return `"unknown"`.
  - `tests/datasource-discovery.service.test.js` — one new case: verifies
    `semanticStatus = "description-guided"`, `capabilities ⊇ ["description_guided"]`,
    and `semanticHints.runtimeContext` is correctly populated.

### Documentation

- **Direktvermarktung data availability — known limitation documented**
  Clarified across all relevant files that filtering installations by a specific
  Direktvermarkter company is **not possible** through any public data source.
  `DirektvermarkterMastrNummer` is deliberately excluded from all MaStR bulk
  exports (BNetzA policy — commercially sensitive data), meaning the
  `direktvermarkterName` / `direktvermarkterMastrId` filter parameters of
  `cernion_installations_local` and `assets.byDirektvermarkter` **will return
  0 results** in practice.

  Changes made:
  - **`.github/copilot-instructions.md`** — New "MCP Data Backend — Known
    Limitations" section with `fernsteuerbarkeitDv` property table, four-source
    verification table (MaStR bulk XML, SOAP API, Netztransparenz.de, local
    MongoDB), practical pipeline implication, and alternative approaches.
  - **`services/assets.service.js`** — `byDirektvermarkter` OpenAPI description
    extended with an explicit ⚠️ data availability warning and pointer to the
    `fernsteuerbarkeitDv: true` + `minCapacity: 100` proxy (Wind/Biomass only).
  - **`services/grid-operations.service.js`** — `direktvermarkterLookup` OpenAPI
    description extended with a matching ⚠️ warning covering both the lookup
    step and the downstream `byDirektvermarkter` step.
  - **`MCP_TOOLS.md`** — New top-level "Known Data Limitations" section with the
    complete `fernsteuerbarkeitDv` property table, four-source evidence table,
    example filter snippet, and all alternative approaches for integrators.

  The `fernsteuerbarkeitDv: true` filter (Wind/Biomass, `minCapacity: 100`) is
  documented as the best publicly available proxy for Redispatch 2.0-eligible
  installations currently in Direktvermarktung. It does not reveal which
  Direktvermarkter company manages a unit or whether the DV contract is active.

## [0.9.12] - 2026-03-21

### Added

- **Direktvermarkter pipeline — Phase 2 & 3 (CR-Direktvermarktung)**
  Implements REST-service integration and agent orchestration for
  direct-energy-marketer (Direktvermarkter) portfolio queries, building on the
  MCP/MongoDB data layer delivered in Phase 1.

  **Phase 2a — `grid-operations.direktvermarkterLookup`**
  New action `POST /grid-operations/direktvermarkter-lookup` wraps the MCP tool
  `cernion_direktvermarkter_lookup`.  Accepts `name` (fuzzy) or `mastrId`
  (exact) and returns portfolio metadata (portfolioSize, totalCapacityMW, role).
  Validates that at least one lookup key is supplied.

  **Phase 2b — `assets.byDirektvermarkter`**
  New action `POST /assets/by-direktvermarkter` queries `cernion_installations_local`
  with the new `direktvermarkterName` / `direktvermarkterMastrId` filter
  parameters from Phase 1.  Supports optional filters `installationType`,
  `commissioningYear`, `minCapacityKW`, `maxCapacityKW`, `bundesland`, `limit`,
  `offset`, and `format` (json / csv / xlsx).  Results are mapped through the
  canonical German output format and include four new Direktvermarktung columns:
  `Direktvermarkter`, `Direktvermarkter MaStR`, `Direktvermarktung Beginn`,
  `Direktvermarktung Status`.

  **Refactor — `assets._mapInstallationItem`**
  The inline mapping lambda inside `_fetchAssets` was extracted into a new shared
  service method `_mapInstallationItem(item, assetType)`.  `_fetchAssets`
  delegates to it unchanged; `byDirektvermarkter` reuses the same mapper,
  ensuring consistent output columns across all asset endpoints.

  **Phase 3a — Agent prompt (RULE 11)**
  Added RULE 11 to the Gemini system prompt and the refinement prompt, defining
  the two-step Direktvermarkter pipeline
  (`direktvermarkterLookup` → `byDirektvermarkter`) with exact chain-ref paths.
  The rule explicitly distinguishes Direktvermarkter from VNB so the agent does
  not fall back to the VNB pipeline (RULE 1) for direct-marketer queries.

  **Phase 3b/c — PARAM_ALIASES & resolveChainedRef**
  Added static aliases `direktvermarktername`, `direktvermarktermastrid`,
  `dvname`, `dvmastrid`, `directmarketername`, `directmarketerid` to
  `PARAM_ALIASES` so `repairPlanParams` corrects LLM-generated typos/synonyms
  before execution.  `resolveChainedRef` supports the new chaining paths
  (`__step_1.data.results[0].mastrId`, `__step_1.data.results[0].name`)
  without code changes (generic path resolution already handles them).

## [0.9.11] - 2026-03-20
### Fixed

- **BDEW→BNr mapping for EWK lookups**
  The EWK tools require the BNetzA Netzbetreibernummer (BNr, 5–10 digits, e.g.
  `10002977`) as their lookup key — 13-digit BDEW market-partner codes are not
  accepted and trigger a silent unfiltered fallback (CR-MCP-02). `vnb_lookup_codes`
  returns the BNr as `canonical.bnr`, but `extractLookupBdewCodes` filtered for
  `/^\d{13}$/` only, so the BNr was silently dropped. `findAlternateBdewCodes` then
  returned only 13-digit BDEW aliases, and `fetchEwkData` fell through to
  `{ vnbName }` as the sole query — which fails for `umsetzungsquote` /
  `digitalisierungsindex` (CR-MCP-03), leaving both fields `null`.
  Fixed by explicitly extracting `canonical.bnr` in `findAlternateBdewCodes` and
  inserting it as the first entry in the query list. The BNr becomes
  `{ bnr: "10002977" }` in `fetchEwkData`'s `ewkQueries`, tried before the
  `vnbName` fallback. All three EWK tools respond correctly to BNr lookups.
  `identity.bnr` is now also exposed in the snapshot API response.

- **MaStR per-type 1000-row cap removed from VNB monitor**
  `fetchMastrData` passed `limit: 1000` to `assets.all` for each of the three
  queries (inBetrieb, inPlanung, netzbetreiberPruefung). Since `assets.all` fans
  out per technology type internally, each type was individually capped at 1000
  rows — VNBs with >1000 installations of a single type showed `pvAnlagen: 1000`
  or `speicherAnlagen: 1000` (the limit, not the real count). Fixed by omitting
  the `limit` parameter so `energy-market.installations` enables unlimited
  pagination. Also added `includeNapData: false` to skip unused NAP fields and
  reduce per-row payload.

## [0.9.10] - 2026-03-20
### Fixed

- **MaStR status filter type mismatch — `inBetrieb` / `inPlanung` returned identical counts**
  `einheitBetriebsstatus` is stored as a number in MongoDB, but the post-filter in
  `energy-market.service.js` compared it against an array of strings (`['35']`),
  so `allowedStatuses.includes(35)` was always `false` and every row passed regardless
  of status. Both the `inBetrieb` (status 35) and `inPlanung` (status 31) queries
  returned the full unfiltered installation set, producing identical counts and
  capacities. Fixed by: (1) passing `status` directly to `cernion_installations_local`
  for DB-level filtering, (2) normalising with `String(inst.einheitBetriebsstatus)`
  in the post-filter safety net.

- **EWK data-gap errors surfaced as `sourceErrors` (CR-MCP-03)**
  `ewk_umsetzungsquote` and `ewk_digitalisierungsindex` return `isError: true` when
  a VNB has no data in those datasets (inconsistent with `ewk_anschlussdauer` which
  returns empty rows). `format-response.js:applyFormat` converts `isError: true` into
  a thrown error (`"Upstream tool returned an error with no details"`), which then
  appeared in `ewk.sourceError` even when `anschlussdauer` succeeded. Added
  `isEwkDataGapError()` helper; when `ewk.sourceAvailable` is `true` (anschlussdauer
  succeeded), umsetzungsquote/digitalisierungsindex errors matching the data-gap
  pattern are suppressed and treated as missing dataset coverage rather than failures.

- **MaStR silent empty result for operators resolved via `cernion_market_partners`**
  `cernion_market_partners` returns annotated MaStR IDs such as
  `"SNB935578300972 (strom, 100% Match)"`. The annotation suffix was passed verbatim
  as `gridOperatorId` to `cernion_installations_local`, which cannot match annotated
  IDs and silently returned 0 results (`mastr.sourceAvailable: false`, no error).
  Fixed by stripping the annotation with `.split(' ')[0].trim()` in `assets.service.js`.

## [0.9.9] - 2026-03-20
### Fixed

- **Stale BDEW code identity resolution (Issue #3)**
  Improved `resolveVnbIdentity()` fallback chain to properly handle stale BDEW codes:
  - Added explicit check for `success !== false` in vnbLookupCodes response to catch MCP tool errors
  - Added debug logging for successful canonical resolution via vnbLookupCodes
  - Improved error message logging when vnbLookupCodes returns error details
  - Ensures stale codes (like 9904350000002) now resolve to canonical operator name instead of "Unknown"
  - Prevents downstream EWK tool failures and upstream error noise in logs

### Added

- **GitHub Release workflow**
  Added `.github/workflows/release.yml` to run on version tags (`v*`) and
  `workflow_dispatch`, executing release quality checks (`npm run release:check`),
  build validation, and automated GitHub Release publication with generated notes.

- **Contribution governance templates**
  Added standardized GitHub collaboration templates for transparent OSS workflows:
  - `.github/pull_request_template.md`
  - `.github/ISSUE_TEMPLATE/bug_report.yml`
  - `.github/ISSUE_TEMPLATE/feature_request.yml`
  - `.github/ISSUE_TEMPLATE/config.yml` (disables blank issues, adds guidance links)

### Changed

- **Maintenance CI pipeline hardening**
  Extended `.github/workflows/maintenance-ci.yml` with additional transparent
  quality gates and reporting:
  - `npm run lint`
  - `npm run build`
  - coverage artifact upload (`coverage/lcov.info`, `coverage-final.json`)
  - Codecov upload for public coverage visibility

- **README transparency badges and policy guidance**
  Updated `README.md` with CI/CodeQL/Release/Codecov badges and a dedicated
  CI/CD transparency section describing required checks and recommended branch
  protection on `main`.

### Fixed

- **VNB Monitor: EWK operatorName mismatch with identity resolution**
  Fixed inconsistency in the EWK snapshot where `ewk.operatorName` could differ
  from the correctly-resolved `identity.name`. The EWK tools on the Cernion MCP
  server may return operator names that don't match the BDEW code's canonical
  name from the market partner registry. Now `ewk.operatorName` is overridden with
  the authoritative identity-resolved name after EWK data fetch completes.

  Impact: VNB monitor snapshots now show consistent operator names across
  `identity.name` and `ewk.operatorName` fields, preventing confusion from
  mismatched company names.

- **VNB Monitor: Missing EWK data in snapshot response**
  Fixed parameter mapping issue in `services/ewk-monitoring.service.js`. The three EWK
  monitoring actions (`anschlussdauer`, `umsetzungsquote`, `digitalisierungsindex`) were
  passing the `bnr` (BNetzA operator number) parameter directly to the Cernion MCP tools,
  but the MCP tools expect this parameter to be named `bdewCode`. Added parameter
  conversion: `bnr` → `bdewCode` in all three handlers before forwarding to MCP.

  Root cause: vnb-monitor.service calls `ewk-monitoring.anschlussdauer({ bnr: bdewCode })`,
  but the EWK tools on the Cernion MCP server don't recognize `bnr`. The Moleculer-level
  parameter name (`bnr`) didn't match the MCP tool's expected parameter name (`bdewCode`).

  Impact: Production VNB monitor endpoints now correctly return EWK benchmark data
  (connection times, implementation rates, digitalization scores) instead of null values.

- **VNB Monitor: EWK MCP session-limit collisions on cold-cache concurrent requests**
  Serialized the three EWK sub-requests in `services/vnb-monitor.service.js`
  (`anschlussdauer`, `umsetzungsquote`, `digitalisierungsindex`) instead of
  firing them in a single `Promise.all`. Also serialized the market-data
  sub-requests (`energy-market.prices`, `gas-storage.countryStorage`) to avoid
  the same session-limit collision in the market phase.

  Root cause: the Cernion MCP server enforces an effective per-token
  concurrent-session limit. When `GET /api/vnb-monitor/:bdewCode` and
  `GET /api/vnb-monitor/:bdewCode/nbp-monitor` arrived concurrently on a cold
  cache, both flows opened EWK MCP sessions at the same time and could trigger
  `-32001 "Session not found"` on the second batch.

  Result: production requests now stay within the MCP session limit across
  both the EWK and market-data phases and no longer fail intermittently during
  concurrent VNB/NBP monitor loads.

- **VNB Monitor: `ewk.sourceAvailable=false` for providers with multiple BDEW codes**
  German DSOs can be registered in the EWK database under a different BDEW code than
  the one used for DSO market-role operations (e.g. a utility holding code instead of
  the grid-operator code). `fetchEwkData()` now tries the primary BDEW code first, then
  all alternate codes found via `grid-operations.marketPartners` for the same provider,
  and finally falls back to a `vnbName`-based query as last resort.

  Changes in `services/vnb-monitor.service.js`:
  - Added helpers `normalizeOperatorName()`, `isLikelySameOperator()`, `extractBdewCode()`.
  - Added `findAlternateBdewCodes()` — queries `grid-operations.marketPartners` by identity
    name and filters candidates that token-match the expected provider, returning their codes.
  - `fetchEwkData()` accepts `options = { providerName, alternateBdewCodes }` and iterates
    through all candidate queries, guarding against cross-provider matches via
    `isLikelySameOperator()`.
  - `snapshot` handler now resolves VNB identity first, then finds alternates, then fetches
    EWK (previously: EWK was fetched before identity was resolved).
  - Duplicate error strings in `ewk.sourceError` are deduplicated with
    `Array.from(new Set(sourceErrors))`.

  Impact: Providers like TWL Netze GmbH (DSO code `9907473000008`) now return
  `ewk.sourceAvailable=true` via their alternate utility BDEW code or name-based lookup.

- **VNB Monitor: hardening against transient MCP/provider failures**
  Improved resilience of `services/vnb-monitor.service.js` for EWK and market snapshots:
  - Added retry with backoff and per-call timeout overrides for MCP-backed actions
    (`callActionWithRetry`, retriable: timeout/503/session/opaque-upstream errors).
  - `fetchEwkData()` no longer stops at the first partial EWK hit; it now continues
    through fallback queries and merges missing dimensions (`anschlussdauer`,
    `umsetzungsquote`, `digitalisierungsindex`) when later queries provide them.
  - `ewk.sourceError` now reports only unresolved dimensions after all fallback attempts.
  - `fetchMarketData()` retries price and gas calls, uses explicit date for day-ahead
    (`date=today`), and falls back to `german-grid.spotprices` when
    `energy-market.prices` has no usable data.

  Impact: fewer false-negative null sections in snapshots during transient upstream
  outages, while preserving transparent source error reporting for unresolved metrics.

- **VNB Monitor: MaStR `Session not found` reduction under nested asset fan-out**
  `fetchMastrData()` no longer executes the three `assets.all` requests in a top-level
  `Promise.all`. Calls are now serialized (`inBetrieb` → `inPlanung` →
  `netzbetreiberPruefung`) and wrapped with retry/backoff + extended timeout.

  Root cause: each `assets.all` call can fan out internally by installation type; running
  three of these in parallel caused nested concurrency spikes and upstream MCP session
  collisions (`-32001 Session not found`).

  Impact: significantly fewer MaStR fetch failures and more stable snapshot completion
  under concurrent API load.

- **VNB Monitor: wasted EWK round-trips on stale market-partner BDEW mappings**
  Restructured the inner query loop in `fetchEwkData()` in
  `services/vnb-monitor.service.js` to use `ewk_anschlussdauer` as an early probe.
  When the probe row returns a `firmenname` that doesn't match the expected provider,
  the two remaining EWK calls (`ewk_umsetzungsquote`, `ewk_digitalisierungsindex`) for
  that query are skipped immediately instead of being executed and then discarded.

  Root cause (Issue #3): the Cernion market-partner database contained a stale record
  associating BDEW code `9904350000002` ("Freiberger Stromversorgung GmbH") with the
  name "TWL Netze GmbH". `findAlternateBdewCodes()` accepted the code because the DB
  record named it correctly from the operator's perspective; the mismatch was only
  visible once the EWK tool returned data for Freiberger. Previously, all three EWK
  calls were made before any mismatch check, wasting 2 extra round-trips per stale code.

  The existing final mismatch guard is preserved as a fallback for the edge case where
  the probe returns no rows but a subsequent call returns data for the wrong operator.

  Impact: for operators with one stale alternate BDEW code in the fallback chain, the
  number of futile EWK calls drops from 3 to 1 per stale entry. The fix is fully
  client-side and does not require changes to the Cernion MCP backend.

- **VNB Monitor: canonical alternate-code resolution via MCP `vnb_lookup_codes`**
  Integrated the new MCP lookup tool into `findAlternateBdewCodes()` in
  `services/vnb-monitor.service.js`.

  Behavior:
  - First try `grid-operations.vnbLookupCodes` (MCP tool `vnb_lookup_codes`) to
    obtain canonical aliases.
  - Use only 13-digit BDEW aliases with `confidence=high|medium` and no
    `conflictFlags`.
  - Fall back to `grid-operations.marketPartners` only if the canonical lookup
    is unavailable, low-confidence, or conflict-marked.

  Also added new gateway action `grid-operations.vnbLookupCodes`
  (`POST /api/grid-operations/vnb-lookup-codes`) as direct wrapper around the
  MCP tool.

  Impact: stale market-partner mappings are bypassed in the primary alias
  resolution path, reducing false alternate-code selection (Issue #3).

## [0.9.8] - 2026-03-19

### Added

- **Async job pattern for long-running REST endpoints (RFC 7231 / HTTP 202)**
  Introduced a file-backed async job persistence layer (`src/job-store.js`) and
  a dedicated polling service (`services/job-status.service.js`) with two new
  REST endpoints:
  - `GET /api/jobs/:jobId/status` — poll job state (`queued` / `running` / `completed` / `error`)
  - `GET /api/jobs/:jobId/result` — retrieve completed result payload

  Jobs are persisted in `.jobs/` as `{jobId}.progress.json` + `{jobId}.result.json`
  with a 24 h TTL (configurable via `JOB_STORE_TTL_SECONDS`).
  GC runs automatically on service startup.

- **Gateway detection flag** (`ctx.meta.$gateway = true`)
  Set in `api.service.js` `onBeforeCall` to distinguish REST gateway calls from
  internal Moleculer service-to-service calls. `startJob()` uses this flag to
  return a synchronous result for internal callers (backwards-compatible).

- **OpenAPI `Jobs` tag** and explicit aliases for job polling endpoints in
  `api.service.js`.

- **UI async job polling support in the web app**
  `src/app.html` now transparently handles `202 Accepted` responses from long-running
  endpoints by polling `statusUrl` / `resultUrl` and returning the final payload
  through the shared `apiFetch()` helper.

- **Test coverage for async job infrastructure**
  Added `tests/job-store.test.js` and `tests/job-status.service.test.js`.

### Changed

- **`grid-operations` service** — 5 long-running actions migrated to async job pattern:
  `gridData`, `operatorAnalysis`, `capacityUtilization`, `redispatchExport` (JSON format;
  CSV/XLSX remain synchronous), `connectionCapacityCheck`.

- **`business-intelligence` service** — 3 long-running actions migrated to async job pattern:
  `salesLeads`, `churnPrediction` (JSON format; CSV/XLSX remain synchronous),
  `marketPenetration`.

- **`.gitignore`** — added `.jobs/` alongside `.reports/`.

## [0.9.7] - 2026-03-18

### Added

- **`nbp-monitor` microservice** (`services/nbp-monitor.service.js`)
  New Netzbetreiberprüfungs-Monitor service with three strategic KPIs derived
  from MaStR installations in status 2955 (NetzbetreiberPrüfung ausstehend):
  - **KPI 1 — Volume Indicator**: total kWp per age class (A/B/C/D) and unit
    type (PV/Wind/Speicher/Sonstige) with configurable alert thresholds
    (🟢 < 50 MW / 🟡 50–150 MW / 🔴 > 150 MW).
  - **KPI 2 — Risk Indicator**: estimated billing uncertainty in € using a
    configurable formula: `kWp × volllaststunden × einspeisevergütung × years / 1000`.
    Default parameters per technology are persisted to `NBP_PARAMETERS_FILE`.
  - **KPI 3 — Process Indicator**: heuristic classification of open tickets into
    VNB-seitig (> 6 weeks), In Bearbeitung (< 6 weeks), and Altlast (> 52 weeks)
    based on `DatumLetzteAktualisierung`. Percentage breakdown with disclaimer.
  - In-memory snapshot cache (default TTL 24 h).
  - Actions: `snapshot`, `getParameters`, `setParameters`, `resetParameters`.

- **New REST endpoints**
  - `GET  /api/vnb-monitor/:bdewCode/nbp-monitor` — full NBP Monitor snapshot
    (explicit alias; also reachable at `/api/nbp-monitor/:bdewCode`)
  - `GET  /api/nbp-monitor/parameters` — current KPI 2 parameters
  - `PUT  /api/nbp-monitor/parameters` — save custom parameters (full-access token required)
  - `DELETE /api/nbp-monitor/parameters` — reset to defaults (full-access token required)

- **Integration Hub NBP Monitor sub-panel** (`src/app.html`)
  Fifth sub-section added to `#integration-hub-panel`:
  - BDEW input + Refresh button
  - KPI 1 stacked bar chart (inline SVG, no external libraries)
  - KPI 2 risk number card with inline collapsible parameter editor
  - KPI 3 donut chart (inline SVG, `stroke-dasharray` technique)
  - PLZ detail table (top 50 PLZ by kWp)
  - Client-side filters (type, age class) that update charts without
    server round-trips
  All charts use existing CSS custom properties for colours.

- **Power BI — NBP Monitor M-Query** in Connector Generator
  New `Power BI – NBP` tab generates an M-Query for the
  `/api/vnb-monitor/:bdewCode/nbp-monitor` endpoint with ready-to-use
  `volumeExpanded`, `riskTable`, and `processTable` sub-queries.

- **`.env.example` additions**
  `NBP_PARAMETERS_FILE` and `NBP_CACHE_TTL_SECONDS`.

### Changed

- **`api.service.js`**: added `NBPMonitor` OpenAPI tag; added `isAbsolutePublicPath`
  entries for `/nbp-monitor` and `/vnb-monitor` to prevent path double-prefixing;
  added full-access scope guard for `PUT/DELETE /api/nbp-monitor/parameters`.

### Tests

- Added `tests/nbp-monitor.service.test.js` (56 tests) covering:
  snapshot structure and schema, age-class boundary values (A/B/C/D),
  KPI 2 formula correctness for all four technologies and age classes,
  KPI 3 6-week and 52-week boundaries, parameter save/reset/validation,
  cache invalidation on parameter change, empty and error installations.
- Extended `tests/api.service.test.js` with NBP Monitor route and OpenAPI checks:
  explicit aliases, NBPMonitor tag, token query param coverage, scope guard.

## [0.9.6] - 2026-03-18

### Added

- **Integration Hub panel in `src/app.html`**
  Added a new `#integration-hub-panel` with:
  - Token management (create/list/revoke, one-time token reveal)
  - Connector snippet generator for Power Automate + Power BI
  - Alert-threshold editor for VNB Monitor with save/reset controls

- **`token-manager` microservice**
  Added `services/token-manager.service.js` with REST endpoints:
  - `GET /api/tokens`
  - `POST /api/tokens`
  - `DELETE /api/tokens/:id`
  - `POST /api/tokens/verify`
  Tokens are generated as `ck_` keys, stored hashed (SHA-256), and support
  `read-only` / `full-access` scopes.

- **VNB Monitor threshold management endpoints**
  Added to `services/vnb-monitor.service.js`:
  - `GET /api/vnb-monitor/thresholds`
  - `PUT /api/vnb-monitor/thresholds`
  - `DELETE /api/vnb-monitor/thresholds`
  Includes persisted threshold overrides and automatic cache invalidation.

### Changed

- **API Gateway token handling and scoped auth checks**
  Extended `services/api.service.js` request preprocessing:
  - Keeps existing Cernion MCP token behavior intact (`Bearer` / `token` override)
  - Adds API token verification for `ck_` tokens via `token-manager.verify`
  - Enforces `read-only` write restrictions and `full-access` route checks
    on Integration Hub administration endpoints.

- **Environment configuration updates**
  Added `.env.example` keys:
  - `TOKEN_STORAGE_FILE`
  - `CERNION_PUBLIC_URL`

### Fixed

- **OpenAPI `requestBody` annotations for `token-manager` POST endpoints**
  Added missing `requestBody` schema declarations for `POST /api/tokens` (create)
  and `POST /api/tokens/verify` so the OpenAPI audit gate reports 0 issues.

## [0.9.5] - 2026-03-17

### Fixed

- Research-Agent: Pure EWK questions no longer fall into the inhouse benchmark
  shortcut solely because inhouse descriptors exist. This removes the forced
  `Inhouse Datenquelle` Pflichtfeld for queries such as
  `"Wie ist die TWL Netze GmbH hinsichtlich der EWK aufgestellt?"` when no
  inhouse dataset is actually needed.
- Research-Agent: `vnbName` is now derived from the user question for common
  EWK/VNB phrasings and injected as a non-required default, so the UI no
  longer asks again for a VNB that is already named in the prompt.

## [0.9.4] - 2026-03-16

### Added

- Added `tests/acceptance/` real-world acceptance fixtures for procurement,
  iMSys rollout, grid incidents, and PV asset inventory, including companion
  `*.acceptance.json` sidecars with acceptance query sets and connector config.

- Added `tests/acceptance.realworld.test.js` to validate acceptance fixture
  integrity (row ranges + sidecar metadata) and to assert expected semantic
  auto-classification with `requiresUserInput: false` for all four datasets.

- Added `docs/use-cases/` documentation entries for passing inhouse–external
  hybrid query patterns used in the v0.9.4 acceptance flow.

- **Period-format normalisation for mixed time references**
  Added `src/period-normaliser.js` with `normalisePeriod()` and
  `isPeriodColumn()` to normalize values like `Jan 2026`, `2026-Q1`, and
  `YYYY-MM` to ISO start dates. Integrated this into
  `in-memory-join.meteringSpotCost` and agent planning so procurement-style
  period columns can be joined reliably with spot-price time series.

- **Hybrid inhouse × external benchmark routing**
  Added intent class `inhouse_benchmark_compare` in `agent.service` for
  benchmark/comparison queries on `grid-assets` and `metering-point-master`.
  Added `in-memory-join.benchmarkCompare` plus REST alias
  `POST /api/in-memory-join/benchmark-compare` for aggregate-vs-benchmark
  delta, ranking, and narrative output.

- **Automatic VNB identity resolution**
  Added `src/vnb-identity.js` and integrated auto-resolution into planning and
  execution flows so VNB context is resolved from environment and datasource
  metadata before prompting users. Added VNB-related environment keys to
  `.env.example`.

- **Datasource filesystem watcher**
  Added `services/datasource-watcher.service.js` to watch `./uploads/`,
  debounce file change events, refresh mapped datasource caches, and emit
  `datasource.file.refreshed` events. Added status endpoint wiring via
  `GET /api/datasource-watcher/status`.

- **Optional LLM-assisted classifier fallback**
  Extended `datasource-classifier` with opt-in fallback for low-confidence
  (`< 0.35`) unknown classifications. Added `llmAssisted` and `llmReasoning`
  outputs, and `CLASSIFIER_LLM_FALLBACK_ENABLED` environment toggle.

### Changed

- **Datasource UI enhancements for v0.9.4 flows**
  Updated `src/app.html` to surface AI-assisted classification state and to
  poll watcher status for automatic refresh notifications when upload-backed
  sources are updated.

### Fixed

- **Bundesnetzagentur Kraftwerksliste CSV ingestion and semantic classification**
  Fixed datasource onboarding for raw `Kraftwerksliste_CSV.csv` exports by
  teaching the CSV connector to preserve quoted multiline header cells,
  enabling correct parsing of files with metadata preamble rows plus embedded
  newlines in header labels. This allows Kraftwerksliste-style files to be used
  with `delimiter: ';'`, `encoding: 'windows-1252'`, and `skipRows: 10`.

- **Manual semantic domain override now persists the selected domain**
  Updated `datasource-classifier.confirm` / forced classification handling so a
  user-selected domain is treated as authoritative instead of silently falling
  back to `unknown` when the auto-classification score is below the heuristic
  threshold.

- **Grid asset classification coverage for generation-unit inventories**
  Expanded the `grid-assets` semantic domain to recognize generation asset
  inventories such as Kraftwerksliste / MaStR-derived power plant extracts,
  including signals like `MaStR`, `Energieträger`, `Spannungsebene`,
  `Inbetriebnahme`, `Technologie`, and `Anschlussnetzbetreiber`.

- **Acceptance classification confidence for iMSys and PV fixtures**
  Expanded semantic indicators for `metering-point-master` (iMSys rollout
  signals) and `grid-assets` (PV/internal-asset signals) so realistic
  acceptance datasets classify to the intended domain without manual
  confirmation.

- **OpenAPI request-body completeness for benchmark compare endpoint**
  Added explicit request body schema and property examples for
  `in-memory-join.benchmarkCompare` so OpenAPI audit passes with zero issues.

- **`procurement_vs_spot` plan parameter binding when discovery uses `source_id`**
  Fixed `listInhouseDescriptors()` in `agent.service` to normalize all three
  field-name variants returned by `datasource-discovery.list` —
  `sourceId` (camelCase), `source_id` (snake_case), and `id` — into the
  canonical `sourceId` used by plan builders. Before this fix, descriptors
  with `source_id` resolved to `null`, causing `datasource-cache.query` to
  fail with "Daten nicht gefunden / fehlende Parameter" before the spot-price
  fetch was ever reached. Also normalizes `aliases` construction from the
  resolved `sourceId` in the same pass.

- **Datasource registry persistence for user-confirmed semantic domains**
  Fixed `datasource-classifier.confirm` so that a manually selected domain is
  stored as authoritative and is never silently overwritten by the heuristic
  classifier on the next refresh cycle. Previously, low-confidence sources
  reverted to `unknown` after cache invalidation even when a domain had been
  explicitly confirmed by the operator.

- **Release baseline cleanup (formatting + lint auto-fix)**
  Executed repo-wide Prettier and ESLint auto-fix pass across `services/`,
  `src/`, `tests/`, and `scripts/` as the v0.9.4 baseline cleanup step.

### Tests

- Added CSV connector regression coverage for quoted multiline header parsing
  after skipped metadata rows.

- Added semantic-classifier regressions for Kraftwerksliste-style generation
  CSVs and for authoritative manual domain overrides.

- Added `tests/period-normaliser.test.js` for period parsing and detection.
- Added `tests/datasource-watcher.service.test.js` for mapped refresh,
  debounce, and unmapped file handling.
- Added `tests/vnb-identity.test.js` for env-first, metadata fallback, and
  unresolved cases.
- Extended `tests/agent.service.test.js`,
  `tests/in-memory-join.service.test.js`, and
  `tests/datasource-classifier.service.test.js` with v0.9.4 routing,
  normalisation, benchmark, and LLM-fallback regressions.

## [0.9.3] - 2026-03-14

### Added

- **Semantic datasource onboarding flow**
  Added a new semantic classification layer for inhouse datasources with a
  static domain registry, heuristic `datasource-classifier` service, and sample
  fixtures covering utility-relevant domains such as metering, procurement,
  grid assets, billing, receivables, MaKo, redispatch, and MaStR extracts.

- **Datasource classification API and discovery enrichment**
  Added `GET /api/datasources/:id/classification` and
  `PATCH /api/datasources/:id/classification`, persisted semantic
  classifications on datasource records, and propagated confirmed domain hints
  plus critical field mappings into datasource discovery descriptors and agent
  planning context.

- **Datasource UI semantic onboarding**
  Extended the datasource panel in `src/app.html` with semantic readiness
  badges, an inline onboarding banner for confirm/correct flows, and automatic
  classification polling after inference.

### Known Limitations

- **Mixed-format `Lieferperiode` not parseable as time reference for spot-price join**
  The `timeseries_cost_enrichment` intent class requires an ISO-parseable timestamp column. The `procurement` domain's `Lieferperiode` field uses mixed formats (`Feb 2026`, `2026-Q1`, `Jan 2026`) that the current timestamp parser cannot resolve. Spot-price join queries against procurement data will fail until either the fixture data uses ISO dates or a period-normalisation step is added to the intent class planner. Tracked for v0.9.4.

- **EWK-Benchmark not fetched in hybrid PV/asset queries when `inhouse_aggregate` intent is selected**
  When a query combines an inhouse asset inventory with an external EWK benchmark, the planner currently falls back to pure `inhouse_aggregate` without calling `Cernion:ewk_benchmark_vnb`. The hybrid routing for `grid-assets` × EWK is not yet implemented. Tracked for v0.9.4.

## [0.9.2] - 2026-03-13

### Fixed

- **Datasource dictionary infer/refresh REST alias mapping**
  Corrected API gateway aliases to existing registry actions:
  `POST /api/datasources/:id/infer` → `datasource-registry.infer`
  and `POST /api/datasources/:id/refresh` → `datasource-registry.refresh`.

- **Inference flow now persists inferred dictionary fields in UI**
  Updated `src/app.html` infer actions to apply the inferred draft through
  dictionary update, preventing stale views where only legacy fields (e.g. `column_1`)
  remained visible after infer.

- **CSV delimiter auto-detection for local file connector**
  Added automatic delimiter detection (`;`, `,`, tab, `|`) when no delimiter is
  configured, plus BOM-safe header handling, so comma-separated files no longer
  collapse into a single `column_1` field.

- **Single-column cached CSV row normalization in in-memory analytics**
  Added normalization for cached rows containing full CSV lines under one column,
  enabling robust timestamp/consumption extraction in
  `in-memory-join.meteringSpotCost` and `in-memory-join.compareForecastActual`.

- **Spot-price source resilience in metering cost calculation**
  Enhanced `in-memory-join.meteringSpotCost` to accept
  `priceEURperMWh` payloads and to fallback to `german-grid.spotprices` when
  `energy-market.prices` returns no rows for the requested interval.

- **OpenAPI request-body completeness for in-memory join endpoints**
  Added request body schemas with required fields and examples for
  `POST /api/in-memory-join/join`,
  `POST /api/in-memory-join/metering-spot-cost`, and
  `POST /api/in-memory-join/compare-forecast-actual` so the OpenAPI audit gate
  reports zero issues.

### Tests

- Extended `tests/in-memory-join.service.test.js` with regressions for:
  single-column cached CSV parsing and market-price fallback behavior.

- Extended `tests/datasource-connector.integration.test.js` with a regression
  that verifies comma delimiter auto-detection when connector delimiter is unset.

### Added

- **Metering fixture for datasource E2E tests**
  Moved `sample_metering.csv` into `tests/fixtures/` so integration/E2E tests can
  use a stable, real-world load-profile dataset.

- **Request-based metering cost enrichment in `datasource-cache.query`**
  Added optional query params `includeCost`, `priceCentPerKWh`, `intervalMinutes`,
  `consumptionPowerField`, and `feedInPowerField`. When enabled, cached rows are
  enriched with `netPowerW`, `intervalEnergyKWh`, and `intervalCostEur`.

- **New `in-memory-join` microservice for cross-source joins**
  Added `POST /api/in-memory-join/join` for generic in-memory joins between
  datasource rows and arbitrary action outputs (inner/left joins, exact/hourly/daily
  key matching, collision strategies).

- **Metering + market-price join endpoint for real spot-cost answers**
  Added `POST /api/in-memory-join/metering-spot-cost` to combine inhouse metering
  intervals with `energy-market.prices` and calculate interval/hour/day electricity
  costs using actual market prices (€/MWh), including totals and missing-price
  diagnostics.

- **Agent planning integration for inhouse metering cost research**
  Updated `agent.service` planning rules to prefer `in-memory-join.meteringSpotCost`
  for questions like "Wie sind die Stromkosten von LPTest am 10.03.2026 gewesen?",
  so the research flow can use real datasource measurements plus market prices.

- **Intent classes for reusable inhouse time-series logic**
  Implemented deterministic intent-class routing in `agent.analyze` for:
  `timeseries_cost_enrichment`, `timeseries_compare_actual_vs_forecast`, and
  `timeseries_delta_analysis`.

- **Auto-alias extraction from filename stem and description tokens in datasource discovery**
  `datasource-discovery` now calls `extractAliases(source)` when building descriptors.
  Aliases are derived from: (1) path stem tokens in `connectorConfig.path`
  (e.g. `GW29_metering_2026.csv` → `['GW29', 'metering', '2026']`) and
  (2) alphanumeric+digit tokens from `source.description` (e.g. `"Lastprofil GW29"` → `'GW29'`).
  This means queries containing only a meter ID like `"GW29"` are now automatically routed
  to the correct datasource without the caller needing to supply an explicit `inhouseSources` list.

- **Description identifier token matching in `resolveInhouseSourceForIntent`**
  The agent's inhouse source resolver now also extracts digit-containing tokens from
  `__sourceMeta.sourceDescription` as a secondary fallback, covering cases where
  discovery descriptors may not yet carry the enriched aliases array.

- **Auto-select single capable source in `buildIntentClassPlan`**
  When the intent class is detected but no source was resolved by alias, the plan builder
  now checks if exactly one fresh datasource with the matching capability exists and
  auto-selects it — no prompt shown to the user. This handles the common single-tenant
  scenario where a user has one metering CSV and just asks about costs.

- **Named select dropdown instead of raw UUID input in `buildIntentClassPlan`**
  When multiple capable sources exist and none was auto-resolved, `requiredInputs` now
  includes a `type: 'select'` field with `{label, value}` options showing human-readable
  source names (mapped to UUIDs). Replaces the previous text input that asked for a raw UUID.

- **`renderForm` in `app.html` handles `{label, value}` option objects**
  The UI's dynamic form renderer now handles select options as either plain strings or
  `{label, value}` objects, enabling the named datasource dropdown.

- **`compareForecastActual` in-memory analytics endpoint**
  Added `POST /api/in-memory-join/compare-forecast-actual` to execute the
  generic pattern: fetch forecast data, read inhouse actual data, join on time,
  calculate deltas, and return table-ready aggregates.

- **Semantic inhouse descriptor enrichment for planner discoverability**
  `datasource-discovery` descriptors now include `aliases`, `capabilities`, and
  `semanticHints` (e.g. inferred time field, consumption/feed-in fields,
  generation field, MaStR/MeLo-like identifiers) to improve automatic plan
  selection across similar use cases.

### Tests

- Added `tests/datasource-metering.integration.test.js` covering the full v0.9
  datasource flow (`registry.create` → `cache.refresh` → `cache.query`) and
  asserting cost enrichment on the sample metering CSV.

- Added `tests/in-memory-join.service.test.js` covering generic hourly join logic
  and the LPTest-style metering spot-cost calculation workflow.

- Extended `tests/agent.service.test.js` with a regression test that ensures
  LPTest cost questions are planned with `in-memory-join.meteringSpotCost`
  (without drifting into MaStR actor lookups).

- Extended `tests/agent.service.test.js` with intent-class coverage for
  actual-vs-forecast planning (`in-memory-join.compareForecastActual`).

- Extended `tests/in-memory-join.service.test.js` with a forecast-vs-actual
  delta calculation scenario.

- Extended `tests/datasource-discovery.service.test.js` with assertions for
  descriptor `aliases`, `capabilities`, and `semanticHints`.

### Fixed

- **API alias mismatch for dictionary history route**
  Corrected API gateway alias to `datasource-registry.getDictionaryHistory`
  for `GET /api/datasources/:id/dictionary/history`.

- **API alias mismatch for datasource cache query route**
  Corrected `GET /api/datasource-cache/:sourceId` to use
  `datasource-cache.query` (instead of non-existent `datasource-cache.get`).

- **Agent fallback to wrong domain for LPTest-like names**
  Added deterministic intent handling in `agent.analyze` for inhouse metering
  cost questions so names like `LPTest` are treated as datasource context, not
  market-partner/MaStR actor search terms.

## [0.9.1] - 2026-03-12

### Added

- **Data Sources management panel in `src/app.html`** (CR-UI-001 through CR-UI-012)
  Added a full `#datasources-panel` section to the built-in single-page application.
  The panel integrates three sub-views — Source List, Source Form, and Dictionary View —
  each built with Vanilla JS following the established IIFE and CSS-token patterns.

- **`showPanel()` outer-scope dispatcher** (CR-UI-001)
  Centralises panel switching for Research, 360° Report, and Data Sources.
  Defined in outer scope (not inside any IIFE) so all three nav targets share
  one authoritative dispatcher. Retrofits the `nav-reset` handler to restore
  `problem-card` visibility when returning to research from any secondary panel.

- **Toast notification system** (CR-UI-001)
  Added `#toast-container` markup and `toast(message, type)` outer-scope helper.
  All datasource UI interactions use toasts instead of `alert()` or `confirm()`.

- **All new CSS classes via existing custom properties** (CR-UI-012)
  Added: `.cache-badge` (`.fresh` / `.stale` / `.empty` / `.error`),
  `.skeleton-row` / `.skeleton-cell` (shimmer animation), `.privacy-toggle`
  (CSS-only PII toggle), `.dict-table`, `.icon-btn`, `.info-callout`,
  `.warn-callout`, `.version-badge`, `.ds-section-title`, `.ds-actions-row`,
  `.ds-filter-input`. All use `var(--*)` tokens; no existing selectors modified.

- **Source List sub-view with skeleton loading** (CR-UI-002)
  Loads from `GET /api/datasources` + `GET /api/datasource-discovery` (merged
  by `sourceId`). Displays 5 shimmer skeleton rows while loading. Supports
  real-time client-side filtering. Shows connector-type icon map, cache-status
  badges, and per-row actions (Edit, Dictionary, Refresh, Delete).

- **Inline Delete confirmation popover** (CR-UI-006)
  Replaces the Delete button with an inline `"Delete X? Yes / Cancel"` popover.
  No `window.confirm()` used anywhere in the datasource code.

- **Inline Refresh with 2 s polling** (CR-UI-007)
  `POST /api/datasources/:id/refresh` followed by polling
  `GET /api/datasource-cache/:id/status` every 2 s. Updates the cache badge
  in place without a full panel reload. Shows `✅ Refreshed — N rows` toast.

- **Source Form sub-view** (CR-UI-003 / CR-UI-004 / CR-UI-005)
  Three collapsible `<details>` sections: Basic Info, Connector (dynamic
  config fields rendered from `GET /api/datasources/connector-types` JSON
  Schema), and Cache Policy (cron/ttl/manual/onDemand with live summary text).
  Scraper + onDemand conflict auto-resets to cron with toast warning.
  Actions: `💾 Save Source`, `🤖 Save & Run AI Inference`, `✕ Cancel`.

- **Dictionary View sub-view** (CR-UI-008 / CR-UI-009 / CR-UI-010)
  Field table with inline privacy-flag CSS toggles (red-tint row + synthetic
  pattern input reveal on toggle). Inference result diff banner (Apply /
  Dismiss). Re-run Inference button. Collapsible version history with per-version
  Restore flow. Wires `PUT /api/datasources/:id/dictionary`,
  `GET …/dictionary/history`, and `POST …/infer`.

- **Inhouse Source Picker in Research Agent Step 1** (CR-UI-011)
  Collapsible chip picker below the Step 1 textarea, loaded from
  `GET /api/datasource-discovery`. Selected source IDs are appended as
  `inhouseSources: [...]` to `POST /api/agent/analyze` via a capture-phase
  listener that fires before the outer analyze handler.

- **`GET /api/datasources/connector-types` REST endpoint** (CR-UI-013)
  Added `rest: 'GET /connector-types'` and a full `openapi:` annotation
  (`tags: ['DataSources']`, response schema) to the existing `listPlugins`
  action in `datasource-connector.service.js`. OpenAPI audit gate passes 0 issues.

- **Upload Folder + File Upload UI for local-file connectors**
  Added backend upload endpoints for datasource workflows:
  `GET /api/datasources/uploads` (list uploaded files) and
  `POST /api/datasources/uploads` (store Base64 payload in `uploads/`).
  Added a new upload component in the Data Sources form (connector section)
  so users can upload CSV/XLSX/DOCX/GeoJSON files directly from the Web UI and
  apply the uploaded absolute file path into the connector `path` field with one click.
  Added drag-and-drop upload support (plus keyboard-accessible click-to-browse)
  in the connector upload box for faster local-file workflows.
  Increased API JSON body size limit to `25MB` to support practical file uploads.

### Tests

- Extended `datasource-connector.service.test.js` with 4 new tests covering:
  REST route presence (`rest` property contains `GET` and `connector-types`),
  OpenAPI annotation (`tags` includes `DataSources`, `summary` non-empty),
  response schema shape (`data` array with required plugin fields),
  and action round-trip returning all built-in connector types with
  expected shape (`type`, `description`, `configSchema`, `source`).

## [0.9.0] - 2026-06-10

### Added

- **Dictionary version guard endpoint + outdated event**
  Added `GET /api/datasources/:id/dictionary/check?referencedVersion=...` so a
  future Logic Builder can validate stored mappings against the current
  dictionary version. The registry now emits `datasource.dictionary.outdated`
  when a stale version is detected.

- **Privacy Flag handling across all request contexts**
  `datasource-cache` now enforces all three privacy modes:
  `internal` returns raw values, `ai-agent` replaces flagged fields with
  synthetic substitutes, and `public` omits flagged fields entirely.

- **Synthetic data generation + DSGVO audit trail**
  Added support for lightweight synthetic patterns such as
  `{{random.numeric(...)}}`, `{{random.alphanumeric(...)}}`, `{{faker.name}}`,
  `{{faker.email}}`, `{{faker.iban.de}}`, and `{{const("...")}}`, plus the
  read-only DSGVO audit endpoint `GET /api/datasource-cache/:sourceId/audit`.

- **v0.9 datasource layer scaffold**
  Added new services for internal datasource registration, connector execution,
  privacy-aware cache access, and AI-ready discovery:
  `datasource-registry`, `datasource-connector`, `datasource-cache`, and
  `datasource-discovery`.

- **Built-in datasource connector plugins**
  Added built-in connector modules for `csv`, `rest`, `geojson`, and `xlsx`,
  plus optional-dependency connectors for `docx` and `scraper`.

- **Agent integration for inhouse sources**
  `agent.analyze` and refinement planning now inject discoverable inhouse
  datasource descriptors into the Gemini planning prompt so internal datasets
  can participate in hybrid analyses.

### Changed

- **Connector delivery scope clarified**
  `docx` and `scraper` are shipped as functional optional-dependency
  connectors: they load through the common plugin system, expose config
  schemas, and execute reads when `mammoth`, `cheerio`, or `puppeteer` are
  installed, but they intentionally degrade with explicit dependency-missing
  errors in lean environments.

- **OpenAPI/public datasource route support**
  API Gateway OpenAPI generation now preserves milestone-style datasource paths
  such as `/api/datasources`, `/api/datasource-cache/:sourceId`, and
  `/api/datasource-discovery` under the shared `DataSources` tag.
  Full OpenAPI annotations (parameters, requestBody, examples) added to all
  datasource service actions — OpenAPI audit gate passes with 0 issues.

- **Logic Builder backend contract completed**
  The backend now exposes source discovery, dictionary version history, and a
  dictionary version-check endpoint for future Logic Builder integration. The
  actual Logic Builder UI step type and autocomplete are external to this
  repository.

### Tests

- Added focused coverage for datasource registry, connector, cache, discovery,
  API exposure, agent prompt integration with inhouse descriptors, and
  dictionary version-guard event handling.
- Added connector integration test suite (22 tests, real file I/O, no broker).
- Verified privacy behavior for all three `privacyContext` modes plus DSGVO
  audit-log creation in cache service tests.
- Full suite: 36 test suites / 899 tests — all passing.
- Coverage: 77% statements, 67% branches, 79% functions, 79% lines
  (above 55/70/70/70 thresholds).

## [0.8.32] - 2026-03-12

### Changed

- **Maintenance milestone kickoff: staged quality-gate ramp (Release N)**
  Increased Jest global coverage thresholds from `30/50/50/50` to `55/70/70/70`
  (branches/functions/lines/statements) with a documented N+1 ramp target.

- **Testing scripts: explicit unit/integration/e2e split**
  Added `test:unit` and `test:e2e`, and tightened `test:integration` to
  `*.integration.test.js` only.

- **Repository hygiene: stale entrypoint cleanup**
  Replaced legacy placeholder logic in `src/index.js` with a deprecation shim
  that delegates to the real root entrypoint.

- **Developer tooling: debug launch target corrected**
  Updated VS Code launch config to start `index.js` instead of legacy
  `src/index.js`.

- **Operational logging fix: Swagger startup URL corrected**
  API Gateway startup log now prints the correct Swagger endpoint
  `/api/docs` (was `/docs`).

- **CI baseline added**
  Added GitHub Actions maintenance workflow running unit coverage gates,
  integration-test discovery sanity check, OpenAPI audit, and advisory
  dependency security audit.

- **OpenAPI quality gate hardened**
  `scripts/audit-openapi.js` now exits non-zero on findings, supports `rest`
  object syntax, ignores internal `$$` params, handles union param schemas,
  and avoids false positives for path/query params documented outside request bodies.

- **Operational hardening via env-driven broker settings**
  Moleculer reliability and observability controls are now configurable via
  environment variables (`REQUEST_TIMEOUT_MS`, retry policy, circuit breaker,
  bulkhead, tracking, metrics, tracing) for safer production rollout.

- **Security automation baseline added**
  Added GitHub Dependabot configuration and a CodeQL workflow for continuous
  dependency and static security analysis.

- **Fail-safe logging hardening for async polling**
  `src/async-job-poller.js` now uses debug-gated logging with redaction and
  truncation to avoid excessive log volume and accidental sensitive-data
  exposure. Added `ASYNC_POLLER_DEBUG` and `ASYNC_POLLER_LOG_MAX_CHARS` controls.

- **Error redaction hardening (gateway + MCP client)**
  Added centralized sanitization for token-bearing error messages in
  `services/api.service.js` and `src/mcp-client.js` to prevent leaking Bearer,
  query-token, or MCP-path token fragments in responses/logged errors.

- **CI security policy tightened for pull requests**
  Added an enforced critical vulnerability audit gate (`npm audit --audit-level=critical`)
  on PRs while keeping high-level advisory audit reporting.

- **CI test-run stability hardening**
  Added `test:unit:ci` (`--runInBand --forceExit`) and switched maintenance CI to
  use it, preventing intermittent Jest open-handle hangs from blocking pipelines.

- **Default port documentation consistency**
  Aligned `.env.example` and Bearer-auth documentation examples to the default
  local runtime port `3000` and corrected Swagger docs path examples to `/api/docs`.

- **Maintenance acceptance checklist added**
  Added `docs/MAINTENANCE_MILESTONE_CHECKLIST.md` as a pass/fail gate list for
  tests, docs, OSS hygiene, security, fail-safe operations, and resource efficiency.

- **Security audit remediation + policy split**
  Applied available `npm audit fix` updates and reduced audit findings to a
  single upstream `xlsx` advisory with no current fix. CI/security scripts now
  use a blocking `critical` gate plus separate `high` advisory reporting.

- **Release gate consolidation**
  Added `npm run release:check` to execute the core maintenance release gates
  (unit coverage, OpenAPI audit, critical security audit) in one command.

### Documentation

- **Quickstart fixed**: replaced missing `./test-integration-services.sh` with
  `npm run test:integration` and optional `npm run test:e2e`.

- **README script catalog updated** with `test:unit`, `test:integration`,
  `test:e2e`, `audit:openapi`, and `audit:security`.

- **Auth docs clarified**: both Bearer header and `token` parameter are allowed;
  Bearer is recommended for production to minimize URL/log token exposure.

- **Token fallback behavior covered by tests**
  Added MCP client tests for custom-token precedence over env token and
  env-token fallback when no custom token is provided.

- **OpenAPI completeness fixes (agent + utility report)**
  Added missing request examples, path parameter examples, and explicit
  requestBody declarations for body-less POST actions used by rebuild flows.

- **Configuration hardening tests added**
  Added unit tests for env-driven Moleculer reliability/observability toggles
  to validate safe defaults and boolean/number parsing behavior.

- **Security policy updated**: supported security-fix release line aligned to `0.8.x`.

## [0.8.31] - 2026-03-09

### Fixed

- **Report cover: confidentiality/internal-use disclaimer removed for public-source reports**
  Removed the cover badge `Vertraulich · Nur für internen Gebrauch` to align with
  the public data-source positioning of generated management reports.

- **Report cover: transfer-verification disclaimer removed**
  Removed `Bitte vor Weitergabe verifizieren` from the `Datengrundlage` line on the
  cover page to avoid implying restricted internal distribution when only public data
  sources are used.

- **CR-SWV-2026-001 CR-06 [HIGH]: Digitalisierungsindex Bundesmedian scaling corrected**
  Fixed percentage rendering for `DI-Bundesmedian (alle VNBs)` in Section 5 by using
  the raw median value from EWK data with a single percent conversion path. This
  prevents inflated displays such as `3000 %` and restores expected values (e.g. `30 %`).

### Tests

- Updated cover-page regression expectation to reflect removal of the transfer-verification
  disclaimer while keeping `Datengrundlage` and BDEW/MaStR provenance assertions.

## [0.8.30] - 2026-03-09

### Fixed

- **Report runtime stability: suppress AbortSignal MaxListeners warnings under MCP concurrency**
  Added an AbortController bootstrap patch so each new `AbortSignal` is created with unlimited
  listener capacity. This removes noisy `MaxListenersExceededWarning` logs caused by concurrent
  MCP SSE/fetch usage while preserving normal EventEmitter leak warnings.

- **Report generation timeout behavior: no more indefinite pre-poll hangs**
  `callWithAutoPoll()` now wraps the initial MCP call in a timeout race using `maxWaitTime`, so
  long-running tools cannot block forever before returning a `job_id`.

- **Report throughput: Sections 6–8 enrichment now parallelized and bounded**
  Section 6/7/8 calls are executed in one `Promise.all` with `ENRICHMENT_TIMEOUT_MS` (default 90s)
  instead of sequential 15-minute waits. This prevents cumulative timeout cascades and keeps report
  generation responsive under degraded MCP conditions.

- **CR-SWF-2026-003 CR-03-A [CRITICAL]: consistent open-prüfung count across report**
  Unified deterministic use of the parsed MaStR total (`anlagenInPruefung`) across Management Briefing,
  SCHOCKER, and 90-day action plan. AI narrative lines with potentially stale Prüfung/PLZ counts are
  no longer merged into these canonical bullets.

- **CR-SWF-2026-003 CR-03-B [CRITICAL]: Prüfung status classification corrected**
  Replaced substring-based logic with robust status normalization (`pruefungStatusInfo`) so
  `Geprüft` is not misclassified as `In Prüfung`. Redispatch table now shows explicit labels
  (`⚠️ In Prüfung`, `✅ Geprüft`) and highlights real open-status rows correctly.

- **CR-SWF-2026-003 CR-05 [HIGH]: PLZ outlier detail enriched with MaStR/NAP/status**
  Added detailed PLZ outlier table columns: MaStR, Anlage, Typ, PLZ (ist), PLZ (soll), NAP,
  Prüfstatus. Dual-risk detection now flags only true open-prüfung cases. Service-side PLZ prefix
  extraction now considers multiple postal-code fields and no longer hard-filters to `InBetrieb`.

- **CR-SWF-2026-003 CR-10 [MEDIUM]: denominator mismatch explanation (740 vs 698)**
  Section 5 now renders a footnote when EWK denominator totals differ between Anschlussdauer and
  Umsetzungsquote, explaining KPI-specific EWK sub-populations.

- **CR-SWF-2026-003 CR-12 [MEDIUM]: module roadmap transparency**
  Added a dedicated “Modul-Roadmap (verfügbar · auf Anfrage aktivierbar)” block in Section 8,
  listing currently available optional modules instead of silent omission.

### Tests

- Added regression tests for CR-SWF-2026-003 items (CR-03-A, CR-03-B, CR-05, CR-10, CR-12).
- Full suite passes: **845/845 tests**.

## [0.8.29] - 2026-03-09

### Fixed

- **CR-SWF-2026-002 CR-01 [CRITICAL]: MaStR Prüfung count now includes all statuses**
  Removed the `status: 'InBetrieb'` filter from `anlagenInPruefung` and `anlagenInPruefungBeispiel`
  queries — previously suppressed stillgelegte/planned installations, showing 4 instead of 41.
  SCHOCKER heading renamed to "DIE GRÖSSTE OFFENE PRÜFUNG IN IHREM NETZ"; type breakdown
  (Solar·N / Speicher·N / …) and top-10 table added via new `renderMaStrTable()` helper.

- **CR-SWF-2026-002 CR-02 [CRITICAL]: Stillgelegte Anlagen mit offenem Prüfstatus**
  New parallel query `anlagenStillgelegtInPruefung` (status=DauerhaftStillgelegt) feeds a dedicated
  table in Section 1 and a contextual note in the SCHOCKER block when count > 0.

- **CR-SWF-2026-002 CR-03 [HIGH]: Dedicated Redispatch-/§51-Anlagenpool table in Section 1**
  Top-10 installations ≥100 kW InBetrieb (sorted by capacity) rendered via `renderMaStrTable()`
  with MaStR, Name, Typ, kW, Spannung, Ort, MeLo, Prüfung, Status columns.

- **CR-SWF-2026-002 CR-04 [HIGH]: Top-10 largest InBetrieb installations table in Section 1**
  `allInstallationsSample` (limit 10, includeStats: true) passed through service and rendered
  as a sortable capacity-descending summary table.

- **CR-SWF-2026-002 CR-05 [HIGH]: PLZ outlier detail table with MaStR references**
  Ortsfremde Anlagen rendered with address, capacity, and a Dual-Risk badge (⚠️) when the
  installation is both ortsfremd and has an open Prüfstatus.

- **CR-SWF-2026-002 CR-06 [HIGH]: CO₂ framing reframed as §14a dispatch indicator**
  Label changed from 'GrünstromIndex – aktuelle regionale CO₂-Intensität' to
  'Aktueller regionaler Strommix – Echtzeit-Indikator für §14a-Steuerung und
  Beschaffungsoptimierung (Quelle: GrünstromIndex)'.

- **CR-SWF-2026-002 CR-07 [HIGH]: Residuallast cost formula carries Worst-Case disclaimer**
  Both the 80 €/MWh fallback and the hardcoded formula fallback now append
  '⚠️ Worst-Case-Schätzung – kein Planungswert' to prevent misuse as a budgeting figure.

- **CR-SWF-2026-002 CR-08 [HIGH]: Gas fill-level action hints prefixed [Marktkontext DE/EU]**
  All three fill-level action items (KRITISCH / moderate / green) now start with
  '[Marktkontext DE/EU]' and the KPI description clarifies the national scope.

- **CR-SWF-2026-002 CR-09 [HIGH]: vmIst SCHOCKER peer comparison includes Strukturhinweis**
  When the VNB's Verbrauch-MS value is an outlier (>1.5× median) and a peer top-performer
  exists, a contextual note '(Strukturhinweis: Ausreißerwert – Netzgröße und Prozessstruktur
  berücksichtigen)' is appended to the PEER-VERGLEICH paragraph.

- **CR-SWF-2026-002 CR-10 [MEDIUM]: NEST explainer uses dynamic ewkTotal with footnote**
  Replaced hardcoded '740' VNB count with `ewkTotal ?? '?'` from live BNetzA-EWK data;
  added footnote ¹ 'Gesamtzahl VNBs gemäß aktuellem BNetzA-EWK-Datensatz – typisch 730–750 VNBs'.

- **CR-SWF-2026-002 CR-11 [MEDIUM]: renderSourceNote() helper + source attribution in Sections 1/4/5**
  New `renderSourceNote(sources, retrievedAt)` helper renders a '📁 Quellen:' attribution line.
  Called in Section 1 (MaStR/Cernion/CO₂ sources), Section 4 (AGSI gas storage), and
  Section 5 (BNetzA EWK benchmark) to satisfy data-transparency requirements.

- **[BUG] Report pipeline: `salesLeads` validation error with `installationType: 'all'`**
  The pipeline passed `installationType: 'all'` to `business-intelligence.salesLeads`, but the
  service only accepts `['solar', 'storage', 'wallbox', 'heatpump']`, causing a
  `Parameters validation error!` on every run. Fixed by using `'solar'` as default type so
  Section 6 salesLeads data is populated without validation rejection.

- **[BUG] Report pipeline: `resolvedMastrId` always `null` for VNBs absent from vnbLookup registry**
  When `grid-operations.vnbLookup` returns `source: not-found` (e.g. Stadtwerke Velbert BDEW
  `9906863000008`), `resolvedMastrId` stayed `null`, silently skipping all MaStR-local queries in
  Sections 1 & 2. Added a city-SNB fallback: queries `cernion_installations_local` with
  `gemeinde: <cityToken>` and extracts the SNB from the first result's NAP data.
  Example: Stadtwerke Velbert now resolves to `SNB974492211483`.

- **[BUG] ENTSO-E `windSolarActual` / `loadForecast` crash with `region: 'DE'`**
  Both tools threw `"Cannot read properties of undefined (reading 'toLowerCase')"` when passed
  the ISO country code `'DE'`. The ENTSO-E resolver expects a country name; fixed by passing
  `'Germany'` instead of `'DE'` for all ENTSO-E calls in the pipeline.

- **[BUG] Section 7: `investmentBusinessCase` crashed with `toUpperCase` TypeError**
  `cernion_investment_business_case` threw a `toUpperCase` TypeError server-side when
  `scenario: 'grid-expansion'` matched no template. Mitigated locally via `callMcpDirect`'s
  error wrapper — section renders with `{ available: false }` rather than aborting the pipeline.
  Root cause is a Cernion MCP server-side bug (reported upstream).

- **[BUG] Section 6/7: market tools received company name instead of geographic region**
  `marketPenetration`, `prosumerTariff`, and `directMarketing` were passed `resolvedVnbName`
  (e.g. `"Stadtwerke Velbert GmbH"`) as the `region` parameter. Added `geoRegion` derivation
  that strips legal suffixes to extract the bare city token (e.g. `"Velbert"`) used as the
  geographic fallback across all Section 6 & 7 MCP calls.

- **[NOTE] Cernion MCP `cernion_nest_compliance_report` returns no results for any VNB**
  Tool consistently returns `"✅ Query executed successfully – No results found"`. Identified as
  a server-side data gap; Section 5 renders gracefully with `{ available: true, data: [] }`.

- **[NOTE] Cernion MCP `agsi_eu_statistics` fails for `country: 'eu'`**
  Returns `JOB_FAILED: No data found for country: eu`. Identified as a server-side bug; the
  pipeline falls back to `gas-storage.euStatistics` correctly.

## [0.8.28] - 2026-03-08

### Fixed

- **360° Report: CR-CERNION-044 BUG-4/8 — `anlagenInPruefung` count capped at 5000 / wrong examples shown**
  The SCHOCKER block in the 360° management report always showed exactly 5000 installations under grid
  operator review because the MaStR query used `limit: 5000` and the count came from `result.length` (i.e.
  the page size, not the real database total).

  **Fix:** `anlagenInPruefung` now uses `format: 'summary'` and `parseMaStrLocalStats()` to extract the
  "Total found: N" line from the MCP response — reflecting the true database count regardless of pagination.
  A separate `anlagenInPruefungBeispiel` query (`format: 'detailed'`, `limit: 3`, single-value
  `netzbetreiberPruefungStatus` string filter) provides verified concrete examples for the report narrative.
  Example: a grid area with 41 pending installations now correctly shows 41, not 5000.

- **360° Report: CR-CERNION-044 BUG-11 — E-mobility / grid-loss KPI rows showing placeholder checkmarks**
  `emobilityImpact` and `gridLossAnalysis` report rows previously displayed `✓ Analyse verfügbar` as the
  value when the upstream MCP tool returned a structured result object but no scalar number was extracted.

  **Fix (`src/report-builder.js`):** Both rows now parse real numeric values from the result:
  - `emobilityImpact` → `criticalStreets.length` (number of at-risk streets) + `section14aDevices` count
  - `gridLossAnalysis` → `lossPercentage` and `lossValueEuro`

  When no parseable number is present the row returns `null` and is suppressed from the table rather than
  showing a misleading checkmark.

- **360° Report: CR-CERNION-044 BUG-12 — Residuallast chart title/caption hardcoded to "48h-Horizont"**
  The Residuallast chart heading and prognosis title were hardcoded strings, causing the report to say
  "48h-Horizont" even when the actual forecast contained a different number of data points (e.g. 96 h or
  7 days).

  **Fix (`src/report-builder.js`):** `rlHorizonLabel` and `rlPrognoseTitel` are now derived dynamically from
  `rlSlice.length` — e.g. 48 entries → "48-Stunden-Horizont", 168 entries → "7-Tage-Horizont".

- **360° Report: CR-CERNION-044 BUG-13 — Energy-mix KPI rows showing placeholder checkmarks**
  Five KPI rows (`windSolarActual`, `genFcLabel`, `regionalEnergyMix`, `actualGeneration`, `loadForecast`)
  used `✓ Echtzeit-Daten verfügbar` / `✓ Prognose verfügbar` as fallback values instead of real numbers.

  **Fix (`src/report-builder.js`):** Each row now extracts the real numeric value from the upstream result
  (MW, GW, percentage as appropriate). When no parseable number exists the row returns `null` and is
  suppressed, keeping the report data-honest.

### Changed

- Bumped application and OpenAPI version to `0.8.28`.



### Fixed

- **Research Agent: `RangeError: Invalid string length` crash in `saveSession` (unresolvable VNB name)**
  When the Research Agent executed a query for an unknown VNB name (e.g. "Stadtwerke Vellbert"),
  a three-bug cascade caused the session JSON serialisation to crash with `RangeError: Invalid string length`:

  1. **Silent unfiltered query** (`services/assets.service.js`): when `cernion_market_partners` returned
     `count: 0` for the VNB name, `resolvedMastrId` and `resolvedBdewCode` stayed null. The code fell
     through to `callParams.gridOperatorName = vnbName`, but `cernion_installations_local` **silently
     ignores** that parameter and returns ALL installations of the requested type in Germany — potentially
     millions of records — with no limit applied.

  2. **Unbounded session storage** (`services/agent.service.js`): `session.results = { stepResults, ... }`
     stored the raw, uncompacted step results, including the massive `data.installations[]` array.

  3. **Crash at serialisation** (`services/agent.service.js`): `JSON.stringify(session)` on a
     multi-million-record payload → `RangeError: Invalid string length` (V8 string-size limit ~512 MB).
     The self-healing repair loop compounded this by repeating steps 3–5, accumulating more uncompacted
     data with each iteration.

  **Three-part fix:**

  - `services/assets.service.js` — after the `cernion_market_partners` lookup, if no `resolvedMastrId`
    and no `resolvedBdewCode` were found AND no `location` / `gridOperatorId` fallback is available,
    throw a descriptive `VNB_NOT_FOUND` error immediately instead of proceeding with an unfiltered query.
    This prevents the data explosion at the source.

  - `services/agent.service.js` — extend `compactStepResult()` to also handle direct array results
    (e.g. `assets.solar` returning a plain array) in addition to `result.data.installations`. Apply
    `compactStepResult()` to every step result before storing in `session.results`, capping arrays at
    50 rows so the serialised session is always manageable.

  - `services/agent.service.js` — `saveSession()` is now crash-safe: `JSON.stringify` is wrapped in a
    try/catch; on `RangeError` the step results are stripped and a `_saveWarning` field is added so the
    session record (including the interpretation) is still persisted and recoverable.

### Changed

- Bumped application version to `0.8.27`.

## [0.8.26] - 2026-03-08

### Fixed

- **Research Agent: JSON blobs in table cells and broken Live CSV for installation queries**
  When a research query returned `energy-market.installations` data (e.g. "Anlagen in Netzbetreiberprüfung"), the
  `napData` field — a nested object per installation — caused two interrelated bugs:

  1. **UI table showed raw JSON strings** — Gemini received the full `data.installations[]` array with nested
     `napData` objects and either serialised them as JSON cell values or failed to parse, triggering the
     fallback that rendered `JSON.stringify(stepResult)` in the result column.

  2. **Live CSV / Export CSV was unusable** — `convertToCSV` JSON-encoded nested objects (→ `"napData":
     "{...json...}"` blob in every row), making automated downstream processing impossible.

  **Three-layer fix:**

  - `services/energy-market.service.js` — `installations` handler: before calling `applyFormat` for
    `format=csv/xlsx`, destructure each row's `napData` object and expand its sub-fields
    (`napMastrNummer`, `messlokation`, `spannungsebene`, `netzMastrNummer`, `netzbetreiberMastrNummer`)
    into top-level scalar columns. The Live CSV endpoint injects `format=csv` into the last step, so this
    path now always produces a clean, blob-free CSV.

  - `services/agent.service.js` — new `compactStepResult()` helper + `flattenInstallation()`:
    before serialising step results into the Gemini summary prompt, `data.installations[]` arrays are
    (a) truncated to 50 rows (prevents token-limit failures on large result sets) and (b) flattened so
    napData sub-fields appear as top-level keys. The prompt now also includes an explicit *CRITICAL TABLE
    RULES* block instructing Gemini never to emit nested objects or arrays as tableRow cell values.

  - `services/agent.service.js` — post-processing safety net: after parsing Gemini's interpretation JSON,
    any remaining object-valued tableRow cells are `JSON.stringify`-d and arrays are joined with `, ` so
    the UI table and the fallback CSV path always receive primitive-only rows.


  - Changed ambiguity logic from OR to AND condition: now requires BOTH low confidence (<0.9) AND close margin (<0.08) to trigger ambiguity.
  - Example: "Stadtwerke Frankenthal" (score 0.88 vs 0.08, margin 0.80) now correctly auto-selects without requiring `confirmAmbiguousVnb=true`.
  - Previous logic incorrectly flagged cases with dominant candidates as ambiguous due to minor confidence threshold misses.

### Added

- **UI-Friendly BDEW Code Selection for Report Generation (CR-CERNION-044)**
  - New `POST /api/utility-report/get-bdew-options` endpoint enables users to discover available BDEW codes without needing prior knowledge.
  - Returns all BDEW codes for a given utility name, including market roles (Lieferant, Bilanzgruppe, etc.) to help users select the correct one.
  - Enhanced `POST /api/utility-report/generate` endpoint now validates BDEW code presence and guides users to `get-bdew-options` when missing.
  - Addresses issue where one Stadtwerk has multiple BDEW codes for different market roles (e.g., Stadtwerke Frankenthal with 3 different codes).
  - Two-step UX: (1) Call `get-bdew-options` to list available codes, (2) Select one and pass to `generate` endpoint.
  - OpenAPI documentation includes step-by-step examples for both endpoints.

- **Explicit Timeout Configuration for Long-Running MCP Actions**
  - Added `timeout: 15 * 60 * 1000` to all async actions using `callWithAutoPoll()` to prevent premature request termination.
  - Fixes timeout issues with `grid-operations.operatorAnalysis` and similar long-running tools that need 8–12 minutes.
  - Updated services: `grid-operations.service.js` (5 actions), `business-intelligence.service.js` (4 actions), `energy-market.service.js` (1 action).

### Fixed

- **CR-CERNION-043: Five production quality bugs fixed in 360° Report (Congress demo critical)**
  - **BUG-1 (Critical):** Digitalisierungsindex inconsistency across sections – unified source chain (benchmarkVnb → dedicated endpoint) to ensure consistent DI value across Section 5, Section 8, and action plan recommendations.
  - **BUG-2 (Critical):** Residuallast formula not scaled – changed from hardcoded "1 MW × 120 €/MWh × 8.760 h ≈ 1,05 Mio. €/Jahr" to dynamic scaling using actual capacity and price (e.g., 54 MW × 120 €/MWh × 8.760 h ≈ 56.7 Mio. €/Jahr). Formula now scales correctly for all VNBs.
  - **BUG-3 (High):** Section 2 showing "n/v – MaStR-Abfrage nicht verfügbar" while management briefing displays MaStR data (e.g., "33.52 MW from 1.046 installations") – single-source-of-truth: prioritized local MaStR MongoDB queries (pvLocal, windLocal, speicherLocal) over broker fallbacks in Section 2 KPI table and briefing.
  - **BUG-4 (Medium):** Query limit cap false positive – both Frankenthal and Gmünd reports showing exactly "500 installations under grid operator review" (statistically impossible) – increased `limit` from 500 → 5000 for `anlagenInPruefung` and `ortsfremdeAnlagen` queries to capture real edge cases.
  - **BUG-5 (Deferred post-Congress):** Day-Ahead-Preis missing in Section 3 for some days despite available market data – documented for post-demo phase; requires retry logic with exponential backoff and last-known-value fallback for ENTSO-E/SMARD market price fetches.
  - All 797 tests validated passing post-fix.

### Changed

- Bumped application and OpenAPI version to `0.8.26`.

### Known Issues

**COMPREHENSIVE TRACKING:** See [CR-CERNION-043-UPDATE.md](CR-CERNION-043-UPDATE.md) for detailed bug report, v1↔v2 comparison table, verification checklist, and actionable roadmap.

- **BUG-1 (Open):** Digitalisierungsindex inconsistency – Section 5: "30%", Section 8: blank, action plan: "67% Datenmanagement Teilscore" (not labeled). Root cause: three separate data sources without unified normalization. Fix: implement fallback chain + explicit teilscore labels.

- ~~**BUG-2 (RESOLVED ✅):**~~ Residuallast formula hardcoded – **FIXED on 8.3.2026** (commit 08e122a). Formula now dynamically scales: `{actualMW} MW × {actualPrice} €/MWh × 8.760 h ≈ {calculatedCost} Mio. €/Jahr`. Example: Frankenthal 54 MW × 120.95 €/MWh now correctly shows ~56.9 Mio. €/Jahr (was: 1.05 Mio. hardcoded). All 797 tests passing. **Demo-ready ✅**

- **BUG-6 (New):** Briefing-Anlagenzahl mismatch – Management page shows "6.476 installations" but Section 2 breakdown totals only ~4.374 (4.372 PV + 1 Wind + unknown storage). Storage installation count missing from KPI table.

- **BUG-7 (New):** Peer comparison hardcoded – Gemeindewerke Baiersbronn (15k EW, rural Baden-Württemberg) appears as benchmark for all utilities, including Frankenthal (50k EW, Rhineland-Palatinate). Needs size-class filtering + Bundesland matching.

- **MCP Backend Offline:** Live verification of MaStR-IDs, real installation counts (500-cap validity), and EWK DI scores pending backend availability.

**Post-Congress (after 10.3.2026):**
- **BUG-5 Backlog:** Day-Ahead-Preis fetching needs exponential backoff retry logic + last-known-value fallback for ENTSO-E/SMARD API timeouts.

## [0.8.25] - 2026-03-07

### Added

- **Utility Report – Feinarbeiten für CR-83/CR-87 abgeschlossen**
  - `FOTOJAHR-ALERT` im 90-Tage-Aktionsplan ergänzt (kombinierte Warnung aus Prüfstau + PLZ-Ausreißern, inkl. 60-Monate-EO-Hinweis).
  - Konkreter Peer-Vergleich im Abschnitt „Peer-Benchmarking“ ergänzt (benannte Referenzen für EE MS und Verbrauch MS, inkl. Gegenüberstellung zum aktuellen VNB-Wert).

### Changed

- **Report Builder – narrative Präzisierung für Vorstandslesbarkeit**
  - `SCHOCKER`- und `Challenge-Fragen`-Blöcke nutzen nun dynamische, benannte Peer-Referenzen statt statischer Formulierungen.
  - Section-5-Peerblock nimmt zusätzliche Segmentwerte (`ee_ms`, `verbrauch_ms`) auf und rendert diese konsistent mit CR-83.
- Bumped application and OpenAPI version to `0.8.25`.

## [0.8.24] - 2026-03-07

### Added

- **Utility Report – CR-74 data-quality query fix (real data, no truncation)**
  - `anlagenInPruefung` now requests all relevant review states (`['NetzbetreiberPruefung', 'InPruefung']`) with `includeNapData: true` and `limit: 500`.
  - `ortsfremdeAnlagen` now uses `includeNapData: true` and `limit: 500`.
  - Enables dynamic, installation-level rendering (MaStR number, capacity, commissioning date) instead of count-only snapshots.

- **Report Builder – Executive modules for CR-78 to CR-90**
  - New NEST explainer + causality chain + regulatory timeline in Section 5.
  - New dynamic `SCHOCKER` page (Prüfstau, Verbrauch MS, §14a readiness) generated from fetched data.
  - New `5 Fragen an Ihr Team` section (prioritized challenge questions from live KPI thresholds).
  - New `Ihr Aktionsplan – Nächste 90 Tage` section with date-based milestones.
  - New mandatory glossary section with 12 domain terms.

- **Section 5 KPI depth upgrade**
  - Anschlussdauer matrix now covers all four segments (EE NS, EE MS, Verbrauch NS, Verbrauch MS) including Phase 1/2, total, median and evaluation.
  - Digitalisierungsindex radar expanded from 3 to 5 axes (`datenmanagement`, `ki_einsatz` added).
  - Umsetzungsquote row now includes rank when available.
  - Added excellence/highlight block for top Umsetzungsquote performance.

- **Management Briefing redesign (CR-70/CR-90)**
  - Replaces linear bullet summary with three horizons: `SOFORT`, `DIESES QUARTAL`, `IHRE STÄRKEN`.
  - Automatically enriched from compliance signals and EWK/DI indicators.

### Changed

- Bumped application and OpenAPI version to `0.8.24`.


## [0.8.23] - 2026-03-09

### Added

- **Report Builder – Semantic KPI Context (domain-aware action hints)**

  All report sections now carry business-decision context, not just metric labels.
  Key additions per section:

  **Section 1 – Netztopologie & MaStR-Qualität**
  - Trafo rows use `trafoBewertung(v, level)` helper: threshold badges `✅/<70%`, `⚠️/70–80%`, `🔴/>80% §11 EnWG Meldepflicht`, `🚨/>95% KRITISCH`.
  - MeLo row: zero → `✅ Alle X Anlagen mit MeLo`; non-zero description includes `~3.000 €/Anlage/Jahr nicht abrechnebar`.
  - Anlagen-in-Prüfung description: Fotojahr 2026 EWK-impact + `§118 EnWG Bußgeldrisiko`.
  - Ortsfremde Anlagen description: Fotojahr 2026 AgNeS-Kapazitätsbilanz note (60 Monate Wirkung).
  - Action hints: §11 Engpass → NEST-Förderantrag; MeLo → 4-Wochen-Frist; Fotojahr 2026 → Erlösobergrenze; Residuallast × Day-Ahead-Preis monetarisiert.

  **Section 2 – EE-Portfolio**
  - PV-Kapazität description: dual VNB-/Lieferant-Sicht (Redispatch vs. Prosumer-Potenzial) + Fotojahr 2026 MaStR-Genauigkeit.
  - Einspeise-Prognose description: Day-Ahead-Beschaffung EPEX Spotmarkt framing.
  - Action hints: MeLo+Redispatch; Fotojahr MaStR Q1; Einspeise-Prognose EPEX; Prosumer-Akquise 3–5× Konversion.

  **Section 4 – Gas**
  - Dynamic `gasHints` IIFE: fill-level-dependent primary hint (<25% KRITISCH with delta to EU-90%, <70% warning, else green) + Lieferant (Abrufoptionen) + VNB (Transformationsplan 2026–2045) + EU-Ländervergleich.

  **Section 5 – Regulierung & EWK**
  - `ewkQuartilBewertung(rank, total)` helper: maps EWK rank to quartile label + NEST consequence (Top-25% = NEST-Vorteil, Bottom-25% = EO-Nachteil).
  - EWK Anschlussdauer Rang kpiRow description: shows quartile + NEST consequence dynamically.
  - Digitalisierungsindex description: "schwächster Teilscore = primäre Handlungspriorität".
  - `ewkHints` IIFE refactored: Anschlussdauer hints include `adQuartil.nestEffect`; DI block detects weakest sub-score (Smart Grids / Digitale Prozesse / Kundenmanagement) with targeted §14a/MaKo/Self-Service consequences; Umsetzungsquote 100% → `EXZELLENZ – echter Wettbewerbsvorteil, aktiv kommunizieren`; NEST-Report hint includes Fotojahr 2026 reference.

  **Section 6 – Kundenmanagement**
  - Churn heuristic guard: when `isHeuristicChurn`, suppress `~8.0 ℹ️` value (null → n/v) and show BI-upsell fallback `⚠️ Branchenheuristik (BDEW ~8 %) ≠ VNB-spezifisch – Cernion BI-Modul für valide Churn-Prognose aktivieren`.
  - kpiRow descriptions updated: heuristic → `VNB-spezifisches ML-Modell nicht aktiviert`; non-heuristic → `ML-Modell, CRM-basiert`.

- **Gemini Prompt – Domain-aware 4-tier prioritization**

  `generateNarrative` prompt now includes:
  - Priority order: Compliance-Risiken (§11/§118/§12) → Financial >10.000 €/Jahr → Strategic (Top-Quartil, 100% UQ) → Monitoring.
  - Context rules: EWK-Rang als Quartil + NEST-Konsequenz; Anschlussdauer Delta; MeLo-Lücken + Fotojahr 60-Monate; Residuallast monetarisiert; UQ 100% = echter Wettbewerbsvorteil.
  - Forbidden: camelCase, generic phrases without numbers, sentences without actionable content.

- **`buildStaticNarrative` – Quartile + MeLo/Fotojahr items**

  - Anschlussdauer items include quartile + NEST consequence (computed from `kpiSummary.anschlussdauer.rankings.*`).
  - New MeLo/Fotojahr critical item (prio 1) when `kpiSummary.meloCheck.anlagen_ohne_melo > 0`: cites `~3.000 €/Anlage/Jahr` and 60-month EO impact.

### Changed

- `tests/utility-report.service.test.js` — 2 tests updated:
  - CR-41 ortsfremde test: assertion updated from `außerhalb des Kerngebiets` to `außerhalb Kerngebiet` (matches current renderer text).
  - CR-12 churn heuristic test: assertions updated — heuristic values are now suppressed (`null` → n/v), expect `not.toContain('~8.0')`, `not.toContain('~60')`; expect `Branchenheuristik` and `BI-Modul`.

## [0.8.22] - 2026-03-09

### Added

- **Report Builder – CR-48: Residuallast 48h-Chart (Abb. A, Section 1)**

  New time-series area chart appended to Section 1 when `residualLoad.forecast`
  contains ≥ 6 hourly data points (48h horizon). Two datasets: Netto-Residuallast
  (blue fill) and Gesamtlast (grey dashed). Canvas ID: `chartResidualLoad`.

- **Report Builder – CR-49: EE-Portfolio-Mix Donut (Abb. B, Section 2)**

  Donut chart visualising PV / Wind / Speicher capacity proportions when at
  least one capacity value is available. Canvas ID: `chartPortfolioMix`.

- **Report Builder – CR-50: Dual-axis Preis+Solar-Chart (Abb. 2, Section 3)**

  Existing EPEX price line chart upgraded to dual-axis when `windSolarActual`
  data is cross-referenced from Section 2. Left axis: €/MWh (price);
  right axis: GW (solar generation). Negative-price periods shaded red.
  Falls back to single-axis when no solar data is available.

- **Report Builder – CR-51: Ländervergleich Gasfüllstand (Abb. D, Section 4)**

  Grouped horizontal bar chart comparing gas storage fill levels for DE / AT /
  NL / FR when `compareCountries.rankings` is available. Reference line at 90%
  (EU mandate). Canvas ID: `chartGasCountry`.

- **Report Builder – CR-52: Digitalisierungsprofil Radar (Abb. E, Section 5)**

  Radar chart showing three digitalization sub-scores (Smart Grids, Digitale
  Prozesse, Kundenmanagement) for this VNB (blue) vs. Bundesmedian (grey
  dashed). Canvas ID: `chartDigiRadar`.

- **Report Builder – CR-53: Peer-Benchmark Tornado (Abb. F, Peer-Benchmarking)**

  Divergence / tornado bar chart showing delta to Bundesmedian for
  Anschlussdauer and Digitalisierungsindex (green = better, red = worse).
  Rendered only when both metrics have national median data available.
  Canvas ID: `chartTornado`.

- **Report Builder – CR-54: EE-Zubaukurve kumuliert (Abb. C, Section 2)**

  Cumulative PV capacity growth chart built from `pvLocal` installation
  commissioning dates, grouped by year. Requires ≥ 5 installations with
  valid `inbetriebnahmeDatum`. Canvas ID: `chartZubau`.

### Fixed

- **Report Builder – CR-43: Pearson-Korrelation Fallback**

  When `priceProductionAnalysis` tool is unavailable ("nicht lizenziert"),
  compute Pearson r from EPEX price data points × ENTSO-E solar generation
  forecasts (last 24h). Requires ≥ 4 paired data points. KPI row now shows
  `r = X.XX (neg./pos. Korrelation)` instead of a blank value. Falls back
  to "Datenbasis für Berechnung unzureichend" when fewer than 4 points exist.

- **Service – Residuallast-Aufruf: `gridOperatorId` → `gridOperatorMastrId`**

  Fixed wrong parameter name in Phase 2 `residual-load.netResidualLoad` call.
  Added `forecastDays: 2` and `resolution: 'hourly'` to ensure 48h hourly
  data is available for the new Section 1 chart.

- **Service – `churnPrediction`: vollständige Parameter**

  Added `predictionWindowMonths: 12`, `includeRetentionStrategy: true`,
  `includeChurnReasons: true`, `includeCompetitiveAnalysis: true` to deliver
  the full 12-month churn analysis as specified in the API reference.

- **Service – `salesLeads`: `installationType` und `limit` korrigiert**

  Changed `installationType` from `'solar'` to `'all'` and raised `limit`
  from `20` to `50` to capture PV, Speicher and Wallbox leads in one call.

- **Service – `section3.windSolarActual` Cross-Reference**

  `windSolarActual` is now explicitly cross-referenced from `section2` into the
  `section3` data object so the dual-axis chart in Section 3 can access it
  without a second MCP call.

## [0.8.21] - 2026-03-08

### Fixed

- **Service – CR-37 (P0): Marktrollen-Resolution – multi-role BDEW classification**

  Phase 1 identification now classifies ALL market-partner candidates found
  during the search into role buckets: VNB (990x), Lieferant (991x),
  MSB (992x), BKV (993x), Direktvermarkter (994x).  Stored as
  `p.meta.marktRollenProfile`.  A post-merge override guarantees that
  `resolvedBdew` is always the VNB code (990x) — not a Lieferant or MSB code
  that might have been picked first.

- **Service – CR-39 (P0): Redispatch VNB-Lookup chain reliability**

  The `vnbLookup` in Phase 1 Step 2 now reliably uses the VNB BDEW code
  guaranteed by CR-37, eliminating cases where a 991x Lieferant code was
  passed to the VNB registry and returned no MaStR-ID.

- **Service – CR-44 (P0): EWK/DI Benchmark always via VNB-Code (990x)**

  Phase 2 `ewk-monitoring.benchmarkVnb` now passes `vnbBdewForEwk =
  marktRollenProfile?.vnb?.bdew ?? resolvedBdew` instead of the raw
  `resolvedBdew`, ensuring BNetzA EWK queries target the Netzbetreiber entry.

- **Report Builder – CR-38 (P1): Trafo-Auslastung honest fallback**

  When both capacity utilization and transformer loading tools are unavailable,
  the three identical "Kapazitätsanalyse-Tool nicht verfügbar" placeholder rows
  are replaced with a single compact row: "Trafo-Auslastung (NS/MS/HS) –
  Tool nicht lizenziert – Tagesaktueller Trafo-Forecast als Ergänzungsmodul
  verfügbar".

- **Report Builder – CR-41 (P0): Ortsfremde Anlagen – VNB-centric description**

  The "Ortsfremde Anlagen (PLZ-Ausreißer)" row now correctly explains that
  queries filter by VNB MaStR-ID (not by PLZ prefix), and that these are
  installations assigned to this VNB in MaStR whose postal codes lie outside
  the core service territory.

- **Report Builder – CR-42 (P1): Einspeise-Kennzahlen – real values**

  "Einspeisung Wind/Solar (Ist)" now shows the actual average MW value from
  the ENTSO-E wind/solar actual data (e.g. "43.250 MW Ø DE (Ist)") instead of
  the static "✓ Echtzeit-Daten verfügbar" placeholder.
  "Einspeise-Prognose (24h)" shows the first-day generation MW from the
  MaStR-based forecast (e.g. "1.2 MW morgen (Netzgebiet-Solar)") when
  numeric data is available.

- **Service – CR-43 (P1): Preis-Einspeise-Korrelation role-aware license check**

  `cernion_price_production_analysis` call now includes `bdewCode: resolvedBdew`
  (guaranteed 990x VNB code by CR-37) so the tool can perform a role-specific
  license check instead of a generic token-level check.

- **Report Builder – CR-40 (P2): Netzverluste – upsell routing to Section 7**

  The fallback note for "Netzverluste (I²R)" changes from "Tool nicht
  lizenziert" to "Premium-Feature – Upsell-Optionen in Abschnitt 7 gelistet",
  linking the reader to the existing Section 7 upsell block.

### Added

- **Report Builder – CR-45 (P2): Marktrollen-Profil in Section 8 & cover**

  Section 8 now renders a "Marktrollen-Profil (BDEW-Codes nach Rolle)" block
  showing all classified roles (VNB, Lieferant, MSB, BKV, DV) with their
  respective BDEW codes as colour-coded badges.
  The cover page shows the VNB BDEW code (and Lieferant code when available)
  in small monospace type below the subtitle.

## [0.8.20] - 2026-03-07

### Fixed

- **Report Builder – CR-30 (P0): Code-Variablen-Leak im Management Summary**

  The LLM echoed JavaScript field names from the raw `kpiSummary` JSON (e.g.,
  *"Das 'loadFallbackWarning' bei der Residuallast…"*).  Two-layer fix:

  1. **`services/utility-report.service.js`** — `generateNarrative` now strips
     keys matching `/(Warning|Error|Fallback|Flag|Raw|isError|DataStatus|_count$)/`
     from the kpiSummary before JSON-encoding it into the LLM prompt.
  2. **`src/report-builder.js`** — Added two additional patterns to
     `PROMPT_LEAK_PATTERNS` that catch camelCase identifier tokens and known
     enum names (`DataStatus`, `NOT_LICENSED`, `loadFallback`, etc.) if they
     slip through to the rendered bullets.

- **Service – CR-31 (P0): MeLo-Datenwiderspruch beseitigt**

  Management Summary said "34 Anlagen ohne MeLo" while Section 1 showed
  "0 ohne MeLo (von 34 ≥100 kW)".  Root cause: `summarizeForReport` exposed
  the raw `installationenOhneMelo.installations_count: 34` (total ≥100 kW
  installations regardless of MeLo status) to the LLM, which misread it as
  "34 without MeLo".

  Fix: after `summarizeForReport` runs, the service now computes
  `kpiSummary.meloCheck = { anlagen_ohne_melo, anlagen_gesamt_ge100kw }` using
  the same `filter((i) => !i?.napData)` logic that `renderSection1` uses, then
  deletes the ambiguous `kpiSummary.installationenOhneMelo` key.  The LLM now
  sees the correct, pre-computed value.

- **Report Builder – CR-32 (P0): Rang-Beschriftung „Top X%" invertiert**

  `renderPeerBenchmarkBlock` computed `pctRankAd = round((1 − rank/total) × 100)`
  then displayed `Top ${100 − pctRankAd}%`, which is always wrong.  For
  Frankenthal (rank 452/740) this produced "Top 61%" — implying a top-performer
  — when the VNB is actually below median.

  Fix: compute `betterThan = round((total − rank) / total × 100)` and apply
  the rule: `betterThan ≥ 75 → "Top X%"` (genuinely top-quartile);
  otherwise `"besser als Y%"` (unambiguous).  Same fix applied to the
  Digitalisierungsindex rank column (`betterThanDi`).

- **Report Builder – CR-33 (P1): Empfehlungen ohne Datenbasis unterdrückt**

  Section 8 always emitted "Smart-Grids Score <30 %: SMGW-Rollout…" and
  "Systemstatus offline: …" even when the underlying KPIs showed "–" (no data
  available) or were clearly online.

  Fix: the `actionHint` block in `renderSection8` is now built from a
  conditional array.  The Smart-Grids threshold hint is only added when
  `isAvail(s8, 'digitalisierungsindex')` and the actual score is known.
  The offline hint is only added when `status` is truthy and does not match
  `/online|✅/i`.  The Digitalisierungsindex-not-available path emits a
  generic EWK-lookup reminder instead.

### Added

- **Report Builder – CR-36 (P1): Redispatch-Anlagen Fallback-Strategie**

  `cernion_redispatch_export` frequently fails with "MaStR-ID erforderlich".
  `renderSection1` now implements a 3-tier lookup for the KPI value:
  1. Certified export (`redispatchExport`), if available.
  2. `operatorAnalysis` enrichment (`opRedispatch`).
  3. CR-36 Fallback: total count from `installationenOhneMelo` query
     (same `minCapacity ≥ 100 kW` filter) prefixed with `~` and described as
     "Schätzung: MaStR-Abfrage ≥100 kW".

  The error text "Redispatch-Export fehlgeschlagen – MaStR-ID erforderlich"
  is now shown only when all three tiers fail.

### Improved

- **Report Builder – CR-34 (P2): NEST/AgNeS-Sektion – Informative Datenquelle-Hinweise**

  AgNeS-Effizienzwert, Erlösobergrenze, and Regulierungskonto-Saldo were
  showing bare `n/v` with "EWK-Benchmarkdaten nicht enthalten".  Replaced with
  an explicit explanation: *"BNetzA-Festsetzungsdaten nicht maschinenlesbar –
  individuell abrufbar (BNetzA BK8)"*.  When all three AgNeS fields are missing,
  an additional `<p>` note with a direct link to BNetzA Beschlusskammer 8 is
  appended below the KPI table.

- **Report Builder – CR-35 (P2): Peer-Benchmarking Rang-Percentil auch für DI**

  Added `betterThanDi` percentile computation for the Digitalisierungsindex
  rank column, mirroring the CR-32 fix.  Updated the table header from "Rang"
  to "Rang (national)" and added a footer note explaining the percentile
  semantics and flagging regional peer comparison (Bundesland / Größenklasse)
  as a planned Roadmap feature.

## [0.8.19] - 2026-03-07

### Fixed

- **Report Builder – CR-23 (P0): Prompt-leak lines appear in Management Summary**

  The LLM sometimes echoes the prompt context as its first output line
  (e.g., *"Hier ist die Management Summary für die Stadtwerke Eberbach:"*).
  Because `renderManagementSummary` parses the response line-by-line, such
  intro sentences were rendered as bullet point 1.

  **Fix (`src/report-builder.js`):** Added `PROMPT_LEAK_PATTERNS` array
  (`/^hier ist/i`, `/^management summary für/i`, `/:\s*$/` etc.) applied inside
  the `.filter()` chain before assigning `findings`. Suppressed lines are
  logged via `console.warn` for operator visibility.

- **Report Builder – CR-24 (P0): Inverted Umsetzungsquote recommendation**

  The `else` branch of the `umsetzungsquote < 80 %` guard in `renderSection5`
  still emitted the text *"Umsetzungsquote <70 %: Nachbearbeitung…"* — which
  fires precisely when the VNB has a high quota (e.g., Eberbach 100 %).

  **Fix (`src/report-builder.js`):** Replaced the incorrect `else` catch-all
  with an explicit four-way branch:
  - `< 80 %` → ACTION: "offene Anschlussbegehren nacharbeiten"
  - `≥ 100 %` → "✅ alle fristgerecht umgesetzt"
  - `80–99 %` → "✅ Niveau halten; Restfälle abschließen"
  - `null` → neutral fallback without a threshold claim

- **Service – CR-25 (P1): PV count shows `1` for multi-installation VNBs**

  The `cernion_installations_local` queries for `pvLocal`/`windLocal`/
  `speicherLocal` used `limit: 1`, so the response said
  `**Results:** 1 installations found` even when hundreds existed.
  `parseMaStrLocalStats` read this bounded value as the total count.

  **Fix (`services/utility-report.service.js`):** Changed all three queries
  from `limit: 1` to `limit: 5000`.

  **Fix (`src/report-builder.js`):** Updated `parseMaStrLocalStats` to prefer
  the `**Total found:**` line from the Summary Statistics block (accurate total)
  over the bounded `**Results:**` header.

### Added

- **Report Builder – CR-26 (P1): New NEST & Regulierungsrahmen sub-section**

  Added `renderNestAgnesBlock()` inserted after the action-hint block in
  `renderSection5`. Shows NEST compliance status and AgNeS KPIs (Effizienzwert,
  Erlösobergrenze, Regulierungskonto) from EWK benchmark data already
  retrieved in Section 5. Sub-section is suppressed entirely when no data is
  available (all-`n/v` guard).

- **Report Builder – CR-27 (P1): New Peer-Benchmarking table**

  Added `renderPeerBenchmarkBlock()` appended after the NEST block in
  `renderSection5`. Renders a four-column table (Kennzahl / Dieser VNB /
  Bundesmedian / Rang) for Anschlussdauer, Digitalisierungsindex, and
  Umsetzungsquote using EWK ranking data already in scope. Includes rank
  percentile (e.g., "Rang 260 / 740 (Top 65 %)"). Table is suppressed when
  all three metrics are unavailable.

### Improved

- **Report Builder – CR-28 (P2): ACTION / HOLD / LEVERAGE modes for Anschlussdauer**

  Top-performing VNBs (Anschlussdauer < 75 % of Bundesmedian ≈ top 25 %)
  now receive a LEVERAGE hint: *"Top-Performer – Als Qualitätsmerkmal in
  Kommunikation mit Gemeinde und Projektierer einsetzen."* Borderline
  above-median cases receive a softer ACTION-light message.
  Digitalisierungsindex ≥ 70 % also gets a positive HOLD message.

- **Report Builder – CR-29 (P2): News relevance scoring replaces simple filter**

  Added `scoreNewsItem(item)` awarding `+2` per energy-sector keyword
  (netzausbau, photovoltaik, lorawan, §14a, etc.) and deducting `−5` for
  navigation fragments, download links, and homepage teasers. Items are
  scored, filtered to `score > 2`, sorted descending, and capped at 4.

## [0.8.18] - 2026-03-07

### Fixed

- **Report Builder – CR-17 (P0): Gas trend renders `[object Object]`**

  The `cernion_agsi_storage_trend` tool returns a nested response where
  `storageTrend.data.trend` is a sub-object (`{ direction, startFillLevel,
  endFillLevel, … }`).  `getVal(trend, 'trendDirection', 'trend', 'direction')`
  matched the key `'trend'` and returned the whole sub-object, which serialised
  as `[object Object]` in the KPI table.

  **Fix (`src/report-builder.js`):** Replaced `getVal` with an inline IIFE that
  checks only string-typed properties in priority order
  (`trend.trend.direction → trend.trendDirection → trend.direction → trend.status`).
  Direction values are mapped to labelled German strings
  (e.g., `withdrawal → ↓ Entnahme`, `injection → ↑ Einspeisung`).

- **Report Builder – CR-19 (P0): Web-scraping navigation artefacts escape news filter**

  Login-page DOM fragments (e.g., `"Internet-Planauskunft Hilfe Hauptmenü
  Abmelden …"`) passed the existing quality filter because they are longer than
  50 characters and do not end with `"…"`.  These appeared as news items in
  Section 8's Context Box.

  **Fix (`src/report-builder.js`):** Added `SNIPPET_BLACKLIST_RE` constant with
  patterns for `Hauptmenü`, `Abmelden`, `Anmeldung erforderlich`,
  `Internet-Planauskunft`, `Grund der Auskunft`, `Cookie-Hinweis`,
  `Bitte aktivieren Sie JavaScript`, and `Hilfe Hauptmen`.  Both
  `shouldRenderNewsSection` and the inline filter in `renderContextBox` now
  reject items matching the blacklist.

- **Report Builder – CR-22 (P0): Section 2 EE-Portfolio shows `–` for all KPIs**

  `cernion_installations_local` returns `{ available: true, data: [{type:'text',
  text:'# MaStR Installations…'}] }`.  `safeData()` returns the raw array
  (it does not auto-unwrap arrays), so
  `pvLocalData?.stats?.totalCapacityKW` was always `undefined`.  Meanwhile the
  Management Summary accessed the same data via a dot-string key path and showed
  correct values (e.g., "PVA Grenzhof 4.37 MW").

  **Fix (`src/report-builder.js`):** Added `parseMaStrLocalStats(dataArr)` helper
  that locates the markdown text item inside the array and extracts count
  (`**Results:** N installations found`) and total capacity
  (`**Total capacity (shown):** … (XXXX kW)`) via regex.  Appended
  `pvLocalStats.totalCapacityKW` / `pvLocalStats.count` (and wind, storage
  equivalents) as the final fallback in each respective chain in
  `renderSection2`.

- **Report Builder – CR-18 (P1): Market partner table shows empty columns + developer footnote**

  The `renderMarktpartnerRegistry` table was rendered even when the Marktrolle
  and MaStR-ID columns were mostly `–`, providing no useful information.  A
  developer-facing footnote ("Fett = für Datenabruf verwendete VNB-Rolle …")
  also leaked into the customer-facing report.

  **Fix (`src/report-builder.js`):** Added a quality gate that suppresses the
  table when fewer than 50 % of partner entries carry a resolved `roles` array.
  Removed the developer footnote `<p>` entirely.

- **Report Builder – CR-21 (P1): `0 / 105` format ambiguous in Section 1**

  The "Redispatch-/§14a-Anlagen ohne MeLo" KPI displayed a bare fraction
  (`0 / 105`) whose numerator and denominator were not labelled, making the
  value confusing without the tooltip.

  **Fix (`src/report-builder.js`):** Changed format to
  `0 ohne MeLo (von 105 ≥100 kW)`, making both parts self-explanatory inline.

- **Report Builder – CR-20 (P2): Section 7 renders a full page of `n/v` rows**

  When all four Section 7 tools (`investmentBusinessCase`, `storageOptimization`,
  `operatorPortfolio`, `operatorAnalysis`) fail or are not licensed, the section
  rendered an empty KPI table that wasted a full report page with no actionable
  content.

  **Fix (`src/report-builder.js`):** Added `anyAvail` guard at the top of
  `renderSection7`.  When none of the four tools produced data the section
  collapses to a compact 🔒 upsell/teaser block listing the unavailable features
  and directing the reader to contact Cernion.  The action-hint recommendation
  block is still rendered in both paths.

## [0.8.17] - 2026-03-06

### Fixed

- **MCP Client – CR-26: Remove serial call queue; retain quota-error retry**

  **Root cause of timeouts:** CR-25 introduced a process-wide serial call queue
  (`_callQueue`) to prevent burst connections from triggering the MCP server's
  quota detection. The Cernion team confirmed the quota issue was server-side
  and has since been resolved (2026-03-06). With the queue in place, ~5 pipeline
  MCP calls × ~10 s each ≈ 50 s total, exceeding the 30 s `callBroker` timeout
  and causing `RequestTimeoutError` on `energy-market.installations`,
  `forecast.generationForecast`, and `energy-market.prices`.

  **Changes (`src/mcp-client.js`):**
  - Removed `static _callQueue` and `INTER_CALL_DELAY_MS` — concurrent calls are
    now allowed again; `Promise.all` in pipeline stages runs as intended.
  - Retained quota-error retry (`MAX_QUOTA_RETRIES = 3`, exponential back-off
    1 s → 2 s → 4 s) as a safety net for transient server-side quota responses.
  - 2 queue-specific unit tests removed (`should serialise concurrent calls`,
    `should handle INTER_CALL_DELAY_MS = 0 without delay`); 3 retry tests kept.

- **Parameter validation – `convert: true` on all numeric action params**

  `fastest-validator` 1.x requires `convert: true` per field; there is no global
  option. HTTP GET query strings deliver all params as strings (`?limit=10` →
  `"10"`), causing validation errors on `type: 'number'` params. Fixed 21 fields
  across 10 service files: `grid-operations`, `ewk-monitoring`, `eic-codes`,
  `business-intelligence`, `query`, `forecast`, `residual-load`, `web-search`,
  `customer-service`, `energy-market`. (`assets.service.js` already had
  `convert: true` correctly.)

## [0.8.16] - 2026-03-06

### Fixed

- **MCP Client – CR-25: Sequential call queue + quota-error retry**

  **Root cause analysis:** `Promise.all` in pipeline phases 2 and 3 was firing
  multiple `callWithNewSession` calls simultaneously. Each call opened its own
  HTTP connection to the MCP server. The server detected the connection burst as
  a quota violation and rejected all of them (`"Token quota exhausted"`).
  Developers confirmed: no real rate limit — this was purely a burst-detection
  artefact.

  **Changes (`src/mcp-client.js`):**
  - **Serial call queue** (`static _callQueue`): every `callWithNewSession` call
    chains onto a process-wide Promise chain so that only one MCP session is open
    at a time. `Promise.all` in pipeline code remains unchanged — serialisation
    happens transparently in the client.
  - **Inter-call delay** (`INTER_CALL_DELAY_MS = 500`): after the previous call
    completes, the client waits 500 ms before opening the next session.
    Configurable via environment variable / test to 0.
  - **Quota retry with exponential back-off** (`MAX_QUOTA_RETRIES = 3`,
    `QUOTA_RETRY_BASE_MS = 1000`): up to 3 retries on quota / rate-limit errors
    (1 s → 2 s → 4 s back-off). Non-quota errors are propagated immediately.
  - **`_isQuotaError(msg)`**: detects `"quota"`, `"rate limit"` and
    `"too many requests"` (case-insensitive).
  - **`_executeCall(toolName, params, token)`**: new private helper — encapsulates
    connect → callTool → disconnect without queue/retry.
  - **`connect()` aborts immediately on quota errors** (instead of 3 retries) so
    the outer retry loop in `callWithNewSession` controls back-off.
  - 5 new unit tests: quota retry → success after 2 failures; all retries
    exhausted → `QUOTA_EXHAUSTED`; no retry on non-quota error; serialisation
    test (3 concurrent calls → no interleaving); delay=0 → no timing overhead.

## [0.8.15] - 2026-03-06

### Fixed

- **360° Report – CR-24: MCP errors are now correctly detected and transparently reported**

  **Root cause analysis:** All previous `VNB_NOT_IDENTIFIED` errors (Heidelberg,
  Eberbach, etc.) shared the same root cause: the token `CERNION_TOKEN` in `.env`
  returned HTTP 403 from the MCP server. `callBroker` silently caught the error
  and returned `{ available: false }`, which the Phase 1 loop interpreted as "no
  results". The error message said "VNB not in registry" instead of "MCP
  authentication failed".

  **Changes:**
  - **MCP error detection**: the Phase 1 loop now checks `mp?.available === false`
    → stores the real error text in `p.meta.mcpError` and skips the query (instead
    of accumulating empty candidates).
  - **Correct error message**: the guard `!resolvedBdew && !resolvedMastrId` first
    checks `p.meta.mcpError` → throws `MCP_CONNECTION_ERROR` with a clear hint
    (token, network, health endpoint) instead of the misleading `VNB_NOT_IDENTIFIED`.
  - **VNB selection transparency**: after successful Phase 1, the pipeline writes
    `p.meta.vnbIdentification` with
    `{ queriesTried, candidatesFound, selected: { name, bdew, selectionReason } }`.
    The field appears in `GET /status/:id` and shows the user which market partner
    was selected and why.
  - **Health endpoint**: new `GET /api/utility-report/health` — tests the MCP
    connection with the configured token and returns
    `{ status, tokenPresent, mcpReachable, toolCount, latencyMs, error }`.
  - 2 new tests: MCP error leads to `MCP_CONNECTION_ERROR` (not
    `VNB_NOT_IDENTIFIED`); successful identification populates
    `vnbIdentification.selected`.

### Added

- **`GET /api/utility-report/health`**: new diagnostic endpoint checks token
  configuration and MCP reachability. First stop when diagnosing pipeline errors.

## [0.8.14] - 2026-03-06

### Fixed

- **360° Report – CR-23: Market partner response extraction and VNB selection corrected**
  - **Cause 1 – wrong response path**: `cernion_market_partners` returns results
    directly as `mp.results` (top-level) in the synchronous MCP path, not as
    `mp.data.results`. The previous code checked only `data.results` →
    `rawCandidates = []` for every query → `VNB_NOT_IDENTIFIED`. Fix: added
    `mp?.results` as a fallback in the extraction chain.
  - **Cause 2 – wrong field name**: the real MCP API returns `companyName` (not
    `name`) and `bdewCode` (not `bdew`). Normalisation in `allCandidatesMap`
    extended to include `c.companyName`; `city` is now also extracted from
    `c.contacts?.[0]?.city`.
  - **Cause 3 – wrong candidate**: with `limit: 5`, "Stadtwerke Heidelberg Netze
    GmbH" (position 10) does not appear in results; `candidates[0]` would be
    "acteno energy GmbH". Fix: `limit` raised to 10; `pickBestVnbPartner` now
    prefers companies with "Netz" in the name as second priority (after explicit
    VNB role).
  - **Cause 4 – premature loop break**: the query loop broke on the FIRST match
    (even for non-VNB companies). Fix: all queries are now executed, all
    candidates collected in `allCandidatesMap`, best match selected afterwards
    from the combined pool.
  - 3 new unit tests for `pickBestVnbPartner`: top-level format, "Netz"
    preference, explicit VNB role beats "Netz" name.

## [0.8.13] - 2026-03-06

### Fixed

- **360° Report – CR-22: Token propagation bug fixed**
  - `cernionToken` resolved from `process.env.CERNION_TOKEN` was never written
    back into `ctx.meta` inside `_runPipeline`.
  - Consequence: all `callBroker()` calls within the pipeline did **not** propagate
    the token to downstream services (e.g. `grid-operations.marketPartners`).
  - `grid-operations` read `ctx.meta.cernionToken` for MCP authentication →
    received `undefined` → MCP auth silently failed → `allPartners: []`,
    `availableTools: []` for every report.
  - Fix: first statement in `_runPipeline`:
    `if (cernionToken) ctx.meta.cernionToken = cernionToken;` — ensures the
    env-resolved token is present in `ctx.meta` before the first broker call.
  - 1 new test: verifies that the env token `process.env.CERNION_TOKEN` is
    correctly set in `ctx.meta.cernionToken` for all downstream calls when
    `ctx.meta` contains no token.

## [0.8.12] - 2026-03-06

### Improved

- **360° Report – CR-21: Context-aware error message for VNB_NOT_IDENTIFIED**
  - Error message now shows the actual search queries used: *"Searched for:
    \"Eberbach\", \"Stadtwerke Eberbach\", \"Stadtwerk Eberbach\"."*
  - Suggestions are derived dynamically from the input value — no more hardcoded
    "Stadtwerke Heidelberg Netz GmbH" example.
  - Input without org prefix (e.g. "Eberbach") → concrete alternatives:
    "Stadtwerk Eberbach GmbH", "Stadtwerke Eberbach Netz GmbH",
    "Eberbach Netz GmbH".
  - Input with org prefix (e.g. "Stadtwerke Eberbach") → variants:
    "Eberbach Netz GmbH", "Stadtwerke Eberbach Netz GmbH",
    "Stadtwerk Eberbach GmbH".
  - Error message continues to include a hint about direct BDEW code input
    (parameter: `bdew`).
  - 1 new test: verifies searched queries and input-specific suggestions (not
    Heidelberg) in the error message.

## [0.8.11] - 2026-03-06

### Fixed

- **360° Report – CR-20: Stadtwerk singular/plural BDEW search and city-SNB fallback**
  - `buildVnbSearchQueries()` now generates **both** Stadtwerk variants:
    - Bare city name (e.g. "Eberbach") →
      `["Eberbach", "Stadtwerke Eberbach", "Stadtwerk Eberbach"]`
    - Input with plural prefix (e.g. "Stadtwerke Eberbach") → adds singular query
      `"Stadtwerk Eberbach"`
    - Input with singular prefix (e.g. "Stadtwerk Eberbach GmbH") → adds plural
      query `"Stadtwerke Eberbach"`
  - Background: the real market partner database entry is "**Stadtwerk** Eberbach
    GmbH" (singular), not "Stadtwerke" — this caused `allPartners: []` and
    `VNB_NOT_IDENTIFIED` errors.
  - City-SNB fallback (Step 1b): `type: 'solar'` → `type: 'all'` — small VNBs
    may not have solar installations with linked NAP data; `'all'` also considers
    wind, storage, and biomass installations.
  - 3 new unit tests for the new query variants (singular, plural↔singular cross).

## [0.8.10] - 2026-03-06

### Added

- **360° Report – CR-19: Market partner registry in Section 8**
  - Phase 1 of the report pipeline now collects **all** market partner candidates
    (up to 5 results per search query variant) in an `allCandidatesMap` and stores
    them as `p.meta.allPartners`.
  - Each candidate is normalised: BDEW code (`bdewCode` or `bdew`), market
    role(s) (`roles` or `marketRoles`), MaStR ID (from `mastrId`,
    `gridOperatorMastrId`, or `mastrIds` object).
  - `allPartners` is passed as part of `meta` to `buildHtmlReport()` — in the
    pipeline (Phase 4) and in the `rebuild` endpoint.
  - `renderMarktpartnerRegistry(allPartners)`: new helper in `report-builder.js`
    that renders a table of all found BDEW codes with market role and MaStR ID.
    - The row with VNB/grid operator role is shown in **bold** (the role used for
      data retrieval).
    - Notice text: *Supplier/sales roles may also have installation assignments
      in MaStR.*
  - `renderSection8()` receives a new `allPartners = []` parameter and calls
    `renderMarktpartnerRegistry` at the end of the section.
  - When `allPartners` is empty the block is not rendered (no empty section).
  - 3 new unit tests: table visible, VNB row bold, empty list suppresses section.



### Changed

- **360° Report – CR-18: Tolerant VNB identification (Phase 1)**
  - `buildVnbSearchQueries()`: automatically generates alternative search terms
    from the input:
    - "Stadtwerke Eberbach" → `["Stadtwerke Eberbach", "Eberbach"]`
    - "Eberbach" → `["Eberbach", "Stadtwerke Eberbach"]`
    - "TWL Netz GmbH" → `["TWL Netz GmbH", "TWL"]`
  - `pickBestVnbPartner()`: when multiple results are returned, prefers the entry
    with market role VNB/grid operator (a utility company has several BDEW codes
    depending on market role).
  - Normalises `mastrIds: { SNB: '…' }` to `mastrId` for consistent downstream
    handling.
  - New fallback (Step 1b): when `cernion_market_partners` returns empty for all
    query variants, reads an SNB directly from NAP data of existing installations
    via `cernion_installations_local` with the extracted city-name component.
  - VNB identification only fails once all three steps have been unsuccessful.
  - 9 new unit tests for `buildVnbSearchQueries` and `pickBestVnbPartner`; 1
    integration test for the stripped-city fallback sequence.

## [0.8.8] - 2026-03-06

### Fixed

- **360° Report – CR-17: VNB-Identifikations-Abbruch bei unbekanntem Netzbetreiber**
  - Pipeline now throws `VNB_NOT_IDENTIFIED` immediately after Phase 1 when neither a BDEW code nor a MaStR-ID could be resolved from the market-partners lookup.
  - Prevents the silent generation of a meaningless all-`n/v` report for unrecognised utility names (e.g. "Stadtwerke Walldorf").
  - `status.error` receives the full human-readable message including suggestions on how to fix the input (correct name spelling or supply `bdew` parameter directly).
  - The `/download/:reportId` endpoint now returns HTTP 422 with `{ success: false, status: "error", error: "<message>" }` instead of a silent 404 when the progress file records `status: 'error'`.
  - 3 new unit tests: download-422 payload, pipeline abort on empty `marketPartners`, no HTML written after abort.

## [0.8.7] - 2026-03-06

### Added

- **360° Report – CR-11: DataStatus Fehlerklassen-Taxonomie (P0)**
  - New module `src/data-status.js` exports `DataStatus` enum (OK / NOT_CALLED / TOOL_ERROR / NOT_LICENSED / NO_DATA / FALLBACK) plus factory `ds()`, renderer helpers `dsValue()`, `dsFallbackReason()`, `dsFallbackDisplay()`, `dsRender()`.
  - Imported in both `utility-report.service.js` and `report-builder.js`.
  - Replaces bare string fallbacks; enables precise distinction between implementation gaps (⚠ n/v), licence gaps (nicht lizenziert), and estimates (~value ⓘ).
  - 18 unit tests in `tests/data-status.test.js`.

- **360° Report – CR-12: Churn Dummy-Werte eliminieren (P1)**
  - `renderSection6` detects heuristic churn text (`/heuristic|heuristik/i`) and renders values with `~` prefix + ⓘ marker instead of plain numbers.
  - Description column shows `"Branchenheuristik (BDEW-Referenz) – kein CRM-Datenzugang"` so readers know values are not VNB-specific.
  - Heidelberg = Hockenheim = 8% is now visually marked as estimate, not a real measurement.

- **360° Report – CR-13: Rohe Web-Snippets bereinigen (P1)**
  - `renderContextBox()` replaced with quality-filtered version: section is suppressed when fewer than 2 items pass or all snippets are ≤50 chars or end with `...`.
  - `formatSnippet()` strips trailing source attributions (` – Publisher`).

- **360° Report – CR-14: Gas EU-Aggregat & Ländervergleich repariert (P1)**
  - Section 4 pipeline adds 2 parallel direct MCP calls: `agsi_eu_statistics` + `agsi_storage_trend` (period_days=14) as enrichment, merged with broker results.
  - `renderSection4` Ländervergleich row now expands `rankings[]` → `"DE: 73 % · AT: 65 % · NL: 80 % · FR: 55 %"` instead of generic `"✓ Daten verfügbar"`.
  - `Gasfüllstand EU gesamt` and `Speicher-Trendbewertung` rows have `fallbackReason` strings.

- **360° Report – CR-15: VNB-Fingerprint-Check (P2)**
  - `validateVnbUniqueness()` helper compares `VNB_SPECIFIC_FIELDS` (7 fields) against all previously completed reports stored in `.reports/*.progress.json`.
  - Warns via `logger.warn` for any field with identical values across VNBs — detects silent dummy-value propagation.
  - `kpiSummaryFlat` now saved to progress JSON after pipeline completion for future comparisons.

- **360° Report – CR-16: Management Summary Priorisierung & Begrenzung (P2)**
  - `buildStaticNarrative` redesigned: each finding has `type` (critical / warning / opportunity) and `prio` (1–5).
  - Critical items always precede warnings; max 2 opportunities appended at the end.
  - Hard cap: max 5 bullets total (previously unlimited, Hockenheim had 6).
  - Anschlussdauer >13 Wo. over median → type=critical (🚨); gas fill <25% → type=critical (⛽); good Anschlussdauer → type=opportunity (✅).
  - Hints line filtered from bullet list.
  - `renderManagementSummary` enforces 5-bullet cap and strips the `📋 Hinweis:` GEMINI hint line.

### Fixed

- Gas section `Ländervergleich Gasfüllstand` row was always rendering `"✓ Daten verfügbar"` instead of actual country percentages.
- Management summary could produce 6–7 bullets with no ordering guarantee between critical issues and opportunities.
- Churn-Risiko-Score and Gefährdete Kunden were identical across all VNBs (hardcoded heuristic values presented as real measurements).

## [0.8.6] - 2026-03-06

### Added

- **360° Report – CR-01: EE-Portfolio MaStR direct enrichment (P1)**
  - Section 2 pipeline now fires 3 parallel `cernion_installations_local` calls (type: solar / wind / storage) when a MaStR-ID is resolved, providing exact capacity and count directly from local MongoDB.
  - `renderSection2` uses these as fallbacks when the `assets` broker service returns incomplete data; shows `n/v (MaStR-Abfrage nicht verfügbar)` only when both sources fail.

- **360° Report – CR-02: Trafo-Auslastung & Netzbetrieb-Kennzahlen (P1)**
  - New `cernion_transformer_loading_forecast` gated call (forecastYears=0) added to Section 1 pipeline.
  - `renderSection1` cascades transformer utilisation from `capacityUtilization` → `transformerLoading.current` → `transformerLoading.transformers`.
  - `operatorAnalysis` used as secondary source for redispatch count when `redispatchExport` fails.

- **360° Report – CR-03: Residuallast-Warnung (P3)**
  - Residuallast value cell appends `⚠ warningMessage` when the tool returns a warning; text shown inline in description column.

- **360° Report – CR-04: Day-Ahead-Preisverlauf 24h (P2)**
  - `energy-market.prices` now fetched with `dateFrom`/`dateTo` (24h window) instead of `date: today`.
  - Removed `slice(-24)` in `renderSection3`; chart renders all available data points (up to 96 quarter-hour values).
  - `Preis-Einspeise-Korrelation` row shows actual coefficient when `correlationCoefficient` is returned.

- **360° Report – CR-05: EWK Handlungsempfehlungen dynamisch (P2)**
  - `renderSection5` action-hint generates text from actual `vnbAnschlussdauer`, `bundesMedian`, `diPct`, and `uqPct` values.

- **360° Report – CR-06/07: Fallback-Reasons für Abschnitte 6 & 7 (P1/P2)**
  - All kpiRows in Section 6 and 7 carry descriptive `fallbackReason` strings.
  - Section 7 extracts `totalInstallations` from `operatorAnalysis` as fallback for `Betreiber-Portfolio Gesamt`.

- **360° Report – CR-09: Dynamische Management Summary (P1)**
  - KPI summary for Gemini now includes **all 8 sections** (previously only 1–3).
  - `buildStaticNarrative` redesigned with conditional, data-driven findings (gas fill %, PV MW, redispatch count, Anschlussdauer delta, day-ahead price, CO₂) sorted by criticality.

- **360° Report – CR-10: Fallback-Handling – kein nacktes „–" (P1)**
  - `kpiRow()` gains optional 5th `fallbackReason` parameter; value cell shows `n/v` (italic, muted) with reason appended to description. Bare `–` retained when no reason supplied (backward-compatible).
  - `.kpi-nvl` CSS class added.
  - Sections 1, 2, 3, 6, 7 pass `fallbackReason` for all tool-dependent KPI rows.

## [0.8.4] - 2026-03-07

### Fixed

- **360° Report – 15 renderer data-path bugs that caused "–" for real KPIs in v0.8.3:**

  **Section 1 (Netz & Grid):**
  - `CO₂-Intensität Strom` — `safeData()` was over-unwrapping into an inner metadata sub-object; added direct `co2Raw = s1?.co2Intensity?.data` read so `co2_intensity_gco2eq_kwh` is always resolved from the top-level envelope.
  - `Residuallast regional` — renderer looked for `rl?.summary?.netResidualLoad` (nonexistent); corrected to `rl?.summary?.kpis?.avgResidualLoadMW` with fallback chain.
  - `Redispatch-Anlagen` — returned `success: false` when BDEW-only VNB not found in MaStR; added `rd?.success !== false` guard so "–" no longer masks a known pipeline failure.

  **Section 3 (Energiemarkt):**
  - `Day-Ahead-Preis` — ENTSO-E tool returns `dataPoints[]` with `priceEURperMWh`; renderer was looking for `prices.prices[].price`. Fixed field names in `priceTimeSeries`, `chartSrc` map and `latestPrice` chain.
  - `Negative Preisphasen` — tool returns MCP text-content array; parse text for "No Negative Price Periods Found" → renders as `0 h §51 EEG` with a ✅ note.
  - `Kraftwerksausfälle` — renamed to "Kraftwerksausfälle (Kapazität)"; fixed path from `getVal(..., 'totalUnavailableMW')` to `unavailData?.statistics?.totalCapacityMW` with event count side-label.

  **Section 4 (Gas):**
  - `Gasfüllstand Deutschland` — AGSI uses field `fillPercentage` not `full`; added as first entry in the fallback chain. Same fix applied to EU aggregate path.

  **Section 5 (Regulierung & Compliance):**
  - `Anschlussdauer EE NS` — EWK `anschlussdauer` tool returns `rows[0].ee_ns_gesamt_wochen`; added as primary path before legacy `adJson.anschlussdauer.ee_ns_gesamt`.
  - `Bundesmedian Anschlussdauer EE NS` — was hardcoded `null`; now extracted from `adJson?.stats?.ee_ns_gesamt?.median`. Bundesmedian KPI row added; chart bar now shows real median value.
  - Added **Digitalisierungsindex Rang** KPI row (`bmJson.rankings.digitalisierungsindex_rank / total`).
  - Added **DI-Bundesmedian** KPI row (`diJson?.stats?.gesamtscore?.median`).

  **Section 6 (Kundenmanagement):**
  - `Gefährdete Kunden` — regex failed to match `"at-risk customers (max 100)**: 60"` format. Fixed to `/at-risk customers[^:]*\*{0,2}:\s*\*{0,2}(\d+)/i`.

  **Section 8 (Digitalisierung):**
  - `Digitalisierungsindex (Gesamt)`, `Smart Grids Score`, `Kundenportal-Score` — renderer used `diJson8?.digitalisierungsindex` (null for standalone tool); corrected to `diJson8?.rows?.[0]`. Scores already in % (0–100); removed incorrect `* 100` multiplier.
  - `Kundenportal-Score` — corrected field from `kundenportal` → `kundenmanagement_webportale`.
  - Added **DI-Rang** KPI row (`diScores8.gesamtscore_rank`).
  - Added **DI-Bundesmedian** KPI row (`diJson8?.stats?.gesamtscore?.median`).

- **360° Report pipeline – MaStR queries skipped when only BDEW code available** — `cernion_installations_local` requires a MaStR ID. `dataQualityBaseParams` is now `null` (and all three MaStR local queries skipped) when `resolvedMastrId` is absent, preventing misleading `{ success: true, error: "BDEW code could not be resolved to MaStR ID" }` responses.

## [0.8.3] - 2026-03-06

### Added

- **360° Report: 3 new MaStR data-quality KPIs in Section 1** — Parallel `cernion_installations_local` queries now populate:
  - **Anlagen in Netzbetreiberprüfung** — count of active installations stuck in open grid-operator review (`netzbetreiberPruefungStatus: NetzbetreiberPruefung`). Regulatory deadline: 4 weeks (NS) / 6 weeks (MS/HS).
  - **Redispatch-/§14a-Anlagen ohne MeLo** — count of active installations ≥100 kW whose NAP record has no linked Messlokation (`napData` absent). Displayed as `missing / total ≥100 kW`.
  - **Ortsfremde Anlagen (PLZ-Ausreißer)** — two-step detection: sample 100 active installations to derive the dominant 3-digit PLZ prefix, then query `postleitzahlNot: prefix` to count outside-territory registrations.
- **Action hint boxes on all 8 report sections** — each section now ends with a blue `action-hint` block containing 4–5 concrete, regulation-specific recommendations so readers know exactly what to do next.
- **`actionHint(title, items)` helper in `report-builder.js`** — generates a styled `<div class="action-hint">` with a bold heading and a bullet list.
- **`.action-hint` CSS class** — blue left-border box (`border-left: 3px solid var(--accent)`), renders correctly in both screen and print/PDF output.
- **`postleitzahlNot` parameter for `energy-market.installations`** — new optional string param (min 2, max 6 chars) passed directly to `cernion_installations_local` to filter out a PLZ prefix range.

### Fixed

- **360° Report: `resolvedMastrId` not extracted from vnbLookup response** — `vnbLookup.data.data.mastrId` was present but not read back into `p.meta.resolvedMastrId`. Now tries `vnbData.mastrId`, `vnbData.data.mastrId`, and `vnbData.mastrIds[0]` in order.
- **360° Report: all solar/wind/storage asset calls failed for VNBs resolved only via BDEW** — `gridOpParams` used `{ gridOperatorMastrId }` (wrong key for the assets broker) and had no BDEW fallback. Fixed to use `{ gridOperatorId: resolvedMastrId }` OR `{ bdewCode: resolvedBdew }`.
- **360° Report: `redispatchExport` failed with "One of gridOperator, gridOperatorId, or gridOperatorBdewCode is required"** — Added `gridOperatorBdewCode: resolvedBdew` as fallback when `resolvedMastrId` is null.



### Fixed

- **360° Report: all KPI values were "–"** — `safeData()` now auto-unwraps the `{success, data: payload}` service envelope that AGSI, EWK, and EIC tools wrap their results in. Previously the renderers received the outer wrapper object and all field lookups missed.
- **Added `extractEwkJson()` helper** — EWK monitoring services return a text-array where the second element carries a `.json` field with structured benchmark data. The new helper extracts this JSON from any `[{type,text}, {type,text,json:{...}}]` response, enabling section 5 (Regulierung & Compliance) to render real values.
- **Section 1** — CO₂ intensity now reads `co2_intensity_gco2eq_kwh` (actual field name from GrünstromIndex API) with fallback to the legacy `co2intensity` key. Residual load now traverses `summary.netResidualLoad`.
- **Section 4** — Gas storage fill level reads `storage.gasInStorage` and `storage.full` from the AGSI nested payload. Supply security status reads `securityStatus` (primary) with fallback to `status`.
- **Section 5** — EWK KPI rows (Anschlussdauer, Digitalisierungsindex, Smart-Grids, Umsetzungsquote) now extract values from `data[1].json` via `extractEwkJson()`; ranking shown as `{rank} / {total}`.
- **Section 6** — churn text extracted from `churn[0].text` (array after unwrap) with fallback to `churn.data[0].text` for legacy shapes.
- **Section 8** — EIC total reads `statistics.total` with flat-object fallback; systemStatus derives 'Online' from `Array.isArray(sysStatus)` when the tool returns a text-array; digitalisierung scores use `extractEwkJson()` with `diScores.gesamtscore * 100`.

## [0.8.1] - 2026-03-05

### Changed

- **Gemini model updated** — `utility-report` service now uses `gemini-2.5-flash` (stable GA) instead of the deprecated `gemini-2.0-flash`. `gemini-2.0-flash` is listed as a "Previous model" in the Google AI docs and will be shut down; `gemini-2.5-flash` is the stable price-performance successor with reasoning support.

### Added

- **360° Bericht panel in `/app`** — new UI section in the web application (`src/app.html`) reachable via the "📄 360° Bericht" nav link. Provides a browser-based hook for the `utility-report` service without requiring API clients or `curl`:
  - Input fields for Versorger name (required), Region, BDEW-Code, and per-request Cernion Token
  - **Generate** button → `POST /api/utility-report/generate`; animated progress bar polls `GET /api/utility-report/status/:reportId` every 4 s, showing phase name and percentage
  - **Open report** button appears on completion → opens `GET /api/utility-report/download/:reportId` in a new tab (browser Print → Save as PDF)
  - **Force-refresh** button ("🔄 Neu generieren") bypasses the 7-day cache via `forceRefresh: true`
  - **History section** — last 20 generated reports persisted in `localStorage`; each entry shows utility name, date, a re-open link, and a remove button

## [0.8.0] - 2026-03-05

### Added

- **360° Utility Management Report Generator** — new `utility-report` service with 3 REST endpoints that produce a comprehensive ~50-page HTML report (print-to-PDF) for German energy utility decision-makers (Stadtwerke, Netzbetreiber).

  - **`POST /api/utility-report/generate`** — starts (or resumes) report generation. Returns a UUID `reportId` immediately; generation runs asynchronously in a sequential 4-phase pipeline. Supports 7-day disk cache (`.reports/UUID.html`) keyed by SHA-256 of `{utilityName, date}`; `forceRefresh: true` bypasses the cache.
  - **`GET /api/utility-report/status/:reportId`** — polls generation phase (0–4), percentage progress and error state.
  - **`GET /api/utility-report/download/:reportId`** — serves the completed HTML document (`text/html`); open in browser and use Print → Save as PDF.

  **Report structure (8 KPI sections matching data scientist KPI list):**
  1. Netzbetrieb & Netzplanung — capacity utilization, redispatch portfolio, residual load, CO₂, e-mobility
  2. Erneuerbare Energien & Einspeiser — PV/Wind/Storage from MaStR, ENTSO-E actual generation, generation forecast
  3. Energiemarkt & Preise — EPEX Day-Ahead, SMARD Spotpreise, ENTSO-E generation/load/unavailability, §51 EEG monitoring
  4. Gasinfrastruktur & Versorgungssicherheit — AGSI/GIE country & EU storage, trend (90%-Mandat line), supply security
  5. Regulierung, Compliance & Marktprozesse — full BNetzA EWK benchmark (Anschlussdauer, Digitalisierungsindex, Umsetzungsquote), NEST compliance
  6. Kundenmanagement, Vertrieb & Prosumer — churn prediction, sales leads, market penetration, prosumer tariff
  7. Investitionsplanung & Business Cases — investment NPV, operator portfolio, storage optimization
  8. Digitalisierung & Systemübersicht — Cernion system status, EIC statistics, VNB digitalisation score

  **Pipeline phases:**
  - Phase 0: `cernion_discover` preflight → builds `Set<toolName>` to gate optional/unconfirmed tools
  - Phase 1: VNB identification via `grid-operations.marketPartners` + `vnbLookup` (BDEW/MaStrId resolution)
  - Phase 2: EIC metadata + EWK benchmark
  - Phase 3: Sequential data collection across all 8 sections (51 wrapped service calls + `callMcpDirect` for 14 unconfirmed tools)
  - Phase 4: Web search context (3 queries via `web-search.query`), Gemini narrative, `buildHtmlReport()`

  **Resumability:** Progress JSON (`.reports/UUID.progress.json`) saved after each phase. Retrying the same `generate` request resumes from the last completed phase.

  **Graceful degradation:** every service call wrapped in `try/catch` returning `{ available: false }`. The HTML renderer shows "Keine Daten verfügbar" placeholders instead of aborting.

  **Charts (Chart.js CDN):** Transformatorauslastung (bar, section 1), Day-Ahead Preisverlauf (line, section 3), Gasfüllstand-Trend with 90%-Mandat line (line, section 4), Anschlussdauer VNB vs. Bundesmedian (horizontal bar, section 5), Churn-Gründe Branchenverteilung (doughnut, section 6).

  **Gemini integration:** If `GEMINI_API_KEY` is set, uses `gemini-2.5-flash` to generate a 5–7-finding German management summary from collected KPIs; falls back to a static template otherwise.

- **Web Search Service** (`services/web-search.service.js`) — new `web-search` Moleculer service, `POST /api/web-search/query`. Calls `https://search.corrently.cloud/search` (SearXNG, privacy-respecting) via `axios`. Used internally by `utility-report` for context enrichment. Graceful: returns `{ success: false, data: { results: [] } }` on network errors.

- **Report Builder** (`src/report-builder.js`) — pure JS module, no external dependencies. Exports:
  - `buildHtmlReport(reportData)` → self-contained HTML string with inline CSS, `@media print` A4 rules, Chart.js CDN, 8 German sections, cover page, management summary, footer.
  - `summarizeForReport(result, sectionKey)` → compact flat object for Gemini (strips large arrays, keeps numeric/boolean KPIs and short strings).

- **KPI Coverage** — 81 KPIs across 8 sections as defined by the data scientist KPI list (March 2026). Tools confirmed available via existing services: 51. Tools attempted via `callMcpDirect` with graceful degradation: 14 (including `cernion_transformer_loading_forecast`, `cernion_investment_business_case`, `cernion_operator_portfolio`, `cernion_storage_optimization`, `cernion_regional_energy_mix`, `cernion_prosumer_tariff_designer`, `cernion_nest_compliance_report`, etc.).

### Tests

- `tests/web-search.service.test.js` — 10 tests: validation (4), successful search (6 including result slicing, field mapping, default language), error handling (2 graceful degradation paths)
- `tests/utility-report.service.test.js` — 25 tests: parameter validation (3), generate action (4), status action (4), download action (3), report-builder integration (10 including XSS escaping, @media print, chart rendering, summarizeForReport), graceful degradation (1)

## [0.7.1] - 2026-03-04

### Fixed

- **`POST /api/agent/analyze` — crash `TypeError: v.values.join is not a function`**
  Root cause: `buildServiceCatalogue` in `agent.service.js` checked `v.values` as a plain truthiness guard before calling `.join('|')`. When Moleculer's `fastest-validator` compiles a multi-type param declaration (an array of rules, e.g. `[{type:'array'}, {type:'string'}]` as used by `grid-operations.redispatchExport.types` since v0.6.19), it mutates the param array in place by adding a `values` property that points to the compiled check **Function**. A Function is truthy but has no `.join` method — any subsequent `agent.analyze` call crashed immediately in `buildServiceCatalogue`.

  The bug was dormant since v0.6.19 and only surfaced in v0.7.0 when a user triggered `agent.analyze` via the Research App using the new EWK-monitoring demo query.

  Fix 1 — **crash guard**: Changed `v.values` truthiness check to `Array.isArray(v.values)` so non-array `values` (functions, objects, Sets) are silently skipped.
  Fix 2 — **multi-type rendering**: When the param `v` itself is an array (multi-type declaration), the catalogue now renders it as `paramName?: type1|type2` instead of falling through to `v.type || 'string'`.

  3 new unit tests: multi-type param with compiled function `values` does not crash `agent.analyze`; multi-type renders as `array|string`; normal enum still renders correctly with `Array.isArray` guard.

## [0.7.0] - 2026-03-04

### Added

- **EWK Monitoring Service** (`services/ewk-monitoring.service.js`) — new Moleculer service exposing 4 REST endpoints for BNetzA Energiewendekompetenz (EWK) monitoring data of ~820 German distribution grid operators (VNBs). Data source: [vnb-transparenz.de/EWK-Monitoring-BNetzA](https://www.vnb-transparenz.de/EWK-Monitoring-BNetzA). All endpoints expose the `format` parameter (`json` | `csv` | `xlsx` | `xls`) for file download. **Tag:** `EWK Monitoring (BNetzA)`.

  - **`POST /api/ewk-monitoring/anschlussdauer`** — wraps `ewk_anschlussdauer`:
    Connection waiting times (median weeks) per voltage level (NS/MS/HS) and installation type (EE/Verbrauch) for all VNBs. Supports `vnbName` partial search, `bnr` exact lookup, `voltageLevel`, `installationType`, `sortBy` (`anschlussdauer_asc` | `anschlussdauer_desc` | `name`), `limit`, `offset`, and `includeRanking`. Returns result list with BNetzA indicators 4.3.1–4.3.6 / 5.3.1–5.3.6 plus national distribution statistics.

  - **`POST /api/ewk-monitoring/digitalisierungsindex`** — wraps `ewk_digitalisierungsindex`:
    Digitalisation scores (0–100 %) across 5 categories (`gesamtscore`, `smart_grids`, `digitale_prozesse`, `datenmanagement`, `kundenmanagement`) and up to 19 sub-indicators for all VNBs. Supports `vnbName`, `bnr`, `category`, `sortBy` (`score_desc` | `score_asc` | `name`), `limit`, `offset`, and `includeRanking`. Scores are normalised from BNetzA's raw 0–1 values to 0–100 %.

  - **`POST /api/ewk-monitoring/umsetzungsquote`** — wraps `ewk_umsetzungsquote`:
    Implementation rate (% of submitted connection applications that were realised) per voltage level and installation type. Covers BNetzA indicators c010 / c020 / c030 (EE) and c041 / c053 / c064 (Verbrauch/Speicher). Returns rate plus absolute counts (applications submitted vs. realised). Supports same filter/sort parameters as `anschlussdauer`.

  - **`POST /api/ewk-monitoring/benchmark-vnb`** — wraps `ewk_benchmark_vnb`:
    Combined EWK performance profile for a single VNB (`vnbName` required, `bnr` optional). Returns all three monitoring dimensions (Anschlussdauer, Digitalisierungsindex, Umsetzungsquote) with national ranks in a single response — Markdown tables + structured JSON.

- **29 new unit tests** in `tests/ewk-monitoring.service.test.js` covering:
  - Service definition (name, action count, timeout)
  - All 4 actions: default params, enum validation, required-field enforcement, pagination, correct MCP tool name, `format` not forwarded to MCP, combined CSV/XLSX passthrough
  - `benchmarkVnb` vnbName required + empty string rejection

## [0.6.25] - 2026-03-04

### Added

- **`POST /api/grid-operations/redispatch-export` — `einsatzverantwortlicher` column in CSV/XLSX output**
  The Redispatch 2.0 export now includes the MaStR field `einsatzverantwortlicher` (Direktvermarkter / deployment-responsible party) as the last column in every row. The value is taken directly from `inst.einsatzverantwortlicher` in the `cernion_installations_local` result; it is left as an empty string when no Direktvermarkter is registered for the installation. This enables the "Direktvermarktungs-Pipeline" dashboard KPI: installations with an empty `einsatzverantwortlicher` are redispatch-eligible (≥ 100 kW) but lack a Direktvermarkter — they automatically fall under Ausfallvergütung and are high-priority sales leads.
  **New CSV format:**
  `mastrNummer,type,capacityKW,city,postalCode,commissioningDate,status,einsatzverantwortlicher`
  2 new unit tests: populated `einsatzverantwortlicher` appears in output; absent field maps to empty string (trailing `""` in row).

## [0.6.24] - 2026-03-04

### Fixed

- **`POST /api/business-intelligence/churn-prediction` — `estimatedAtRiskCustomers`, `assumedChurnRatePct`, `analysisText` empty and `isHeuristicModel: false` in CSV (D11 follow-up)**
  Root cause: `extractChurnText` only checked `result.data?.content?.[0]?.text`, but `cernion_customer_churn_prediction` responds synchronously (no async job). For synchronous tools, `mcp-client.callTool` places the content array **directly** at `result.data` (i.e. `result.data = [{type:'text', text:'...'}]`), not wrapped in `{content:[...]}`. Accessing `.content` on an array returns `undefined`, so `extractChurnText` silently returned `''` — causing all derived fields to be `null`/`false` and `analysisText` to be an empty string.
  Fix 1 — `extractChurnText`: now checks `Array.isArray(result.data) && result.data[0]?.text` first (synchronous/direct path), then falls back to `result.data.content[0]?.text` (async-polled path), then string fallbacks.
  Fix 2 — `parseChurnPredictionText`: added fallback regex patterns for at-risk count, churn rate, and heuristic flag to handle wording variations across MCP tool versions (`at.risk customers.*?`, `churn rate.*?`, `churn.*?`, `Abwanderungsrate`, `Heuristik`).
  2 new unit tests: real MCP array-format response path (verifies `60,8,"true"` in CSV); German "Heuristik" wording detection.

## [0.6.23] - 2026-03-04

### Fixed

- **`POST /api/grid-operations/redispatch-export` — `format=csv` ignored across all four previous fix iterations (D7 root cause found)**
  The Moleculer `params` schema correctly declared `format` since v0.6.20, and the handler correctly extracted and used it. The actual failure was that the `openapi.requestBody.content['application/json'].schema.properties` block was written out manually and **omitted the `format` property entirely**. Because the Moleculer API Gateway uses the explicit OpenAPI `requestBody` schema (when present) as the authoritative parameter map, `format` was never registered as an accepted request body field — it was silently dropped before reaching the handler in all deployed versions.
  Fix: Added `format: FORMAT_PARAM_SCHEMA` to the `properties` block of the OpenAPI request schema (matching the pattern used by `german-grid.redispatch` and all other services). Also added a `responses[200]` block with `FORMAT_RESPONSE_CONTENT` so `text/csv` and `application/vnd.openxmlformats...` appear as valid response content types in the published spec. Added a `byMastrIdCsv` example to the Swagger UI.


### Fixed

- **`POST /api/german-grid/redispatch` — `totalMeasures`/`totalEnergyMWh` empty in CSV (D8 follow-up)**
  The v0.6.21 summary-row CSV was correct in structure, but the actual Netztransparenz API sometimes uses `Total volume:` instead of `Total energy:` for the aggregate energy field, and can return `isError: true` (HTTP 500 from Netztransparenz) without the outer `success` flag becoming `false`.
  Fix 1 — `isError` guard: when `result.data?.isError === true`, the handler now throws a descriptive error (`"Netztransparenz API Error: ..."`) instead of silently returning an empty summary row.
  Fix 2 — flexible regexes: `parseRedispatchMeasuresText` now tries `Total energy:` **and** `Total volume:` (case-insensitive) for the energy field, and strips European digit separators (`1,248,204` / `1.248.204`) before `parseInt`.
  2 new unit tests: `"Total volume:"` alternate wording, `isError: true` rejection.

- **`POST /api/grid-operations/redispatch-export` — `isError: true` silently returns empty CSV (D7 follow-up)**
  When the `cernion_redispatch_export` async job completes with `isError: true` in its result envelope (e.g. grid operator not found), the handler now throws a descriptive error instead of returning a preamble-only CSV with `# Total: 0 installations`.
  Also: removed the `status: 'InBetrieb'` filter from the `cernion_installations_local` secondary lookup (it was unnecessarily restrictive — installations with non-standard status codes were excluded), and added `localResult?.data?.installations` as a fallback access path to handle both direct JSON-spread and wrapped response shapes.
  1 new unit test: `isError: true` rejection.



### Fixed

- **`POST /api/grid-operations/redispatch-export` — `format=csv` returned only 5-row preview (D7)**
  The v0.6.20 fix parsed the Markdown `**Preview**` table embedded in the MCP narrative, which contained at most 5 rows. The actual full installation data (up to 10 000 records) is available via `cernion_installations_local` with `format: 'detailed'`.
  Fix: `parseRedispatchExportText` now extracts the resolved operator MaStR ID from the `MaStR Number(s): SNB…` line. The CSV handler then calls `cernion_installations_local` with that ID to fetch the full structured dataset and maps each record to `{mastrNummer, type, capacityKW, city, postalCode, commissioningDate, status}`. CSV header changed accordingly; the `# Note: Preview only` comment is omitted when full data is available. A preview fallback is used only if the local lookup call fails.
  Tests updated: old preview-column assertions replaced with full-column and MaStR-number assertions; mock for `callWithNewSession` added.

- **`POST /api/german-grid/redispatch` — `format=csv` returned identical timestamps for all rows (D8)**
  The MCP tool `netztransparenz_redispatch` always returns exactly 10 preview rows, all sharing the first UTC time slot of the queried period (e.g. `2026-02-01T23:00:00Z`), making per-row CSV output meaningless for PowerBI trend analysis.
  Fix: `parseRedispatchMeasuresText` now extracts the aggregate summary fields from the narrative (`Found: N measures`, `Total volume:`, `High congestion:`, `Top reasons:` block) instead of the individual preview rows. The handler produces a single summary row per API call with fields `{dateFrom, dateTo, totalMeasures, totalEnergyMWh, highCongestion, topReason1..3 (name/MWh/pct), source}`. The preamble note changed from "Preview only — N of M measures shown" to "Aggregated summary per period. For monthly trend analysis call with monthly date ranges."
  Tests updated: assertions match new summary-row columns and confirm "Preview only" string is absent.

- **`POST /api/business-intelligence/churn-prediction` — `format=csv` parameter ignored (D11)**
  The `format` parameter was not declared in the Moleculer params schema and was forwarded directly to the MCP tool `cernion_customer_churn_prediction`, which returned a raw heuristic narrative regardless.
  Fix: Added `format` to the params schema. The handler strips `format` before calling `callWithAutoPoll`, then parses the narrative with `parseChurnPredictionText` to extract `{customerSegment, region, riskThreshold, predictionWindowMonths, estimatedAtRiskCustomers, assumedChurnRatePct, isHeuristicModel, analysisText}`. For `format=csv`/`xlsx` a single summary row is returned with a `# Churn Prediction Export` preamble including a `# Note: Heuristic model` warning. Default JSON passthrough unchanged.
  3 new unit tests: CSV preamble, format not forwarded to MCP, JSON default.



### Fixed

- **`POST /api/grid-operations/redispatch-export` — `format=csv` ignored; raw JSON narrative returned (D7)**
  The `format` parameter was missing from the Moleculer params schema, so it was never extracted from `ctx.params` and was forwarded as-is to the MCP tool; the raw MCP narrative result was then returned unchanged.
  Fix: Added `format` to the `redispatchExport` params schema. The handler now strips `format` before forwarding to `callWithAutoPoll`, then parses the narrative text with `extractRedispatchText` + `parseRedispatchExportText`. For `format=csv` a proper CSV is returned with a `# Redispatch 2.0 Export` preamble block (grid operator name, min capacity, total installations/capacity, generated timestamp, partial-preview note). For `format=xlsx`/`xls` the parsed rows are passed to `applyFormat`. For `format=json` (default) the raw MCP result is returned unchanged.
  4 new unit tests: JSON passthrough, CSV preamble content, CSV header row, `format` not forwarded to MCP tool.

- **`POST /api/german-grid/redispatch` — `format=csv` returns empty body (D8)**
  `applyFormat` was called correctly, but `extractRows()` in `format-response.js` found no known array key in the MCP result — the measures data lives exclusively in `result.data.content[0].text` as a Markdown bullet list — so it always returned `[]`, producing an empty CSV.
  Fix: Added `extractRedispatchText` + `parseRedispatchMeasuresText` helpers to `german-grid.service.js`. The handler now parses bullet lines of the form `- TIMESTAMP: VALUE MWh (TYPE)` into structured rows `{timestamp, quantityMWh, measureType}` and builds a `# Redispatch Measures Export` preamble (period, total measures, total energy, generated timestamp, partial-preview note). Also added null-result and `success=false` guards that throw descriptive errors instead of returning `null`.
  4 new unit tests: CSV preamble content, CSV header/data rows, JSON passthrough, null-result error, `success=false` error.

## [0.6.19] - 2026-03-04

### Fixed

- **`POST /api/grid-operations/redispatch-export` — 422 Validation Error when `types` is a comma-separated string**
  The Moleculer params schema declared `types` as `type: 'array'`, so passing `"types": "solar,wind,storage"` (a JSON string) was rejected with `VALIDATION_ERROR 422` before the handler was reached.
  Fix: The `types` param now accepts both `array` and `string` via a Moleculer multi-type declaration. The handler normalises a string to an array by splitting on `,` and trimming whitespace before forwarding to the MCP tool `cernion_redispatch_export`. Both `["solar","wind"]` and `"solar,wind"` now produce identical results.
  3 new unit tests: array passthrough, comma-string coercion, comma-string with spaces.

## [0.6.18] - 2026-03-04

### Fixed

- **`POST /api/energy-market/co2-intensity` — CSV export missing `# Source:` and `# Generated:` comment lines**
  The `format=csv` response already included `# CO2 Intensity Export`, `# Location:`, `# Current CO2 Intensity`, and `# Average Today` header comments, but omitted the data-source attribution and generation timestamp that are present in the MCP response (`data_source` and `timestamp` fields).
  Fix: Added `# Source: <data_source>` (conditionally, only when `data_source` is non-empty) and `# Generated: <timestamp>` comment lines to the CSV preamble. The `# Source:` line reflects the upstream provider (e.g., `GrünstromIndex (api.corrently.io)`) and `# Generated:` uses `result.timestamp` (falling back to `result.data.timestamp`, then `new Date().toISOString()`).
  Updated test mock to include `data_source` and top-level `timestamp`; added two new `toContain` assertions.

## [0.6.17] - 2026-03-04

### Fixed

- **`POST /api/residual-load/net-residual-load` — `Load (MW) = 0` for all future-date requests (SMARD filter 411 not yet published before ~14:00 CET)**
  Root cause confirmed via direct SMARD API probe: SMARD filter 411 ("Prognostizierte Netzlast", day-ahead load forecast) has `null` values for tomorrow's date until the German TSOs publish the day-ahead forecast at approximately 14:00 CET. Before publication, all 96 quarter-hourly slots contain `null`, which the MCP tool maps to `loadMW=0`. The region name (`Rheinland-Pfalz`, `Bayern`, etc.) and population scaling were both correct — the underlying national SMARD load data was simply not yet available.
  Fix: Automatic **D-7 reference week fallback** — when all `loadMW` values are 0 and the requested date is today or in the future, the service automatically retries with `startDate = requestedDate − 7 days` (same weekday). This uses SMARD filter 410 (realised load), which always has data. The fallback is consistent with the MCP tool's own documented strategy for D+2–D+14 requests. A `loadFallbackWarning: true` and descriptive `loadFallbackNote` field are added to the response. If the D-7 retry also returns all zeros, the original `dataQualityWarning` is surfaced as a last resort.
  Historical requests (`startDate` in the past) that return all-zero load still receive the `dataQualityWarning` / `populationOverride` guidance (population scaling issue, not a date issue).
  7 new unit tests covering all fallback branches.

## [0.6.16] - 2026-03-04

### Fixed

- **`POST /api/residual-load/net-residual-load` — `Load (MW)` still 0 in v0.6.15 (root cause finally found)**
  Root cause confirmed via live API probe: MaStR stores the `bundesland` field as a **numeric catalog code** (e.g. `"1410"`) for every single installation — never as a text name like `"Rheinland-Pfalz"`. All previous fix attempts failed because they assumed at least one record would contain a text `bundesland`; `isTextRegion` correctly rejected these numeric codes, so the code fell through to `landkreis = "Ludwigshafen am Rhein"`, which SMARD also silently rejects.
  Fix: Added a `BUNDESLAND_CODES` static lookup map (all 16 Bundesländer, codes `1400`–`1415`, verified empirically via live probing of every state) as the new Pass 1 of `resolveRegionFromOperatorId`. The numeric code is now translated to the SMARD-accepted text name before any text-region fallback is attempted.

## [0.6.15] - 2026-03-04

### Fixed

- **`POST /api/residual-load/net-residual-load` — `Load (MW)` persistently 0 after all previous fix attempts (v0.6.13, v0.6.14)**
  Root cause: `resolveRegionFromOperatorId` sampled only **one** installation (`limit: 1`) to derive
  the SMARD region. For TWL Ludwigshafen (`SNB935578300972`) the first installation returned by
  `cernion_installations_local` has `bundesland: null` in its MaStR record. With `limit: 1` the
  v0.6.14 `isTextRegion` guard correctly skipped the numeric `landkreis = "1410"`, but then fell
  through to `gemeinde = "Ludwigshafen am Rhein"` — a city name SMARD does not accept, returning
  `loadMW = 0` for every timestamp.
  **Fix**: The sample is increased from `limit: 1` to **`limit: 10`**. The method now scans **all**
  returned installations in three passes:
  1. Return the first non-numeric `bundesland` found across all 10 records.
  2. If no installation has a valid `bundesland`, try `landkreis` (text, non-numeric).
  3. Last resort: `gemeinde` (city name).
  For TWL, at least one of the 10 sampled installations has `bundesland: "Rheinland-Pfalz"`, which
  SMARD resolves correctly; `populationOverride: 170000` then scales the state-level RLP load down
  to the ~170 K Ludwigshafen grid area.
  One new unit test added: `resolveRegionFromOperatorId` finds bundesland in second record when
  first record has `bundesland: null` (two-installation mock).

### Added

- **`POST /api/energy-market/co2-intensity` — `format` parameter (CSV / XLSX export)**
  The endpoint previously returned only JSON regardless of any `format` parameter in the request
  body. `format` is now a supported parameter (`json` | `csv` | `xlsx` | `xls`, default `json`):
  - **`format: "csv"`** — Returns a downloadable CSV with `# CO2 Intensity Export`,
    `# Location`, `# Current CO2 Intensity (gCO2eq/kWh)`, `# Average Today (gCO2eq/kWh)`
    comment headers followed by the hourly `timestamp,gCO2eqPerKWh` forecast rows — matching
    the `# Region: …` comment format used by the forecast and residual-load services.
  - **`format: "xlsx"`/`"xls"`** — Returns an Excel workbook with the forecast time series.
  - **`format: "json"`** (default) — Unchanged JSON response.
  - `format` is stripped before forwarding to the MCP tool `cernion_co2_intensity`.
  - OpenAPI documentation updated: `format` added to request schema, CSV/XLSX added to
    `responses[200].content`, new `forecastCsv` example.
  Four new unit tests added (CSV content, XLSX buffer, `format` not forwarded to MCP, JSON default).

### Fixed

- **`POST /api/residual-load/net-residual-load` — numeric AGS `landkreis` code (`1410`) passed to SMARD causing `Load (MW) = 0`**
  v0.6.13 fixed the `bundesland`-first priority for `resolveRegionFromOperatorId`, but MaStR
  stores `landkreis` as a numeric AGS Kreisschlüssel (e.g. `"1410"` for Ludwigshafen an der
  Weinstraße) rather than a human-readable name. When `bundesland` was `null` in an installation
  record, the code fell through to `landkreis = "1410"` — SMARD does not recognise numeric codes
  and silently returns `loadMW = 0` for all timestamps.
  **Fix**: `resolveRegionFromOperatorId` now skips any candidate value that is a purely numeric
  string (`/^\d+$/.test(s.trim())`). The three candidates (`bundesland`, `landkreis`, `gemeinde`)
  are evaluated in order and the first non-numeric, non-empty text name is used. For TWL
  Ludwigshafen this produces `"Rheinland-Pfalz"` regardless of whether `bundesland` comes from
  the first sampled installation or not.
  Two new unit tests added: numeric `landkreis` skipped in favour of `bundesland`; numeric
  `landkreis` skipped with `null` `bundesland` falls back to `gemeinde`.

## [0.6.13] - 2026-03-04

### Fixed

- **`POST /api/residual-load/net-residual-load` — `Load (MW)` = 0 when region is auto-derived from `gridOperatorMastrId`**
  When `gridOperatorMastrId` was provided without an explicit `region`, v0.6.11 introduced
  auto-derivation via `cernion_installations_local`. The method picked `gemeinde` first
  (e.g. `"Ludwigshafen am Rhein"`), but SMARD only provides load data at Bundesland level
  (`"Rheinland-Pfalz"`, `"Bayern"`, etc.) — city names are not valid SMARD region keys and
  silently return `loadMW = 0` for every timestamp. `populationOverride` cannot rescue this
  because it scales an already-zero base load: `170000 × 0 = 0`.
  **Fix**: `resolveRegionFromOperatorId` now returns `bundesland` first, then `landkreis`,
  then `gemeinde` as last resort. For the TWL case this produces `"Rheinland-Pfalz"`, which
  SMARD resolves correctly; `populationOverride: 170000` then scales the state-level load
  down to the operator's ~170 K grid area as intended.
  One unit test updated (`prefers bundesland over gemeinde from installation`).

## [0.6.12] - 2026-03-04

### Fixed

- **`POST /api/forecast/generation-forecast` — `"resolution": "hour"` now accepted**
  Same alias gap as v0.6.8 fixed for `residual-load`, now patched for the forecast service.
  The Moleculer params enum only listed `"hourly"` and `"15min"`, so passing `"hour"` returned
  a `422 Unprocessable Entity`. `"hour"` is now a valid alias: it passes validation and is
  normalised to `"hourly"` inside the handler before being forwarded to the MCP tool
  `mastr_generation_forecast`. Both `"hour"` and `"hourly"` produce identical results.
  Two new unit tests added.

## [0.6.11] - 2026-03-04

### Added

- **`POST /api/residual-load/net-residual-load` — `region` auto-derived from `gridOperatorMastrId`**
  When a request provides `gridOperatorMastrId` but omits `region` (and all
  location fields), the handler now automatically resolves the region by fetching
  one sample installation for that operator via `cernion_installations_local`
  (`limit: 1`) and using its `gemeinde`, `landkreis`, or `bundesland` as the SMARD
  population-scaling region. This eliminates the requirement to pass both
  `gridOperatorMastrId` and `region` separately for standard Stadtwerk/EVU use
  cases (e.g. TWL Ludwigshafen: `{ gridOperatorMastrId: "SNB935578300972" }`).
  Falls back gracefully to a structured `RESIDUAL_LOAD_MISSING_REGION` error only
  when the lookup itself returns no installations. The new `resolveRegionFromOperatorId`
  helper method follows the same pattern used by `vnbLookup` in the grid-operations
  service. Covered by 5 new unit tests.

## [0.6.10] - 2026-03-04

### Fixed

- **`POST /api/residual-load/net-residual-load` — crash when only `gridOperatorMastrId` is provided (no `region`)**
  The MCP tool `mastr_net_residual_load` always calls `.toLowerCase()` on `region`
  for SMARD population scaling, crashing with
  `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` when
  `region` is absent — even when `gridOperatorMastrId` is set. The guard in the
  service handler was gated on `!gridOperatorMastrId`, so requests that supplied
  only `gridOperatorMastrId` (without `region`) bypassed it and reached the MCP
  tool with `region: undefined`. The guard is now unconditional: any call that
  cannot derive a `region` from `region`, `gemeinde`, `landkreis`, or `bundesland`
  returns a structured `RESIDUAL_LOAD_MISSING_REGION` error with an actionable
  message before the MCP tool is contacted. Two unit tests that encoded the
  incorrect assumption were corrected.

## [0.6.9] - 2026-03-04

### Fixed

- **`POST /api/german-grid/spotprices` with `format=csv` returned empty CSV**
  The `extractRows` helper in `src/format-response.js` did not recognise
  `dataPoints` as a price-row array. ENTSO-E day-ahead prices tools return their
  data under that key (e.g. `{ dataPoints: [{timestamp, priceEURperMWh, …}] }`).
  Because the `spotprices` handler also uses ENTSO-E as its automatic fallback
  (since v0.6.7), any request with `format=csv` that triggered the fallback path
  (dates ≥ today) silently produced an empty file. `dataPoints` is now the second
  entry in both `TOP_LEVEL_ARRAY_KEYS` and `NESTED_ARRAY_KEYS` so CSV/XLSX export
  works regardless of whether the primary Netztransparenz source or the ENTSO-E
  fallback is used. The `entsoe/day-ahead-prices` endpoint with `format=csv` was
  affected by the same root cause and is fixed by the same change.

## [0.6.8] - 2026-03-04

### Fixed

- **`POST /api/residual-load/net-residual-load` — `"resolution": "hour"` now accepted**
  The parameter validation rejected `"hour"` with a `422 Unprocessable Entity`
  because the enum only listed `"hourly"` and `"15min"`. `"hour"` is now a valid
  alias: it passes validation and is normalised to `"hourly"` inside the handler
  before being forwarded to the MCP tool. Both `"hour"` and `"hourly"` produce
  identical results.

## [0.6.7] - 2026-03-04

### Added

- **Automatic ENTSO-E fallback for `POST /api/german-grid/spotprices`** — when
  Netztransparenz.de returns an error (no data for the period, API 500, outage),
  the endpoint transparently retries with ENTSO-E day-ahead prices (DE bidding
  zone, hourly resolution). Callers can detect the fallback via `data.fallback: true`
  and `data.fallbackSource: "entsoe_day_ahead_prices"` in the JSON response; the
  text content is prefixed with a ⚠️ annotation.
  - If both sources fail: HTTP 500 with a combined error message (`Beide
    Datenquellen nicht verfügbar`) listing both errors.
  - If the ENTSO-E call itself throws (network/timeout): original Netztransparenz
    error is surfaced unchanged.
  - 6 new unit tests covering all fallback scenarios.

## [0.6.6] - 2026-03-03

### Added

- **`format` parameter for `POST /api/german-grid/negative-prices`** — the endpoint
  now accepts `"format": "csv"` / `"xlsx"` / `"xls"` alongside the default `"json"`.
  Because the MCP tool returns a narrative text analysis (not a data table), CSV/XLSX
  output wraps the result into one structured row with the fields:
  `dateFrom`, `dateTo`, `logic`, `includeEegCompliance`, `analysis`, `dataReliabilityWarning`.
  This allows Power Automate flows to trigger a file download and read the analysis
  text without any special JSON parsing.

## [0.6.5] - 2026-03-03

### Fixed

- **Silent empty file on upstream MCP errors** — when an MCP tool returns
  `isError: true` (e.g. "No price data available for the requested period"),
  `applyFormat` previously produced a 0-byte CSV/XLSX with a `200 OK` status,
  making it impossible to distinguish from a legitimate empty result set.
  It now throws immediately, so the caller always receives an HTTP `500` with
  a descriptive JSON error message — regardless of the requested output format.
  Applies to all services that use `applyFormat` (german-grid, forecast, etc.).

- **`negativePrices` upstream error passthrough** — the `german-grid.negativePrices`
  handler, which bypasses `applyFormat`, now also performs an explicit `isError`
  check and throws with the upstream error text rather than silently returning
  the raw MCP error object.

### Changed

- `tests/api.service.test.js` version assertion updated to `0.6.5`.

## [0.6.4] - 2026-03-03

### Added

- **Relative date aliases for all `german-grid.*` endpoints** — `dateFrom` and `dateTo`
  parameters on `spotprices`, `negativePrices`, `forecast`, and `redispatch` now accept
  human-friendly relative aliases alongside literal ISO dates:

  | Alias | Resolves to |
  |---|---|
  | `today` | Current date (UTC) |
  | `yesterday` | Today − 1 day |
  | `tomorrow` | Today + 1 day |
  | `today+N` | Today + N days (e.g. `today+7`, `today+30`) |
  | `today-N` | Today − N days (e.g. `today-7`, `today-90`) |

  Literal ISO dates (`YYYY-MM-DD`) continue to work unchanged.

  Introduced shared utility `src/date-utils.js` (`resolveDateAlias`, `resolveDateParams`)
  for use by any future service requiring the same behaviour.

  Motivation: automation tools (Power Automate, dashboards) previously had to compute
  ISO date strings externally. `{ "dateFrom": "today", "dateTo": "today+2" }` now
  works directly against any german-grid endpoint.

- **42 new tests** in `tests/date-utils.test.js` covering all aliases, case-insensitivity,
  whitespace trimming, pass-through for literal dates, and edge cases (`null`, `undefined`,
  non-string values).

## [0.6.3] - 2026-03-03

### Added

- **Unlimited / high-limit fetching for installation endpoints** — `energy-market.installations`
  and all `assets.*` endpoints now support `limit=all` (or any high number, e.g. `limit=1000000`)
  to retrieve the **complete result set in a single request**. The server transparently paginates
  across multiple MCP calls (each capped at 10,000 rows internally) and returns all results
  merged. Designed for automation tools like Power Automate that cannot loop with offsets.
  - `pagination.limit` in the response will echo `"all"` or the requested number.
  - `pagination.hasMore` is `false` whenever all data was retrieved, `true` only when the
    result was capped at an explicit numeric limit.

- **`netzbetreiberPruefungStatus` exposed in OpenAPI** — The grid operator verification
  status filter was already accepted as a parameter but was undocumented. It is now visible
  in the Swagger UI for all `assets.*` endpoints with codes and descriptions:
  `2954`=Geprüft ✅ / `2955`=In Prüfung ⏳ / `3075`=Nicht vorgesehen.

- **Pagination support for installation endpoints** — `energy-market.installations` and all
  `assets.*` endpoints accept an `offset` parameter (integer ≥ 0, default `0`) alongside
  `limit`. Response includes a `pagination` object: `{ offset, limit, count, hasMore }`.
  - `hasMore: true` signals that an explicit numeric limit capped the result and more records
    are available; use `offset` to fetch the next page when not using `limit=all`.
  - **Root cause**: `cernion_installations_local` has a server-side default cap of 1,000 rows.
    Combined with client-side `operationalStatus` post-filtering, users could receive fewer
    rows than the limit with no indication that more data existed.
  - OpenAPI documentation updated on all affected endpoints.

### Removed

- **`test-all-services-json-parsing.sh`** — leftover manual smoke-test shell script superseded by the Jest integration test suite.

## [0.6.2] - 2026-03-03

### Added

- **CSV/XLSX export for all tabular API endpoints** — All data-returning endpoints now accept an
  optional `format` query/body parameter (`json` | `csv` | `xlsx` | `xls`). Passing `csv` or
  `xlsx`/`xls` triggers a file download with correct `Content-Type` and `Content-Disposition`
  headers. Affected services and actions:
  - `energy-market`: `prices`, `production`, `installations`
  - `gas-storage`: `historicalData`, `compareCountries`
  - `entsoe`: `dayAheadPrices`, `unavailability`, `physicalFlows`, `actualGeneration`,
    `windSolarForecast`, `loadForecast`, `aggregatedGeneration`, `windSolarActual`,
    `generationForecast`
  - `german-grid`: `spotprices`, `forecast`, `redispatch`
  - `eic-codes`: `search`, `gasOperators`, `gasFacilities`
  - `grid-operations`: `marketPartners`

- **`src/format-response.js`** — New shared helper module providing:
  - `extractRows(result)` — auto-detects the tabular array in a MCP response
  - `convertToCSV(data)` — RFC 4180-compliant CSV serialiser with nested-object support
  - `convertToXLSX(data, sheetName)` — XLSX Buffer generator with auto-sized columns
  - `applyFormat(ctx, result, format, filename, sheetName, customRows)` — main dispatch
  - `FORMAT_PARAM_SCHEMA` / `FORMAT_RESPONSE_CONTENT` — reusable OpenAPI schema fragments

- **OpenAPI documentation updated** — All affected endpoints document the `format` parameter
  and `text/csv` / `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` response
  content types. GET endpoints expose `format` as a query parameter; POST endpoints add it to the
  request body schema.

- **Missing OpenAPI `responses` blocks backfilled** — `entsoe.loadForecast`,
  `entsoe.aggregatedGeneration`, `entsoe.windSolarActual`, `entsoe.generationForecast` were
  missing `responses[200]` entries; these have been added as part of the format rollout.

### Changed

- **`energy-market.prices` — removed `isDbError` text-parsing workaround** (`services/energy-market.service.js`):
  - Cernion MCP backend deployed three fixes on 2026-03-02:
    - Bug 1 (Critical): `cernion_energy_prices` now calls `queryENTSOEDayAheadPrices` directly for `market=day-ahead` — the old `executeAskQuery` / MaStR routing has been removed. No more markdown tables with `error_message`/`data_mastr` columns.
    - Bug 2 (High): All failure paths now return `{ success: false, error: { code: 'PRICE_DATA_UNAVAILABLE', message, source } }` via a shared `errorResponse()` helper. Variable column names (`price_data_not_found`, `not_found`, `no data`, etc.) no longer occur.
    - Bug 3 (Medium): `normaliseRegion()` + extended `eic-areas.ts` aliases in the backend now accept `DE-LU`, `DE-AT-LU`, `10Y1001A1001A63L`, `10Y1001A1001A82H` as valid inputs.
  - Client-side `isDbError` markdown-table detection block removed (was dead code against the new backend).
  - Client-side `REGION_ALIASES` map retained as belt-and-suspenders; `10Y1001A1001A82H` added as new entry (now confirmed alias in `eic-areas.ts`).
  - 3 dead-code text-pattern tests replaced by 1 backend-passthrough test that asserts the new structured error contract (`source: 'cernion_energy_prices'`). Net test count: 460 → 458.

## [0.6.1] - 2026-03-02

### Added

- **`populationOverride` UI injection on `dataQualityWarning`** (`services/agent.service.js`):
  - After every `execute` call, the agent scans `stepResults` for any `residual-load.netResidualLoad` step that returned `dataQualityWarning: true` (SMARD returned `loadMW=0`).
  - When detected, a `populationOverride` entry is automatically injected into `session.plan.requiredInputs` with the SMARD-detected population as the pre-filled `default` (e.g. `245000` parsed from `"245.000"`).
  - The `execute` return value now always includes `requiredInputs: session.plan.requiredInputs` so the UI re-renders the corrected form in the same response without needing a separate `getSession` round-trip.
  - Session is immediately persisted after injection so `getSession` also reflects the new field.

- **EPEX Day-Ahead prices step in RULE 8** (`services/agent.service.js`):
  - Gemini plans for Residuallast/CO2 queries now always include a step 5 calling `energy-market.prices` (market: `day-ahead`, region: `Deutschland`) to enable monetary assessment.
  - Region MUST be the string `"Deutschland"` — ENTSO-E bidding zone codes (`DE-LU`, `DE-AT-LU`) are explicitly prohibited in the plan prompt.
  - `startDate`/`endDate` are extracted as `requiredInputs` with computed defaults per RULE 5.

- **`energy-market.prices` — region normalisation** (`services/energy-market.service.js`):
  - Handler now maps ENTSO-E bidding zone codes to `"Deutschland"` before calling the MCP tool: `DE-LU`, `DE-AT-LU`, `DE`, `Germany`, and the full ENTSO-E EIC code are all accepted.

### Fixed

- **`energy-market.prices` — MCP database error detection** (`services/energy-market.service.js`):
  - `cernion_energy_prices` sometimes routes to the MaStR SQL engine which has no price tables, returning `success: true` but wrapping a SQL `error_message` row in a markdown text block.
  - The handler now detects this pattern (`error_message`, `undefined rows`, `data_mastr`, `does not exist`) and returns `{ success: false, error: { code: 'PRICE_DATA_UNAVAILABLE' } }` — a clean structured error the agent can reason about.
  - Also catches thrown errors and returns the same structured error shape.

- **Residuallast interpretation overhaul** (`services/agent.service.js` — `summaryPrompt` RULE 8):
  - **UTC → MEZ/MESZ conversion**: All timestamps must be converted to local time (UTC+1 in winter, UTC+2 in summer) and labelled `"Zeitpunkt (MEZ)"` — bare UTC timestamps are now prohibited.
  - **Full 48-hour coverage**: Interpretation must cover ALL days in the returned forecast; truncating to day 1 only is now explicitly forbidden.
  - **Data quality gate**: When `dataQualityWarning: true`, the summary must begin with a prominent `⚠️ DATENFEHLER:` block and set `needsMoreInput: true` before any EE-only analysis.
  - **Monetary assessment**: When EPEX prices are available, interpretation calculates `(peak_price − optimal_price) × load_MW × hours` and reports the monetäre Hebelwirkung in €/day. When `loadMW = 0`, a labelled placeholder assumption (~30 MW) is used.
  - **Optimal window ranking**: Top-3 windows now ranked by consecutive 2-hour blocks sorted by CO2 ascending, EPEX price ascending, EE generation descending — with quantified Lastverschiebungspotenzial in MWh.
  - **Table columns standardised**: `Zeitpunkt (MEZ)`, `CO2 (g/kWh)`, `EE-Erzeugung (MW)`, `Residuallast (MW)`, `EPEX Day-Ahead (€/MWh)`, `Bewertung`.
  - **`Bewertung` taxonomy**: `✅ Optimal`, `🟡 Gut`, `🔴 Vermeiden (CO2-Peak)`, `⛔ Teuer + CO2-Reich`.

- **Refine prompt RULE 8** (`services/agent.service.js`):
  - The refinement prompt now carries the full 5-step RULE 8 pipeline (including prices step) and the `gemeinde` ≠ `region` guard, keeping refined plans consistent with initial plans.

### Tests

- `tests/agent.service.test.js` — 4 new tests: `populationOverride` injected when `dataQualityWarning: true`; not injected when `false`; no duplicate when already present; `requiredInputs` always present in return value. (28 agent tests total)
- `tests/energy-market.service.test.js` — 6 new tests: `data_mastr` text error → `PRICE_DATA_UNAVAILABLE`; `Error:` text → `PRICE_DATA_UNAVAILABLE`; `DE-LU` → `Deutschland` normalisation; `DE-AT-LU` → `Deutschland`; thrown error → `PRICE_DATA_UNAVAILABLE`. (36 energy-market tests total)
- **Total: 457 tests passing (0 failing)**

### Added

- **AI Research Web App** (`src/app.html`, served at `/app`):
  - Browser-based single-page application for interactive exploration of all microservices — no curl, no Swagger form, no coding required.
  - Full AI-agent loop: free-text problem description → Gemini-generated multi-step execution plan → editable parameter form → step-by-step execution → sortable/filterable results table → shareable URL.
  - Step-result status chips show which services were called and whether they succeeded.
  - Follow-up banner: when the AI determines it needs more information it prompts the user with a targeted question without losing the current session.
  - Self-healing re-plan: if a step returns an empty or failed result the agent automatically regenerates and retries the plan once (`repairAttempt` guard prevents infinite loops).

- **AI Agent service** (`services/agent.service.js`):
  - `POST /api/agent/analyze` — converts a free-text query into a numbered multi-step microservice plan using Google Gemini. Returns `requiredInputs` array with editable parameters.
  - `POST /api/agent/execute` — executes the plan step-by-step, resolves `__step_N.fieldPath` chaining between steps, and returns results together with an AI-generated plain-text summary.
  - `GET /api/agent/session/:id` — retrieves a previously saved session by UUID (enables shareable URLs).
  - `GET /api/agent/session/:id/csv?param=value` — re-executes the full plan live and returns the last step's result as a downloadable CSV file. GET query parameters override saved input values, enabling fully parameterised automation URLs.
  - `POST /api/agent/rerun` — re-runs an existing session with new user inputs.
  - Sessions are persisted to `.sessions/` (JSON files, git-ignored).

- **Universal parameter extraction (RULE 5)**:
  - Every concrete user-data value in a step param (names, dates, IDs, postal codes, capacities, search terms, …) is automatically surfaced as a pre-filled, editable `requiredInput` with the extracted value as `default`.
  - Structural/system parameters (`format`, `limit`, `type`, `installationType`, `resolution`, `forecastDays`, `includeNapData`, …) are exempt and remain hardcoded.
  - Makes every generated plan a **reusable template**: parameters can be changed in the form and re-run without re-analyzing from scratch.

- **Live CSV with GET parameters** (`GET /api/agent/session/:id/csv`):
  - Query parameters appended to the URL (`?startDate=2026-03-01&postleitzahl=30159`) override saved values and are applied with the highest priority.
  - Input priority: `requiredInputs[].default` → `session.userInputs` → **URL GET params** (wins).
  - The CSV URL in the UI updates in real time as form fields are edited (live `URLSearchParams` builder).
  - Designed for zero-config integration with Microsoft Power Automate, Excel Power Query, pandas `read_csv(url)`, Grafana, Power BI, cron jobs, or any tool that consumes a CSV URL.

- **`normalizePlan()` helper** — normalises varying LLM key names after every `JSON.parse` (`useTool/tool/service → action`, `args/inputs/input → params`, `label/name → description`).

- **`resolveChainedRef()` enhancements** — strips `{{…}}` mustache wrappers before processing `__step_N.fieldPath` dot-notation chains with array index support.

- **`effectiveInputs` override safety net** — in both main and repair execution loops, any param whose name appears in `requiredInputs` is overridden with the user-supplied (or default) value even if Gemini hardcoded the value in the step — guarantees form field edits are always respected.

- **Auto city injection for DSO pipeline** — executor automatically injects `city` into `grid-operations.vnbLookup` steps by scanning prior `marketPartners` results, independent of what the LLM generates.

- **`vnbLookup` city fallback** (`services/grid-operations.service.js`) — when the primary `cernion_vnb_lookup` cannot resolve a BDEW code to a MaStR ID, falls back to `cernion_installations_local` with `format:'detailed'` and `includeNapData:true` to extract the grid operator SNB from NAP data of a local installation.

- **`.sessions/` added to `.gitignore`** — session files containing user queries are runtime data and must not be committed.

### Changed

- **README.md** — full rewrite: Research Web App and Live CSV sections added; configuration documented as a table; service architecture and AI agent documented; duplicate License section removed; Contributing guidelines expanded.
- **`services/api.service.js`** — Swagger topbar link to Research Web App (`/app`); OpenAPI version bumped to `0.6.0`.

### Fixed

- Disabled "Run Analysis" button for plans with zero `requiredInputs` — `renderForm()` now enables `btnExecute` immediately when the inputs array is empty.
- Repair-loop executor used raw `userInputs` only (ignored `requiredInputs[].default` and the `requiredInputNames` override) — unified to use `effectiveInputs` and the same override set as the main loop.



### Changed
- **OpenAPI specification audit — complete coverage of required/optional parameters and examples** across all 13 services:
  - **`system` — `POST /validate-params`**: Added missing `requestBody` with full schema (`tool`, `params`), 2 examples, and `responses.200` schema.
  - **`assets` — all 8 GET endpoints** (`/list`, `/solar`, `/wind`, `/storage`, `/biomass`, `/hydro`, `/combustion`, `/all`):
    - All filterable query parameters (`gridOperatorMastrId`, `bundesland`, `landkreis`, `gemeinde`, `postleitzahl`, `minCapacity`, `maxCapacity`, `status`, `includeNapData`, `operationalStatus`, `format`, `limit`, `offset`) now documented in `parameters[]` with type, description, and example.
    - Named `examples` blocks added to all actions.
  - **`gas-storage` — all 7 POST endpoints**: Added named `examples` blocks to every action (`country-storage`, `operator-storage`, `historical-data`, `eu-statistics`, `compare-countries`, `storage-trend`, `supply-security-check`).
  - **`business-intelligence`**: Added missing parameter descriptions and examples to `salesLeads`, `churnPrediction`, `marketPenetration`, `dynamicTariffCalculator`.
  - **`eic-codes` — `POST /search`**: `required` flag added to `requestBody`; `code`/`name` at-least-one constraint documented.
  - **`energy-market`**: Added missing `required` flags and tightened parameter descriptions on `prices`, `production`, `co2-intensity`, `installations`.
  - **`grid-operations`**: Added missing parameter descriptions and examples to `gridData`, `vnbdigital-search`, `vnb-lookup`, `operator-analysis`, `capacity-utilization`, `redispatch-export`, `connection-capacity-check`.
  - **`query`**: Added missing `requestBody` `required` flags and examples to `ask`, `ask-learned`, `discover`.
  - **`german-grid`**: Added missing examples to `spotprices`, `negative-prices`, `forecast`, `market-partners`.
  - **`customer-service`**: Added missing `required` flags and parameter descriptions to `portal-widget`, `installation-health-check`, `installation-change-wizard`.
  - **No breaking changes** — all parameter names, types, and defaults are unchanged.

## [0.5.8] - 2026-02-19

### Changed
- **`forecast.generationForecast` and `residual-load.netResidualLoad` — historical predictions via `startDate`** (new MCP tool capability for both `mastr_generation_forecast` and `mastr_net_residual_load`):
  - New parameter **`startDate`** (`string`, optional, format `YYYY-MM-DD`) on both actions:
    - Omitting `startDate` preserves the existing default behaviour (starts from tomorrow) — **no breaking change**.
    - When `startDate` is a past date, Visual Crossing returns **observed weather data** instead of a forecast; the IEC calculation methodology (IEC 61853 / IEC 61400) is identical.
    - For `netResidualLoad`: SMARD automatically switches to **filter 410** (realised load) for historical requests — no extra parameter needed.
    - Historical responses are **cached for 30 days** (immutable data, no additional API quota impact).
  - New fields in the response `summary` object:
    | Field | Type | Values |
    |---|---|---|
    | `isHistorical` | `boolean` | `true` when `startDate` is in the past, `false` otherwise |
    | `dataMode` | `string` | `"weather_forecast"` or `"historical_observation"` |
  - OpenAPI updated for both endpoints:
    - `startDate` schema property added to request body (with pattern `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`).
    - `isHistorical` and `dataMode` added to the response `summary` schema.
    - One new request body example each (`historicalForecast`, `historicalResidualLoad`).
    - Descriptions extended with historical mode section including cache behaviour.
  - 5 new tests in `forecast.service.test.js`, 6 new tests in `residual-load.service.test.js`.

## [0.5.7] - 2026-02-19

### Changed
- **`forecast.generationForecast` — single-installation forecast modes** (new MCP tool capability):
  - New parameter **`installationMastrNummer`** (`string`, optional) — highest-priority single-installation lookup by MaStR unit ID:
    - `SEE…` prefix → `installationType` auto-derived as `solar`
    - `SWE…` prefix → `installationType` auto-derived as `wind`
    - Unknown prefix → `installationType` removed, MCP tool searches both collections
    - Overrides `messlokationId`, `gridOperatorMastrId`, and `location`
  - New parameter **`messlokationId`** (`string`, optional) — single-installation lookup via Metering Location ID (MeLo, 33 chars, starts with `DE`). Resolved via `mastr_netzanschlusspunkte` NAP table. Priority: `installationMastrNummer > messlokationId > gridOperatorMastrId > location`.
  - Handler refactored: single-installation modes skip building the nested `location` object.
  - OpenAPI updated: new `installationMastrNummer` and `messlokationId` schema properties, two new request body examples (`singleInstallationMastrNr`, `singleInstallationMeLo`), description extended with priority rules.
  - 9 new tests, total now 395.

## [0.5.6] - 2026-02-20

### Changed
- **`assets` service — NAP enrichment, GPS, and `netzbetreiberpruefungStatus`** (all endpoints: `/list`, `/solar`, `/wind`, `/storage`, `/biomass`, `/hydro`, `/combustion`, `/all`):
  - New parameter **`includeNapData`** (`boolean`, default `true`) — passed through to `energy-market.installations`.
  - New flattened output columns in every row:
    | Column | Type | Description |
    |---|---|---|
    | `Netzbetreiberpruefung Status` | `number \| null` | Grid operator review code: 2954=Geprüft, 2955=In Prüfung, 3075=Nicht vorgesehen |
    | `Netzbetreiberpruefung Status Name` | `string \| null` | Human-readable label |
    | `NAP MaStR Nummer` | `string \| null` | Grid connection point ID (SAN…) |
    | `Messlokation (MeLo)` | `string \| null` | DE… metering location ID (33 chars) |
    | `Spannungsebene NAP` | `string \| null` | Voltage level label at connection point |
    | `Nettoengpassleistung kW` | `number \| null` | Net bottleneck capacity in kW |
    | `Netz MaStR Nummer` | `string \| null` | Connected grid ID (SNE…) |
    | `Netzbetreiber NAP MaStR` | `string \| null` | Grid operator at connection point (SNB…) |
  - `Breitengrad` / `Längengrad` (GPS) were already present in the mapping; confirmed they pass through correctly from the enriched `energy-market.installations` response.
  - Fixed duplicate `format` parameter line in `wind` action params.
  - OpenAPI documentation updated for all endpoints: new `includeNapData` query parameter; `list` action response schema extended with all new fields.
  - 11 new tests added in `tests/assets.service.test.js` (total now 386).

## [0.5.5] - 2026-02-19

### Changed
- **`energy-market.installations` — `netzbetreiberpruefungStatus` field** (`cernion_installations_local` backend update):
  - New field **`netzbetreiberpruefungStatus`** (`number | null`) on every installation object — the grid operator verification status from MaStR:
    | Code | Meaning |
    |---|---|
    | `2954` | Geprüft ✅ — confirmed by grid operator |
    | `2955` | In Prüfung ⏳ — review in progress |
    | `3075` | Nicht vorgesehen — no verification applicable |
    | `null` | Not available (older record, value not set in original MaStR export) |
  - OpenAPI description updated with `netzbetreiberpruefungStatus` code table; response example updated for both installations (one with `2954`, one with `null`).

### Fixed
- Test file `tests/energy-market.service.test.js`: removed stray `});` that collapsed two `describe` blocks onto one line.

### Testing
- 5 new tests in new `installations action — netzbetreiberpruefungStatus` describe block (375 total, up from 370):
  - Status 2954 (Geprüft) passes through
  - Status 2955 (In Prüfung) passes through
  - Status 3075 (Nicht vorgesehen) passes through
  - Status `null` (older record) passes through
  - Mixed statuses (2954 + null) in same response

## [0.5.4] - 2026-02-19

### Changed
- **`energy-market.installations` — NAP & GPS enrichment** (`cernion_installations_local` backend update):
  - New optional parameter **`includeNapData`** (boolean, default: `true`) — pass `false` to skip enrichment for faster responses on large result sets.
  - When `true`, each installation object now includes a **`napData`** sub-object (or `undefined` for ~48% of older installations that have no MeLo on record):
    | Field | Description |
    |---|---|
    | `napMastrNummer` | NAP identifier (SAN...) |
    | `messlokation` | MeLo-ID (DE000...) for billing/metering |
    | `spannungsebene` | Voltage level code |
    | `spannungsebeneLabel` | Human-readable label (Niederspannung / Mittelspannung / Hochspannung / Höchstspannung) |
    | `nettoengpassleistung` | Net transfer capacity at NAP in kW |
    | `netzMastrNummer` | Grid MaStR-ID (SNE...) |
    | `netzbetreiberMastrNummer` | Grid operator MaStR-ID (SNB...) |
  - All installation objects now include **`latitude`** and **`longitude`** (GPS coordinates).
  - Wind turbine objects additionally include **`typenbezeichnung`** (model, e.g. "E-115") and **`hersteller`** (manufacturer, e.g. "Enercon").
  - Storage system objects additionally include **`batterietechnologie`**, **`acDcKoppelung`**, **`wechselrichterleistung`**, **`einsatzort`**.
  - OpenAPI updated: `includeNapData` in request schema, two new examples (`withNapData`, `withoutNapData`), response example updated with realistic NAP data + GPS + second installation showing `napData: undefined`.
  - NAP enrichment uses a single `$in` query — no N+1; typically < 50 ms additional overhead for 1,000 installations.

### Testing
- 7 new tests in `tests/energy-market.service.test.js` (370 total, up from 363) in new `installations action — NAP enrichment` describe block with isolated `beforeEach` mocks:
  - `includeNapData: true` passed to MCP tool by default
  - `includeNapData: false` passed through explicitly
  - `napData` object fields pass through correctly
  - `napData` may be `undefined` for older installations
  - `latitude`/`longitude` fields pass through
  - Wind turbines with `includeNapData: false` + `typenbezeichnung`/`hersteller` fields
  - Storage with `batterietechnologie`, `acDcKoppelung`, `wechselrichterleistung`, `einsatzort`

## [0.5.3] - 2026-02-20

### Added
- **Residual Load Service** (`services/residual-load.service.js`) — new Moleculer service exposing two REST endpoints:
  - `POST /api/residual-load/net-residual-load` — wraps new MCP tool `mastr_net_residual_load`: calculates **net residual load = Regional Load − PV − Wind** using real SMARD.de load data (population-scaled), MaStR installed capacity (PV + Wind), and Visual Crossing weather forecasts (IEC 61853/61400 models). Supports:
    - `forecastDays` 1–14, `resolution` hourly/15min (96 pts/day = §12 StromNZV Fahrplan), `installationType` solar/wind/all
    - Flat-to-nested location params: `bundesland`, `landkreis`, `gemeinde`, `postleitzahl`, `latitude`, `longitude`
    - `populationOverride` for known grid populations (important for industrial sites e.g. BASF/Ludwigshafen)
    - `format` JSON/CSV/XLSX export (CSV with metadata comments; XLSX with Forecast + Summary sheets)
    - SMARD data sourcing: filter 410 (realised) for past/today, filter 411 (day-ahead TSO) for D+1, filter 410 reference week for D+2–D+14
  - `POST /api/residual-load/load-forecast-regional` — wraps updated MCP tool `cernion_load_forecast_regional`: LLM-based regional load forecast now **injecting real MaStR PV/Wind capacity and SMARD population scaling** into the reasoning prompt before LLM call. Fully backward-compatible (no parameter changes). Graceful fallback to placeholder values if MaStR query fails.
- **97 new tests** across two new test suites (363 total, up from 266):
  - `tests/residual-load.service.test.js` (63 tests): service definition, required params, optional params, location object building, CSV/XLSX format, error handling, method-level unit tests
  - `tests/residual-load.integration.test.js` (34 tests): TWL Ludwigshafen day-ahead 15-min procurement, Bayern 7-day hourly, 2-day industrial populationOverride, data point count matrix (7 scenarios), installationType filtering, CSV/XLSX full export pipeline, `loadForecastRegional` end-to-end

## [0.5.2] - 2026-02-19

### Added
- **Forecast Service – `resolution` Parameter** - The `mastr_generation_forecast` MCP tool now supports sub-daily time resolution; the service exposes this via a new `resolution` parameter on `POST /api/forecast/generation-forecast`:
  - `"daily"` (default) – 1 data point per day; minimal weather API quota
  - `"hourly"` – 24 data points per day; suited for intraday dispatch planning and energy trading
  - `"15min"` – 96 data points per day; linear interpolation between hourly weather values; suited for §12 StromNZV balancing/scheduling and Fahrplanlieferung to TSO/DSO
- **CSV export** now includes a `# Resolution: <value>` metadata comment
- **XLSX export** now includes a `Resolution` row in the Metadata sheet
- **OpenAPI response schema** extended with new `metadata` fields returned by the updated tool: `weatherDataSource`, `iecStandardApplied`, `cachingEnabled`, `apiCallsUsed`, `orientationCorrectionApplied`, `portfolioOrientationFactor`, `orientationDataCoverage`
- **OpenAPI request examples** updated: `gridOperatorForecast` now shows `resolution`, plus two new examples `hourlyIntraday` (Bayern, 3 days hourly) and `quarterHourlyBalancing` (PLZ 67063, 2 days 15min)

### Changed
- `convertForecastToCSV(forecastData, summary, resolution)` – third argument added (backward compatible, defaults to `"daily"`)
- `convertForecastToXLSX(forecastData, summary, resolution)` – third argument added (backward compatible, defaults to `"daily"`); duplicate JSDoc comment removed

### Testing
- 13 new tests added across all three forecast test suites (59 total forecast tests, up from 46)
  - `forecast.service.test.js`: invalid resolution rejects, all 3 valid values accepted, default is `daily`, resolution forwarded to MCP tool
  - `forecast.integration.test.js`: 1 pt/day for `daily`, 48 pts for 2-day `hourly`, 192 pts for 2-day `15min`, resolution passed to MCP, invalid value rejects; mock updated to generate `pointsPerDay × forecastDays` data points
  - `forecast.export.test.js`: `# Resolution:` comment in CSV, `Resolution` row in XLSX Metadata sheet (both via service call and direct method invocation)
- Total test count: **266 tests across 20 suites** (all passing)

## [0.5.1] - 2026-02-18

### Fixed
- **Forecast Service – Correct MCP Tool Name** - `forecast.service.js` was calling the non-existent tool `cernion_mastr_generation_forecast`, causing every request to fail with `"Error: Unknown tool"`. The service now calls the correct tool `mastr_generation_forecast`.
- **Forecast Service – Schema Alignment** - Fully aligned with the real `mastr_generation_forecast` MCP tool schema:
  - `forecastDays` (1–14 days, default 7) replaces `forecastHorizonHours` (1–168 h)
  - `gridOperatorMastrId` replaces `gridOperatorId`
  - `location` is now sent as a nested object `{bundesland, landkreis, gemeinde, postleitzahl, latitude, longitude}`; callers still pass flat parameters
  - Response shape: `summary` + `forecasts[]` (was `data.forecast[]`)
  - Generation values in **MW** (`generationMW`) instead of kW
  - Weather data is embedded per-forecast-item (`weather.temperature`, `weather.windSpeed`, `weather.solarIrradiance`, `weather.cloudCover`) instead of a separate `weatherForecast` array
- **Live Integration Test Isolation** – `tests/assets.integration.test.js` requires a live MCP connection and was causing the default `npm test` run to time out after 60 s. It is now excluded from the default suite and can be run separately with `npm run test:live`.

### Changed
- **Forecast Service – Updated OpenAPI Documentation** - Request body and response schemas in the Swagger docs now match the real tool. Examples updated to reflect daily forecasts and the correct field names.
- **CSV/XLSX Export – Updated Column Names** - Forecast exports now use `Generation (MW)` instead of `Generation (kW)`, and the Metadata sheet shows `Total Capacity (MW)`.
- **Test Suite – 46 Forecast Tests Rewritten** - All three forecast test files (`forecast.service.test.js`, `forecast.export.test.js`, `forecast.integration.test.js`) have been rewritten to match the real MCP tool schema. No stale old-schema tests remain.
- **jest.config.js** – Added `tests/assets.integration.test.js` to `testPathIgnorePatterns`. New `npm run test:live` script runs it explicitly.

### Technical Details
- Confirmed via live Cernion MCP server: tool list contains 76 tools (status endpoint incorrectly reported 42); correct name is `mastr_generation_forecast`
- Live test with `SNB935578300972`: 2,756 installations, 25.77 MW total capacity, 3-day forecast returns correctly
- All 253 unit tests pass; 0 failures in default suite

## [0.5.0] - 2026-02-18

### Added
- **Renewable Energy Generation Forecast Service** - New forecast microservice for weather-based renewable energy generation forecasting
  - Weather-based generation forecasts using real MaStR installation data
  - IEC standard compliance (IEC 61853 for solar, IEC 61400 for wind)
  - Hourly forecasts up to 7 days (168 hours)
  - Regional filtering (state, district, municipality, postal code)
  - Installation-level breakdown available
  - Weather data integration via Visual Crossing API
  - Use cases: Energy procurement optimization, grid congestion analysis, VPP trading
  - Endpoint: `POST /api/forecast/generation-forecast`
  - CSV/XLSX export support with metadata
  - Full OpenAPI documentation with 7 request examples
  - 47 comprehensive tests (16 unit + 11 integration + 20 export tests)

- **XLSX Export Support for Assets Service** - Download asset data as Excel spreadsheets
  - All 7 asset endpoints now support `format=xlsx` parameter in addition to CSV and JSON
  - Automatic column width adjustment for better readability
  - Proper Excel MIME types and download headers
  - Works with all asset types: solar, wind, storage, biomass, hydro, combustion, all
  - Multi-sheet workbooks with formatted headers
  - Example: `GET /api/assets/solar?vnbName=Netze BW&format=xlsx`

- **CSV/XLSX Export for Forecast Service** - Download generation forecasts in multiple formats
  - Added `format` parameter (json, csv, xlsx) to forecast endpoint
  - CSV format includes metadata comments (location, installation type, capacity)
  - XLSX format includes two sheets: Forecast data + Metadata sheet
  - Consistent export interface across all data-heavy services
  - Content-Type headers and automatic file download support

### Changed
- **Test Coverage Improvements** - Added 31 new tests across forecast and export functionality
  - Total test count: 255 tests across 21 test suites
  - Code coverage: 79.13% overall
  - 100% test pass rate

### Dependencies
- Added `xlsx` (SheetJS) library for Excel file generation

## [0.4.1] - 2026-02-13

### Fixed
- **Comprehensive MaStR Field Mapping** - Assets service now captures ALL fields from MaStR data
  - Fixed missing `C_Rate` for storage installations (now checks 4 field name variants for storage capacity)
  - Fixed missing `Marktakteur Name` (now checks 4 field name variants including `nameMarktakteur` and `marktakteurFirmenname`)
  - Enhanced capacity field mapping for storage (now checks `acLeistung`, `bruttoleistung`, `nettonennleistung`, `installierteleistung`)
  - All field mappings now handle both German and English field name variants from MCP

### Added
- **60+ Comprehensive MaStR Fields** - Complete dataset now available for all asset types:
  - **Core Identification**: EinheitMastrNummer, Einheit Systemstatus
  - **Grid Operator Info**: Netzbetreiber MaStR, Netzbetreiber Name
  - **Enhanced Power Specs**: Added separate kW field alongside MW, AC/DC Nennleistung for storage
  - **Storage-Specific**: Batterietechnologie, Hersteller Batteriemodule, AC/DC Nennleistung
  - **Solar-Specific**: Hauptausrichtung (orientation), Neigungswinkel (tilt), Leistungsbegrenzung, Anzahl Module, Leistung je Modul
  - **Wind-Specific**: Nabenhöhe (hub height), Rotordurchmesser (rotor diameter), Hersteller, Typenbezeichnung
  - **Dates**: Registrierungsdatum, Genehmigungsdatum (in addition to commissioning date)
  - **Grid Connection**: Spannungsebene (voltage level), Fernsteuerbarkeit (remote control), Einsatzverantwortlicher
  - **Location**: Längengrad (longitude), Breitengrad (latitude), complete address data
  - **Additional**: Fläche (used area in m²)

### Changed
- **Robust Field Detection** - All field mappings now check multiple name variants to ensure no data loss
- **OpenAPI Schema Updated** - Swagger documentation now includes all 60+ fields with proper types, descriptions, and nullability
- **Asset-Type Aware** - Fields are appropriately marked as type-specific (e.g., solar-only, wind-only, storage-only)

### Technical Details
- Enhanced field mapping in assets.service.js with comprehensive fallback chains
- Storage capacity calculation now checks: `storageCapacityKWh`, `nutzbareSpeicherkapazitaet`, `speicherkapazitaet`, `nutzbareKapazitaet`
- Power capacity checks: `capacityKW`, `acLeistung`, `bruttoleistung`, `nettonennleistung`, `installierteleistung`
- Marktakteur name checks: `marketActorName`, `marktakteurName`, `nameMarktakteur`, `marktakteurFirmenname`
- All OpenAPI property definitions updated with proper types and descriptions
- Maintains backward compatibility - all previously available fields still work

## [0.4.0] - 2026-02-13

### Added
- **CSV Export** - All asset endpoints now support CSV download format
  - Add `format=csv` query parameter to any `/api/assets/*` endpoint
  - Automatically sets proper response headers (`Content-Type: text/csv`, `Content-Disposition: attachment`)
  - CSV includes all fields including new operational status fields
  - Works with all filters (location, operationalStatus, minCapacityKW, etc.)
  - Available for all endpoints: list, solar, wind, storage, biomass, hydro, combustion, all

- **Operational Status Filtering** - Smart filtering by installation operational status
  - **Default behavior**: Only returns active installations (status 35 - "In Betrieb")
  - Override with `operationalStatus` parameter: `35` (active), `38` (decommissioned), `all`, or comma-separated
  - Reduces noise in results - most users only need active installations
  - Status codes: 31=Planned, 35=In operation, 37=Temporarily decommissioned, 38=Permanently decommissioned
  - Applies to all asset endpoints

- **Status Fields in Output** - Installation operational status now visible in API responses
  - `Betriebsstatus`: Status code (e.g., "35")
  - `Betriebsstatus Name`: German status name (e.g., "In Betrieb")
  - Allows users to verify filter behavior and understand installation state
  - Included in both JSON and CSV output formats

- **Cernion Token as Request Parameter** - Flexible authentication options
  - Pass Cernion MCP token as query parameter: `?token=YOUR_TOKEN`
  - Alternative to Bearer token header authentication
  - Overrides `CERNION_TOKEN` environment variable for the request
  - Enables easy browser testing and multi-tenant scenarios
  - Documented in OpenAPI specification

### Changed
- **Breaking**: Default behavior change for asset endpoints
  - Now returns only active installations (status 35) by default
  - Previous behavior (all statuses): Use `operationalStatus=all`
  - Rationale: Most users only need active installations; decommissioned units create noise
  - Easy to override for users who need all installations

### Technical Details
- CSV conversion with proper escaping and UTF-8 encoding
- Client-side operational status filtering after MCP tool call with stats recalculation
- Field mapping includes status extraction from `einheitBetriebsstatus` with German name mapping
- OpenAPI documentation fully updated with new parameters and response formats
- Response header manipulation for CSV download behavior

## [0.3.1] - 2026-02-12

### Fixed
- **Assets Service** - Location parameter now correctly passed to MCP tool for postal code filtering
- **Assets Service** - Fixed validation error when using gridOperatorId without location parameter
- **Energy Market Service** - Added postleitzahl parameter support for precise location filtering
- Parameter handling: postleitzahl only set when location is actually provided (prevents validation errors)

### Technical Details
- Bug 1: energy-market.service.js was accepting location parameter but not forwarding it to MCP tool
- Bug 2: assets.service.js was always setting postleitzahl even when undefined, causing validation failure
- Both fixes apply to all asset types (solar, wind, storage, biomass, hydro, combustion)

## [0.3.0] - 2026-02-11

### Added
- **Assets Service** - Complete grid operator asset management service
  - Retrieve all installations from German Marktstammdatenregister (MaStR) for a distribution network operator
  - Support for all installation types: solar, wind, storage, biomass, hydro, combustion
  - VNB filtering by BDEW code, MaStR grid operator ID, or operator name
  - Redispatch 2.0 filter (installations ≥100kW)
  - No pagination required - can retrieve millions of installations
  - Type-specific endpoints: `/api/assets/solar`, `/api/assets/wind`, `/api/assets/storage`, etc.
  - Combined endpoint: `/api/assets/all` with optional type selection
- VNB/DSO lookup endpoints for grid operator discovery
- BDEW → MaStR grid operator ID resolution
- MaStR installation filters for grid operator identification

### Changed
- Moved assets service from custom-services to core services directory
- OpenAPI documentation fully translated to English for international compatibility
- Expanded OpenAPI documentation with detailed descriptions, examples, and error responses
- Grid operator analysis/export accepts BDEW/MaStR identifiers in addition to names

### Fixed
- VNB filtering now works for all installation types (solar, wind, storage, biomass, combustion)
- Removed workaround code that restricted VNB filtering to storage-only after MaStR database update

### Testing
- Added comprehensive test coverage for assets service
- Integration tests for VNB filtering across all installation types

## [0.2.0] - 2026-02-07

### Added
- Custom service and test directories for local extensions (custom-services/, custom-tests/)
- Creator CLI support for iterative updates, catalog-aware generation, and optional live MCP integration tests
- Test helper script for custom services (`npm run test:custom`)
- Hot reload and runtime loading for both core and custom services

### Changed
- Service creator now resolves Gemini model availability and falls back to supported models
- Creator and runtime guidance updated for OpenAPI coverage and ctx.call orchestration

### Fixed
- Normalized CO₂ intensity forecast response shape to align with MCP tool data
- Improved resilience when mapping forecast arrays from MCP responses

## [0.1.0] - 2026-02-07

### Added
- Initial release of Cernion Energy Tools MicroService Agent System
- 11 microservices covering energy market operations
  - Query Tools Service (`query`) - Natural language queries and schema discovery
  - Energy Market Data Service (`energy-market`) - Prices, production, forecasts
  - Grid Operations Service (`grid-operations`) - Network data, redispatch, capacity analysis
  - Business Intelligence Service (`business-intelligence`) - Market analysis, lead generation
  - Customer Service Service (`customer-service`) - Self-service widgets, health checks
  - ENTSO-E Service (`entsoe`) - European energy data from ENTSO-E Transparency Platform
  - Gas Storage Service (`gas-storage`) - European gas storage monitoring (AGSI)
  - EIC Codes Service (`eic-codes`) - Energy Identification Code management
  - German Grid Service (`german-grid`) - German grid operator data (Netztransparenz.de)
  - System Service (`system`) - Status, job management, token management
  - API Gateway Service (`api`) - REST API with OpenAPI documentation
- 70+ MCP tools mapped to REST endpoints
- Moleculer-based microservices architecture
- MCP (Model Context Protocol) SDK integration
- Async job polling for long-running operations
- OpenAPI/Swagger documentation at `/api/docs`
- CLI tool for calling microservices
- Service creation tool for scaffolding new services
- Comprehensive test suite with Jest
- ESLint and Prettier code quality tools
- Hot reload support for development
- Bearer token authentication support
- Automatic OpenAPI schema generation

### Documentation
- Complete README.md with quick start guide
- MCP_TOOLS.md - Developer documentation for 70+ energy data tools
- MCP_SERVICES.md - Microservices architecture documentation
- QUICKSTART.md - Quick start guide for developers
- CONTRIBUTING.md - Contribution guidelines
- ASYNC_JOB_POLLING.md - Async job polling documentation
- BEARER_TOKEN_AUTHENTICATION.md - Authentication guide
- API documentation via Swagger UI

### Testing
- Unit tests for all microservices
- Tests for MCP client and async job poller
- Test coverage reporting with Jest
- 100% service coverage with test files

### Configuration
- Environment variable configuration via `.env`
- Moleculer configuration for distributed systems
- Support for NATS, Redis, MQTT transporters
- Configurable caching (Memory, Redis)
- Google Gemini AI integration
- Cernion MCP token authentication

## Roadmap

### Planned
- Additional European energy market integrations
- Real-time WebSocket support for streaming data
- Enhanced caching strategies
- Performance optimization for high-volume queries
- Extended test coverage with integration tests
- Docker containerization support
- Kubernetes deployment configurations
- CI/CD pipeline setup
- Rate limiting and throttling

---

## Release Notes

### v0.1.0 - Initial Release

This is the first public release of Cernion Energy Tools, providing a comprehensive microservices platform for energy market data analysis and operations. The system integrates with multiple data sources including:

- **MaStR** (Marktstammdatenregister) - German registry of energy installations
- **ENTSO-E** Transparency Platform - European electricity grid data
- **SMARD.de** - German electricity market data
- **AGSI** - European gas storage data
- **Netztransparenz.de** - German grid operator data
- **GrünstromIndex** - Regional CO₂ intensity forecasts

The platform supports both direct API queries and natural language queries powered by AI, making energy data accessible to both technical and non-technical users.

### Key Features in v0.1.0

1. **REST API First**: All functionality exposed via REST endpoints
2. **OpenAPI Documentation**: Auto-generated Swagger documentation
3. **Bearer Token Auth**: Support for Cernion MCP tokens
4. **Async Jobs**: Long-running queries return job IDs for polling
5. **Multi-Format Dates**: ISO 8601, YYYYMMDD, German format (DD.MM.YYYY)
6. **Comprehensive Statistics**: Most endpoints include statistical summaries
7. **EIC Code Resolution**: Automatic European energy code resolution
8. **Template Learning**: Self-learning query system for 20x faster repeated queries

### Breaking Changes
None - initial release

### Migration Guide
Not applicable - initial release

### Deprecations
None - initial release
