# Generic Energy Sidecar Connector

Issue #257 generalizes the Cernion Agent Sidecar MVP into a small provider/host contract for energy-domain agents. Cernion is the first provider; OpenClaw is the first intended host. The implementation remains inside Cernion for this slice so it can be tested and deployed without external plugin packaging.

## Boundary

An Energy Sidecar has two sides:

- Provider: owns domain actions, tenant policy, role policy, HITL policy, and audit semantics.
- Host: discovers tools, stores secrets, supplies tenant/role context, and invokes tools through the provider boundary.

The host-facing descriptor is metadata, not a policy source. Cernion continues to enforce all policy in `agent-sidecar` before any downstream call.

## Descriptor

`src/energy-sidecar-descriptor.js` builds a provider-neutral descriptor with:

- provider id/name/version and policy owner
- domain, currently `energy`
- endpoint contract for manifest and tool calls
- bearer auth with secret reference only
- tool name/title/description/input schema
- safety class, required scope, tenant/role/HITL policy
- response contract, side effects, and target action

The descriptor must not contain bearer tokens, `ck_` tokens, auth headers, local host state, or raw secrets. `bearerTokenSecretRef` is a host-side pointer such as `CERNION_READONLY_TOKEN`.

## Cernion Provider

`src/cernion-sidecar-provider.js` maps the existing Cernion Sidecar manifest into the generic descriptor and builds the provider REST call shape:

```text
GET  /api/agent-sidecar/tools
POST /api/agent-sidecar/tools/:name/call
```

The mapped provider keeps exactly the #254 MVP tools:

- `cernion.ask`
- `cernion.answer_dossier`
- `cernion.recommend_capability`
- `cernion.list_readonly_capabilities`
- `cernion.get_evidence_status`

## MCP-Like Bridge

`src/energy-sidecar-mcp-bridge.js` provides transport-neutral helpers:

- `buildMcpLikeToolsList(descriptor)` creates a `tools/list`-style object.
- `callMcpLikeTool(...)` maps a host call to the provider and preserves `sidecar_policy_blocked` as a structured host-visible error.

This is not a full MCP server and not an OpenClaw plugin package. A future package can wrap these helpers with the concrete transport and installer metadata.

## API Surface

The existing sidecar service also exposes read-only bridge views:

```text
GET  /api/agent-sidecar/descriptor
GET  /api/agent-sidecar/mcp/tools
POST /api/agent-sidecar/mcp/tools/:name/call
```

The POST bridge delegates to the same server-side policy gate as `/api/agent-sidecar/tools/:name/call`. Read-only API tokens are allowed only for these policy-gated sidecar call paths.

## Policy

Allowed:

- read-only/advisory tool discovery
- calls to the five curated MVP tools
- Hydration Registry allowlisted read-only evidence/status calls through `cernion.get_evidence_status`
- structured propagation of provider policy blocks

Blocked:

- Full OpenAPI export
- write/admin/token/HITL-resolve actions
- production mutation
- new external connectors
- secrets in descriptors, logs or docs
- OpenClaw workspace coupling inside Cernion
- Personal Agent hardcoding for OpenClaw

## OpenClaw Consumption

OpenClaw can consume the descriptor as a generic HTTP/MCP-like provider:

1. Store the Cernion read-only token in the OpenClaw secret store.
2. Fetch `/api/agent-sidecar/descriptor` or `/api/agent-sidecar/mcp/tools`.
3. Present the five tools with their safety annotations.
4. Invoke `POST /api/agent-sidecar/mcp/tools/:name/call` with explicit tenant context.
5. Treat `sidecar_policy_blocked` as a provider-owned policy decision.

Future publishable work is limited to transport and packaging around this contract. Energy-domain logic and policy remain with the provider.
