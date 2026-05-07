# Issue 18 — Rate Limiting + Tenant-Quota Enforcement

**Bereich:** Plattform · **Priorität:** Hoch · **Ziel-Release:** v0.48

## Problem

Das API-Gateway (`services/api.service.js`) hat heute **kein Rate-Limiting und keine Tenant-Quotas**. Nach v0.41 (Multi-Tenant) und v0.43 (LLM-Provider-Abstraktion) ist das ein direktes Geschäftsrisiko:

- Ein gieriger Tenant kann das gesamte LLM-Kostenbudget aufbrauchen.
- Ein unkontrollierter Power-Automate-Loop kann den MCP-Server (oder OEP/Overpass-Upstream) überlasten.
- DoS-Schutz fehlt.
- Asynchrone Job-Queues (`utility-report`, `mastr-quality`) sind leer-FIFO ohne Tenant-Fairness — ein Tenant kann andere blockieren.

## Vorschlag

1. **Token-Bucket pro Endpoint-Klasse** in `src/rate-limit.js`:
   - `read` (default 600 req/min/tenant)
   - `write` (default 60 req/min/tenant)
   - `compute` (LLM/Async-Job: 30 req/min/tenant)
   - Konfigurierbar pro Tenant in `tenant:{id}:rate_limits`.
2. **Distributed Counter** per PouchDB / Redis-compat (Driver-Pattern wie Job-Store).
3. **Quota-Limit** (täglich/monatlich):
   - LLM-Token-Budget pro Tenant (`llm_tokens_per_day`, `llm_tokens_per_month`)
   - Async-Jobs pro Tag (`max_async_jobs_per_day`)
   - RAG-Ingestions pro Monat (`max_rag_chunks_per_month`)
4. **Fair-Queueing** im Job-Store:
   - Tenant-Round-Robin statt FIFO.
   - Per-Tenant-Concurrency-Cap (default 3 simultane Long-Runner).
5. **Feedback-Header:**
   - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
   - `Retry-After` bei 429.
6. **Webhook-Events** `rate_limit.exceeded`, `quota.threshold.reached` (90 %), `quota.exhausted`.
7. **Admin-API:**
   - `GET /api/tenants/:id/quotas` — aktuelle Verbrauchsraten
   - `PUT /api/tenants/:id/quotas` (cross-tenant-admin)
   - `GET /api/tenants/:id/rate-limit-events`
8. **Observability-Metriken** (auf v0.44.1 aufbauend):
   - `cernion_rate_limit_hits{tenant_id, endpoint_class}` (mit Tenant-Hash, nicht roh)
   - `cernion_quota_usage{tenant_id, resource}`

## Akzeptanzkriterien

- Lasttest: Tenant A 1000 req/s → eigene 429s, Tenant B unbeeinflusst.
- LLM-Quota-Erschöpfung erzeugt strukturierten Fehler `LLM_QUOTA_EXCEEDED` und Webhook.
- Job-Fair-Queueing-Test: zwei Tenants, jeweils 10 lange Jobs → keiner wird komplett blockiert.
- ≥35 Tests inkl. Race-Conditions, Reset-Window-Edge-Cases.
- `docs/RATE_LIMIT_AND_QUOTAS.md`.

## Bezug

- v0.41 — Multi-Tenant (Voraussetzung)
- v0.43 — LLM-Provider (Token-Verbrauch zählbar)
- v0.45.1 — Job-Store-Driver (Fair-Queueing-Hook)
- Hängt an Issue 17 (Tenant-Admin-Rolle für Quota-Edits)
