# Stadtwerk Mauer External Interface Stubs

Issue: #267

Capability key: `stadtwerk_mauer_external_interface_stubs`

## Product Cut

This slice adds deterministic sandbox-internal stubs for Stadtwerk Mauer external process boundaries. It is designed for demo and test force without real external side effects.

## In Scope

- Sandbox-only `callStub` transcripts for MaKo/Lieferantenwechsel, MSB/EDM plausibility, customer communication, control/device boundary, billing/settlement/tariff placeholder, and webhook/connector placeholder.
- Read-only dashboard and dossier status through `dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus`.
- Stub artifacts stored in the #268 sandbox runtime namespace so `stadtwerk-mauer-sandbox-runtime.reset` removes transcripts, outbox placeholders, follow-ups and audit artifacts.
- Capability Broker, Evidence Registry and Hydration Registry wiring for the read-only status path.

## Out of Scope

- Real MaKo, MSB/EDM, customer communication, webhook, billing, settlement, tariff, contract, SMGW/CLS or device-control actions.
- Generic connector framework, secrets/key material, production tenant lifecycle, one-off n8n branches, broad cockpit UI, or Personal Agent hardcoding.

## Smoke Path

1. Read empty status with `GET /api/dashboard/stadtwerk-mauer-external-interface-stubs`.
2. Create sandbox transcripts with `POST /api/stadtwerk-mauer/external-interface-stubs/call` for at least MaKo and control-boundary families.
3. Re-read status and verify transcript counts, response variants, missing evidence and no-call guards.
4. Reset with `POST /api/stadtwerk-mauer-sandbox-runtime/reset`.
5. Re-read status and verify transcript artifacts are gone.
6. Verify a non-`stadtwerk-mauer` tenant receives `SANDBOX_TENANT_REQUIRED` for mutation.
