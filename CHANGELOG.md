# Changelog

All notable changes to the Cernion Energy Tools project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
