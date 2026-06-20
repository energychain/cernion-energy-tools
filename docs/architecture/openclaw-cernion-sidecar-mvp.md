# OpenClaw Cernion Sidecar MVP

Issue #254 introduces a narrow OpenClaw-first sidecar boundary for Cernion. The sidecar is not a new agent brain and not a full OpenAPI export. It is a small server-side facade that exposes a curated set of Cernion tools while Cernion keeps policy ownership.

## Product Boundary

The MVP exposes at most five tools:

- `cernion.ask`
- `cernion.answer_dossier`
- `cernion.recommend_capability`
- `cernion.list_readonly_capabilities`
- `cernion.get_evidence_status`

Only `read_only_evidence` and `advisory_reasoning` are allowed. HITL requirements may be surfaced as evidence or guidance, but the sidecar must not approve, reject, resolve, create, delete, import, issue tokens, call webhooks, or trigger production process changes.

## Runtime Flow

```text
OpenClaw
  -> /api/agent-sidecar/tools
  -> /api/agent-sidecar/tools/:name/call
    -> agent-sidecar policy gate
      -> Personal Agent ask / Answer Dossier
      -> Capability Broker recommendation
      -> Hydration Registry allowlisted read-only evidence/status action
```

The host can inspect the manifest with `GET /api/agent-sidecar/tools`. Tool invocation uses `POST /api/agent-sidecar/tools/:name/call` with a read-only API token. The API gateway permits this specific POST for read-only tokens because the sidecar policy gate revalidates tenant, safety class, side effects and target action before any downstream call.

## Policy Rules

Every tool definition includes:

- `targetAction`
- `safetyClass`
- `requiredScope`
- `tenantPolicy`
- `rolePolicy`
- `hitlPolicy`
- `responseContract`
- `sideEffects`

Policy is enforced server-side in Cernion. Tool descriptions for MCP/OpenClaw are not a policy source.

## Smoke Path

DevServer smoke should verify:

- `GET /api/agent-sidecar/tools` returns exactly the five curated tools.
- `cernion.list_readonly_capabilities` returns the same manifest through the tool-call endpoint.
- `cernion.recommend_capability` returns a recommendation without executing its plan.
- `cernion.get_evidence_status` can call a Hydration Registry allowlisted read-only status action.
- A forbidden HITL/write/admin/token action returns `sidecar_policy_blocked`.

No Personal Agent hardcoding is required for OpenClaw. Consumption stays in the manifest, policy gate, existing Cernion actions and generated API artifacts.

## Setup Guide

For operator-facing setup instructions, see
[`openclaw-cernion-sidecar-setup.md`](./openclaw-cernion-sidecar-setup.md).
