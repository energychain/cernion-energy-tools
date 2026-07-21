# Tabular Intelligence Layer — MVP Architecture

Status: accepted implementation plan for issue #456  
Date: 2026-07-21

## Decision and MVP cut

Cernion Energy Tools (CET) gets a read-only `tabular` Moleculer service. The model may
translate a question into a constrained plan and may explain deterministic output; CET owns
validation, execution, numbers, evidence, and confidence.

The MVP covers:

- privacy-aware table profiles and compact LLM context;
- an explicit, versioned plan document;
- deterministic select, filter, sort, limit, aggregate/group, time-bucket, missing-interval,
  duplicate, and outlier operations;
- a simple two-source join delegated to `in-memory-join.join`;
- deterministic `ask` responses with evidence, even when no LLM is configured;
- quality reports derived from the same profile/execution primitives.

Non-goals are writes/import confirmation, arbitrary SQL or JavaScript, arbitrary broker action
execution, custom model training, GPU dependencies, persistence of raw rows or prompts, and
regulatory conclusions. The MVP does not expose `columnMap`: the existing datasource dictionary
and classifier field mappings remain authoritative and a second mapping vocabulary would be
premature.

Later phases may add persisted profile snapshots, richer multi-table DAGs, EDM-native source
adapters, XLSX-specific profiling, benchmark suites, and optional specialist Large Tabular Model
(LTM) providers. Those providers must implement the same planner interface and can never replace
the deterministic guard/executor.

## Actions and REST shape

The service exposes the following Moleculer actions and `/api/tabular/*` REST routes:

| Action | REST | Purpose |
| --- | --- | --- |
| `tabular.profile` | `POST /tabular/profile` | Compute schema/statistics/privacy-safe profile |
| `tabular.llmContext` | `POST /tabular/llm-context` | Return bounded schema/profile context, never raw tables |
| `tabular.queryPlan` | `POST /tabular/query-plan` | Validate a supplied plan or optionally ask `llm-client` for one |
| `tabular.executePlan` | `POST /tabular/execute-plan` | Deterministically execute an allow-listed plan |
| `tabular.ask` | `POST /tabular/ask` | Plan/execute and render an evidence-backed answer |
| `tabular.qualityReport` | `POST /tabular/quality-report` | Missing, duplicate, interval and outlier diagnostics |

Every action accepts source IDs, never connector credentials. Direct inline rows are deliberately
an internal/test-only service option and are not part of the public REST schema. The source read
path is `datasource-cache.query`; cache hydration still belongs to datasource registry/connector.
All broker calls propagate `ctx.meta`.

## Plan JSON schema

```json
{
  "schemaVersion": "1.0",
  "sources": [
    { "alias": "metering", "sourceId": "uuid", "privacyContext": "ai-agent" }
  ],
  "operations": [
    { "op": "filter", "field": "status", "operator": "eq", "value": "active" },
    { "op": "timeBucket", "field": "timestamp", "interval": "hour", "as": "period" },
    {
      "op": "aggregate",
      "groupBy": ["period"],
      "metrics": [{ "fn": "sum", "field": "value", "as": "energy" }]
    },
    { "op": "sort", "by": [{ "field": "period", "direction": "asc" }] },
    { "op": "limit", "count": 100 }
  ],
  "output": { "maxRows": 500 }
}
```

A join operation has `left`, `right`, `leftField`, `rightField`, `matchMode`, `joinType`, and
optional collision settings. It is allowed only before row-local operations and is delegated to
`in-memory-join.join`. Filter operators are a closed enum (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`,
`in`, `contains`, `isNull`, `notNull`). Aggregates are a closed enum (`count`, `sum`, `avg`, `min`,
`max`). Unknown keys/operations, excessive limits, multiple joins, unsafe privacy contexts, and
cross-tenant plan execution are rejected. No executable expression or arbitrary action name is
accepted.

## Profile representation

Profiles are calculated on bounded cache pages and returned, not persisted:

- source ID and row counts;
- inferred columns, dominant type, null/distinct counts and ratios;
- numeric min/max/mean where applicable;
- timestamp min/max where parseable;
- semantic classification from `datasource-classifier.classify` when available;
- dictionary privacy flags from `datasource-registry.get`, represented only as sensitivity
  metadata;
- stable hashes for the privacy-processed input and profile.

Profile samples contain only scalar statistics and redacted examples. Raw rows are never stored by
the tabular service.

## LLM-safe context and token limit

`llmContext` serializes source IDs, classifications, column names/types, null/distinct ratios,
numeric ranges, timestamp ranges, row counts, warnings, and plan schema. It excludes raw rows,
connector configuration, dictionary synthetic patterns, tenant IDs, and direct identifier values.
Flagged/private or identifier-like columns expose no examples. Other examples are scalar,
length-limited, and capped per column.

The context budget defaults to 2,000 estimated tokens (four characters per token), is capped at
8,000, and is reduced deterministically by removing examples, then low-priority columns. The
actual character/token estimate and truncation flag are returned.

## Deterministic backend and service reuse

The MVP executor is an in-process array pipeline with hard row/operation limits. It is suitable for
bounded cached datasets and easy to audit. It reuses instead of duplicates:

- `datasource-cache.query` for paged row access and `ai-agent`/`public` privacy processing;
- `datasource-registry.get` for dictionary metadata;
- `datasource-classifier.classify` and semantic domains for energy-domain classification;
- `in-memory-join.join` for two-source joins;
- EDM conventions for UTC parsing, 15-minute/hour/day/week/month bucketing, interval checks, and
  deterministic aggregation; direct EDM database access is explicitly avoided;
- `src/llm-client.js` only for optional structured planning and optional non-numeric wording.

Numeric values in answers are copied from `executePlan` result rows/summaries. An LLM response is
never accepted as numerical evidence.

## Evidence and trace

`executePlan` and `ask` return:

```json
{
  "executedPlan": {},
  "resultTable": [],
  "evidence": {
    "sourceIds": [],
    "inputRowCounts": {},
    "resultRowCount": 0,
    "evidenceRows": [],
    "calculationSummary": "",
    "operations": [],
    "hashes": { "input": "sha256:...", "plan": "sha256:...", "result": "sha256:..." },
    "traceId": "..."
  },
  "warnings": [],
  "assumptions": [],
  "confidence": "high"
}
```

Evidence rows are a small bounded excerpt of the privacy-processed result, not source-table rows.
Stable canonical JSON hashes make reruns comparable. Warning conditions lower confidence.

## Tenant and privacy boundary

- Tenant identity comes only from authenticated `ctx.meta.tenantId`; request payloads cannot
  override it.
- Plans are bound to a one-way tenant hash at validation/planning time. Execution under another
  tenant is rejected.
- All downstream calls preserve metadata. The layer never accesses cache internals or connector
  credentials.
- Public actions force `ai-agent` or stricter `public` cache privacy; `internal` is reserved for
  explicitly internal broker calls and is not accepted by public action parameters.
- Context sent to an LLM is always produced by `llmContext`, never by serializing rows.
- No profile, plan, prompt, result, or evidence is persisted by this service.

The underlying datasource registry/cache remains the system of record for source authorization.
A future registry migration may add explicit per-source tenant ownership without changing this
service contract.

## Tests and benchmarks

Unit tests use three committed fixtures:

1. 15-minute metering time series: time buckets, aggregation, missing interval, and outlier checks;
2. asset/master data: profile, privacy-safe LLM context, duplicate and missing-value checks;
3. joined asset/metering data: existing join service delegation followed by group aggregation.

Additional tests cover plan rejection, tenant binding, context budget, deterministic hashes,
numeric answer grounding, and LLM-free fallback. The release evidence is targeted Jest tests,
`npm run test:unit:ci`, `npm run audit:openapi`, and `npm run check:llm`. A later benchmark suite
should track execution latency by rows/operations, profile/context token size, planner validity
rate, deterministic replay hashes, and answer/evidence agreement on a fixed fixture corpus.

## Optional LTM providers

Specialized TableLLM/TableLlama/Table-GPT-like or local providers may later be registered behind a
planner/context-provider adapter. They receive the same bounded safe context and must emit the same
plan schema. Provider output always passes the execution guard, and only CET execution can create
numbers or evidence. No optional provider becomes a runtime dependency of the core service.
