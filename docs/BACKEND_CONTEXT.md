# Cernion Energy Tools — Backend Context Reference

> **Version:** 0.27.0
> **Purpose:** Comprehensive backend context for frontend developers, AI assistants,
> and new contributors. One document to understand the full system.

---

## 1. Architecture Overview

Cernion Energy Tools is a **Moleculer microservices** system. Each service runs in the
same process and communicates via Moleculer's in-process transport (no network hops for
internal calls). A single API Gateway (`services/api.service.js`) exposes all services as
REST endpoints on port 3000.

```
HTTP clients
    │
    ▼ port 3000
┌─────────────────────────────────────────────────────────────────┐
│ services/api.service.js  (Moleculer-Web + OpenAPI mixin)        │
│   GET  /api/dashboard/*       → dashboard-api.service   (v0.19) │
│   POST /api/mastr-quality/*   → mastr-quality.service   (v0.17) │
│   POST /api/grid-connection/* → grid-connection.service (v0.14) │
│   POST /api/energy-sharing/*  → energy-sharing.service  (v0.15) │
│   POST /api/redispatch/*      → redispatch-expost.svc   (v0.18) │
│   GET  /api/datapoints/*      → datapoint.service       (v0.11) │
│   … and 36 more services                                        │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ MCP client
Cernion MCP server (external HTTP)  ─── MaStR MongoDB (local)
```

### Architecture Layers

| Layer | Introduced | Description |
|-------|-----------|-------------|
| Execution Layer | v0.9.x | MCP services, REST gateway, inhouse datasources, AI agent |
| Geo Layer | v0.10 | OSM-based grid infrastructure analysis (`osm-geo.*`) |
| Datapoint Layer | v0.11–v0.13 | Named managed data sources with PouchDB, scheduling, OEO/OEMetadata, snapshots |
| Agent Layer | v0.14 | Grid Connection Validation — 6-step deterministic pipeline |
| Agent Layer | v0.15 | Energy Sharing Validation — § 42c EnWG, 6 steps |
| Agent Layer | v0.17 | MaStR Data Quality Audit — 8-step, 25 `MQ_*` codes, weighted scoring |
| Agent Layer | v0.18 | Redispatch Ex-Post Settlement Audit — 7 steps, 19 `RD_*` codes |
| Dashboard Layer | v0.19 | Read-only UI aggregator (`dashboard-api.service.js`) |
| Platform Layer | v0.20–v0.20.5 | Company CRUD, Object Store, ZNP, API Cookbook (`znp`, `company`, `cookbook`) |
| Decision Layer | v0.24 | NOVA SSE decision feed (`nova.service.js`) |
| CYA Layer | v0.26 | Profile-aware narrative generator, multi-stakeholder personas (`cya.service.js`) |
| Monitor Layer | v0.27 | MaStR field-level change monitor, SMTP notifications, subscriptions (`mastr-monitor.service.js`) |
| UI Integration | v0.20+ | Enterprise UI (`cernion-ui`) consuming this REST API; contract boundary: `docs/ui-contracts/` |

---

## 2. Service Directory (45 services as of v0.27.0)

| Service | File | Since | Key actions |
|---------|------|-------|-------------|
| api | `api.service.js` | v0.1 | API Gateway |
| agent | `agent.service.js` | v0.9 | Natural-language query planner |
| assets | `assets.service.js` | v0.9 | MaStR asset lookups |
| business-intelligence | `business-intelligence.service.js` | v0.9 | Sales leads, tariff design |
| company | `company.service.js` | v0.20.3 | Company-entity CRUD |
| cookbook | `cookbook.service.js` | v0.20.5 | API recipes, search, validation |
| **cya** | `cya.service.js` | **v0.26** | **`createProfile`, `getProfile`, `listProfiles`, `generate`, `refine`** |
| customer-service | `customer-service.service.js` | v0.9 | Customer-facing helpers |
| **dashboard-api** | `dashboard-api.service.js` | **v0.19** | **4 UI-aggregate endpoints** |
| datapoint | `datapoint.service.js` | v0.11 | CRUD + refresh + snapshots |
| datasource-cache | `datasource-cache.service.js` | v0.9 | Inhouse datasource cache |
| datasource-classifier | `datasource-classifier.service.js` | v0.9 | Semantic domain classifier |
| datasource-connector | `datasource-connector.service.js` | v0.9 | Connector registry |
| datasource-discovery | `datasource-discovery.service.js` | v0.9 | Datasource discovery |
| datasource-registry | `datasource-registry.service.js` | v0.9 | Datasource CRUD |
| datasource-watcher | `datasource-watcher.service.js` | v0.9 | File change watcher |
| eic-codes | `eic-codes.service.js` | v0.9 | EIC code lookup |
| energy-market | `energy-market.service.js` | v0.9 | Prices, CO₂, installations |
| energy-sharing | `energy-sharing.service.js` | v0.15 | § 42c EnWG validation |
| energy-sharing-allocation | `energy-sharing-allocation.service.js` | v0.16 | Allocation engine |
| entsoe | `entsoe.service.js` | v0.9 | ENTSO-E generation/forecast data |
| ewk-monitoring | `ewk-monitoring.service.js` | v0.9 | EWK benchmarking |
| forecast | `forecast.service.js` | v0.9 | Electricity demand forecasts |
| gas-storage | `gas-storage.service.js` | v0.9 | AGSI gas storage data |
| german-grid | `german-grid.service.js` | v0.9 | SMARD/Netztransparenz data |
| grid-connection | `grid-connection.service.js` | v0.14 | Netzanschluss validation |
| grid-operations | `grid-operations.service.js` | v0.9 | VNB lookup, redispatch export |
| in-memory-join | `in-memory-join.service.js` | v0.9 | Cross-datasource joins |
| job-status | `job-status.service.js` | v0.9 | Async job polling |
| **mastr-monitor** | `mastr-monitor.service.js` | **v0.27** | **`createWatch`, `getWatch`, `listWatches`, `deleteWatch`, `executeWatch`, `getLatestDelta`, `listDeltas`, `subscribe`, `confirmSubscription`, `unsubscribe`, `listSubscriptions`, `createFromSession`** |
| mastr-quality | `mastr-quality.service.js` | v0.17 | MaStR data quality audit |
| nbp-monitor | `nbp-monitor.service.js` | v0.16 | NBP price/CO₂ monitoring |
| **nova** | `nova.service.js` | **v0.24** | **`pendingDecisions`, `apply`, `stream` (SSE)** |
| object-store | `object-store.service.js` | v0.20.4 | Generic object store |
| oep | `oep.service.js` | v0.12 | Open Energy Platform |
| osm-geo | `osm-geo.service.js` | v0.10 | OSM/Overpass geo analysis |
| query | `query.service.js` | v0.9 | LLM query planner |
| redispatch-expost | `redispatch-expost.service.js` | v0.18 | Redispatch settlement audit |
| residual-load | `residual-load.service.js` | v0.9 | Residual load analysis |
| system | `system.service.js` | v0.1 | Health, version |
| token-manager | `token-manager.service.js` | v0.16 | `ck_` prefix tokens |
| utility-report | `utility-report.service.js` | v0.9 | Utility analysis reports |
| vnb-monitor | `vnb-monitor.service.js` | v0.9 | VNB monitoring + alerts |
| web-search | `web-search.service.js` | v0.9 | Web search integration |
| znp | `znp.service.js` | v0.20.4 | Zählpunkt-Netzbetreiber-Prüfung |

---

## 3. PouchDB Store Locations

Each agent service has its own embedded PouchDB. Raw data is **never persisted** —
only metadata, provenance hashes, and audit trails.

| Service | DB path | Doc prefix | Purpose |
|---------|---------|------------|---------|
| datapoint | `data/datapoints/` | `dp:` | Datapoint metadata |
| datapoint (snapshots) | `data/datapoints/` | `snap:` | Snapshot seals |
| company | `data/companies/` | — | Company-Entities (BDEW-Marktpartner) |
| grid-connection | `data/grid-connections/` | `val:` | Validation audit trail |
| energy-sharing | `data/energy-sharing/` | `es:` | Energy sharing audit trail |
| mastr-quality | `data/mastr-quality/` | `mq:` | MaStR quality audit trail |
| object-store | `data/object-store/` | — | Generic Objekte (Agent-Artefakte) |
| object-store (mastr_watches) | `data/object-store/` | `mastr_watches` ns | MaStR Monitor watch definitions |
| object-store (mastr_snapshots) | `data/object-store/` | `mastr_snapshots` ns | MaStR Monitor installation snapshots |
| object-store (mastr_deltas) | `data/object-store/` | `mastr_deltas` ns | MaStR Monitor change deltas |
| object-store (mastr_subscriptions) | `data/object-store/` | `mastr_subscriptions` ns | MaStR Monitor email subscriptions |
| redispatch-expost | `data/redispatch-expost/` | `rd:` | Redispatch audit trail |

---

## 4. Finding Codes (92 total)

All finding codes are defined in `src/validation-findings.js` with:
- JavaScript constants (e.g. `const MQ_ZERO_CAPACITY = 'MQ_ZERO_CAPACITY'`)
- `FINDING_CODE_METADATA` map (added v0.19) with `{ severity, agent, step, description, descriptionDe }`

> **Naming-Konvention:** JS-Konstantennamen tragen Agent-Präfixe (ES_, MQ_, RD_, GO_),
> aber Energy-Sharing-Werte in API-Responses haben KEIN ES_-Präfix. Details:
> `src/validation-findings.js` (Kommentar-Block am Anfang der Konstanten-Definitionen).

### By agent

| Agent | Prefix | Count | Steps |
|-------|--------|-------|-------|
| grid-connection | `GC_` / `GO_` / `VNB_` | ~28 | 1–6 |
| energy-sharing | `ES_` / `APPROVED` etc. | ~28 | 1–6 |
| mastr-quality | `MQ_` | 25 | 2–8 |
| redispatch-expost | `RD_` | 19 | 2–7 |

### Severity distribution

- **error** — blocking, must be resolved before settlement/approval
- **warning** — non-blocking, should be investigated
- **info** — informational, pipeline trace

### `FINDING_CODE_METADATA` API

```javascript
const { FINDING_CODE_METADATA } = require('./src/validation-findings');

// Each entry:
FINDING_CODE_METADATA['MQ_ZERO_CAPACITY']
// → { severity: 'error', agent: 'mastr-quality', step: 4,
//      description: 'Gross capacity (Bruttoleistung) is zero',
//      descriptionDe: 'Bruttoleistung = 0' }
```

---

## 5. Async Job Pattern

Long-running endpoints return `HTTP 202`:

```json
{ "jobId": "job_abc123", "status": "queued", "pollUrl": "/api/jobs/job_abc123" }
```

Poll `GET /api/jobs/:jobId` (2s interval, 200s timeout):
- `{ status: 'completed', result: {...} }` — done
- `{ status: 'failed', error: '...' }` — failed
- `{ status: 'running', step: N }` — in progress

Jobs are persisted in `data/jobs/` (file-backed `src/job-store.js`). Git-ignored.

Agents that use async jobs: `mastr-quality`, `grid-connection`, `energy-sharing`, `redispatch-expost`.

---

## 6. Authentication

All endpoints (except `GET /api/openapi.json` and `GET /api/docs`) require:
```
Authorization: Bearer ck_<token>
```

Tokens are issued by `POST /api/tokens`. Stored as SHA-256 hash — original never retained.

Scopes:
- `read-only` — GET endpoints only
- `full-access` — all endpoints (includes PUT/DELETE/POST)

Special bypass routes (no token required):
- `GET /api/tokens`
- `POST /api/tokens`
- `DELETE /api/tokens/:id`
- `PUT /api/vnb-monitor/thresholds`
- `PUT /api/nbp-monitor/parameters`

---

## 7. Dashboard API (v0.19) — Quick Reference

```
GET /api/dashboard/vnb-overview?bdewCode=9907473000008
GET /api/dashboard/market-snapshot
GET /api/dashboard/market-snapshot?location=Heidelberg&region=Bayern
GET /api/dashboard/quality-summary
GET /api/dashboard/quality-summary?gridOperatorId=SNB935578300972
GET /api/dashboard/finding-codes
```

| Endpoint | Upstream calls | Cache TTL | Notes |
|----------|---------------|-----------|-------|
| `vnb-overview` | 7 (parallel) | 5 min | Always returns `_errors` array |
| `market-snapshot` | 4 (parallel) | 15 min | `location`/`region` override params |
| `quality-summary` | 5 (parallel) | 5 min | Optional `gridOperatorId` filter |
| `finding-codes` | 0 (static) | 24 h | 92 codes with EN+DE descriptions |

All endpoints follow the graceful degradation pattern:
- Failed internal calls → `null` in affected field
- Failed call name appended to `_errors[]`
- Response **always** returned (no 500 from upstream failures)

---

## 8. KRITIS Compliance Constraints

- **No native bindings** — PouchDB uses pure JS engine only
- **No network port** for PouchDB — embedded in-process only
- **No external process** for PouchDB
- **Raw data never persisted** — only metadata + SHA-256 provenance hashes
- **PII masking** via `src/prompt-scrubber.js` before sending to external LLMs
- **EU AI Act Art. 12** — full audit trail in PouchDB for all agent decisions
- `agent_interventions` array in each audit document for explainability

---

## 9. Key Source Modules

| Module | Path | Purpose |
|--------|------|---------|
| MCP Client | `src/mcp-client.js` | All Cernion MCP calls |
| Async Job Poller | `src/async-job-poller.js` | `callWithAutoPoll` for long-running MCP tools |
| Job Store | `src/job-store.js` | File-backed job persistence (`data/jobs/`) |
| Validation Findings | `src/validation-findings.js` | 92 finding codes + `FINDING_CODE_METADATA` |
| Redispatch Risk | `src/redispatch-risk.js` | Pure risk scoring module (Weg A/B) |
| MaStR Monitor Diff | `src/mastr-monitor-diff.js` | Field-level delta computation (`computeDelta`, `buildSnapshotEntry`) |
| MaStR Monitor Notify | `src/mastr-monitor-notify.js` | SMTP email (`sendDeltaNotification`, `sendConfirmationEmail`) |
| MaStR Monitor Scheduler | `src/mastr-monitor-scheduler.js` | Cron preset matcher (`isDue`, `PRESETS`) |
| CYA Personas | `src/cya-agent-personas.js` | Multi-stakeholder narrative personas (Investor, Planer, Betreiber) |
| Prompt Scrubber | `src/prompt-scrubber.js` | PII field masking |
| Period Normaliser | `src/period-normaliser.js` | Mixed period format → ISO 8601 |
| VNB Identity | `src/vnb-identity.js` | VNB identity resolution from env + metadata |
| Semantic Domains | `src/semantic-domains.js` | Domain classifier hints |
| OEO Mappings | `src/oeo-mappings.js` | ~150 Open Energy Ontology class mappings |
| OEMetadata Builder | `src/oemetadata-builder.js` | OEMetadata v2.0 JSON builder |

---

## 10. Environment Variables (key)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | API Gateway port |
| `CERNION_TOKEN` | — | Cernion MCP bearer token (required) |
| `OVERPASS_ENDPOINT` | public | OSM Overpass API URL |
| `DATAPOINT_SCHEDULER_ENABLED` | true | Enable/disable auto-refresh scheduler |
| `DATAPOINT_MAX_CONCURRENT_REFRESHES` | 3 | Concurrency cap for scheduled refreshes |
| `CLASSIFIER_LLM_FALLBACK_ENABLED` | false | Enable LLM fallback in datasource classifier |
| `SMTP_HOST` | — | SMTP hostname for MaStR Monitor email (v0.27) |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP auth username |
| `SMTP_PASS` | — | SMTP auth password |
| `SMTP_FROM` | — | Notification sender address |
| `MASTR_MONITOR_BASE_URL` | `http://localhost:3000` | Base URL embedded in subscription links |

---

## 11. Test Suite

- **Framework**: Jest (`jest.config.js`)
- **Coverage thresholds**: branches 60%, functions/lines/statements 75%
- **Total**: ~2 268+ tests, ~82 suites (as of v0.27.0)
- **Release gate**: `npm run release:check` (unit coverage + OpenAPI audit + critical security)
- Custom tests in `custom-tests/` (git-ignored, excluded from coverage)

Key test commands:
```bash
npm test                     # All tests with coverage
npm run test:unit:ci         # Unit tests only (CI mode, --forceExit)
npm run audit:openapi        # OpenAPI annotation completeness audit
npm run export:openapi       # Generate openapi-export.json
npm run release:check        # Full release gate
```

---

## 12. Known Limitations

- **Direktvermarktung portfolio**: `DirektvermarkterMastrNummer` is excluded from
  MaStR public bulk exports (BNetzA policy). `direktvermarkterName` filter returns
  0 results. Best proxy: `fernsteuerbarkeitDv: true` + `minCapacity: 100` (Wind/Biomass only).
- **ESLint warnings**: ~37 non-blocking `no-unused-vars` warnings — tracked for cleanup.
- **Jest open handles**: mitigated with `--forceExit`; root cause is `fs.watch` teardown
  in `datasource-watcher.service.js`.
- **`xlsx` advisory**: high-severity advisory with no upstream fix. Documented exception
  in `SECURITY.md`. Mitigation: input constrained to trusted in-process data only.
- **`dashboard-api` `mastr-quality.list` gridOperatorId**: all 7 vnbOverview calls are
  fired simultaneously via `Promise.allSettled`. `mastr-quality.list` is called without
  `gridOperatorId` (returns newest audit regardless of operator). Accepted trade-off for
  latency — will be improved with a sequential identity-first pattern in a future release.

### Known Limitations / Open Risks

**BDEW-Auflösungsrisiko (offen seit v0.20.2):**
`cernion_installations_local` löst `gridOperatorBdewCode` server-seitig im MCP-Tool
auf — nicht lokal via `vnbLookupCodes`. Es ist nicht verifiziert, ob der MCP-Server
dieselbe Mapping-Collection nutzt. Bei BDEW-Codes mit Alias-Konflikten könnte der
v0.20.0-Bug (falscher Code für TWL Netze) auf dem `bdewCode`-Pfad wieder auftreten.
Muss vor der nächsten Operator-Onboarding-Welle untersucht werden.

**CR-0003 — Drei fehlende Agent-Response-Felder:**
`steps[].findingCode` (grid-connection), `curtailment`-Top-Level-Objekt und
`portfolio.weg` (redispatch) sind nicht implementiert. Frontend-Workarounds produktiv
seit v0.20.4. Fix geplant für v0.21.x.
Siehe `feedback/CR-0003-missing-agent-fields.md`.

---

## 13. UI Contracts

See `docs/ui-contracts/` for the complete frontend ↔ backend contract:

```
docs/ui-contracts/
├── 00-architecture.md       Overview, conventions, auth, async pattern
├── 01-dashboard-overview.md GET /dashboard/vnb-overview
├── 02-market-snapshot.md    GET /dashboard/market-snapshot
├── 03-quality-summary.md    GET /dashboard/quality-summary
├── 04-finding-codes.md      GET /dashboard/finding-codes
├── 05-mastr-quality.md      POST /mastr-quality/audit
├── 06-grid-connection.md    POST /grid-connection/validate
├── 07-energy-sharing.md     POST /energy-sharing/validate
├── 08-redispatch.md         POST /redispatch/audit
├── 09-datapoints.md         GET/POST /datapoints
├── 10-vnb-monitor.md        GET /vnb-monitor/snapshot
├── 11-nbp-monitor.md        GET /nbp-monitor/status
├── 12-auth.md               GET/POST /tokens
├── 13-shared-components.md  Shared UI component specs
└── 21-mastr-monitor.md      GET/POST /mastr-monitor/* (v0.27)
```
