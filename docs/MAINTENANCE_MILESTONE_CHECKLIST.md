# Maintenance Milestone Checklist (v0.8.31+)

This checklist defines the hard gates before starting the next feature milestone.

## 1) Tests & Coverage

- [ ] `npm run test:unit:ci` passes (coverage gates enforced)
- [ ] `npm run test:integration -- --listTests` resolves integration tests correctly
- [ ] `npm run test:e2e` is documented and runnable in token-enabled environments
- [ ] New/changed modules have unit tests

## 2) Documentation Quality

- [ ] README scripts and configuration are up-to-date
- [ ] QUICKSTART commands are valid
- [ ] Auth docs align with current token behavior (Bearer + query token allowed)
- [ ] CHANGELOG captures all material maintenance changes

## 3) Open Source Hygiene

- [ ] LICENSE / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY are present and current
- [ ] CI workflows are present for quality and security
- [ ] Dependabot is enabled

## 4) Security

- [ ] `npm run audit:security` executed (advisory report)
- [ ] PR critical gate passes (`npm audit --audit-level=critical`)
- [ ] CodeQL workflow active
- [ ] Error payloads redact secrets/tokens

## Fast gate command

- [ ] `npm run release:check` passes

## 5) Fail-safe Logging & Operations

- [ ] Async polling logs are debug-gated and redacted
- [ ] API error responses sanitize token-bearing messages
- [ ] Startup URLs and docs paths are consistent

## 6) Operational Best Practices

- [ ] Reliability controls configurable via env (`retry`, `circuit breaker`, `bulkhead`)
- [ ] Metrics/tracing toggles documented
- [ ] CI uses stable unit-test execution mode

## 7) Resource Efficiency

- [ ] Polling avoids verbose production logging
- [ ] Polling and timeouts remain bounded by config
- [ ] No known unbounded result-storage paths for sessions/reports

## Release N+1 follow-up targets

- Increase Jest thresholds from 55/70/70/70 to 60/75/75/75.
- Reduce remaining lint/prettier debt and move to full lint CI gate.
- Expand e2e smoke coverage for key REST routes.
