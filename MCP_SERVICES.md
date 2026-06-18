# Cernion Energy Tools - MCP Microservices

Comprehensive MicroService Agent System for Energy Markets, mapping Cernion MCP tools to REST API endpoints.

## Overview

This project provides a complete REST API wrapper around the Cernion Model Context Protocol (MCP) server, exposing 70+ energy data tools through 12 microservices organized by functional categories. Starting with v0.9, it also includes a parallel inhouse datasource layer for internal utility datasets.

## Architecture

- **Moleculer Framework**: Microservices-based architecture
- **MCP SDK**: HTTP streaming transport to Cernion MCP server
- **Session Management**: One MCP session per HTTP request
- **Auto-generated OpenAPI**: Documentation available at `/api/openapi.json`

## Microservices

### 1. Query Tools Service (`query`)
Natural language queries and template-based searches

**Endpoints:**
- `POST /api/query/ask` - Natural language energy data queries
- `POST /api/query/ask-learned` - Template-based queries (20x faster)
- `POST /api/query/discover` - Schema discovery for databases and tools
- `GET /api/query/search` - Structured search for MS365 Copilot / OpenAPI plugins (operationId: `searchCernionData`)

### 1a. Copilot Process Service (`copilot-process`)
MS365 Copilot process actions (Phase 2). Read-only + draft/propose. Consequential execute in Phase 3.
**Allowlist:** `config/copilot-operations.json` (26 ops) | **Copilot spec:** `openapi-copilot.json` (generate: `npm run export:openapi:copilot`)
**Process bridge doc:** `docs/copilot-process-bridge.md` | **Setup guide:** `docs/copilot-setup.md`
Plugin: `docs/copilot-plugin.json` | Agent: `docs/copilot-agent.json`

**Read-only:**
- `GET /api/copilot-process/vdmi/:matrixId/context` - VDMI matrix context (operationId: `getVdmiContext`)
- `GET /api/copilot-process/vdmi/responsibilities` - Open VDMI responsibilities (operationId: `listOpenResponsibilities`)
- `GET /api/copilot-process/znp/:projectId/status` - ZNP project status (operationId: `getZnpProjectStatus`)
- `GET /api/copilot-process/grid-connection/:validationId` - Grid connection validation report (operationId: `getGridConnectionValidation`)

**Draft/Propose (no writes):**
- `POST /api/copilot-process/vdmi/:matrixId/prepare-validation` - VDMI nomination draft (operationId: `prepareVdmiValidation`)
- `POST /api/copilot-process/vdmi/:matrixId/draft-evidence` - Evidence suggestions (operationId: `draftVdmiEvidence`)
- `POST /api/copilot-process/grid-connection/prepare-validation` - Validation config draft (operationId: `prepareGridConnectionValidation`)

### 2. Energy Market Data Service (`energy-market`)
Prices, production, forecasts, installations

**Endpoints:**
- `POST /api/energy-market/prices` - Day-ahead/intraday electricity prices
- `POST /api/energy-market/production` - Generation data by source
- `POST /api/energy-market/co2-intensity` - Regional CO₂ intensity forecasts
- `POST /api/energy-market/installations` - Search MaStR installations

### 3. Grid Operations Service (`grid-operations`)
Network data, redispatch, capacity analysis

**Endpoints:**
- `POST /api/grid-operations/grid-data` - Grid operation data
- `POST /api/grid-operations/operator-analysis` - Comprehensive operator analysis
- `POST /api/grid-operations/capacity-utilization` - Network capacity utilization
- `POST /api/grid-operations/redispatch-export` - Export redispatch installations
- `POST /api/grid-operations/connection-capacity-check` - Grid connection feasibility

### 4. Business Intelligence Service (`business-intelligence`)
Market analysis, lead generation, tariff design

**Endpoints:**
- `POST /api/business-intelligence/sales-leads` - Identify sales leads from MaStR
- `POST /api/business-intelligence/dynamic-tariff-calculator` - Dynamic tariff calculation
- `POST /api/business-intelligence/churn-prediction` - Customer churn risk prediction
- `POST /api/business-intelligence/market-penetration` - Market penetration analysis

### 5. Customer Service Service (`customer-service`)
Self-service widgets, health checks, wizards

**Endpoints:**
- `POST /api/customer-service/portal-widget` - Generate embeddable widgets
- `POST /api/customer-service/installation-health-check` - Yield performance diagnosis
- `POST /api/customer-service/installation-change-wizard` - Step-by-step change guidance

### 6. ENTSO-E Service (`entsoe`)
European Energy Data from ENTSO-E Transparency Platform

**Endpoints:**
- `POST /api/entsoe/day-ahead-prices` - Direct ENTSO-E day-ahead prices
- `POST /api/entsoe/unavailability` - Generation/transmission unavailability
- `POST /api/entsoe/physical-flows` - Cross-border electricity flows
- `POST /api/entsoe/actual-generation` - Actual generation by type
- `POST /api/entsoe/wind-solar-forecast` - Wind/solar forecasts
- `POST /api/entsoe/load-forecast` - Load demand forecasts
- `POST /api/entsoe/aggregated-generation` - Aggregated actual generation (all types)
- `POST /api/entsoe/wind-solar-actual` - Actual wind/solar generation
- `POST /api/entsoe/generation-forecast` - Generation forecasts by type
- `GET /api/entsoe/psr-types` - List PSR type codes

### 7. Gas Storage (AGSI) Service (`gas-storage`)
European gas storage monitoring

**Endpoints:**
- `POST /api/gas-storage/country-storage` - Country storage data
- `POST /api/gas-storage/operator-storage` - Operator-specific storage
- `POST /api/gas-storage/historical-data` - Historical time-series
- `POST /api/gas-storage/eu-statistics` - EU-wide statistics
- `POST /api/gas-storage/compare-countries` - Multi-country comparison
- `POST /api/gas-storage/storage-trend` - Trend analysis
- `POST /api/gas-storage/supply-security-check` - Security assessment

### 8. EIC Code Management Service (`eic-codes`)
Energy Identification Code database

**Endpoints:**
- `POST /api/eic-codes/search` - Search EIC code database
- `POST /api/eic-codes/validate` - Validate EIC code format
- `GET /api/eic-codes/gas-operators` - List gas storage operators
- `GET /api/eic-codes/gas-facilities` - List gas storage facilities
- `GET /api/eic-codes/statistics` - EIC database statistics

### 9. German Grid Data Service (`german-grid`)
Official German grid operator data from Netztransparenz.de

**Endpoints:**
- `POST /api/german-grid/spotprices` - German spotmarket prices
- `POST /api/german-grid/negative-prices` - Negative price analysis (§51 EEG 2023)
- `POST /api/german-grid/forecast` - Solar/wind generation forecasts
- `POST /api/german-grid/redispatch` - Redispatch measures

### 10. Renewable Energy Forecast Service (`forecast`)
Weather-based renewable energy generation forecasting using real MaStR installation data

**Endpoints:**
- `POST /api/forecast/generation-forecast` - Weather-based generation forecasts

**Key Features:**
- Real installation data from German Marktstammdatenregister (3.7M+ installations)
- IEC standard compliance (IEC 61853 for solar, IEC 61400 for wind)
- Hourly forecasts up to 7 days (168 hours)
- Regional filtering (state, district, municipality, postal code)
- Installation-level breakdown available
- Weather data integration via Visual Crossing API
- 24-hour weather data caching for performance

**Use Cases:**
- Energy procurement optimization for Stadtwerke
- Grid congestion anticipation for VNB/GNB
- Virtual Power Plant (VPP) trading
- Intraday and day-ahead market positioning
- Industrial load shifting optimization

### 11. System Tools Service (`system`)
Status, job management, parameter validation

**Endpoints:**
- `GET /api/system/status` - System and provider status
- `POST /api/system/validate-params` - Validate tool parameters
- `GET /api/system/job-status/:jobId` - Check async job status
- `GET /api/system/job-result/:jobId` - Retrieve async job result

### 12. Inhouse Datasource Registry (`datasource-registry`)
Datasource registration, dictionary versioning, and schema inference drafts

**Endpoints:**
- `POST /api/datasources` - Register a new datasource
- `GET /api/datasources` - List registered datasources
- `GET /api/datasources/:id` - Get datasource definition
- `PUT /api/datasources/:id` - Update datasource definition
- `DELETE /api/datasources/:id` - Remove datasource definition
- `GET /api/datasources/:id/dictionary` - Get current dictionary
- `PUT /api/datasources/:id/dictionary` - Replace current dictionary and increment version
- `GET /api/datasources/:id/dictionary/history` - Get version history
- `GET /api/datasources/:id/dictionary/:version` - Get specific dictionary version
- `POST /api/datasources/:id/infer` - Generate inferred draft dictionary
- `POST /api/datasources/:id/refresh` - Trigger datasource refresh

### 13. Inhouse Datasource Cache (`datasource-cache`)
Privacy-aware cached datasource row access and audit trail

**Endpoints:**
- `GET /api/datasource-cache/:sourceId` - Query cached rows
- `GET /api/datasource-cache/:sourceId/status` - Cache status and staleness
- `GET /api/datasource-cache/:sourceId/audit` - DSGVO substitution audit log
- `POST /api/datasource-cache/:sourceId/refresh` - Refresh cache entry now
- `DELETE /api/datasource-cache/:sourceId` - Invalidate cache entry

### 14. Inhouse Datasource Discovery (`datasource-discovery`)
AI-ready descriptors for fresh internal data sources

**Endpoints:**
- `GET /api/datasource-discovery` - List discoverable datasource descriptors
- `GET /api/datasource-discovery/search?q=...` - Search datasource descriptors
- `GET /api/datasource-discovery/:sourceId/descriptor` - Get one descriptor

### 15. Inhouse Datasource Connectors (`datasource-connector`)
Internal plugin runtime for heterogeneous datasource reads (not exposed directly via public REST)

**Built-in plugins:**
- `csv`
- `rest`
- `geojson`
- `xlsx`
- `docx` (optional dependency scaffold)
- `scraper` (optional dependency scaffold)

**Current integration note:**
- These connectors are consumed by `datasource-registry` and `datasource-cache`
- `datasource-discovery` publishes fresh sources to the agent as inhouse descriptors
- `agent.analyze` now includes inhouse datasource descriptors alongside normal microservice actions

### 16. Datapoint Management (`datapoint`) — v0.11–v0.13

Named, versioned, health-monitored data sources backed by embedded PouchDB.
Promotes agent sessions to managed datapoints with lifecycle tracking (v0.11),
FAIR provenance metadata and interval scheduling (v0.12), and snapshot-based
consistency proofs for agent pipelines (v0.13).

**REST endpoints — Datapoint CRUD:**

| Method | Path | Action | Description |
|--------|------|--------|-------------|
| `POST` | `/api/datapoints/promote` | `datapoint.promote` | Promote a session to a named datapoint |
| `GET` | `/api/datapoints` | `datapoint.list` | List all datapoints (`?tags=`, `?sourceType=`, `?includeHealth=`) |
| `GET` | `/api/datapoints/health/overview` | `datapoint.health` | Aggregated health overview (healthy / stale / errored / neverRun) |
| `GET` | `/api/datapoints/:name` | `datapoint.get` | Get full datapoint document |
| `PUT` | `/api/datapoints/:name` | `datapoint.update` | Update description / tags / fixedParams / refresh strategy |
| `DELETE` | `/api/datapoints/:name` | `datapoint.remove` | Delete a datapoint |
| `POST` | `/api/datapoints/:name/refresh` | `datapoint.refresh` | Re-execute plan, update `lastRun` + `health` + `provenanceHash` |
| `GET` | `/api/datapoints/:name/data` | `datapoint.data` | Get live data (JSON or `?format=csv`; re-executes plan) |

**REST endpoints — FAIR Metadata (v0.12):**

| Method | Path | Action | Description |
|--------|------|--------|-------------|
| `GET` | `/api/datapoints/:name/oemetadata` | `datapoint.oemetadata` | OEMetadata v2.0 document (EU AI Act Art. 12 provenance hash). Add `?validate=true` for ajv schema validation report. |
| `GET` | `/api/datapoints/oeo-context` | `datapoint.oeoContext` | JSON-LD `@context` mapping datapoint fields to OEO class IRIs. Optional `?name=` for datapoint-scoped field mappings. |

**REST endpoints — Snapshot Semantik (v0.13):**

| Method | Path | Action | Description |
|--------|------|--------|-------------|
| `POST` | `/api/datapoints/snapshot` | `datapoint.createSnapshot` | Create a consistency snapshot over a set of datapoints |
| `GET` | `/api/datapoints/snapshots` | `datapoint.listSnapshots` | List all snapshots (optional `?status=complete\|partial\|failed`) |
| `GET` | `/api/datapoints/snapshot/:id` | `datapoint.getSnapshot` | Get full snapshot document |
| `POST` | `/api/datapoints/snapshot/:id/validate` | `datapoint.validateSnapshot` | Validate snapshot — compare current `provenanceHash` values |
| `DELETE` | `/api/datapoints/snapshot/:id` | `datapoint.removeSnapshot` | Delete a snapshot |

**Key design decisions:**
- Only metadata (`lastRun`, `health`, `provenanceHash`) is persisted in PouchDB — raw data always flows through RAM (KRITIS constraint)
- `auto_compaction: true` keeps disk footprint minimal
- KRITIS-compliant: PouchDB is pure JavaScript, no native bindings, no network port, no external process
- Route ordering: all static sub-routes (`/health/overview`, `/oeo-context`, `/snapshot`, `/snapshots`) are registered **before** `/:name` to prevent path-parameter capture
- `maxConcurrentRefreshes` (env: `DATAPOINT_MAX_CONCURRENT_REFRESHES`, default: `3`) limits simultaneous MCP sessions during scheduled batch refreshes
- Snapshot `createdBy` field (`manual` / `agent` / `scheduler`) is an optional parameter for forward-compatibility with the v0.14 Agent Layer

**Tag-based filtering (AP3, v0.13):**
`GET /api/datapoints?tags=solar,stromdao-netze` returns only datapoints that have **all** specified tags (case-insensitive AND semantics, comma-separated). Works for both direct listing and as input to `createSnapshot`.

**Snapshot creation — three phases:**
1. **Freshness-Check** — datapoints with `lastRun.status === 'success'` and age ≤ `maxAgeMinutes` are marked `fresh` (no refresh triggered).
2. **Sequential Refresh** — stale datapoints are refreshed one-by-one (not parallel) to respect MCP session limits.
3. **Seal** — `snapshotHash` = SHA-256 over alphabetically sorted `provenanceHash` values. Status: `complete` (all ok) / `partial` (some errors) / `failed` (all errors).

**Example — promote and refresh:**

```bash
curl -X POST http://localhost:3000/api/datapoints/promote \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId": "9209aa45-93f7-471c-8883-76326c4083f1",
    "name": "pv-portfolio-stromdao-netze",
    "tags": ["solar", "stromdao-netze"],
    "fixedParams": { "query": "STROMDAO Netze" },
    "refresh": { "strategy": "interval", "intervalMinutes": 60 }
  }'

curl -X POST http://localhost:3000/api/datapoints/pv-portfolio-stromdao-netze/refresh
curl http://localhost:3000/api/datapoints/health/overview
```

**Example — OEMetadata v2.0 with validation:**

```bash
curl "http://localhost:3000/api/datapoints/pv-portfolio-stromdao-netze/oemetadata?validate=true"
```

**Example — create and validate a consistency snapshot:**

```bash
# By explicit names
curl -X POST http://localhost:3000/api/datapoints/snapshot \
  -H 'Content-Type: application/json' \
  -d '{
    "datapointNames": ["pv-portfolio-stromdao-netze", "redispatch-anlagen-stromdao-netze"],
    "maxAgeMinutes": 60,
    "name": "stromdao-validierung-q1-2026"
  }'

# By tag filter
curl -X POST http://localhost:3000/api/datapoints/snapshot \
  -H 'Content-Type: application/json' \
  -d '{ "tags": "stromdao-netze,redispatch-pipeline" }'

# Validate consistency (after running a pipeline)
curl -X POST http://localhost:3000/api/datapoints/snapshot/<id>/validate
```

---

### 17. OEP Connector (`oep`) — v0.12

Read-only connector for the Open Energy Platform (OEP) REST API v0.
Provides access to public energy scenario datasets, NEP reference data,
and research tables without authentication.

**REST endpoints:**

| Method | Path | Action | Description |
|--------|------|--------|-------------|
| `GET` | `/api/oep/schemas` | `oep.listSchemas` | List available OEP database schemas |
| `GET` | `/api/oep/schemas/:schema/tables` | `oep.listTables` | List tables within a schema |
| `GET` | `/api/oep/tables/:schema/:table/meta` | `oep.getTableMeta` | Column definitions and data types |
| `GET` | `/api/oep/tables/:schema/:table/rows` | `oep.query` | Fetch rows (`?limit=`, `?offset=`, `?where=`, `?orderby=`; max 1000/request) |
| `GET` | `/api/oep/search` | `oep.search` | Case-insensitive substring search over all OEP table names and descriptions |

**Cache:** 24 h in-memory TTL for schema lists, table lists, and metadata. Row queries are not cached.

**Env var:** `OEP_API_BASE_URL` (default: `https://openenergyplatform.org/api/v0`).

**Example — search and query:**

```bash
curl "http://localhost:3000/api/oep/search?q=photovoltaic"
curl "http://localhost:3000/api/oep/tables/model_draft/oed_scenario_output/rows?limit=10"
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and add your Cernion token:

```bash
cp .env.example .env
```

Edit `.env`:
```
CERNION_TOKEN=your_token_here
PORT=3000
```

Get your token from https://cernion.de

### 3. Start Services

Development mode (with hot reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Testing

Run all tests:
```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run integration tests:
```bash
npm run test:integration
```

## API Documentation

Once the services are running, access the OpenAPI documentation:

**OpenAPI JSON:**
```
http://localhost:3000/api/openapi.json
```

**Swagger UI (Interactive API Testing):**
```
http://localhost:3000/api/docs
```

The Swagger UI provides an interactive interface where you can:
- Explore all available endpoints
- View request/response schemas
- Test API calls directly from your browser
- See example requests and responses

## MCP Session Management

Each HTTP request creates a new MCP session using the `CernionMCPClient.callWithNewSession()` method:

1. Client connects to Cernion MCP server via HTTP streaming (SSE)
2. Tool is called with provided parameters
3. Session is automatically closed after response
4. Result is returned to the REST API caller

This ensures stateless REST API behavior while properly managing MCP sessions.

## MCP Client Usage

```javascript
const CernionMCPClient = require('./src/mcp-client');

// One-off tool call with automatic session management
const result = await CernionMCPClient.callWithNewSession('cernion_ask', {
  query: 'Wieviel PV-Leistung in Bayern?'
});

// Or manage session manually
const client = new CernionMCPClient(process.env.CERNION_TOKEN);
await client.connect();
const result = await client.callTool('cernion_ask', { query: '...' });
await client.disconnect();
```

## Example Requests

### Query natural language
```bash
curl -X POST http://localhost:3000/api/query/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "Wieviel PV-Leistung in Bayern?"}'
```

### Get day-ahead prices
```bash
curl -X POST http://localhost:3000/api/energy-market/prices \
  -H "Content-Type: application/json" \
  -d '{
    "market": "day-ahead",
    "region": "Deutschland",
    "date": "2026-02-04"
  }'
```

### Check grid operator analysis
```bash
curl -X POST http://localhost:3000/api/grid-operations/operator-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "gridOperator": "Netze BW",
    "includeRedispatch": true
  }'
```

### Get sales leads
```bash
curl -X POST http://localhost:3000/api/business-intelligence/sales-leads \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Heidelberg",
    "installationType": "solar",
    "daysBack": 30,
    "limit": 5
  }'
```

## Project Structure

```
cernion-energy-tools/
├── src/
│   ├── mcp-client.js           # MCP SDK wrapper
│   └── index.js
├── services/
│   ├── api.service.js          # API Gateway
│   ├── query.service.js        # Query Tools
│   ├── energy-market.service.js
│   ├── grid-operations.service.js
│   ├── business-intelligence.service.js
│   ├── customer-service.service.js
│   ├── entsoe.service.js
│   ├── gas-storage.service.js
│   ├── eic-codes.service.js
│   ├── german-grid.service.js
│   └── system.service.js
├── tests/
│   ├── setup.js
│   ├── mcp-client.test.js
│   ├── query.service.test.js
│   ├── energy-market.service.test.js
│   ├── grid-operations.service.test.js
│   ├── business-intelligence.service.test.js
│   └── system.service.test.js
├── .env.example
├── package.json
├── moleculer.config.js
└── jest.config.js
```

## 18. Grid Connection Validation (v0.14)

Deterministic 6-step Netzanschluss validation pipeline. No LLM involvement.

**Service:** `grid-connection`
**Source:** `services/grid-connection.service.js`

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/grid-connection/validate` | Run 6-step pipeline (120 s timeout) |
| `GET` | `/api/grid-connection/validations` | List past validation reports |
| `GET` | `/api/grid-connection/validations/:id` | Get validation report by UUID |

### Pipeline Steps

| Step | Name | Logic |
|---|---|---|
| 1 | `inventory` | Fetch installations ≥100 kW via `cernion_installations_local` (Weg A) or tagged datapoint (Weg B) |
| 2 | `delta` | Detect MaStR duplicates, stale NBP status, voltage level mismatches |
| 3 | `capacity` | Simultaneity-adjusted capacity by voltage level (`SIMULTANEITY_FACTORS`) |
| 4 | `benchmark` | EWK connection time + implementation rate via `ewk-monitoring.*` service |
| 5 | `decision` | Rule engine: `GO_DIRECT` / `GO_CONDITIONAL` / `NO_GO_EXPANSION` / `DATA_QUALITY_INSUFFICIENT` |
| 6 | `audit` | Snapshot validation + `AUDIT_TRAIL_CREATED` (EU AI Act Art. 12) |

### Key Parameters

| Parameter | Type | Description |
|---|---|---|
| `gridOperatorId` | `string` | MaStR SNB/GNB ID (preferred) |
| `gridOperatorBdew` | `string` | 13-digit BDEW code (resolved via `vnbLookupCodes`) |
| `gridOperatorName` | `string` | Fuzzy name match via `marketPartners` |
| `datapointTags` | `string[]` | Tags for datapoint snapshot creation |
| `skipSteps` | `number[]` | Step numbers to skip (e.g. `[4]` skips EWK benchmark) |
| `includeCapacityCheck` | `boolean` | Enable `cernion_connection_capacity_check` for headroom data |

### Finding Codes

`INVENTORY_COMPLETE`, `INVENTORY_EMPTY`, `INSTALLATION_NO_NAP`, `INSTALLATION_STATUS_ANOMALY`,
`MASTR_DUPLICATE_SUSPECTED`, `OPERATOR_DATA_STALE`, `VOLTAGE_LEVEL_MISMATCH`,
`CAPACITY_HEADROOM_OK`, `CAPACITY_CONDITIONAL`, `CAPACITY_EXPANSION_NEEDED`, `TRANSFORMER_DATA_MISSING`,
`EWK_BENCHMARK_SLOW`, `EWK_BENCHMARK_FAST`, `EWK_IMPLEMENTATION_LOW`,
`GO_DIRECT`, `GO_CONDITIONAL`, `NO_GO_EXPANSION`, `DATA_QUALITY_INSUFFICIENT`,
`AUDIT_TRAIL_CREATED`, `SNAPSHOT_DRIFT_DETECTED`

### Architecture Notes

- PouchDB at `.grid-connections/` (`GRID_CONNECTION_DB_PATH` env), doc prefix `val:`.
- Raw installation data is **never** persisted — only report metadata (KRITIS).
- Service excluded from LLM agent catalogue (`skipServices`).
- `src/validation-findings.js` — 20 finding-code constants, factory, aggregator.

---

## 19. Energy Sharing Validation (v0.15)

Deterministic 6-step Energy Sharing community validation pipeline (§ 42c EnWG).
Interims-Prozess for VNBs ahead of § 20b EnWG central IT platform (deadline 01.06.2026).
No LLM involvement.

**Service:** `energy-sharing`
**Source:** `services/energy-sharing.service.js`

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/energy-sharing/validate` | Run 6-step pipeline (120 s timeout) |
| `GET` | `/api/energy-sharing/validations` | List past validation reports (filter by `communityId`) |
| `GET` | `/api/energy-sharing/validations/:id` | Get validation report by UUID |

### Pipeline Steps

| Step | Name | Logic |
|---|---|---|
| 1 | `identity` | Resolve VNB identity via `vnb_lookup_codes` MCP tool |
| 2 | `generators` | Validate each generator MaStR record via `cernion_installations_local` (one bulk call + secondary search for wrong-grid-area detection) |
| 3 | `directMarketer` | Check `FernsteuerbarkeitDv` flag (§ 21 Abs. 2 EEG mandatory ≥100 kW) + DV register via `cernion_direktvermarkter_lookup` |
| 4 | `eligibility` | § 42c EnWG conformity: share sums, MaLo format (`DE[0-9]{31}`), duplicates, grid area consistency |
| 5 | `decision` | Rule engine: `APPROVED` / `APPROVED_WITH_CONDITIONS` / `REJECTED_STRUCTURAL` / `REJECTED_GENERATOR_INVALID` / `REJECTED_OTHER` |
| 6 | `audit` | Snapshot validation + `AUDIT_TRAIL_CREATED` (EU AI Act Art. 12) |

### Key Parameters

| Parameter | Type | Description |
|---|---|---|
| `gridOperatorId` | `string` | MaStR SNB/GNB ID (preferred) |
| `gridOperatorBdew` | `string` | 13-digit BDEW code |
| `communityName` | `string` | Name of the Energy Sharing community |
| `communityId` | `string` | External community ID assigned by the VNB |
| `generators` | `object[]` | Generator participants: `{ mastrNummer, sharePercent, direktvermarkter? }` |
| `consumers` | `object[]` | Consumer participants: `{ maloId, sharePercent, name? }` |
| `datapointTags` | `string[]` | Tags for datapoint Weg B fallback |

### Finding Codes

**VNB Identity:** `VNB_RESOLVED`, `VNB_AMBIGUOUS`, `VNB_NOT_FOUND`

**Generator:** `GENERATOR_VALID`, `GENERATOR_NOT_FOUND`, `GENERATOR_NOT_OPERATIONAL`,
`GENERATOR_WRONG_GRID_AREA`, `GENERATOR_TYPE_INELIGIBLE`, `GENERATOR_CAPACITY_ZERO`,
`GENERATOR_NO_NAP`, `GENERATOR_NO_MELO`, `GENERATOR_DUPLICATE`

**Direct Marketer:** `DV_VALID`, `DV_MANDATORY_MISSING`, `DV_NOT_CONTROLLABLE`,
`DV_NOT_FOUND`, `DV_INACTIVE`, `DV_MASTR_MISMATCH`

**Eligibility:** `ELIGIBILITY_CONFIRMED`, `SHARE_SUM_GENERATORS_INVALID`,
`SHARE_SUM_CONSUMERS_INVALID`, `NO_GENERATORS`, `NO_CONSUMERS`, `MIXED_GRID_AREAS`,
`GENERATOR_EXCEEDS_LIMIT`, `CONSUMER_MALO_INVALID`, `CONSUMER_MALO_DUPLICATE`

**Decision:** `APPROVED`, `APPROVED_WITH_CONDITIONS`, `REJECTED_STRUCTURAL`,
`REJECTED_GENERATOR_INVALID`, `REJECTED_OTHER`

**Audit (reused from v0.14):** `AUDIT_TRAIL_CREATED`, `SNAPSHOT_DRIFT_DETECTED`

### Architecture Notes

- PouchDB at `.energy-sharing/` (`ENERGY_SHARING_DB_PATH` env), doc prefix `es:`.
- Raw installation data is **never** persisted — only report metadata (KRITIS).
- Service excluded from LLM agent catalogue (`skipServices`).
- `src/validation-findings.js` extended with 28 new constants (total: 48 codes).
- Weg B datapoint fallback via `tryDatapointFallback` helper (mirrors v0.14 pattern).

---

## 7. Dashboard API Service (v0.19) — `dashboard-api`

Read-only UI aggregator. Exposes 4 composite endpoints designed to satisfy entire
dashboard pages with a single API call. No own PouchDB, no state, no side-effects.

**Endpoints:**

| Method | URL | Cache TTL | Description |
|--------|-----|-----------|-------------|
| `GET` | `/api/dashboard/vnb-overview` | 5 min | VNB identity, KPIs, latest agent results, alerts |
| `GET` | `/api/dashboard/market-snapshot` | 15 min | Spot prices, CO₂ intensity, renewable forecast |
| `GET` | `/api/dashboard/quality-summary` | 5 min | Recent reports from all 5 agent pipelines |
| `GET` | `/api/dashboard/finding-codes` | 24 h | All 92 finding codes with EN+DE descriptions |

**Architecture notes:**

- All upstream calls fired in parallel via `Promise.allSettled` (< 3s latency target).
- Each upstream call wrapped in `safeCall()` — failed calls return `null`, service name
  added to `_errors[]`. Response always returned — never 500 from upstream failure.
- In-memory cache (`this.cache = new Map()`) with per-action TTLs.
- Reads `FINDING_CODE_METADATA` from `src/validation-findings.js` for `findingCodes` endpoint.
- **NOT** in `skipServices` — all 4 endpoints are LLM-accessible read-only tools.
- Upstream services: `grid-operations`, `vnb-monitor`, `datapoint`, `mastr-quality`,
  `grid-connection`, `energy-sharing`, `redispatch-expost`, `energy-sharing-allocation`,
  `energy-market`, `entsoe`, `german-grid`.

---

## Technology Stack

- **Moleculer**: 0.14.35 - Microservices framework
- **@modelcontextprotocol/sdk**: 1.26.0 - MCP client SDK
- **Moleculer Web**: 0.10.8 - API Gateway
- **Moleculer Auto OpenAPI**: 1.1.7 - Auto-generated API docs
- **Jest**: 29.7.0 - Testing framework

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests for new functionality
5. Ensure all tests pass (`npm test`)
6. Submit a pull request

## License

GPL-3.0

## Support

For issues and questions:
- GitHub Issues: https://github.com/energychain/cernion-energy-tools/issues
- Cernion Documentation: https://cernion.de/mcp_tools.md

## Credits

Developed by Energy Chain for the Cernion Energy Platform.
