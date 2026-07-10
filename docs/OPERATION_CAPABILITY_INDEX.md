# Operation Capability Index

> **Type:** Reference
> **Status:** Implemented
> **Issue:** [#416](https://github.com/energychain/cernion-energy-tools/issues/416)

## 1. What this is

The Operation Capability Index is a generated, versioned artifact
(`operation-capability-index.json`) that classifies **every** operation in
`openapi-export.json` with the metadata an agent needs to route a
natural-language request to the right endpoint: what kind of thing the
operation is, how consequential invoking it is, how an agent should approach
calling it, and what parameters it needs.

It exists so that Capability Broker, Blueprints, Receipts, Personal Agent,
OpenClaw Sidecar, Microsoft Copilot Sidecar, ChatGPT Sidecar, and future
agent integrations can route against the **full** API surface instead of
each hand-building endpoint-specific routing rules (the pattern that
produced the string of `fix(chatgpt-sidecar): ...` disambiguation commits
that preceded this issue).

Three pieces make up the feature:

| Piece | File | Role |
|---|---|---|
| Classifier | `src/operation-capability-classifier.js` | Pure function: one raw OpenAPI operation -> full metadata record. No I/O. |
| Generator | `scripts/generate-operation-capability-index.js` | Reads `openapi-export.json`, classifies every operation, writes `operation-capability-index.json`. |
| Ranker | `src/operation-capability-index.js` | Loads the artifact, ranks candidates for a natural-language query, reports missing required parameters. |

The Capability Broker is the central integration point:

- `capability-broker.recommend` includes `operationCandidates` on every
  recommendation, so Personal Agent, OpenClaw Sidecar, Copilot-side flows and
  other existing callers get the same ranked API-surface view without learning
  a new action first.
- `capability-broker.queryOperationIndex` exposes the ranker directly for
  Sidecars or diagnostics that need only operation candidates.
- ChatGPT Sidecar uses `capability-broker.queryOperationIndex` for its
  OpenAPI fallback selection and keeps its older local OpenAPI heuristic only
  as a technical fallback if the central broker action is unavailable.

## 2. The product principle: visibility, not blanket hiding

**Write-capable and process-capable operations are not hidden.** An
`admin` operation with `consequenceLevel: "high"` is still in the index,
still rankable, and still returned by the ranker - just tagged so an agent
knows to route it through `confirm` rather than `direct` execution.

Enforcement (who is *allowed* to call what) stays exactly where it already
lives: tenant scope, user role, and backend validation. This index answers
"what is this operation and how should an agent approach it," never "is the
caller allowed to invoke it." Conflating the two would mean re-implementing
authorization logic in every agent integration that consumes the index -
exactly the fragility this issue exists to remove.

## 3. Coverage guarantee

The generator's coverage check (`checkCoverage()` in
`scripts/generate-operation-capability-index.js`, enforced by
`npm run check:operation-capability-index` and by
`tests/generate-operation-capability-index.test.js`) fails the build if:

- any deduplicated OpenAPI operation is missing from the output, or
- any entry has an invalid `operationKind`, or
- any entry with `agentable: false` lacks a concrete `nonAgentableReason`.

As of this writing there are exactly **2** non-agentable operations in the
whole surface (`GET /api/openapi.json` and `GET /api/openapi-copilot.json`)
- they return the raw OpenAPI document itself, not a business operation
result, and the reason is recorded on the entry. Every other operation,
including every write and every process-start endpoint, is agentable.

Operations sharing one `operationId` across multiple paths (see
`dedupeOperations()`) are collapsed into one canonical entry with the rest
listed under `aliases` - nothing is dropped, but nothing is double-counted
either. `coverage.rawOperationCount` in the artifact is the pre-dedup count;
`coverage.operationCount` is the post-dedup entry count.

## 4. Classification model

Each entry in `operation-capability-index.json` looks like this (trimmed):

```json
{
  "operationId": "gas-storage_countryStorage",
  "method": "POST",
  "path": "/api/gas-storage/country-storage",
  "service": "gas-storage",
  "action": "gas-storage.countryStorage",
  "operationKind": "data_read",
  "consequenceLevel": "none",
  "recommendedExecutionMode": "direct",
  "agentable": true,
  "nonAgentableReason": null,
  "capabilityCandidates": ["gas_grid_transformation_asset_cockpit"],
  "domains": ["market-data"],
  "dataSources": ["AGSI"],
  "entityTypes": [],
  "requiredScopes": ["gas-storage:read"],
  "tenantScoped": true,
  "writesTo": [],
  "sideEffects": [],
  "idempotency": "idempotent",
  "rollbackHint": null,
  "parameters": { "required": [ /* ... */ ], "optional": [ /* ... */ ] },
  "rankingSignals": { "positiveKeywords": [ /* ... */ ], "negativeCues": [ /* ... */ ], "synonyms": [ /* ... */ ], "examples": [ /* ... */ ], "curated": true }
}
```

### `operationKind`

| Kind | Meaning |
|---|---|
| `data_read` | Read-only query, including POST endpoints on curated filter/query services (`READ_ONLY_QUERY_SERVICES`). |
| `dashboard_read` | Read-only, dashboard-specific aggregation. |
| `advisory_plan` | Validate/simulate/preview - computes an outcome without persisting it. |
| `draft_write` | Creates a draft/intent, not a committed change. |
| `object_store_write` | Creates, updates, or deletes a stored business object. |
| `process_start` | Starts a new multi-step process instance (e.g. VDMI matrix flow). |
| `process_step` | Advances/rolls back/approves a step in an existing process. |
| `admin` | Privileged configuration/tenant/backup operation. |
| `external_effect` | Calls out to an external system (ENTSO-E nomination, email, webhook, ERP). |
| `internal` | Not a business operation (spec/meta endpoints). |
| `unknown` | Fallback - a mutating method the other heuristics couldn't otherwise classify; treated conservatively (`confirm`). |

### `consequenceLevel` x `recommendedExecutionMode`

Defaults are keyed by `operationKind` (`KIND_DEFAULTS` in the classifier),
then adjusted per-operation - e.g. any `DELETE` is bumped to
`recommendedExecutionMode: "confirm"` regardless of its base kind, since
deletions are rarely reversible via API.

| consequenceLevel | recommendedExecutionMode | Typical kind |
|---|---|---|
| none | direct | data_read, dashboard_read |
| low | explain_only / prepare | advisory_plan, draft_write |
| medium | prepare | object_store_write, process_step |
| high | confirm | process_start, admin, external_effect |

`recommendedExecutionMode` is a **recommendation for the agent's UX flow**,
not an authorization gate - direct means "safe to just do it and report the
result," confirm means "surface the intended call and its effect to the
human before executing."

### Other fields worth knowing

- `writesTo` / `sideEffects` / `rollbackHint` - best-effort, heuristic hints
  for what a write touches and how to undo it (rollbackHint looks for a
  sibling rollback/cancel/reject operation on the same service).
- `requiredScopes` / `tenantScoped` - documents the expected authorization
  shape; this is descriptive, the backend remains the actual enforcement
  point.
- `parameters.required` / `parameters.optional` - merged from OpenAPI
  `parameters` and the JSON request body schema, each with an
  `extractionHint` (e.g. `country_code`, `date_range_start`) an agent can
  use to map free-text entities onto operation arguments.

## 5. The ranker (`src/operation-capability-index.js`)

```js
const { rankOperations, selectTopOperation } = require('./src/operation-capability-index');

const candidates = rankOperations('What is the current German gas storage fill level?', {
  limit: 3,
  extractedInputs: {}, // already-resolved param values, if any
});
// [{ operationId, action, method, path, score, confidence, operationKind,
//    consequenceLevel, recommendedExecutionMode, requiredParameters,
//    missingRequiredParameters, ... }, ...]

const best = selectTopOperation('Create a full backup snapshot', {});
// best.operationId, best.recommendedExecutionMode, best.alternatives
```

### Scoring, in short

Scoring is deterministic (no LLM call) and token-based:

1. **Positive keyword overlap** - query tokens (stemmed) that appear in the
   operation's `rankingSignals.positiveKeywords` add weight proportional to
   token length.
2. **Curated vs. generic signals** - `rankingSignals.curated: true` marks
   entries that got hand-tuned `positiveKeywords`/`negativeCues`/`synonyms`
   from `OPERATION_SIGNAL_OVERLAY` in the classifier (the small set of
   easily-confused energy-market/ENTSO-E/gas-storage operations that
   motivated this issue). Curated synonym/negative-cue matches are weighted
   much higher than the generic per-domain fallback signals every other
   operation in the same domain shares - otherwise a broad domain synonym
   like "day-ahead" (shared by *every* market-data operation) would drown
   out the specific keywords that actually disambiguate one operation from
   its neighbors.
3. **Negative cues** - matched as whole phrases against the normalized
   query (not bag-of-words), so a cue like `"single country fill level"`
   only fires when that phrase is actually present, not whenever the query
   happens to contain "fill" and "level" separately.
4. **Capability / domain bias** - pass `capability` and/or `domain` in
   `options` (as the Capability Broker or a Sidecar's own intent
   classification would already have resolved) to bias toward operations
   tagged with a matching `capabilityCandidates` entry or `domains` entry.
5. **Explicit identifier mention** - if the compacted query text contains
   the operation's compacted `action` or `operationId` verbatim (e.g. the
   user typed `gasStorageCompareCountries`), that's treated as decisive.

Results below `MIN_ROUTABLE_SCORE` are dropped entirely; results are
reported with a `confidence` of `'low' | 'medium' | 'high'` (see
`confidenceForScore`). `MIN_ROUTABLE_SCORE` is intentionally low - the same
visibility principle from Section 2 applies here: a single strong keyword hit
should still surface an operation at low confidence rather than be
silently dropped, letting the caller decide (e.g. ask a clarifying
question) rather than the ranker deciding for them.

### Missing-parameter reporting

`findMissingRequiredParameters(entry, extractedInputs)` (and the
`missingRequiredParameters` field on every ranked candidate) compares an
operation's `parameters.required` against a flat object of already-resolved
values, matching on either the parameter's `name` or its `extractionHint`
(case-insensitive). This lets a caller run its own entity extraction once
and reuse the result across every candidate operation without re-deriving
per-operation parameter names.

## 6. Regenerating the index

```bash
npm run generate:operation-capability-index   # writes operation-capability-index.json
npm run check:operation-capability-index      # CI-style drift check, no write; part of `npm run release:check`
```

Run the generator whenever `openapi-export.json` changes (i.e. after
`npm run export:openapi`) or the classifier's heuristics change. The
generator embeds a `sourceOpenApiHash` in the artifact specifically so
staleness is detectable without re-running classification.

## 7. Integrating a new agent surface

To route a natural-language request against the full operation surface:

1. Resolve `capability` / `domain` first if your integration already has
   that context (Capability Broker classification, a Sidecar's own
   intent-routing step) - pass it into `rankOperations`/`selectTopOperation`
   for a large accuracy boost.
2. Call `rankOperations(question, { capability, domain, extractedInputs })`.
3. If `missingRequiredParameters` is non-empty on the top candidate, ask a
   clarifying question for those specific parameters before calling out.
4. Branch on `recommendedExecutionMode`: `direct` -> just call it and report
   the result; `prepare`/`confirm` -> surface the intended call (operation,
   parameters, `consequenceLevel`) to the human first; `explain_only` ->
   describe what would happen without offering to execute it.
5. Actual authorization (tenant scope, role, backend validation) is
   unaffected by any of this - call through the same authenticated path you
   always would.

`services/chatgpt-sidecar.service.js`'s `selectOpenApiFallbackOperation` /
`scoreOpenApiFallbackOperation` predate this index and implement a narrower,
hand-tuned version of the same idea for a small subset of operations
(`READ_ONLY_FALLBACK_POST_SERVICES`). Migrating that call site onto
`rankOperations` is a natural follow-up once this index has run in
production long enough to validate the generic ranker's precision against
that existing bespoke logic; the `OPERATION_SIGNAL_OVERLAY` entries in the
classifier already carry over its curated cue regexes as declarative
`rankingSignals` so the migration doesn't lose that tuning.
