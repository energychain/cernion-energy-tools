# Feature Specification: Cernion Energy Tools v0.9.4
## Inhouse Data Layer — Consolidation & Completeness

**Target release:** v0.9.4
**Status:** Draft
**Prerequisite:** v0.9.3 tagged and all 941 tests passing
**Scope:** `datasource-classifier`, `datasource-registry`, `datasource-connector`,
`agent.service`, `src/semantic-domains.js`, `src/app.html`

---

## 1. Motivation

v0.9.3 introduced the semantic onboarding flow and validated it against four
real-world Stadtwerk use cases. The acceptance test (10/12 queries passing)
revealed three concrete gaps that limit the practical value of the Inhouse
Data Layer:

1. **Mixed-format time references** — `Lieferperiode` values like `Feb 2026`
   or `2026-Q1` cannot be parsed as timestamps, blocking spot-price join
   queries for procurement data.
2. **Hybrid routing gap** — queries combining inhouse asset inventories with
   external EWK benchmarks fall back to pure `inhouse_aggregate` instead of
   fetching the external source.
3. **VNB identity not resolved** — the agent asks the user for the VNB name
   even though the system already knows the operator identity from
   configuration or from registered datasource metadata.

Additionally, two items deferred from v0.9.3 are now ready to specify:

4. **Filesystem watcher for `./uploads/`** — automatic cache invalidation
   when an uploaded file is replaced.
5. **LLM-assisted classifier fallback** — for files the heuristic classifier
   cannot confidently classify (confidence < 0.35), an optional LLM call
   provides a second opinion before asking the user.

Finally, the repo-wide Prettier/ESLint cleanup deferred from v0.9.3 is
included as a mandatory first step to reduce noise in all subsequent diffs.

---

## 2. Goals

- Close all two known limitations documented in the v0.9.3 CHANGELOG.
- Resolve VNB identity automatically without user prompt.
- Add filesystem watcher so "Live CSV" updates trigger cache refresh
  without manual intervention.
- Add LLM-assisted fallback for low-confidence classifier results.
- Ship a clean, lint-free codebase as the baseline for v0.9.4+.

---

## 3. Feature 1 — Repo-wide Cleanup (prerequisite, no logic changes)

**Must be the first commit in v0.9.4**, before any feature work.

### 3.1 Tasks

```bash
# 1. Auto-fix formatting
npx prettier --write services/ src/ tests/ scripts/

# 2. Auto-fix lint
npx eslint --fix services/ src/ tests/ scripts/

# 3. Remaining manual lint fixes
#    - No eslint-disable without inline justification comment
#    - No empty catch blocks
#    - No console.log in service code (use this.logger)

# 4. Validate
npm test          # must pass: 941+ tests
npm run release:check  # must pass
```

### 3.2 Commit message

```
chore: repo-wide prettier + eslint cleanup (post v0.9.3 baseline)
```

**Do NOT touch:** `tests/fixtures/`, `tests/acceptance/`, `docs/use-cases/`,
`CHANGELOG.md`, `package-lock.json`, any CSV or JSON data files.

---

## 4. Feature 2 — Period-Format Normalisation for Time References

**Closes known limitation:** *"Mixed-format Lieferperiode not parseable
as time reference for spot-price join"*

### 4.1 Problem

The `timeseries_cost_enrichment` intent class requires an ISO-parseable
timestamp column. The `procurement` domain's `Lieferperiode` field uses
mixed human-readable formats:

| Input value | Meaning | Required ISO form |
|-------------|---------|-------------------|
| `Jan 2026` | January 2026 | `2026-01-01` (start of month) |
| `Feb 2026` | February 2026 | `2026-02-01` |
| `Mar 2026` | March 2026 | `2026-03-01` |
| `2026-Q1` | Q1 2026 | `2026-01-01` (start of quarter) |
| `2026-Q2` | Q2 2026 | `2026-04-01` |
| `2026-Q3` | Q3 2026 | `2026-07-01` |
| `2026-Q4` | Q4 2026 | `2026-10-01` |

### 4.2 New module: `src/period-normaliser.js`

Stateless utility — no broker dependency, importable by any service.

```js
/**
 * Normalise a human-readable period string to an ISO date string
 * representing the start of that period.
 * Returns null if the format is not recognised.
 *
 * @param {string} value  e.g. 'Feb 2026', '2026-Q2', '2026-03-15'
 * @returns {string|null} ISO date string or null
 */
function normalisePeriod(value) { ... }

/**
 * Detect whether a column in a set of sample rows contains
 * period-format values (not pure ISO timestamps).
 * Returns true if > 50% of non-empty values match period patterns.
 *
 * @param {Array<object>} rows
 * @param {string} columnName
 * @returns {boolean}
 */
function isPeriodColumn(rows, columnName) { ... }

module.exports = { normalisePeriod, isPeriodColumn };
```

**Supported input patterns:**

```
/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i
/^\d{4}-Q[1-4]$/
/^\d{4}-\d{2}$/           (YYYY-MM → first day of month)
/^\d{4}-\d{2}-\d{2}$/    (already ISO → pass through)
```

### 4.3 Integration points

**`in-memory-join.meteringSpotCost`** — before joining rows, detect period
columns via `isPeriodColumn()` and normalise values via `normalisePeriod()`
so the join key is always a comparable ISO date string.

**`agent.service` — `timeseries_cost_enrichment` intent class** — when
building the plan, check `semanticHints.criticalFieldMappings.timeReference`
and apply `isPeriodColumn` to decide whether normalisation is needed.
Pass `{ normalisePeriod: true }` in the plan params so the join service
knows to apply the normaliser.

**`datasource-classifier`** — when inferring `criticalFieldStatus` for the
`timeReference` role, mark period-format columns as `resolved: true` with
`meta: { periodFormat: true }` so downstream consumers know normalisation
is required.

### 4.4 Tests

| File | New coverage |
|------|-------------|
| `tests/period-normaliser.test.js` | Unit tests for all supported patterns including edge cases (leap years, Q boundaries, already-ISO passthrough, null for unknown formats) |
| `tests/in-memory-join.service.test.js` | Regression: procurement fixture with mixed Lieferperiode formats produces valid cost enrichment result |
| `tests/agent.service.test.js` | Regression: `timeseries_cost_enrichment` plan includes `normalisePeriod: true` when timeReference column is period-format |

---

## 5. Feature 3 — Hybrid Routing: Inhouse × External

**Closes known limitation:** *"EWK-Benchmark not fetched in hybrid
grid-assets queries when `inhouse_aggregate` intent is selected"*

### 5.1 Problem

When a query combines an inhouse asset inventory with an external EWK
benchmark, the planner currently routes to pure `inhouse_aggregate`
because the `grid-assets` domain has no hybrid intent class defined.

### 5.2 New intent class: `inhouse_benchmark_compare`

Added to `agent.service` alongside the existing intent classes.

**Trigger conditions** (all must be true):
- Inhouse source domain is `grid-assets` or `metering-point-master`
- Query contains benchmark/comparison signals:
  keywords: `vergleich`, `benchmark`, `durchschnitt`, `bundesweit`,
  `ranking`, `index`, `ewk`, `bnetzagentur`, `wie stehen wir`
- At least one external Cernion tool is available that matches the domain:
  - `grid-assets` → `Cernion:ewk_benchmark_vnb`
  - `metering-point-master` → `Cernion:ewk_digitalisierungsindex`

**Plan structure:**

```js
{
  intentClass: 'inhouse_benchmark_compare',
  steps: [
    {
      action: 'datasource-cache.query',
      params: { sourceId, limit: 500 },
      resultKey: 'inhouseRows'
    },
    {
      action: externalTool,   // e.g. 'Cernion:ewk_benchmark_vnb'
      params: { vnb: resolvedVnbId },
      resultKey: 'benchmarkData'
    },
    {
      action: 'in-memory-join.benchmarkCompare',
      params: {
        inhouseRows: '{{inhouseRows}}',
        benchmarkData: '{{benchmarkData}}',
        domain: sourceDomain,
        aggregationField: resolvedCapacityField
      }
    }
  ]
}
```

### 5.3 New action: `in-memory-join.benchmarkCompare`

```js
// Input
{
  inhouseRows: Array,        // rows from datasource-cache
  benchmarkData: Object,     // response from external Cernion tool
  domain: String,            // 'grid-assets' | 'metering-point-master'
  aggregationField: String   // e.g. 'Leistung_kWp', 'Jahresverbrauch_kWh'
}

// Output
{
  inhouseSummary: {
    total: Number,
    count: Number,
    average: Number,
    unit: String
  },
  benchmarkSummary: {
    vnbValue: Number,
    medianValue: Number,
    ranking: String,   // e.g. 'above median', 'below median'
    source: String
  },
  delta: Number,
  deltaPercent: Number,
  narrative: String   // human-readable 1-sentence summary
}
```

### 5.4 Tests

| File | New coverage |
|------|-------------|
| `tests/agent.service.test.js` | `inhouse_benchmark_compare` intent triggered for PV-list × EWK-benchmark query |
| `tests/in-memory-join.service.test.js` | `benchmarkCompare` produces correct delta and narrative for mock inhouse + benchmark data |

---

## 6. Feature 4 — VNB Identity Resolution

### 6.1 Problem

When a query requires an external tool that needs the VNB identifier
(e.g. `Cernion:ewk_benchmark_vnb`, `Cernion:ewk_digitalisierungsindex`),
the agent currently asks the user: *"Required input missing: Name des
Verteilnetzbetreibers (VNB)"* — even though the system may already know
the operator identity.

### 6.2 Resolution chain

The agent must attempt to resolve the VNB identity automatically via the
following chain before prompting the user:

**Step 1 — Environment variable**
```
process.env.CERNION_VNB_ID     // MaStR-ID, e.g. SNB935578300972
process.env.CERNION_VNB_NAME   // Human-readable name
process.env.CERNION_VNB_BDEW   // BDEW code, e.g. 9904350000002
```

**Step 2 — Registered datasource metadata**
Check all registered datasources for `semanticHints` containing
MaStR-like identifiers or `Anschlussnetzbetreiber` field values.
Use the most recently confirmed datasource.

**Step 3 — `.env` / system config file**
Read `VNB_ID`, `VNB_NAME`, `VNB_BDEW` from the active environment.

**Step 4 — User prompt (fallback only)**
If none of the above resolves, prompt the user as before.

### 6.3 New helper: `src/vnb-identity.js`

```js
/**
 * Resolve VNB identity from available sources.
 * Returns { mastrId, name, bdewCode } or null if unresolvable.
 */
async function resolveVnbIdentity(broker) { ... }
```

Called by `agent.service` in any planning step that requires VNB context.

### 6.4 Configuration

Add to `.env.example`:

```
# VNB Identity (optional — used for automatic EWK/benchmark lookups)
# If set, the agent will use these values without prompting the user.
CERNION_VNB_MASTR_ID=
CERNION_VNB_NAME=
CERNION_VNB_BDEW=
```

### 6.5 Tests

| File | New coverage |
|------|-------------|
| `tests/vnb-identity.test.js` | Resolution from env vars, from datasource metadata, null when neither available |
| `tests/agent.service.test.js` | EWK tool call uses resolved VNB ID without user prompt when env var is set |

---

## 7. Feature 5 — Filesystem Watcher for `./uploads/`

**Deferred from v0.9.3** (no clear spec at the time — now specified).

### 7.1 Behaviour

When a file in `./uploads/` is replaced or modified, any datasource
registered with a connector pointing to that file must have its cache
automatically invalidated and refreshed.

### 7.2 New service: `datasource-watcher.service.js`

Moleculer service using Node.js `fs.watch` (no additional dependencies).

```js
module.exports = {
  name: 'datasource-watcher',

  settings: {
    watchDir: process.env.UPLOADS_DIR || './uploads',
    debounceMs: 2000,   // avoid multiple events for single save operation
  },

  dependencies: ['datasource-registry', 'datasource-cache'],

  async started() {
    // scan registry for all CSV/XLSX connectors pointing to watchDir
    // build map: filePath → [sourceId, ...]
    // start fs.watch on watchDir
  },

  methods: {
    async onFileChange(filename) {
      // debounce
      // find sourceIds mapped to this filename
      // for each: call datasource-cache.refresh({ sourceId })
      // emit datasource.file.refreshed { sourceId, filename }
      // log result
    }
  }
};
```

**Key constraints:**
- Stateless between broker restarts — rebuilds the filePath→sourceId map
  on `started()` by querying `datasource-registry.list`.
- Debounce of 2000ms prevents multiple refresh calls for a single
  file-save operation (editors often write in multiple steps).
- Only watches files in `watchDir` — no recursive watching of subdirectories.
- Does not trigger re-inference or re-classification — only cache refresh.
  If the file structure changes significantly, the user must manually
  re-run inference.
- Emits `datasource.file.refreshed` so the UI can show a toast notification.

### 7.3 UI integration

The datasource list in `src/app.html` should subscribe to
`datasource.file.refreshed` events (via a polling endpoint or SSE) and
update the cache badge to `fresh` with a toast:
*"✅ [Source name] — automatically refreshed (file changed)"*

### 7.4 New REST endpoint

`GET /api/datasource-watcher/status` — returns the current watcher state:

```json
{
  "watching": true,
  "watchDir": "./uploads",
  "trackedFiles": 4,
  "mappings": [
    { "filename": "beschaffungsportfolio.csv", "sourceIds": ["uuid-1"] }
  ]
}
```

### 7.5 Tests

| File | New coverage |
|------|-------------|
| `tests/datasource-watcher.service.test.js` | File change triggers `datasource-cache.refresh` for mapped source; debounce prevents double-refresh; unmapped file change is ignored |

---

## 8. Feature 6 — LLM-Assisted Classifier Fallback

**Deferred from v0.9.3** (marked as v0.9.4 candidate in the original spec).

### 8.1 Trigger condition

The LLM fallback is invoked only when:
- Heuristic classifier returns `confidence < 0.35` (i.e. `domainId: 'unknown'`)
- AND `settings.llmFallbackEnabled` is `true` (default: `false`)
- AND the Cernion MCP server is reachable

This keeps the classifier deterministic and testable by default.
LLM fallback is an opt-in enhancement.

### 8.2 Behaviour

When triggered, the classifier calls the Cernion agent with a structured
prompt:

```
You are a data classification assistant for German energy utilities.
Given the following column names and sample values from an uploaded CSV,
identify the most likely semantic domain from this list:
[list of domain IDs and descriptions from semantic-domains.js]

Column names: [...]
Sample values (3 rows): [...]
Filename: [...]
Description: [...]

Respond with JSON only:
{ "domainId": "...", "confidence": 0.0-1.0, "reasoning": "..." }
```

The LLM response is merged with the heuristic result:
- If LLM confidence ≥ 0.65: use LLM domain, set `llmAssisted: true`
- If LLM confidence < 0.65: keep `domainId: 'unknown'`, set
  `requiresUserInput: true`

### 8.3 Configuration

```
# .env.example
CLASSIFIER_LLM_FALLBACK_ENABLED=false
```

```js
// datasource-classifier.service.js settings
settings: {
  sampleSize: 50,
  confidenceThreshold: 0.80,
  unknownThreshold: 0.35,
  llmFallbackEnabled: process.env.CLASSIFIER_LLM_FALLBACK_ENABLED === 'true',
}
```

### 8.4 Classification result additions

```js
{
  domainId: String,
  confidence: Number,
  llmAssisted: Boolean,      // new: true if LLM fallback was used
  llmReasoning: String,      // new: LLM explanation (for UI display)
  requiresUserInput: Boolean
}
```

### 8.5 UI

When `llmAssisted: true`, the onboarding banner shows a secondary label:
*"🤖 AI-assisted classification"* alongside the domain suggestion.

### 8.6 Tests

| File | New coverage |
|------|-------------|
| `tests/datasource-classifier.service.test.js` | LLM fallback not called when confidence ≥ 0.35 (default off); LLM result used when fallback enabled and heuristic returns unknown; LLM confidence < 0.65 still results in requiresUserInput: true |

---

## 9. Acceptance Criteria

- [ ] Repo-wide cleanup commit lands first, all 941+ tests still pass
- [ ] `period-normaliser.js` handles all 8 input patterns with unit tests
- [ ] Procurement × Spotpreis query (previously failing) now returns a result
- [ ] PV-Anlagenliste × EWK-Benchmark query scores Routing ≥ 2, Usefulness ≥ 2
- [ ] iMSys × EWK query no longer asks for VNB name when env var is set
- [ ] File replacement in `./uploads/` triggers cache refresh within 3 seconds
- [ ] LLM fallback disabled by default, opt-in via env var
- [ ] All new REST endpoints covered by OpenAPI annotations (audit gate: 0 issues)
- [ ] Full test suite passes (target: 980+ tests across 42+ suites)
- [ ] `npm run release:check` passes

---

## 10. Out of Scope for v0.9.4

The following are explicitly deferred to v0.10:

- **Process Engine / embedded Node-RED** — event-driven workflow automation
  with chained agent queries, scheduled execution, and output routing
  (Email, SharePoint, Webhook). This is a Major feature requiring its own
  spec and a separate planning session.
- **Multi-domain sources** — a single file spanning multiple semantic domains.
- **Real-time streaming** — SSE or WebSocket push for watcher events to UI
  (polling is sufficient for v0.9.4).
- **Custom domain definitions** — user-defined semantic domains beyond the
  built-in registry.
