# Stadtwerk Mauer E2E Process Demo

`stadtwerk_mauer_e2e_process_demo` is the first reset-safe virtual utility process trace for Stadtwerk Mauer. It composes the #268 sandbox runtime and #267 external-interface stubs into one deterministic PV Anmeldung demo path.

## Scope

- Demo path: `pv_registration_electrician_missing_nap`.
- Mutating action: `stadtwerk-mauer-e2e-process-demo.runDemo`, tenant `stadtwerk-mauer` only.
- Read-only dashboard and dossier status: `dashboard-api.stadtwerkMauerE2eProcessDemoStatus`.
- Runtime artifacts stay in the #268 sandbox namespace so `stadtwerk-mauer-sandbox-runtime.reset` removes demo traces, stub transcripts, dossier additions, follow-ups, outbox placeholders and audit artifacts.

## Guards

- No real MaKo dispatch, MSB/EDM connector, customer send, billing, settlement, tariff, switching, webhook, SMGW/CLS or device-control action.
- No HITL creation and no Personal-Agent execution.
- No production tenant lifecycle mutation or generic workflow engine.

## Smoke Path

1. Read empty status with `GET /api/dashboard/stadtwerk-mauer-e2e-process-demo`.
2. Run the PV demo with `POST /api/stadtwerk-mauer/e2e-process-demo/run`.
3. Read status again and verify trace, roles/capabilities, stub transcript, missing NAP/reference evidence and no-call guards.
4. Reset with `POST /api/stadtwerk-mauer-sandbox-runtime/reset`.
5. Read final status and verify the trace count is zero.
6. Verify a non-`stadtwerk-mauer` tenant receives `SANDBOX_TENANT_REQUIRED` for mutation.
