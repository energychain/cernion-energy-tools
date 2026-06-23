# Stadtwerk Mauer Sandbox Runtime

Issue: #268

## Product Cut

`stadtwerk_mauer_sandbox_runtime` is the bounded lifecycle contract for write-capable Stadtwerk Mauer demos. It allows deterministic sandbox-only event ingestion and reset/delete for tenant `stadtwerk-mauer`, while the dossier-facing surface remains read-only.

## In Scope

- `stadtwerk-mauer-sandbox-runtime.ingestEvent` for non-consequential demo-event mutation in tenant `stadtwerk-mauer` only.
- `stadtwerk-mauer-sandbox-runtime.reset` for idempotent cleanup of sandbox-owned runtime artifacts.
- `dashboard-api.stadtwerkMauerSandboxRuntimeStatus` and `GET /api/dashboard/stadtwerk-mauer-sandbox-runtime` as the read-only status and dossier path.
- Derived-state inventory for event instances, dossier additions, follow-up proposals, stub transcript placeholders, outbox/queue placeholders, and audit artifacts.
- Hydration Registry allowlist only for the read-only dashboard status action.

## Out Of Scope

- Production tenant deletion, provisioning, onboarding, or generic tenant lifecycle.
- Real MaKo, MSB/EDM, customer communication, billing, settlement, tariff, switching, webhook, SMGW/CLS, device-control, or external connector actions.
- HITL creation, Personal-Agent execution, secrets/key handling, broad cockpit UI, or irreversible side effects.

## Dossier Evidence

The status response exposes reset/delete readiness, artifact counts, missing lifecycle evidence, positive follow-ups, and source-action guards. Mutation actions are intentionally absent from the Hydration Registry.
