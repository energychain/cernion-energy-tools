# CET Architecture Shepherd Scan

Generated: 2026-10-10T03:02:10.527Z

## Repository snapshot

- Package: cernion-energy-tools 0.99.21
- Git HEAD marker: ref: refs/heads/release/v0.99.19
- Files scanned: 1296
- Services: 144
- src/*.js files: 211
- Tests: 330
- Integrations files: 26
- Markdown/docs files: 383

## Existing validation summary

```
build: ok
lint: ok
test-unit-ci: skipped (set SHEPHERD_FULL=1)
audit-openapi: skipped (set SHEPHERD_FULL=1)
check-llm: skipped (set SHEPHERD_FULL=1)
gitnexus-analyze: skipped (set SHEPHERD_FULL=1)
```

## Top-level shape

- `tests`: 373 files
- `docs`: 298 files
- `src`: 258 files
- `services`: 180 files
- `agentic-architecture`: 34 files
- `.claude`: 26 files
- `integrations`: 26 files
- `scripts`: 23 files
- `.github`: 9 files
- `feedback`: 8 files
- `.vscode`: 5 files
- `examples`: 3 files
- `tools`: 3 files
- `fixtures_parallel`: 2 files
- `fixtures_real`: 2 files
- `reports`: 2 files
- `.copilotignore`: 1 files
- `.editorconfig`: 1 files
- `.env.example`: 1 files
- `.eslintrc.hygiene.json`: 1 files

## Agentic surface

- Agent/capability/sidecar related files: 211
- Routing/capability/broker/manifest files: 48
- Evidence/HITL/receipt/dossier files: 67
- OpenWebUI/ChatGPT adapter files: 25

Primary agentic files:

- `agentic-architecture/AGENTIC_CORE_DIRECTIVE.md`
- `agentic-architecture/ARCHITECTURE_CANON.md`
- `agentic-architecture/DOMAIN_ONTOLOGY.md`
- `agentic-architecture/domain/AMBIGUOUS_TERMS.md`
- `agentic-architecture/domain/DOMAIN_OBJECTS.md`
- `agentic-architecture/domain/domain-abstraction-report.md`
- `agentic-architecture/domain/ENERGY_DOMAIN_CANON.md`
- `agentic-architecture/domain/EVIDENCE_VS_PRACTICE.md`
- `agentic-architecture/domain/HUMAN_DECISION_POINTS.md`
- `agentic-architecture/domain/NATURAL_WORKFLOWS.md`
- `agentic-architecture/domain/PROCESS_PATTERNS.md`
- `agentic-architecture/E2E_PROCESS_MAP.md`
- `agentic-architecture/NAMING_CONVENTIONS.md`
- `agentic-architecture/OPENWEBUI_AGENTIC_ROUTING.md`
- `agentic-architecture/README.md`
- `agentic-architecture/REFACTORING_BACKLOG.md`
- `agentic-architecture/reports/latest/agentic-core-findings.md`
- `agentic-architecture/reports/latest/architecture-scan.md`
- `agentic-architecture/reports/latest/canon-update-proposal.md`
- `agentic-architecture/reports/latest/domain-abstraction-summary.json`
- `agentic-architecture/reports/latest/domain-abstraction/AMBIGUOUS_TERMS.md`
- `agentic-architecture/reports/latest/domain-abstraction/DOMAIN_OBJECTS.md`
- `agentic-architecture/reports/latest/domain-abstraction/domain-abstraction-report.md`
- `agentic-architecture/reports/latest/domain-abstraction/ENERGY_DOMAIN_CANON.md`
- `agentic-architecture/reports/latest/domain-abstraction/EVIDENCE_VS_PRACTICE.md`
- `agentic-architecture/reports/latest/domain-abstraction/HUMAN_DECISION_POINTS.md`
- `agentic-architecture/reports/latest/domain-abstraction/NATURAL_WORKFLOWS.md`
- `agentic-architecture/reports/latest/domain-abstraction/PROCESS_PATTERNS.md`
- `agentic-architecture/reports/latest/openwebui-blindspots.md`
- `agentic-architecture/reports/latest/refactoring-backlog.md`
- `agentic-architecture/reports/latest/scan-complete.txt`
- `agentic-architecture/reports/latest/scan-summary.json`
- `agentic-architecture/SHEPHERD_SUMMARY.md`
- `agentic-architecture/shepherd-fingerprint.json`
- `AGENTS.md`
- `docs/agent-decision-enums.ts`
- `docs/agent-responses/alloc-list.json`
- `docs/agent-responses/alloc-list.status`
- `docs/agent-responses/es-list.json`
- `docs/agent-responses/es-list.status`

## Service inventory

- `agent-manifest` — services/agent-manifest.service.js (3 detected actions)
- `X-Tenant-Id` — services/agent-persona.service.js (9 detected actions)
- `agent-receipts` — services/agent-receipts.service.js (19 detected actions)
- `agent-sidecar` — services/agent-sidecar.service.js (2 detected actions)
- `direktvermarkterName` — services/agent.service.js (4 detected actions)
- `agnes-bottleneck` — services/agnes-bottleneck.service.js (7 detected actions)
- `altdaten-assessment` — services/altdaten-assessment.service.js (7 detected actions)
- `api` — services/api.service.js (1 detected actions)
- `vnbName` — services/assets.service.js (8 detected actions)
- `auth` — services/auth.service.js (5 detected actions)
- `automatisierungsradar` — services/automatisierungsradar.service.js (6 detected actions)
- `backup-orchestrator` — services/backup-orchestrator.service.js (4 detected actions)
- `battery-redispatch-special-gate` — services/battery-redispatch-special-gate.service.js (15 detected actions)
- `bess-screening` — services/bess-screening.service.js (10 detected actions)
- `bilanzkreis` — services/bilanzkreis.service.js (5 detected actions)
- `blindflug-radar` — services/blindflug-radar.service.js (6 detected actions)
- `blueprint-management` — services/blueprint-management.service.js (6 detected actions)
- `churn-prediction-${Date.now()}.csv` — services/business-intelligence.service.js (7 detected actions)
- `startDate` — services/capability-broker.service.js (4 detected actions)
- `capex-prioritization` — services/capex-prioritization.service.js (7 detected actions)
- `ticket` — services/chatgpt-sidecar.service.js (8 detected actions)
- `clarification-policy` — services/clarification-policy.service.js (6 detected actions)
- `Erneuerbare-Energien-Gesetz (EEG)` — services/community.service.js (6 detected actions)
- `company` — services/company.service.js (11 detected actions)
- `connection-rejection-evidence` — services/connection-rejection-evidence.service.js (9 detected actions)
- `cookbook` — services/cookbook.service.js (5 detected actions)
- `copilot-process` — services/copilot-process.service.js (3 detected actions)
- `customer-service` — services/customer-service.service.js (3 detected actions)
- `cya` — services/cya.service.js (8 detected actions)
- `dashboard-api` — services/dashboard-api.service.js (0 detected actions)
- `datapoint` — services/datapoint.service.js (10 detected actions)
- `datasource-cache` — services/datasource-cache.service.js (11 detected actions)
- `datasource-classifier` — services/datasource-classifier.service.js (8 detected actions)
- `datasource-connector` — services/datasource-connector.service.js (12 detected actions)
- `datasource-discovery` — services/datasource-discovery.service.js (3 detected actions)
- `datasource-registry` — services/datasource-registry.service.js (9 detected actions)
- `datasource-watcher` — services/datasource-watcher.service.js (2 detected actions)
- `decision-frame` — services/decision-frame.service.js (2 detected actions)
- `domain-routes` — services/domain-routes-management.service.js (5 detected actions)
- `dossier-hydration` — services/dossier-hydration-management.service.js (5 detected actions)
- `e2e-connection-check` — services/e2e-connection-check.service.js (9 detected actions)
- `edm-messkonzept` — services/edm-messkonzept.service.js (12 detected actions)
- `edm-validation` — services/edm-validation.service.js (9 detected actions)
- `edm-virtual` — services/edm-virtual.service.js (9 detected actions)
- `edm` — services/edm.service.js (11 detected actions)
- `eeg-clawback-calculator` — services/eeg-clawback-calculator.service.js (5 detected actions)
- `eic-codes` — services/eic-codes.service.js (8 detected actions)
- `energy-market` — services/energy-market.service.js (8 detected actions)
- `energy-sharing-allocation` — services/energy-sharing-allocation.service.js (13 detected actions)
- `energy-sharing-community` — services/energy-sharing-community.service.js (5 detected actions)
- `energy-sharing` — services/energy-sharing.service.js (10 detected actions)
- `entsoe` — services/entsoe.service.js (7 detected actions)
- `eog-calculator` — services/eog-calculator.service.js (7 detected actions)
- `evidence-requirement` — services/evidence-requirement.service.js (10 detected actions)
- `evidence-revalidation` — services/evidence-revalidation.service.js (9 detected actions)
- `evidence-router` — services/evidence-router.service.js (4 detected actions)
- `ewk-monitoring` — services/ewk-monitoring.service.js (5 detected actions)
- `file-ingest-monitor` — services/file-ingest-monitor.service.js (11 detected actions)
- `finance-agent` — services/finance-agent.service.js (14 detected actions)
- `flex` — services/flex.service.js (4 detected actions)
- `flexibilitaetskosten-raster` — services/flexibilitaetskosten-raster.service.js (7 detected actions)
- `flexibility-conductor-role-model` — services/flexibility-conductor-role-model.service.js (13 detected actions)
- `fnav-commercial-hedging` — services/fnav-commercial-hedging.service.js (13 detected actions)
- `forecast-engine` — services/forecast-engine.service.js (7 detected actions)
- `forecast-sandbox` — services/forecast-sandbox.service.js (12 detected actions)
- `forecast` — services/forecast.service.js (3 detected actions)
- `gas-capacity-order-revision-gate` — services/gas-capacity-order-revision-gate.service.js (18 detected actions)
- `gas-storage` — services/gas-storage.service.js (5 detected actions)
- `gasnetz-waermeplanung` — services/gasnetz-waermeplanung.service.js (8 detected actions)
- `german-grid` — services/german-grid.service.js (6 detected actions)
- `ghost-asset-alert` — services/ghost-asset-alert.service.js (6 detected actions)
- `governance` — services/governance.service.js (6 detected actions)
- `grid-connection` — services/grid-connection.service.js (18 detected actions)
- `grid-operations` — services/grid-operations.service.js (6 detected actions)
- `hitl` — services/hitl.service.js (13 detected actions)
- `in-memory-join` — services/in-memory-join.service.js (10 detected actions)
- `interface-placeholder` — services/interface-placeholder.service.js (9 detected actions)
- `investment-maturity-off-balance-gate` — services/investment-maturity-off-balance-gate.service.js (17 detected actions)
- `investment-planning` — services/investment-planning.service.js (14 detected actions)
- `job-status` — services/job-status.service.js (3 detected actions)

## Naming/shape drift signals

Potential duplicate or overlapping slugs:

- `services/agent.service.js`, `services/personal-agent.service.js`
- `services/eeg-clawback-calculator.service.js`, `src/eeg-clawback-calculator.js`
- `services/evidence-router.service.js`, `src/evidence-router.js`
- `services/tabular-intelligence.service.js`, `src/tabular-intelligence.js`
- `src/job-store/driver.js`, `src/rate-quota/driver.js`
- `src/job-store/factory.js`, `src/rate-quota/factory.js`
- `src/job-store/file-driver.js`, `src/rate-quota/file-driver.js`
- `src/job-store/redis-compat-driver.js`, `src/rate-quota/redis-compat-driver.js`

Services without obvious direct unit test by filename heuristic: 26

- `services/agnes-bottleneck.service.js`
- `services/altdaten-assessment.service.js`
- `services/automatisierungsradar.service.js`
- `services/backup-orchestrator.service.js`
- `services/bess-screening.service.js`
- `services/capex-prioritization.service.js`
- `services/connection-rejection-evidence.service.js`
- `services/e2e-connection-check.service.js`
- `services/flexibilitaetskosten-raster.service.js`
- `services/fnav-commercial-hedging.service.js`
- `services/gasnetz-waermeplanung.service.js`
- `services/ghost-asset-alert.service.js`
- `services/netzkoppelvertrag-workflow.service.js`
- `services/nkp-reporting.service.js`
- `services/rcs-rule-catalog.service.js`
- `services/regulatorische-entgeltlogik.service.js`
- `services/reinvest-signal.service.js`
- `services/reporting-governance.service.js`
- `services/tenant-quota.service.js`
- `services/vdmi-evidence.service.js`
- `services/vdmi-findings.service.js`
- `services/vdmi-governance-templates.service.js`
- `services/vdmi-human-override.service.js`
- `services/vdmi-portfolio-gatekeeping.service.js`
- `services/vdmi-spectator.service.js`
- `services/vnb-100-tage-assessment.service.js`

## First Shepherd reading

This deterministic scan does not judge business correctness. It provides a stable map for the next architecture review loop: services, agentic surface, OpenWebUI bridge visibility, evidence/HITL surface, naming overlap, and test coverage by naming heuristic.
