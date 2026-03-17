# Changelog

All notable changes to the Cernion Energy Tools project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [Unreleased]

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
