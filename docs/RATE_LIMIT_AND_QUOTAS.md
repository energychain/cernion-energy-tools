# Rate Limits and Tenant Quotas

## Scope

Issue 18 in `v0.48.4` ships the persistence, visibility, and first enforcement wave for tenant-aware rate limiting and quotas.
Release: `v0.48.4`

Current scope:
- hard `429` blocking for gateway endpoint-class rate limits
- hard quota prechecks for LLM calls, REST async jobs, and RAG ingest chunks
- tenant-fair async dispatch with per-tenant concurrency caps in `job-store`
- webhook fan-out for rate/quota threshold and exhaustion events
- tenant quota visibility and admin mutation endpoints

## What is included in v0.48.4

### Counter / quota storage foundation

New modules:
- `src/rate-quota-store.js`
- `src/rate-quota/driver.js`
- `src/rate-quota/file-driver.js`
- `src/rate-quota/redis-compat-driver.js`
- `src/rate-quota/factory.js`

Driver behavior:
- default driver name: `redis-compat`
- current `redis-compat` mode is a compatibility shim backed by local file storage
- this mirrors the rollout strategy already used by the job-store driver layer

### Read-only tenant admin visibility

New endpoints:
- `GET /api/tenants/:id/quotas`
- `PUT /api/tenants/:id/quotas`
- `GET /api/tenants/:id/rate-limit-events`

Current access behavior:
- gateway requires `full-access`
- tenant-bound tokens can only read their own tenant
- non-tenant-scoped internal/admin contexts can read arbitrary tenants

Write behavior:
- `PUT /api/tenants/:id/quotas` accepts partial updates for:
  - `rateLimits`: `read`, `write`, `compute`
  - `quotas`: `llm_tokens_per_day`, `llm_tokens_per_month`, `max_async_jobs_per_day`, `max_rag_chunks_per_month`
- unknown keys or non-integer/negative values return `422 VALIDATION_ERROR`

### Active enforcement in v0.48.4

Gateway rate limiting:
- token bucket per endpoint class: `read`, `write`, `compute`
- headers returned on allowed requests:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`
- blocked requests return:
  - HTTP `429`
  - error type `RATE_LIMIT_EXCEEDED`
  - `Retry-After`

Quota-enforced resources:
- LLM usage:
  - preflight quota check before provider call
  - HTTP/service error type `LLM_QUOTA_EXCEEDED`
- Async jobs:
  - quota check in shared [src/job-store.js](src/job-store.js) before REST job creation
  - tenant-fair dispatcher with per-tenant cap (`JOB_STORE_MAX_CONCURRENT_PER_TENANT`, default `2`)
  - error type `ASYNC_JOB_QUOTA_EXCEEDED`
- Knowledge-RAG ingest:
  - chunk quota check before embeddings/persistence
  - error type `RAG_QUOTA_EXCEEDED`

### LLM quota accounting with interim estimator

`src/llm-client.js` now records tenant-scoped LLM usage when a tenant context is available.

Estimator behavior:
- prompt tokens: `ceil(characters / 4)`
- completion tokens: `ceil(characters / 4)`
- if future provider adapters expose actual token counts, the store can persist `hasActual=true`
- current phase stores both estimated and actual fields so enforcement can later become stricter without breaking data shape

### Metrics

New Prometheus metrics:
- `cernion_rate_limit_hits{tenant_hash,endpoint_class}`
- `cernion_quota_usage{tenant_hash,resource,window}`

Privacy rule:
- raw tenant identifiers are **not** exported as metric labels
- labels use a short SHA-256 tenant hash instead

## Default values

### Endpoint-class defaults

- `read`: `600 req/min`
- `write`: `60 req/min`
- `compute`: `30 req/min`

### Quota defaults

- `llm_tokens_per_day`: `250000`
- `llm_tokens_per_month`: `5000000`
- `max_async_jobs_per_day`: `250`
- `max_rag_chunks_per_month`: `100000`

These defaults are visible via the new quota snapshot endpoint.

## Environment variables

### Driver selection

- `RATE_QUOTA_DRIVER=redis-compat|redis|valkey|file`
- `RATE_QUOTA_DIR=./data/rate-quotas`
- `RATE_QUOTA_REDIS_URL=redis://...`
- `RATE_QUOTA_REDIS_PREFIX=cernion:rate-quotas`

### Rate defaults

- `RATE_LIMIT_READ_PER_MINUTE`
- `RATE_LIMIT_WRITE_PER_MINUTE`
- `RATE_LIMIT_COMPUTE_PER_MINUTE`

### Quota defaults

- `QUOTA_LLM_TOKENS_PER_DAY`
- `QUOTA_LLM_TOKENS_PER_MONTH`
- `QUOTA_MAX_ASYNC_JOBS_PER_DAY`
- `QUOTA_MAX_RAG_CHUNKS_PER_MONTH`

### Async dispatch defaults

- `JOB_STORE_MAX_CONCURRENT_PER_TENANT` (default: `2`)

## Event model

Currently persisted event types:
- `rate_limit.exceeded`
- `quota.threshold.reached`
- `quota.exhausted`

Current delivery behavior:
- events are stored tenant-locally
- events are exposed through `GET /api/tenants/:id/rate-limit-events`
- whitelisted webhook subscriptions can receive:
  - `rate_limit.exceeded`
  - `quota.threshold.reached`
  - `quota.exhausted`

Quota semantics:
- positive values enforce the configured limit
- `0` blocks new consumption immediately for that resource

## Tenant context propagation

The API gateway now forwards tenant context into the observability async-local state. This allows downstream modules such as `llm-client` to attribute usage to the current tenant without requiring all existing call sites to be refactored at once.

## Remaining next step (target: later patch)

Still open:
- finer-grained role model for quota writes beyond `full-access` token scope
