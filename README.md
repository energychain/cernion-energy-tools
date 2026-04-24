# Cernion Energy Tools

MicroService Agent System for Energy Markets

[![Maintenance CI](https://github.com/energychain/cernion-energy-tools/actions/workflows/maintenance-ci.yml/badge.svg?branch=main)](https://github.com/energychain/cernion-energy-tools/actions/workflows/maintenance-ci.yml)
[![CodeQL](https://github.com/energychain/cernion-energy-tools/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/energychain/cernion-energy-tools/actions/workflows/codeql.yml)
[![Release](https://github.com/energychain/cernion-energy-tools/actions/workflows/release.yml/badge.svg)](https://github.com/energychain/cernion-energy-tools/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/energychain/cernion-energy-tools/branch/main/graph/badge.svg)](https://codecov.io/gh/energychain/cernion-energy-tools)

A modular, scalable microservices platform built with [Moleculer](https://moleculer.services/) for developing energy market applications with AI integration (Google Gemini) and MCP (Model Context Protocol) support.

## Features

- 🚀 **Moleculer Microservices Framework** — Fast, modern, and powerful microservices framework
- 🌐 **API Gateway** — HTTP REST API with automatic route generation
- 🤖 **AI Agent** — Natural-language query planner powered by Google Gemini: describe your energy data need in plain text and the agent generates, executes, and interprets a multi-step microservice plan automatically
- 🏢 **Inhouse Data Sources** — Register, infer, cache, and discover internal utility datasets (CSV, REST, GeoJSON, XLSX, DOCX, Scraper) alongside public energy tools
- 🧩 **Research Web App** — Built-in single-page application at `/app` for interactive, browser-based testing of the AI agent — no separate tooling required
- 📥 **Live CSV Export** — Every agent result exposes a parameterised GET endpoint (`/api/agent/session/:id/csv?param=value`) for zero-config integration with automation tools such as Microsoft Power Automate, Excel Power Query, or cron jobs
- � **Datapoints** — Named, versioned, health-monitored data sources backed by embedded PouchDB. Promote any agent session to a managed datapoint, track refresh history and schema stability, and retrieve live data as JSON or CSV via `/api/datapoints`. See the [health overview](http://localhost:3000/api/datapoints/health/overview) for a dashboard of all registered datapoints.- 📸 **Snapshots** — Seal a group of datapoints as a consistent unit with SHA-256 provenance hashing. Create, validate (drift detection), list, and remove snapshots via `/api/datapoints/snapshot*` (v0.13)
- 🌍 **OSM Geo Layer** — Grid infrastructure analysis via OpenStreetMap/Overpass: VNB assignment validation, nearby infrastructure, substation inventory, and grid topology (v0.10)
- 🌐 **OEP Connector** — Read-only access to the Open Energy Platform (scenario data, NEP references, research datasets) via `/api/oep/*` (v0.12)
- 🔌 **Grid Connection Validation** — Deterministic 6-step Netzanschluss pipeline (`POST /api/grid-connection/validate`): inventory → delta → capacity → EWK benchmark → Go/No-Go decision → audit trail. No LLM — identical inputs, identical findings. Reports sealed with PouchDB snapshots for EU AI Act Art. 12 compliance (v0.14)
- 🤝 **Energy Sharing Validation** — Deterministic 6-step § 42c EnWG pipeline (`POST /api/energy-sharing/validate`): generator/consumer eligibility, MaLo validation, share-sum check, DV validation. Regulatory deadline: 01.06.2026 (v0.15)
- 📊 **MaStR Data Quality Audit** — 8-step portfolio quality audit (`POST /api/mastr-quality/audit`): registration completeness, capacity plausibility, NAP/MeLo connectivity, duplicate detection, geo spot-check. Weighted 0–100 score across 5 dimensions (v0.17)
- ⚡ **Redispatch Ex-Post Audit** — 7-step Redispatch 2.0 settlement readiness audit (`POST /api/redispatch/audit`): portfolio assembly (Weg A/B), NAP/MeLo/DV checks, curtailment data, financial risk scoring (v0.18)
- 🗂️ **Dashboard API** — Read-only UI aggregator with 4 composite endpoints (`GET /api/dashboard/*`): VNB overview, market snapshot, quality summary, finding-codes reference. All upstream calls parallel via `Promise.allSettled`, graceful degradation, 5–15 min cache (v0.19)
- 📖 **API Cookbook** — Curated REST recipe library with search and validation (`GET /api/cookbook`) — discover common query patterns for the AI agent and REST API (v0.20.5)
- 🏢 **Company Registry** — BDEW market-partner CRUD with Double-Opt-In confirmation (`POST /api/company/companies`) (v0.20.3)
- 🗄️ **Object Store** — Generic key-value store for agent artefacts and session data (`GET/PUT/DELETE /api/object-store/:namespace/:key`) (v0.20.4)
- 🔍 **ZNP — Zählpunkt-Netzbetreiber-Prüfung** — Multi-layer substation graph analysis for Netzanschluss projects with G-Factor scoring and strategic prompts (`POST /api/znp/projects`) (v0.20.4)
- 🌊 **NOVA Decision Feed** — Real-time SSE decision stream for ZNP grid upgrade proposals with apply/reject workflow (`GET /api/nova/stream`) (v0.24)
- 🤖 **CYA Agent** — Profile-aware grid-connection narrative generator with multi-stakeholder AI perspectives (Investor, Planer, Betreiber) — generates and refines structured narratives from agent sessions (`POST /api/cya/generate`) (v0.26)
- 🔔 **MaStR Monitor** — Field-level change detection with SMTP email notifications, Double-Opt-In subscriptions, cron scheduling, and Live-CSV session replay (`POST /api/mastr-monitor/watches`) (v0.27)
- 🧮 **EDM Virtual Auto-Population** — Automated daily quarter-hour filling for virtual and dummy MeLos via SLP and optional Messkonzept batch evaluation (`POST /api/edm/virtual/*`) (v0.29)
- 🧠 **OEO / OEMetadata** — Open Energy Ontology annotations on all 45+ REST endpoints, OEMetadata v2.0 export with optional JSON Schema validation (v0.11.4–v0.12)
- 🔐 **Data Provenance** — SHA-256 provenance hashing on every datapoint refresh for EU AI Act Art. 12 compliance, plus explainability log for agent corrections (v0.11.5)
- 🧹 **Prompt Scrubber** — Field-level PII masking with energy-domain allowlist before sending data to external LLMs (v0.11.5)- �🔌 **MCP Support** — Model Context Protocol SDK integration
- 📝 **OpenAPI Documentation** — Automatic API documentation at `/api/docs`
- 🧭 **DSO/VNB Lookup** — VNBdigital search/lookup and BDEW → MaStR resolution
- 🛠️ **CLI Tool** — Command-line interface for calling microservices
- 📦 **Service Templates** — Ready-to-use skeleton service template
- 🔄 **Hot Reload** — Automatic service reloading during development
- 🎯 **Best Practices** — ESLint, Prettier, and structured project layout

## Documentation

- [CHANGELOG.md](CHANGELOG.md) - Release notes and notable changes
- [MCP_TOOLS.md](MCP_TOOLS.md) - MCP tool reference
- [MCP_SERVICES.md](MCP_SERVICES.md) - Microservice-to-tool mapping
- [BEARER_TOKEN_AUTHENTICATION.md](BEARER_TOKEN_AUTHENTICATION.md) - Auth guide
- [docs/BACKEND_CONTEXT.md](docs/BACKEND_CONTEXT.md) - Backend architecture reference (services, PouchDB, finding codes, auth)
- [llm.txt](llm.txt) - Generated LLM context artifact (architecture + domain knowledge + cookbook + OpenAPI)
- [docs/ui-contracts/](docs/ui-contracts/) - Frontend ↔ backend API contracts (v0.27, 22 docs)
- [docs/MAINTENANCE_MILESTONE_CHECKLIST.md](docs/MAINTENANCE_MILESTONE_CHECKLIST.md) - Pre-milestone quality/security gate checklist
- [SECURITY.md](SECURITY.md) - Security policy and disclosure
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - Community guidelines

## CI/CD & Transparency

- Pull requests and pushes to `main` run automated quality checks (lint, build, unit coverage gates, integration discovery sanity, OpenAPI audit, security audits).
- Security analysis is continuously enforced with CodeQL.
- Version tags (`v*`) trigger a release pipeline (`release:check` + build + GitHub Release).
- `llm.txt` is validated in release checks and regenerated from source-of-truth files via `npm run generate:llm`.
- In maintenance CI, `llm.txt` sync is checked strictly when `CHANGELOG.md` changes.
- Coverage reports are uploaded and publicly visible via Codecov.
- Recommended repository setting: enable branch protection on `main` and require `Maintenance CI` + `CodeQL` checks before merge.

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/energychain/cernion-energy-tools.git
cd cernion-energy-tools

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env and add your API keys (see Configuration section)
nano .env
```

### Running the Services

```bash
# Start all services
npm start

# Or use development mode with hot reload
npm run dev
```

The API Gateway will start on `http://localhost:3000` by default.

| URL | Description |
|---|---|
| `http://localhost:3000/app` | **Research Web App** — AI agent UI for interactive testing |
| `http://localhost:3000/api/docs` | Swagger UI — full OpenAPI documentation |
| `http://localhost:3000/api/openapi.json` | Raw OpenAPI spec |

### Using the CLI

```bash
# Call a microservice action
npm run cli -- skeleton.hello --name=John

# Health check
npm run cli -- skeleton.health

# Get help
npm run cli -- --help
```

## Research Web App

The built-in web application at `/app` lets you explore all microservices using plain-text natural language — no curl, no Swagger form, no coding required.

### Workflow

1. **Describe your question** — type in plain English or German, e.g.
   *"Alle PV-Anlagen im Netz der Enercity in Hannover"*

2. **Review the plan** — the AI decomposes the question into a numbered sequence of microservice calls and shows you exactly which services will be called and with which parameters.

3. **Adjust parameters** — concrete values extracted from your query (dates, postal codes, MeLo IDs, operator names, …) appear as pre-filled, editable form fields. Change any value without re-generating the plan.

4. **Run & explore** — results appear in a sortable, filterable table. The raw JSON from every step is available for debugging.

5. **Share or automate** — a shareable URL and a **Live CSV link** are generated automatically (see below).

### Live CSV for Automation

Every completed analysis exposes a parameterised CSV endpoint:

```
GET /api/agent/session/<id>/csv?param1=value1&param2=value2
```

- The query **re-runs live** against the real data sources every time it is called — data is never stale.
- GET parameters **override** the saved values, so the same session URL can be reused with different dates, regions, or identifiers.
- The CSV URL updates in real time in the UI as you change any form field.

**Power Automate / Excel Power Query example:**

```
http://10.0.0.8:3900/api/agent/session/2a70e478-90ce-4fa5-b996-6f98efdba7cf/csv?startDate=2026-03-01
```

Point a *HTTP → Get file* action or a Power Query *Web* data source at this URL. Change the `startDate` parameter to fetch a different reporting period — no re-analysis needed.

**Other automation patterns:**
- Schedule a cron job / GitHub Action to pull fresh CSVs daily
- Feed directly into pandas `read_csv(url)` in a Jupyter notebook
- Use as a data source in Grafana, Power BI, or any tool that accepts a CSV URL

## Creating New Services

### Using the Service Creator

```bash
# Create a new service interactively
npm run create

# Or specify a name directly
npm run create -- my-service
```

This creates a new service in `custom-services/` from the skeleton template and generates a matching test in `custom-tests/`.

Custom services are local-only and ignored by git. Core services shipped with the project live in `services/`.

### Manual Service Creation

1. Copy the skeleton template:
   ```bash
   cp templates/skeleton.service.js custom-services/my-service.service.js
   ```

2. Edit the service — change the `name` property, add actions, events, and methods.

3. Restart services:
   ```bash
   npm start
   ```

### Custom Services & Tests

- Custom services live in `custom-services/` and are loaded at startup.
- Custom tests live in `custom-tests/` and are excluded from release coverage.
- Run custom tests without global coverage thresholds:
  ```bash
  npm run test:custom -- my-service.service.test.js
  ```

## Project Structure

```
cernion-energy-tools/
├── services/              # Core microservices (shipped with release)
│   ├── api.service.js     # API Gateway + Swagger UI
│   ├── agent.service.js   # AI agent — plan/execute/export
│   ├── assets.service.js  # MaStR installation assets
│   ├── datapoint.service.js # Named datapoints + snapshots (v0.11–v0.13)
│   ├── osm-geo.service.js # OSM geo layer (v0.10)
│   ├── oep.service.js     # Open Energy Platform (v0.12)
│   ├── datasource-registry.service.js
│   ├── datasource-connector.service.js
│   ├── datasource-cache.service.js
│   ├── datasource-discovery.service.js
│   ├── forecast.service.js
│   ├── gas-storage.service.js
│   ├── german-grid.service.js
│   ├── grid-operations.service.js
│   ├── cya.service.js         # CYA narrative agent (v0.26)
│   ├── mastr-monitor.service.js # MaStR Monitor + subscriptions (v0.27)
│   ├── nova.service.js        # NOVA SSE decision feed (v0.24)
│   ├── znp.service.js         # Zählpunkt-Netzbetreiber-Prüfung (v0.20.4)
│   └── ...                # 45 services total — see services/ for full list
├── src/
│   ├── app.html           # Research Web App (single-page)
│   ├── connectors/        # Built-in datasource connector plugins
│   ├── mcp-client.js      # Centralised MCP tool caller
│   ├── async-job-poller.js # Async job polling
│   ├── prompt-scrubber.js  # PII masking for LLM prompts
│   ├── oeo-mappings.js    # OEO class mappings (~150 entries)
│   ├── validation-findings.js # Finding codes + FINDING_CODE_METADATA (92 codes, v0.19)
│   ├── mastr-monitor-diff.js  # Field-level delta computation (v0.27)
│   ├── mastr-monitor-notify.js # SMTP email notifications (v0.27)
│   ├── mastr-monitor-scheduler.js # Cron preset scheduler (v0.27)
│   ├── cya-agent-personas.js  # CYA multi-stakeholder personas (v0.26)
│   └── oemetadata-builder.js # OEMetadata v2.0 builder
├── custom-services/       # Local/custom services (git-ignored)
├── custom-connectors/     # Local/custom datasource plugins (git-ignored)
├── custom-tests/          # Local/custom tests (git-ignored)
├── templates/
│   └── skeleton.service.js
├── tests/                 # Core test suite
├── scripts/               # Build / audit scripts
├── index.js               # Main entry point
├── cli.js                 # CLI tool
├── create-service.js      # Interactive service creator
├── moleculer.config.js    # Moleculer configuration
├── .env.example           # Environment variables template
└── package.json
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and edit:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API Gateway port |
| `LOG_LEVEL` | `info` | Logging level (`info`, `debug`, `warn`, `error`) |
| `GEMINI_API_KEY` | — | Google Gemini API key (required for AI agent) |
| `GEMINI_MODEL` | `gemini-3-pro-preview` | Gemini model name |
| `MCP_SERVER_URL` | — | MCP server URL |
| `CERNION_TOKEN` | — | Cernion MCP token ([request here](https://cernion.de/) or email dev@stromdao.com) |
| `NAMESPACE` | — | Moleculer namespace for service isolation |
| `TRANSPORTER` | — | Message transporter (NATS, Redis, MQTT, …) |
| `REQUEST_TIMEOUT_MS` | `900000` | Broker request timeout in ms |
| `RETRY_POLICY_ENABLED` | `false` | Enable broker-level retries for retryable errors |
| `CIRCUIT_BREAKER_ENABLED` | `false` | Enable circuit breaker protection |
| `BULKHEAD_ENABLED` | `false` | Enable bulkhead concurrency protection |
| `METRICS_ENABLED` | `false` | Enable Moleculer metrics collection |
| `TRACING_ENABLED` | `false` | Enable Moleculer tracing |
| `ASYNC_POLLER_DEBUG` | `false` | Enable verbose async job poller debug logging |
| `ASYNC_POLLER_LOG_MAX_CHARS` | `400` | Max chars for poller debug payload snippets |
| `DATASOURCE_MONGO_COLLECTION_REGISTRY` | `datasource_registry` | Collection name for datasource definitions |
| `DATASOURCE_MONGO_COLLECTION_CACHE` | `datasource_cache` | Collection name for cached datasource rows |
| `DATASOURCE_MONGO_COLLECTION_AUDIT` | `datasource_audit` | Collection name for privacy/audit records |
| `DATASOURCE_CONNECTOR_PLUGINS_DIR` | `src/connectors` | Built-in datasource connector directory |
| `DATASOURCE_CUSTOM_PLUGINS_DIR` | `custom-connectors` | Custom datasource connector directory |
| `DATASOURCE_MAX_INFER_SAMPLE_ROWS` | `200` | Max sample rows used for schema inference |
| `DATASOURCE_SCRAPER_TIMEOUT_MS` | `30000` | Timeout for scraper connector page loads |
| `DATASOURCE_DEFAULT_PRIVACY_CONTEXT` | `ai-agent` | Default privacy mode for datasource reads |
| `GRID_CONNECTION_DB_PATH` | `./.grid-connections` | PouchDB path for Netzanschluss validation reports (v0.14) |
| `ENERGY_SHARING_DB_PATH` | `./data/energy-sharing` | PouchDB path for Energy Sharing audit trail (v0.15) |
| `MASTR_QUALITY_DB_PATH` | `./data/mastr-quality` | PouchDB path for MaStR quality audits (v0.17) |
| `REDISPATCH_DB_PATH` | `./data/redispatch-expost` | PouchDB path for Redispatch Ex-Post audits (v0.18) |
| `OBJECT_STORE_DB_PATH` | `./data/object-store` | PouchDB path for generic object store (v0.20.4) |
| `ZNP_DB_PATH` | `./data/znp` | PouchDB path for ZNP projects (v0.20.4) |
| `COOKBOOK_DB_PATH` | `./data/cookbook` | PouchDB path for API cookbook (v0.20.5) |
| `COOKBOOK_SEED_FILE` | — | Optional JSON seed file for cookbook recipes |
| `GEMINI_EMBEDDING_MODEL` | `text-embedding-004` | Gemini embedding model for semantic cookbook search |
| `SMTP_HOST` | — | SMTP server hostname for MaStR Monitor email notifications (v0.27) |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | — | SMTP authentication username |
| `SMTP_PASS` | — | SMTP authentication password |
| `SMTP_FROM` | — | Sender address for notification emails |
| `MASTR_MONITOR_BASE_URL` | `http://localhost:3000` | Base URL embedded in subscription confirmation links |

For complete operational options (retry backoff, circuit-breaker thresholds, bulkhead queue limits), see [.env.example](.env.example).

## Inhouse Data Sources (v0.9)

The v0.9 datasource layer adds a second data plane next to MCP-backed public energy tools: internal utility and grid-operator data.

### Services

- `datasource-registry` — CRUD for source definitions, cache policy, Data Dictionary, dictionary version history, and schema inference drafts
- `datasource-connector` — plugin runtime for reading heterogeneous sources through built-in or custom connectors
- `datasource-cache` — privacy-aware cached row access, status inspection, refresh, invalidation, and DSGVO audit trail
- `datasource-discovery` — AI-ready inhouse source descriptors for the agent and future Logic Builder integrations

### Built-in connector plugins

- `csv` — delimited files from disk, including `.gz`
- `rest` — JSON/CSV HTTP endpoints
- `geojson` — feature flattening with centroid coordinates
- `xlsx` — spreadsheet row extraction via SheetJS
- `docx` — Word extraction scaffold (optional `mammoth` dependency)
- `scraper` — HTML/table extraction scaffold via `cheerio` or `puppeteer`

### Public REST endpoints

- `POST /api/datasources`
- `GET /api/datasources`
- `GET /api/datasources/:id`
- `PUT /api/datasources/:id`
- `DELETE /api/datasources/:id`
- `GET /api/datasources/:id/dictionary`
- `PUT /api/datasources/:id/dictionary`
- `GET /api/datasources/:id/dictionary/history`
- `GET /api/datasources/:id/dictionary/:version`
- `POST /api/datasources/:id/infer`
- `POST /api/datasources/:id/refresh`
- `GET /api/datasource-cache/:sourceId`
- `GET /api/datasource-cache/:sourceId/status`
- `GET /api/datasource-cache/:sourceId/audit`
- `POST /api/datasource-cache/:sourceId/refresh`
- `DELETE /api/datasource-cache/:sourceId`
- `GET /api/datasource-discovery`
- `GET /api/datasource-discovery/search?q=...`
- `GET /api/datasource-discovery/:sourceId/descriptor`

### Current implementation status

- Implemented: service scaffolds, public REST exposure, OpenAPI tag grouping, in-memory cache/registry flow, connector loader, CSV/REST/GeoJSON/XLSX reads, discovery descriptors, and agent prompt integration
- Scaffolded with optional dependencies: `docx`, `scraper`
- Planned follow-up: persistent MongoDB backend, richer connector validation, and Logic Builder integration

### Moleculer Configuration

Edit `moleculer.config.js` to customise logger settings, transporter, cacher, circuit breaker, metrics, and tracing.

## Open Energy Ontology (OEO) Integration

Since v0.11.4 Cernion is annotated with machine-readable mappings to the
[Open Energy Ontology](https://github.com/OpenEnergyPlatform/ontology) (v2.11.0).

| Layer | What it does |
|---|---|
| `src/oeo-mappings.js` | Static lookup (~150 entries): installation types, grid concepts, voltage levels, market types, ENTSO-E PSR codes, units. Includes German labels. |
| `x-oeo-class` in OpenAPI | Every REST endpoint carries `x-oeo-class` arrays linking to OEO class IRIs. |
| `semanticHints.oeoClasses` | Datasource discovery descriptors expose domain-level OEO annotations. |
| Classifier keyword boost | German OEO labels (e.g. "Solaranlage", "Stromnetz") enrich the heuristic scorer for German-language uploads. |
| `GET /api/datapoints/oeo-context` | JSON-LD `@context` document mapping datapoint fields to OEO IRIs. |
| `scripts/sync-oeo.js` | Validates mappings against upstream OEO releases. Run: `npm run sync:oeo`. |

### Upstream dependency

The ontology is maintained by [@OpenEnergyPlatform/ontology](https://github.com/OpenEnergyPlatform/ontology).
All inline references are tagged with `// @OpenEnergyPlatform/ontology — OEO_XXXXX label`
so that GitHub search surfaces our dependency to upstream maintainers.

## Available Scripts

| Script | Description |
|---|---|
| `npm start` | Start all services |
| `npm run dev` | Start with hot reload and REPL |
| `npm run cli` | Run CLI tool |
| `npm run create` | Create new service from template |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format code with Prettier |
| `npm test` | Run full test suite with coverage |
| `npm run test:unit` | Run unit/service tests with coverage thresholds |
| `npm run test:unit:ci` | CI-safe unit run (`--runInBand --forceExit`) |
| `npm run test:integration` | Run integration tests (`*.integration.test.js`) |
| `npm run test:e2e` | Run live end-to-end integration test (`assets.integration.test.js`) |
| `npm run test:custom` | Run custom tests (no coverage threshold) |
| `npm run test:watch` | Watch mode |
| `npm run audit:openapi` | Audit OpenAPI request/parameter quality |
| `npm run audit:security` | Run blocking dependency audit (critical severity) |
| `npm run audit:security:advisory` | Run advisory dependency audit (high+) |
| `npm run export:openapi` | Generate `openapi-export.json` with `x-ui-page` annotations |
| `npm run release:check` | Run core release gates (unit coverage, OpenAPI, critical security audit) |
| `npm run sync:oeo` | Validate/update OEO mappings from upstream release |
| `npm run sync:oemetadata` | Validate/update OEMetadata schema from upstream |
| `npm run build` | No-op passthrough for CI compatibility |

### Operational Profiles

- Local development: keep reliability toggles off (`RETRY_POLICY_ENABLED=false`, `CIRCUIT_BREAKER_ENABLED=false`, `BULKHEAD_ENABLED=false`).
- Production baseline: enable at least `CIRCUIT_BREAKER_ENABLED=true` and `BULKHEAD_ENABLED=true` after validation in staging.
- Incident debugging: temporarily enable `ASYNC_POLLER_DEBUG=true` with conservative `ASYNC_POLLER_LOG_MAX_CHARS`.

## Service Architecture

Each service follows this structure:

```javascript
module.exports = {
  name: 'service-name',
  settings: { /* service-specific settings */ },
  actions: {
    myAction: {
      rest: 'GET /my-action',
      params: { param1: { type: 'string' } },
      openapi: { summary: '…', tags: ['MyService'] },
      async handler(ctx) { /* … */ }
    }
  },
  events: { /* event handlers */ },
  methods: { /* internal methods */ },
  created() {}, async started() {}, async stopped() {}
};
```

## AI Agent

The `agent` service (`services/agent.service.js`) exposes four REST actions used by the Research Web App:

| Endpoint | Description |
|---|---|
| `POST /api/agent/analyze` | Generate a multi-step execution plan from a free-text query |
| `POST /api/agent/execute` | Run the plan and return results + an AI-generated summary |
| `GET /api/agent/session/:id` | Retrieve a saved session (shareable URL) |
| `GET /api/agent/session/:id/csv?…` | Re-run plan and download results as CSV |

### Parameter Extraction (RULE 5)

Every concrete value from the user's message (dates, postal codes, IDs, operator names, …) is automatically surfaced as an editable form field with the extracted value pre-filled. Structural parameters (`format`, `limit`, `type`, …) remain hardcoded. This makes every generated query a **reusable template** that can be adjusted without re-analysis.

### Robust Plan Execution

- **`normalizePlan()`** — normalises varying key names from the LLM (`useTool/args/label` → `action/params/description`)
- **`resolveChainedRef()`** — resolves `__step_N.fieldPath` references between steps, strips `{{…}}` wrappers
- **`effectiveInputs`** — seeds from `requiredInputs[].default`, overlaid by user-supplied values; overrides hardcoded step params for any declared `requiredInput` name
- **Self-healing re-plan** — if a step returns an empty result, the agent automatically retries with a re-generated plan (one attempt, guarded by `repairAttempt` flag)

## API Gateway

The API Gateway (`services/api.service.js`) provides:

- **Base URL**: `http://localhost:3000/api`
- **Research Web App**: `http://localhost:3000/app`
- **API Docs**: `http://localhost:3000/api/docs`
- **OpenAPI spec**: `http://localhost:3000/api/openapi.json`

## Release Checklist

1. Update version in `package.json` and OpenAPI version in `services/api.service.js`
2. Update `CHANGELOG.md`
3. Run tests: `npm test` (must pass with coverage thresholds)
4. Run lint: `npm run lint`
5. Run OpenAPI audit: `npm run audit:openapi`
6. Run dependency security audit: `npm run audit:security`
7. Ensure `custom-services/`, `custom-tests/`, `.sessions/`, and `.env` are not committed
8. Commit, tag, and push: see [Release Process in copilot-instructions](.github/copilot-instructions.md)

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes with tests
4. Run `npm test` and `npm run lint`
5. Submit a pull request

## Versioning

This project follows [Semantic Versioning](https://semver.org/). See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Security

Please report security issues privately. See [SECURITY.md](SECURITY.md) for the responsible disclosure policy.

## Code of Conduct

Please follow our community guidelines in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

GPL-3.0 — see [LICENSE](LICENSE) for details.

## Support

- **GitHub Issues**: https://github.com/energychain/cernion-energy-tools/issues
- **Cernion Token**: https://cernion.de/ or email dev@stromdao.com

## Acknowledgments

- [Moleculer](https://moleculer.services/) — Microservices framework
- [Google Gemini](https://ai.google.dev/) — AI plan generation
- [MCP](https://modelcontextprotocol.io/) — Model Context Protocol
- [Cernion](https://cernion.de/) — German energy data backend
