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
- `cernion-stadtwerk-mauer-e2e-smoke.yaml`

The examples call only `/api/operations-runbook/**`. Do not encode Cernion domain rules in Rundeck jobs.

## E2E Example: Stadtwerk Mauer

The first domain E2E example for this integration should be the Stadtwerk Mauer sandbox demo:

- use case: `docs/use-cases/stadtwerk-mauer-e2e-process-demo.md`
- sandbox tenant: `stadtwerk-mauer`
- demo path: `pv_registration_electrician_missing_nap`
- underlying capabilities:
  - `stadtwerk_mauer_sandbox_runtime`
  - `stadtwerk_mauer_external_interface_stubs`
  - `stadtwerk_mauer_e2e_process_demo`

Rundeck must still call only curated `/api/operations-runbook/**` endpoints. The Stadtwerk Mauer job should therefore be implemented as an operations-runbook wrapper that performs:

1. read initial demo status,
2. reset the sandbox tenant,
3. run the PV registration demo,
4. read and summarize trace, dossier growth, stub transcript, missing evidence and no-call guards,
5. reset the sandbox tenant again,
6. read final status and prove residue-free cleanup.

This example is intentionally more than a local smoke test. It is the transfer pattern for a future real Stadtwerk rollout: Rundeck owns the human-operated runbook surface, while Cernion owns tenant boundaries, source-action guards, idempotency, audit traces, domain rules and the mapping from sandbox stubs to real interfaces.

Before moving from Stadtwerk Mauer to a real Stadtwerk, the operations-runbook wrapper must replace sandbox-only assumptions with explicit tenant provisioning, production-safe scopes, real connector readiness checks, human approval gates for consequential actions, and a documented reset/delete policy that cannot affect production tenant state.
