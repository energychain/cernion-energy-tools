# Issue 06 — Prometheus + OpenTelemetry + structured logging

**Bereich:** Operations · **Priorität:** Mittel · **Ziel-Release:** v0.44

## Problem

Die Plattform hat 56 Services, 222 Endpunkte und ~150 Cookbook-Recipes — aber kein produktives Observability-Backbone. Heute existiert nur `npm run audit:openapi` als Health-Indikator. Es fehlen Standardmetriken, Domänenmetriken, strukturierte Logs und Distributed Traces.

## Vorschlag

1. **Prometheus** über Moleculer-Metric-Reporter:
   - `GET /metrics` (full-access oder unauth wenn `METRICS_PUBLIC=true`)
   - Default-Metriken + Custom Counter/Histogram pro Domäne
   - Register-Konvention: `cernion_<service>_<action>_<metric>` mit Tenant-Label
2. **Schlüssel-Metriken:**
   - `cernion_audit_pipeline_duration_seconds{agent, step, status}`
   - `cernion_a2a_negotiation_rounds{outcome}`
   - `cernion_rag_query_hit_count{collection, hit_bucket}`
   - `cernion_mastr_delta_count{severity}`
   - `cernion_async_job_queue_depth{service}`
   - `cernion_llm_request{provider, model, status}` + Latency
3. **Structured Logging** auf `pino`, Logger-Factory in `src/logger.js`. Felder: `service`, `action`, `tenantId`, `traceId`, `sessionId`, `correlationId`.
4. **OpenTelemetry**: HTTP-Inbound + Moleculer-Action + outbound (MCP, OEP, ENTSO-E, Overpass, LLM) als Spans. OTLP-Export über `OTEL_EXPORTER_OTLP_ENDPOINT`.
5. **Dashboards**: Grafana-JSON-Beispiele in `docs/observability/grafana/`.

## Akzeptanzkriterien

- `/metrics` liefert >50 sinnvolle Custom-Metriken.
- Trace eines `utility-report.generate` zeigt alle Phase-3-Sub-Calls inkl. Retry.
- KRITIS-konform: kein PII in Labels (CI-Test).
- Kein Performance-Regress >5 % im Bench-Test.

## Bezug

- v0.37.1 Phase-3-Heartbeats + `fetchWithRetry`
- `feedback/HYGIENE_SPRINT.md` Prio 4
