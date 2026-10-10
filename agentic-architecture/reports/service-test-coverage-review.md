# Service Test Coverage Review

Generated: 2026-10-10T11:21:08.429Z
Source run: 20261010T072152Z

This Shepherd review classifies services that have no obvious direct unit test by filename heuristic. It is not a claim that the service is untested; it is a routing list for autonomous follow-up work.

## Summary

- Services scanned: 144
- Tests scanned: 330
- Services without obvious direct test: 26

## Classification counts

- `coverage_review_needed`: 18
- `domain_smoke_test_recommended`: 6
- `smoke_test_recommended`: 1
- `experimental_or_demo`: 1

## Services

### services/agnes-bottleneck.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether agnes-bottleneck is indirectly covered; otherwise add a minimal action-level smoke test.

### services/altdaten-assessment.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether altdaten-assessment is indirectly covered; otherwise add a minimal action-level smoke test.

### services/automatisierungsradar.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether automatisierungsradar is indirectly covered; otherwise add a minimal action-level smoke test.

### services/backup-orchestrator.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether backup-orchestrator is indirectly covered; otherwise add a minimal action-level smoke test.

### services/bess-screening.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether bess-screening is indirectly covered; otherwise add a minimal action-level smoke test.

### services/capex-prioritization.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether capex-prioritization is indirectly covered; otherwise add a minimal action-level smoke test.

### services/connection-rejection-evidence.service.js

- Classification: `domain_smoke_test_recommended`
- Recommendation: Prioritize a domain smoke test for connection-rejection-evidence; it is relevant to agentic routing or energy-domain workflows.

### services/e2e-connection-check.service.js

- Classification: `domain_smoke_test_recommended`
- Recommendation: Prioritize a domain smoke test for e2e-connection-check; it is relevant to agentic routing or energy-domain workflows.

### services/flexibilitaetskosten-raster.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether flexibilitaetskosten-raster is indirectly covered; otherwise add a minimal action-level smoke test.

### services/fnav-commercial-hedging.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether fnav-commercial-hedging is indirectly covered; otherwise add a minimal action-level smoke test.

### services/gasnetz-waermeplanung.service.js

- Classification: `domain_smoke_test_recommended`
- Recommendation: Prioritize a domain smoke test for gasnetz-waermeplanung; it is relevant to agentic routing or energy-domain workflows.

### services/ghost-asset-alert.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether ghost-asset-alert is indirectly covered; otherwise add a minimal action-level smoke test.

### services/netzkoppelvertrag-workflow.service.js

- Classification: `domain_smoke_test_recommended`
- Recommendation: Prioritize a domain smoke test for netzkoppelvertrag-workflow; it is relevant to agentic routing or energy-domain workflows.

### services/nkp-reporting.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether nkp-reporting is indirectly covered; otherwise add a minimal action-level smoke test.

### services/rcs-rule-catalog.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether rcs-rule-catalog is indirectly covered; otherwise add a minimal action-level smoke test.

### services/regulatorische-entgeltlogik.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether regulatorische-entgeltlogik is indirectly covered; otherwise add a minimal action-level smoke test.

### services/reinvest-signal.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether reinvest-signal is indirectly covered; otherwise add a minimal action-level smoke test.

### services/reporting-governance.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether reporting-governance is indirectly covered; otherwise add a minimal action-level smoke test.

### services/tenant-quota.service.js

- Classification: `smoke_test_recommended`
- Recommendation: Add a direct smoke test for tenant-quota lifecycle/actions or document existing integration coverage.

### services/vdmi-evidence.service.js

- Classification: `domain_smoke_test_recommended`
- Recommendation: Prioritize a domain smoke test for vdmi-evidence; it is relevant to agentic routing or energy-domain workflows.

### services/vdmi-findings.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether vdmi-findings is indirectly covered; otherwise add a minimal action-level smoke test.

### services/vdmi-governance-templates.service.js

- Classification: `experimental_or_demo`
- Recommendation: Keep documented; add smoke test only if exposed through OpenAPI/OpenWebUI.

### services/vdmi-human-override.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether vdmi-human-override is indirectly covered; otherwise add a minimal action-level smoke test.

### services/vdmi-portfolio-gatekeeping.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether vdmi-portfolio-gatekeeping is indirectly covered; otherwise add a minimal action-level smoke test.

### services/vdmi-spectator.service.js

- Classification: `coverage_review_needed`
- Recommendation: Review whether vdmi-spectator is indirectly covered; otherwise add a minimal action-level smoke test.

### services/vnb-100-tage-assessment.service.js

- Classification: `domain_smoke_test_recommended`
- Recommendation: Prioritize a domain smoke test for vnb-100-tage-assessment; it is relevant to agentic routing or energy-domain workflows.

## Follow-up policy

- `domain_smoke_test_recommended`: prioritize first because these services influence fachliche routing and energy-domain assistance.
- `smoke_test_recommended`: add lifecycle/action smoke tests or document existing integration coverage.
- `coverage_review_needed`: classify as indirectly covered, smoke-test needed, experimental, or legacy/refactor candidate.
- `experimental_or_demo`: avoid over-testing demos unless exposed to OpenAPI/OpenWebUI or used by production flows.
