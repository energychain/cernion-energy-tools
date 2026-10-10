# Shepherd Refactoring Backlog

Generated: 2026-10-10T01:20:18.598Z

## Safe first work packages

1. Capability catalog completeness audit
   - Compare `services/*.service.js`, `operation-capability-index.json`, OpenAPI export, and OpenWebUI/ChatGPT adapter exposure.
   - Output: missing capability mappings and stale capability names.

2. Agentic domain model extraction
   - Introduce or document stable primitives: Case, Actor/Human, Capability, Evidence Requirement, Process State, Tool Contract.
   - Output: architecture canon update, no runtime change first.

3. Naming convergence pass
   - Review duplicate/overlapping slugs listed below.
   - Output: ADR naming rule and small rename/refactor proposals only after GitNexus impact analysis.

4. Service-test map hardening
   - Services without obvious direct tests: 26.
   - Output: decide whether each is covered indirectly, needs a smoke test, or should be marked experimental.

## Duplicate/overlap candidates

- `services/agent.service.js`, `services/personal-agent.service.js`
- `services/eeg-clawback-calculator.service.js`, `src/eeg-clawback-calculator.js`
- `services/evidence-router.service.js`, `src/evidence-router.js`
- `services/tabular-intelligence.service.js`, `src/tabular-intelligence.js`
- `src/job-store/driver.js`, `src/rate-quota/driver.js`
- `src/job-store/factory.js`, `src/rate-quota/factory.js`
- `src/job-store/file-driver.js`, `src/rate-quota/file-driver.js`
- `src/job-store/redis-compat-driver.js`, `src/rate-quota/redis-compat-driver.js`

## Services needing coverage review

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
