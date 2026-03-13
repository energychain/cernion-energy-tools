# Cernion Energy Tools

MicroService Agent System for Energy Markets

A modular, scalable microservices platform built with [Moleculer](https://moleculer.services/) for developing energy market applications with AI integration (Google Gemini) and MCP (Model Context Protocol) support.

## Features

- 🚀 **Moleculer Microservices Framework** — Fast, modern, and powerful microservices framework
- 🌐 **API Gateway** — HTTP REST API with automatic route generation
- 🤖 **AI Agent** — Natural-language query planner powered by Google Gemini: describe your energy data need in plain text and the agent generates, executes, and interprets a multi-step microservice plan automatically
- 🏢 **Inhouse Data Sources** — Register, infer, cache, and discover internal utility datasets (CSV, REST, GeoJSON, XLSX, DOCX, Scraper) alongside public energy tools
- 🧩 **Research Web App** — Built-in single-page application at `/app` for interactive, browser-based testing of the AI agent — no separate tooling required
- 📥 **Live CSV Export** — Every agent result exposes a parameterised GET endpoint (`/api/agent/session/:id/csv?param=value`) for zero-config integration with automation tools such as Microsoft Power Automate, Excel Power Query, or cron jobs
- 🔌 **MCP Support** — Model Context Protocol SDK integration
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
- [docs/MAINTENANCE_MILESTONE_CHECKLIST.md](docs/MAINTENANCE_MILESTONE_CHECKLIST.md) - Pre-milestone quality/security gate checklist
- [SECURITY.md](SECURITY.md) - Security policy and disclosure
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - Community guidelines

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
│   ├── datasource-registry.service.js
│   ├── datasource-connector.service.js
│   ├── datasource-cache.service.js
│   ├── datasource-discovery.service.js
│   ├── forecast.service.js
│   ├── gas-storage.service.js
│   ├── german-grid.service.js
│   ├── grid-operations.service.js
│   └── ...                # See services/ for full list
├── src/
│   ├── app.html           # Research Web App (single-page)
│   ├── connectors/        # Built-in datasource connector plugins
│   ├── mcp-client.js      # Centralised MCP tool caller
│   └── async-job-poller.js
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
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model name |
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
| `npm run release:check` | Run core release gates (unit coverage, OpenAPI, critical security audit) |

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
