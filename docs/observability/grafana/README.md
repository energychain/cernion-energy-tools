# Grafana starter dashboards

Diese Beispiele sind bewusst klein gehalten und passen zu den Metriken aus Release v0.44.1.

## Dateien

- `overview-dashboard.json` — allgemeiner Betriebsüberblick für API, Jobs, Logs und LLM/MCP-Traffic
- `utility-report-tracing-dashboard.json` — Fokus auf `utility-report.generate`, Phase-Dauern und Retry-Verhalten

## Import

1. Grafana öffnen
2. `Dashboards` → `New` → `Import`
3. Eine der JSON-Dateien aus diesem Verzeichnis auswählen
4. Eure Prometheus-Datasource zuordnen

## Erwartete Metriken

- `cernion_action_calls_total`
- `cernion_action_duration_seconds`
- `cernion_logs_total`
- `cernion_async_job_queue_depth`
- `cernion_llm_request_total`
- `cernion_llm_request_duration_seconds`
- `cernion_mcp_request_total`
- `cernion_mcp_request_duration_seconds`
- `cernion_utility_report_phase_duration_seconds`
- `cernion_utility_report_retry_attempts_total`
- `cernion_rag_query_hit_count`
- `cernion_mastr_delta_count`
- `cernion_a2a_negotiation_rounds`

## Hinweise

- Keine Tenant-IDs in Labels verwenden oder visualisieren.
- Traces werden separat über OTLP exportiert; die Dashboards hier sind rein Prometheus-basiert.
