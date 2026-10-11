# Capability / OpenAPI / Service Alignment

Generated: 2026-10-10T22:16:17.086Z
Source run: 20261010T192759Z
Issue: #802 Capability-Catalog gegen Services, OpenAPI und operation-capability-index abgleichen

This report is a deterministic Shepherd alignment pass. It does not claim semantic completeness; it identifies where Services, OpenAPI operations, capability-index entries and agentic routing artifacts visibly line up or diverge.

## Summary

- Services/signals scanned: 157
- OpenAPI operations scanned: 1246
- operation-capability-index entries scanned: 6
- Capability/routing files from scan: 0
- Services without obvious OpenAPI/capability-index match: 12

## Alignment matrix

| Service | OpenAPI hits | Capability-index hits | Status |
| --- | ---: | ---: | --- |
| `Erneuerbare-Energien-Gesetz (EEG)` | 0 | 0 | needs-review |
| `Stadtwerk Mauer` | 0 | 1 | mapped-or-referenced |
| `X-Tenant-Id` | 0 | 1 | mapped-or-referenced |
| `activation` | 0 | 0 | needs-review |
| `agent-manifest` | 6 | 1 | mapped-or-referenced |
| `agent-receipts` | 19 | 1 | mapped-or-referenced |
| `agent-sidecar` | 5 | 1 | mapped-or-referenced |
| `agents` | 0 | 1 | mapped-or-referenced |
| `agnes-bottleneck` | 3 | 1 | mapped-or-referenced |
| `altdaten-assessment` | 3 | 1 | mapped-or-referenced |
| `api` | 1243 | 3 | mapped-or-referenced |
| `auth` | 6 | 1 | mapped-or-referenced |
| `automatisierungsradar` | 3 | 1 | mapped-or-referenced |
| `backup-orchestrator` | 10 | 1 | mapped-or-referenced |
| `battery-redispatch-special-gate` | 4 | 1 | mapped-or-referenced |
| `bess-screening` | 3 | 1 | mapped-or-referenced |
| `bilanzkreis` | 10 | 1 | mapped-or-referenced |
| `blindflug-radar` | 4 | 1 | mapped-or-referenced |
| `blueprint-management` | 8 | 1 | mapped-or-referenced |
| `capex-prioritization` | 3 | 1 | mapped-or-referenced |
| `churn-prediction-${Date.now()}.csv` | 0 | 0 | needs-review |
| `clarification-policy` | 6 | 1 | mapped-or-referenced |
| `company` | 12 | 1 | mapped-or-referenced |
| `connection-rejection-evidence` | 4 | 1 | mapped-or-referenced |
| `cookbook` | 7 | 1 | mapped-or-referenced |
| `copilot-process` | 17 | 1 | mapped-or-referenced |
| `customer-service` | 3 | 1 | mapped-or-referenced |
| `cya` | 20 | 1 | mapped-or-referenced |
| `dashboard-api` | 254 | 1 | mapped-or-referenced |
| `datapoint` | 40 | 1 | mapped-or-referenced |
| `dataset` | 2 | 1 | mapped-or-referenced |
| `datasource-cache` | 5 | 1 | mapped-or-referenced |
| `datasource-classifier` | 1 | 1 | mapped-or-referenced |
| `datasource-connector` | 2 | 1 | mapped-or-referenced |
| `datasource-discovery` | 3 | 1 | mapped-or-referenced |
| `datasource-registry` | 13 | 1 | mapped-or-referenced |
| `datasource-watcher` | 1 | 1 | mapped-or-referenced |
| `decision-frame` | 7 | 1 | mapped-or-referenced |
| `direktvermarkterName` | 0 | 1 | mapped-or-referenced |
| `domain-router` | 7 | 1 | mapped-or-referenced |
| `domain-routes` | 10 | 1 | mapped-or-referenced |
| `dossier-hydration` | 10 | 1 | mapped-or-referenced |
| `e2e-connection-check` | 4 | 1 | mapped-or-referenced |
| `edm` | 42 | 2 | mapped-or-referenced |
| `edm-messkonzept` | 12 | 2 | mapped-or-referenced |
| `edm-validation` | 8 | 1 | mapped-or-referenced |
| `edm-virtual` | 4 | 1 | mapped-or-referenced |
| `eeg-clawback-calculator` | 12 | 1 | mapped-or-referenced |
| `eic-codes` | 5 | 1 | mapped-or-referenced |
| `energy-market` | 5 | 1 | mapped-or-referenced |
| `energy-sharing` | 24 | 1 | mapped-or-referenced |
| `energy-sharing-allocation` | 7 | 1 | mapped-or-referenced |
| `energy-sharing-community` | 8 | 1 | mapped-or-referenced |
| `entsoe` | 10 | 1 | mapped-or-referenced |
| `eog-calculator` | 9 | 1 | mapped-or-referenced |
| `evidence-requirement` | 0 | 0 | needs-review |
| `evidence-revalidation` | 0 | 0 | needs-review |
| `evidence-router` | 1 | 1 | mapped-or-referenced |
| `ewk-monitoring` | 4 | 1 | mapped-or-referenced |
| `file-ingest-monitor` | 22 | 1 | mapped-or-referenced |
| `finance-agent` | 8 | 1 | mapped-or-referenced |
| `flex` | 17 | 1 | mapped-or-referenced |
| `flexibilitaetskosten-raster` | 3 | 1 | mapped-or-referenced |
| `flexibility-conductor-role-model` | 4 | 1 | mapped-or-referenced |
| `fnav-commercial-hedging` | 4 | 1 | mapped-or-referenced |
| `forecast` | 47 | 1 | mapped-or-referenced |
| `forecast-engine` | 16 | 1 | mapped-or-referenced |
| `forecast-sandbox` | 24 | 1 | mapped-or-referenced |
| `function-coverage` | 0 | 0 | needs-review |
| `gas-capacity-order-revision-gate` | 4 | 1 | mapped-or-referenced |
| `gas-storage` | 7 | 1 | mapped-or-referenced |
| `gasnetz-waermeplanung` | 3 | 1 | mapped-or-referenced |
| `german-grid` | 4 | 1 | mapped-or-referenced |
| `ghost-asset-alert` | 4 | 1 | mapped-or-referenced |
| `governance` | 55 | 1 | mapped-or-referenced |
| `governance-cards` | 18 | 1 | mapped-or-referenced |
| `grid-connection` | 9 | 1 | mapped-or-referenced |
| `grid-operations` | 15 | 1 | mapped-or-referenced |
| `hitl` | 14 | 1 | mapped-or-referenced |
| `in-memory-join` | 5 | 1 | mapped-or-referenced |
| `interface-placeholder` | 5 | 1 | mapped-or-referenced |
| `investment-maturity-off-balance-gate` | 4 | 1 | mapped-or-referenced |
| `investment-planning` | 3 | 1 | mapped-or-referenced |
| `job-status` | 15 | 1 | mapped-or-referenced |
| `journal` | 0 | 0 | needs-review |
| `knowledge-continuity-governance-gate` | 5 | 1 | mapped-or-referenced |
| `knowledge-rag` | 13 | 1 | mapped-or-referenced |
| `mastr-monitor` | 12 | 1 | mapped-or-referenced |
| `mastr-quality` | 5 | 1 | mapped-or-referenced |
| `mcp-server` | 9 | 1 | mapped-or-referenced |
| `mqtt-broker` | 0 | 0 | needs-review |
| `mqtt-edm-ingest` | 0 | 0 | needs-review |
| `mscons-import` | 6 | 1 | mapped-or-referenced |
| `municipality` | 2 | 1 | mapped-or-referenced |
| `nbp-monitor` | 5 | 1 | mapped-or-referenced |
| `netzkoppelvertrag-workflow` | 4 | 1 | mapped-or-referenced |
| `nkp-reporting` | 3 | 1 | mapped-or-referenced |
| `notices` | 2 | 1 | mapped-or-referenced |
| `notification` | 0 | 1 | mapped-or-referenced |
| `nova` | 19 | 1 | mapped-or-referenced |
| `object-store` | 8 | 1 | mapped-or-referenced |
| `observability` | 6 | 1 | mapped-or-referenced |
| `oep` | 7 | 1 | mapped-or-referenced |
| `openai-compatible` | 0 | 1 | mapped-or-referenced |
| `operations-runbook` | 9 | 1 | mapped-or-referenced |
| `osm-geo` | 5 | 1 | mapped-or-referenced |
| `persona-inbox` | 0 | 0 | needs-review |
| `personal-agent` | 7 | 1 | mapped-or-referenced |
| `personal-agent-work-out-loud-listener` | 0 | 0 | needs-review |
| `presentation` | 3 | 1 | mapped-or-referenced |
| `query` | 13 | 1 | mapped-or-referenced |
| `rcs-rule-catalog` | 4 | 1 | mapped-or-referenced |
| `rcs-simulation-run` | 18 | 1 | mapped-or-referenced |
| `re4de-variable-grid-fee` | 3 | 1 | mapped-or-referenced |
| `redispatch-asset-register` | 7 | 1 | mapped-or-referenced |
| `redispatch-data-governance` | 7 | 1 | mapped-or-referenced |
| `redispatch-expost` | 6 | 1 | mapped-or-referenced |
| `redispatch-readiness-gate` | 4 | 1 | mapped-or-referenced |
| `redispatch-settlement-sandbox` | 5 | 1 | mapped-or-referenced |
| `redispatch-special-case-gate` | 3 | 1 | mapped-or-referenced |
| `regulatorische-entgeltlogik` | 4 | 1 | mapped-or-referenced |
| `reinvest-signal` | 3 | 1 | mapped-or-referenced |
| `reporting-governance` | 3 | 1 | mapped-or-referenced |
| `residual-load` | 2 | 1 | mapped-or-referenced |
| `settlement` | 25 | 1 | mapped-or-referenced |
| `shared-service-agent` | 0 | 0 | needs-review |
| `shared-service-learning` | 4 | 1 | mapped-or-referenced |
| `signals` | 0 | 1 | mapped-or-referenced |
| `slp` | 7 | 1 | mapped-or-referenced |
| `stadtwerk-mauer-e2e-process-demo` | 6 | 1 | mapped-or-referenced |
| `stadtwerk-mauer-external-interface-stubs` | 6 | 1 | mapped-or-referenced |
| `stadtwerk-mauer-sandbox-runtime` | 7 | 1 | mapped-or-referenced |
| `startDate` | 0 | 1 | mapped-or-referenced |
| `system` | 7 | 1 | mapped-or-referenced |
| `tabular` | 6 | 1 | mapped-or-referenced |
| `tenant-quota` | 6 | 1 | mapped-or-referenced |
| `tenantId` | 10 | 2 | mapped-or-referenced |
| `tenantId` | 10 | 2 | mapped-or-referenced |
| `tenantId` | 10 | 2 | mapped-or-referenced |
| `tenantId` | 10 | 2 | mapped-or-referenced |
| `ticket` | 8 | 1 | mapped-or-referenced |
| `token-manager` | 5 | 1 | mapped-or-referenced |
| `utility-report` | 7 | 1 | mapped-or-referenced |
| `vdmi` | 47 | 2 | mapped-or-referenced |
| `vdmi-governance-templates` | 4 | 1 | mapped-or-referenced |
| `vdmi-portfolio-gatekeeping` | 3 | 1 | mapped-or-referenced |
| `vnb-100-tage-assessment` | 3 | 1 | mapped-or-referenced |
| `vnb-monitor` | 8 | 1 | mapped-or-referenced |
| `vnbName` | 0 | 1 | mapped-or-referenced |
| `wake` | 2 | 1 | mapped-or-referenced |
| `web-search` | 1 | 1 | mapped-or-referenced |
| `webhooks` | 8 | 1 | mapped-or-referenced |
| `willi-federated` | 2 | 1 | mapped-or-referenced |
| `willi-mako` | 9 | 1 | mapped-or-referenced |
| `willi-regulatorik` | 2 | 1 | mapped-or-referenced |
| `workbench` | 61 | 1 | mapped-or-referenced |
| `znp` | 26 | 1 | mapped-or-referenced |

## Needs review

- `Erneuerbare-Energien-Gesetz (EEG)` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `activation` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `churn-prediction-${Date.now()}.csv` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `evidence-requirement` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `evidence-revalidation` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `function-coverage` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `journal` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `mqtt-broker` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `mqtt-edm-ingest` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `persona-inbox` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `personal-agent-work-out-loud-listener` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic
- `shared-service-agent` — no obvious OpenAPI operation or operation-capability-index match by basename heuristic

## Follow-up policy

- A missing heuristic match is not automatically a bug; some services are internal or orchestrating libraries.
- Fachlich visible services should either map to a Capability, an OpenAPI/tool exposure, or an explicit internal-only rationale.
- Future Shepherd handlers should turn repeated needs-review entries into targeted capability-catalog or OpenAPI-index tickets.
