# Cernion Rundeck Integration

This integration keeps Rundeck as the human runbook surface while Cernion owns tenant isolation, scopes, idempotency, traces, and operational policy.

Required environment:

- `CERNION_BASE_URL`, for example `https://dev.cernion.example`
- `CERNION_RUNDECK_TOKEN`, a tenant-bound token with the exact required `rundeck-*` scopes

The wrapper prints `summary.markdown` first for Rundeck logs and then the full JSON payload after `--- JSON RESULT ---`.

Initial jobs:

- `cernion-day-start-brief.yaml`
- `cernion-blocked-work.yaml`
- `cernion-revalidation-execute-dev.yaml`

The examples call only `/api/operations-runbook/**`. Do not encode Cernion domain rules in Rundeck jobs.
