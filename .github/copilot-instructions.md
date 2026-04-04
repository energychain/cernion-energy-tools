# GitHub Copilot Instructions for Cernion Energy Tools

## Project Overview
This is a MicroService Agent System for Energy Markets built with Moleculer. It wraps the Cernion MCP server and exposes MCP tools as REST endpoints via an API Gateway.

### Key Implementation Facts
- Services live in `services/` and are loaded by Moleculer at runtime.
- MCP calls are centralized in `src/mcp-client.js` and used by services.
- Long-running tools use `src/async-job-poller.js` (`callWithAutoPoll`).
- REST endpoints are declared with `rest` in each action and documented via OpenAPI.
- API Gateway is `services/api.service.js` with OpenAPI at `/api/openapi.json` and Swagger UI at `/api/docs`.
- Embedded PouchDB (`pouchdb` + `pouchdb-find`) stores datapoint metadata and snapshots.
  KRITIS-compliant: no native bindings, no network port, no external process.

## Architecture Layers (v0.10–v0.20)

| Layer | Version | Description |
|---|---|---|
| Execution Layer | v0.9.x | MCP services, REST gateway, inhouse datasources, AI agent |
| Geo Layer | v0.10 | OSM-based grid infrastructure analysis (`osm-geo.*` actions) |
| Datapoint Layer | v0.11–v0.13 | Named managed data sources with PouchDB, scheduling, OEO/OEMetadata, snapshots |
| Agent Layer | v0.14–v0.15 | Grid Connection Validation (v0.14) + Energy Sharing Validation (v0.15): deterministic pipelines, PouchDB audit trail, EU AI Act Art. 12 compliance |
| Agent Layer | v0.17 | MaStR Data Quality Audit (v0.17): 8-step portfolio quality audit, weighted dimension scoring, `skipSteps`, 25 `MQ_*` finding codes (total: 73) |
| Agent Layer | v0.18 | Redispatch Ex-Post Agent (v0.18): 7-step settlement readiness audit, Weg A/B portfolio, `src/redispatch-risk.js`, 19 `RD_*` finding codes (total: 92) |
| Dashboard Layer | v0.19 | Dashboard API (v0.19): 4 UI-aggregate endpoints, `Promise.allSettled`, `safeCall`, `FINDING_CODE_METADATA`, in-memory cache, `scripts/export-openapi.js`, 14 UI contracts |
| UI Sync Layer | v0.20 | Version sync with `cernion-ui` Enterprise UI; no backend code changes; REST API consumed by frontend via `docs/ui-contracts/` |

## Coding Guidelines

### General Principles
- Follow clean code principles and SOLID design patterns
- Write self-documenting code with clear variable and function names
- Prioritize readability and maintainability over cleverness
- Use async/await for asynchronous operations instead of callbacks
- Handle errors explicitly and provide meaningful error messages

### Code Style
- Use 2 spaces for indentation
- Use ES6+ modern JavaScript features (CommonJS modules, no TypeScript)
- Use descriptive variable names (camelCase for variables, PascalCase for classes)
- Keep functions small and focused (single responsibility)
- Add JSDoc comments for public APIs and complex functions
- Include unit tests for all business logic

### Architecture Guidelines
- Follow microservice architecture patterns
- Each service should be independently deployable
- Use RESTful API design principles
- Implement proper error handling and logging
- Use environment variables for configuration
- Follow 12-factor app methodology

### Security Best Practices
- Never commit sensitive data (API keys, passwords, tokens)
- Use environment variables for secrets
- Validate and sanitize all inputs
- Implement proper authentication and authorization
- Follow OWASP security guidelines
- `src/prompt-scrubber.js` masks PII before sending data to external LLMs

### Testing Guidelines
- Write unit tests for all business logic
- Use Jest as the testing framework
- Meet coverage thresholds: branches 60%, functions 75%, lines 75%,
  statements 75%
- Current suite: ~1 660+ tests, ~57 suites — all must pass after changes
- Run release gate before every release: `npm run release:check`
- Acceptance fixtures in `tests/acceptance/` — do not modify
- Custom tests live in `custom-tests/` and are excluded from release coverage

### Documentation
- Update README.md with any significant changes
- Document API endpoints with examples
- Include inline comments for complex logic
- Keep documentation up-to-date with code changes
- Every REST action MUST have full OpenAPI annotations (`npm run audit:openapi` enforced)

## Project-Specific Context

### Energy Market Domain
- Understand energy market operations and terminology
- Consider time-series data handling for energy consumption/production
- Implement proper data validation for market transactions
- Handle currency and unit conversions carefully

### Microservice Communication
- Use RESTful APIs for synchronous communication
- Consider message queues for asynchronous operations
- Implement proper service discovery mechanisms
- Use correlation IDs for distributed tracing

### PouchDB Conventions
- Datapoint docs use prefix `dp:` (e.g. `dp:solar-assets-twl`)
- Snapshot docs use prefix `snap:` (e.g. `snap:<uuid>`)
- Indexes: `['name']`, `['createdAt']`
- Raw data is NEVER persisted — only metadata and provenance hashes (KRITIS constraint)

### Provenance & Compliance
- Every datapoint refresh computes a SHA-256 `provenanceHash` over step results
  (EU AI Act Art. 12 compliance, v0.11.5)
- Snapshots seal a group of datapoints with a `snapshotHash` (SHA-256 over sorted
  provenance hashes) for consistency proof (v0.13.0)
- `agent_interventions` array records every automated agent correction for explainability
- OEMetadata v2.0 endpoint (`GET /api/datapoints/:name/oemetadata`) with optional
  `?validate=true` JSON Schema validation (v0.12.0)

## File Organization
- `/services` — Core microservices (loaded by Moleculer at runtime)
- `/src` — Shared modules (MCP client, formatters, scrubber, PouchDB builders)
- `/tests` — Core test suite (Jest)
- `/custom-services` — Local/custom services (git-ignored)
- `/custom-tests` — Local/custom tests (git-ignored)
- `/templates` — Service skeleton template
- `/scripts` — Build, audit, and sync scripts
- `/docs` — Documentation and use-case files
- `/uploads` — User-uploaded inhouse datasets (git-ignored)

## Common Patterns to Follow
- Use dependency injection for better testability
- Implement proper logging with structured logs
- Use configuration management for different environments
- Follow semantic versioning for releases

### Async Job Pattern (v0.9.8+)
- Long-running REST actions return HTTP 202 with a `jobId`
- File-backed persistence in `src/job-store.js` (`data/jobs/` directory, git-ignored)
- `ctx.meta.$gateway` flag distinguishes REST callers from internal callers
- Agent executor strips `$gateway` to prevent async descriptor leakage in plan steps

### Inhouse Data Layer (v0.9+)
- All inhouse datasource access MUST go through `datasource-cache.query`
- NEVER use `query.ask`, SQL actions, or database lookups for inhouse sources
- Inhouse sources are identified by sourceId in `inhouseSources` or
  `semanticHints.domain` in discovery descriptor
- Event payloads must remain lean — `datasource.inference.complete` carries
  only `{ sourceId, filename, description }`, never sampleRows
- `datasource-classifier` is stateless and fetches sample rows itself
- Semantic domains are defined in `src/semantic-domains.js`
- Classifier uses heuristic scoring only — no external AI calls in classifier
- `src/period-normaliser.js` handles mixed period formats (e.g. `Jan 2026`, `2026-Q1`)
  for time-series joins
- `src/vnb-identity.js` resolves VNB identity automatically from env and datasource metadata
- `services/datasource-watcher.service.js` detects upload file changes and triggers
  datasource cache refresh
- LLM classifier fallback is opt-in via `CLASSIFIER_LLM_FALLBACK_ENABLED` and runs only
  for low-confidence unknown classifications
- Description-guided `"other"` domain (v0.9.13) allows free-text dataset descriptions
  as semantic guide for AI queries

### Datapoint Layer (v0.11–v0.13)
- `services/datapoint.service.js` — core CRUD, health, refresh, scheduling, snapshots
- PouchDB stores only metadata — raw data always flows through RAM
- Scheduling: 60-second interval tick in `started()`, controlled by
  `DATAPOINT_SCHEDULER_ENABLED` env var
- Concurrency guard: `maxConcurrentRefreshes` setting (env: `DATAPOINT_MAX_CONCURRENT_REFRESHES`,
  default 3) prevents MCP session overflows during scheduled refreshes
- Tags: datapoints carry a `tags` array; `list` action supports `?tags=solar,twl-netze`
  (AND semantics, case-insensitive)
- Snapshots: `createSnapshot` accepts `datapointNames` or `tags`, performs freshness check,
  sequential refresh, then seals with `snapshotHash`

### OEO / OEMetadata (v0.11.4–v0.12)
- `src/oeo-mappings.js` — ~150 curated OEO class mappings with German labels
- `x-oeo-class` OpenAPI extension on all 45+ REST actions
- `src/oemetadata-builder.js` — maps datapoints to OEMetadata v2.0 JSON
- `src/source-license-map.js` — 14-prefix license mapping (DL-DE, CC-BY, ODbL)
- `scripts/sync-oeo.js` and `scripts/sync-oemetadata.js` for upstream validation

### OSM Geo Layer (v0.10)
- `services/osm-geo.service.js` — 4 actions: validate, infrastructureNearby,
  substationFinder, gridTopology
- Uses Overpass API (public or private instance via `OVERPASS_ENDPOINT` env var)
- Agent RULE 12 routes geo intents to these actions

## Current Project Status (v0.20.0)

- Release `v0.20.0` is the current release.
- **38 Moleculer services** (including dashboard-api aggregator, v0.19)
- **4 deterministic agents** (grid-connection v0.14, energy-sharing v0.15,
  mastr-quality v0.17, redispatch-expost v0.18)
- **1 allocation engine** (energy-sharing-allocation v0.16)
- **4 dashboard aggregate endpoints** (dashboard-api v0.19)
- **92 finding codes** with EN+DE metadata (FINDING_CODE_METADATA)
- **~1,782+ tests**, ~60 test suites
- **Enterprise UI** consuming this API: `cernion-ui` repository (v0.20.0+)
- UI contracts: `docs/ui-contracts/` (14 files, backend-owned)
- **Dashboard Layer (v0.19.1 hotfix):** `dashboard-api.service.js` — read-only UI aggregator:
  - 4 endpoints: `vnbOverview`, `marketSnapshot`, `qualitySummary`, `findingCodes`
  - `Promise.allSettled` parallelism, `safeCall` graceful degradation, in-memory cache.
  - `FINDING_CODE_METADATA` added to `src/validation-findings.js` (all 92 codes, EN+DE).
  - 4 routes registered in `api.service.js` under new `Dashboard API` OpenAPI tag.
  - 39 unit tests in `tests/dashboard-api.test.js`.
  - `scripts/export-openapi.js` + `npm run export:openapi` script.
  - 14 UI contract docs in `docs/ui-contracts/` (00–13).
  - `docs/BACKEND_CONTEXT.md` — full backend reference for frontend consumers.
- **UI Layer (v0.15.1):** All v0.13–v0.15 backend features surfaced in `src/app.html`:
  - Datapoints panel: tag filter input, interventions row-expand (📋 per row), Snapshots sub-section (create/list/validate/delete).
  - Integration Hub: Grid Connection Validation sub-card (v0.14 — Netzanschluss pipeline).
  - Integration Hub: Energy Sharing Validation sub-card (v0.15 — § 42c EnWG, dynamic generator/consumer rows, share-sum validation, decision badges).
  - New CSS tokens: `.decision-badge`, `.val-kpi-row`, `.val-step-timeline`, `.val-findings`, `.dynamic-rows-wrap`, `.dp-snapshots-section`, etc.
- **Agent Layer (v0.14–0.18):** Four deterministic validation/audit agents:
  - `grid-connection.service.js` (v0.14) — 6-step Netzanschluss pipeline.
  - `energy-sharing.service.js` (v0.15) — 6-step Energy Sharing pipeline (§ 42c EnWG),
    regulatory deadline 01.06.2026. PouchDB at `data/energy-sharing/`, doc prefix `es:`.
    28 new finding codes in `src/validation-findings.js` (total: 48).
  - `mastr-quality.service.js` (v0.17) — 8-step MaStR portfolio quality audit.
    PouchDB at `data/mastr-quality/`, doc prefix `mq:`. 25 new `MQ_*` finding codes
    (total: 73). Weighted quality score across 5 dimensions (0–100). 180s timeout.
  - `redispatch-expost.service.js` (v0.18) — 7-step Redispatch 2.0 Ex-Post settlement audit.
    PouchDB at `data/redispatch-expost/`, doc prefix `rd:`. 19 new `RD_*` finding codes
    (total: 92). `src/redispatch-risk.js` pure module (assessSettlementReadiness, assessRisk).
    Weg A (MCP) / Weg B (datapoint fallback) portfolio. 180s timeout.
- Integration Hub panel (`#integration-hub-panel`) in `src/app.html` with token
  management, Power Automate / Power BI connector generator, VNB Monitor
  threshold editor, and NBP Monitor sub-panel.
- `token-manager` microservice with `ck_` prefix tokens, SHA-256 storage,
  `read-only` / `full-access` scopes.
- Datapoint Layer with full lifecycle: promote → CRUD → schedule → refresh →
  snapshot → validate. Five snapshot REST endpoints in `api.service.js`.
- OEMetadata v2.0 + OEO integration across all domain services.
- Known limitations tracked for future releases:
  - ~37 non-blocking ESLint `no-unused-vars` warnings — tracked for cleanup
  - Jest open handles on test exit — mitigated with `--forceExit`, root cause
    likely `fs.watch` teardown in datasource-watcher
- Release gate: `npm run release:check` (tests + OpenAPI + security)
- Known risk: `xlsx` high advisory — documented exception in SECURITY.md

### Agent Layer (v0.14–v0.18)

- All agent services follow the **deterministic pipeline pattern**:
  separate PouchDB, `skipServices` exclusion, MCP calls via `CernionMCPClient.callWithNewSession`,
  no LLM involvement, EU AI Act Art. 12 audit trail.
- `energy-sharing` adds: generator/consumer input schema, per-generator DV validation,
  MaLo format check, § 42c EnWG eligibility assessment.
- `mastr-quality` adds: 8-step portfolio audit, weighted dimension scoring
  (`QUALITY_DIMENSION_WEIGHTS` + `computeDimensionScore` + `computeQualityScore`),
  `skipSteps` parameter (only steps 3–7 may be skipped), geo spot-check via `osm-geo.validate`,
  25 `MQ_*` finding codes. PouchDB at `data/mastr-quality/`, doc prefix `mq:`.
- `redispatch-expost` adds: 7-step Redispatch 2.0 settlement audit, Weg A/Weg B portfolio
  (`tryDatapointFallback` standalone method with freshness gate), pure risk module at
  `src/redispatch-risk.js`, `skipSteps` parameter (only steps 3–6 may be skipped),
  19 `RD_*` finding codes. PouchDB at `data/redispatch-expost/`, doc prefix `rd:`.

## Release Process (0.x)

1. Update version in `package.json` and OpenAPI version in `services/api.service.js`.
2. Update `CHANGELOG.md` with release notes.
3. Run release gate: `npm run release:check` (tests + OpenAPI + critical security).
4. Ensure no secrets are present (`.env` must not be committed).
5. Commit changes: `git add -A && git commit -m "chore: prepare X.Y.Z release"`.
6. Tag release: `git tag vX.Y.Z`.
7. Push: `git push && git push --tags`.

Notes:
- Advisory scan (`npm run audit:security:advisory`) may fail on known, documented upstream vulnerabilities; review before release.
- Do not store tokens or API keys in the repository; use `.env.example` only.
- CI workflows reference `npm run build` — this is a no-op passthrough (`echo`) since
  the project has no build step. It exists solely for CI compatibility.

## MCP Data Backend — Known Limitations

### Direktvermarktung (Direct Marketing) Data Availability

**What IS available**
- `cernion_installations_local` supports filtering by `fernsteuerbarkeitDv: true`
  (field `FernsteuerbarkeitDv` in EinheitenWind.xml / EinheitenSolar.xml, stored as
  string `"1"` / `"0"`).
- Combined with `minCapacity: 100` (kW), this is the best public proxy for
  Redispatch 2.0-eligible installations currently in Direktvermarktung.
- Available for: **Wind, Biomass** — field is NOT present in Solar/Storage collections.
- Does NOT reveal which specific Direktvermarkter company manages the unit.
- Does NOT confirm that a DV contract is currently active (data may be stale).

**What is NOT available — and why**
- Filtering by a specific Direktvermarkter company (e.g. "all assets of Next Kraftwerke")
  is **not possible** through any public data source.
- `DirektvermarkterMastrNummer` exists in the MaStR data model but is **deliberately
  excluded from all public bulk exports** (BNetzA policy — commercially sensitive data).
- As a result, the local MongoDB field `direktvermarkterMastrNummer` is not populated
  and the `direktvermarkterName` / `direktvermarkterMastrId` filter parameters of
  `cernion_installations_local` will return empty results.
- The same applies to `cernion_installations` (Powabase) — no DV portfolio method exists
  in the MaStR SOAP API either.

**Implication for the Direktvermarkter pipeline**
- `grid-operations.direktvermarkterLookup` → `assets.byDirektvermarkter` is the
  designed pipeline, but **`byDirektvermarkter` will return 0 results** in practice
  because the underlying MongoDB filter fields are unpopulated.
- When a user asks for a specific DV company's portfolio, communicate this limitation
  and offer `fernsteuerbarkeitDv: true` + `minCapacity: 100` as the best available proxy
  (for Wind/Biomass only).

**Alternative approaches (informational only)**
- Authenticated MaStR portal access by the DV company itself.
- Netztransparenz.de — aggregated MWh volumes per marketing product only.
- Bilateral data exchange with the Direktvermarkter.
- BKV-MPID from `MarktakteureUndRollen.xml` for balance group queries.

## Feedback vom Frontend

Das Frontend-Repository (`cernion-ui`) hat ein `feedback/`-Verzeichnis mit
strukturierten Rückmeldungen (Bug Reports, Change Requests, Information Requests,
Documentation Requests). Wenn du Feedback-Dateien als Kontext erhältst:

1. Lies die Datei vollständig
2. Prüfe die betroffene(n) Service-Datei(en) und UI-Contracts
3. Implementiere den Fix oder beantworte die Frage
4. Aktualisiere den betroffenen UI-Contract in `docs/ui-contracts/`
5. Setze den Status in der Feedback-Datei auf `resolved` + Version

Typen: BR- (Bug), CR- (Change Request), IR- (Information Request), DR- (Doku)

Resolutions werden in `feedback/RES-[TYPE]-NNNN.md` abgelegt (Template: `feedback/TEMPLATE.md`).

## What NOT to Do
- Don't use `var` - use `const` or `let`
- Don't ignore errors or use empty catch blocks
- Don't hardcode configuration values
- Don't write functions longer than 50 lines
- Don't commit commented-out code
- Don't use abbreviations in variable names unless widely understood
