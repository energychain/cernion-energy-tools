# OpenClaw Cernion Sidecar Setup

This guide describes how an agent host such as OpenClaw, Hermes or another MCP/HTTP-capable orchestrator can consume the Cernion Sidecar MVP introduced in issue #254.

The sidecar is a controlled Cernion facade. It is not a full OpenAPI export, not a new agent brain and not a policy delegation to the agent host. Cernion remains the policy owner.

## Requirements

The operator needs:

- Cernion base URL, for example `https://api.cernion.example`.
- A Cernion API token with `read-only` scope.
- A token-bound `tenantId` and user identity.
- An agent role compatible with the MVP tools, currently `ROLE_UTILITY_HQ` or `ROLE_GRID_OPERATOR`.
- An agent host that can perform authenticated HTTP calls or map the HTTP endpoints into MCP-like tools.

Do not pass Cernion tokens in URL query parameters. Use an `Authorization: Bearer <token>` header and store the token in the host secret store.

## Endpoints

The sidecar has two HTTP endpoints:

```text
GET  /api/agent-sidecar/tools
POST /api/agent-sidecar/tools/:name/call
```

The manifest endpoint lists the curated tools and their server-side policies. The call endpoint invokes exactly one curated tool through the Cernion policy gate.

## Tool Manifest

Fetch the manifest first:

```bash
curl -sS "$CERNION_BASE_URL/api/agent-sidecar/tools" \
  -H "Authorization: Bearer $CERNION_READONLY_TOKEN"
```

The MVP must return exactly five tools:

- `cernion.ask`
- `cernion.answer_dossier`
- `cernion.recommend_capability`
- `cernion.list_readonly_capabilities`
- `cernion.get_evidence_status`

Each tool entry includes:

- `targetAction`
- `safetyClass`
- `requiredScope`
- `tenantPolicy`
- `rolePolicy`
- `hitlPolicy`
- `responseContract`
- `sideEffects`

The agent host may use these fields to present the tools, but policy is still enforced server-side by Cernion.

## Calling A Tool

Tool calls are sent as JSON with an `input` object:

```bash
curl -sS "$CERNION_BASE_URL/api/agent-sidecar/tools/cernion.list_readonly_capabilities/call" \
  -H "Authorization: Bearer $CERNION_READONLY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "context": {
        "tenantId": "stadtwerk-a"
      }
    }
  }'
```

Successful responses use a compact wrapper:

```json
{
  "success": true,
  "tool": "cernion.list_readonly_capabilities",
  "targetAction": "agent-sidecar.listTools",
  "safetyClass": "read_only_evidence",
  "sideEffects": "none",
  "structuredContent": {}
}
```

Policy blocks return `success:false` and `error:"sidecar_policy_blocked"`.

## Example Calls

Ask Cernion a read-only advisory question:

```bash
curl -sS "$CERNION_BASE_URL/api/agent-sidecar/tools/cernion.ask/call" \
  -H "Authorization: Bearer $CERNION_READONLY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "question": "Welche Evidenz fehlt fuer die Redispatch-Readiness?",
      "context": {
        "tenantId": "stadtwerk-a"
      },
      "domain": "auto",
      "maxEvidence": 5
    }
  }'
```

Request an answer dossier:

```bash
curl -sS "$CERNION_BASE_URL/api/agent-sidecar/tools/cernion.answer_dossier/call" \
  -H "Authorization: Bearer $CERNION_READONLY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "question": "Erstelle ein kurzes Dossier zur Netzanschluss-Readiness.",
      "context": {
        "tenantId": "stadtwerk-a"
      },
      "dossierContract": "slim",
      "timeBudgetMs": 30000
    }
  }'
```

Ask for a capability recommendation without executing the plan:

```bash
curl -sS "$CERNION_BASE_URL/api/agent-sidecar/tools/cernion.recommend_capability/call" \
  -H "Authorization: Bearer $CERNION_READONLY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "task": "Bewerte, welche Cernion Capability fuer ein Investitionsrisiko-Dossier passt.",
      "knownContext": {
        "tenantId": "stadtwerk-a"
      },
      "mode": "initial"
    }
  }'
```

Call a Hydration Registry allowlisted read-only evidence/status action:

```bash
curl -sS "$CERNION_BASE_URL/api/agent-sidecar/tools/cernion.get_evidence_status/call" \
  -H "Authorization: Bearer $CERNION_READONLY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "targetAction": "dashboard-api.jourFixeDecisionClosureStatus",
      "params": {
        "tenantId": "stadtwerk-a"
      }
    }
  }'
```

The target action must be allowlisted by the Dossier Hydration Registry. Non-allowlisted or write-like actions are blocked.

## OpenClaw Host Mapping

For OpenClaw or an equivalent host, map the sidecar as an authenticated HTTP tool provider:

```json
{
  "name": "cernion-sidecar",
  "baseUrl": "https://api.cernion.example/api/agent-sidecar",
  "auth": {
    "type": "bearer",
    "secretRef": "CERNION_READONLY_TOKEN"
  },
  "manifest": {
    "method": "GET",
    "path": "/tools"
  },
  "call": {
    "method": "POST",
    "pathTemplate": "/tools/{name}/call",
    "bodyTemplate": {
      "input": "{{input}}"
    }
  }
}
```

Concrete host configuration may differ. The important part is that the host loads `/tools`, exposes only the returned names, and sends calls back to `/tools/:name/call` with the read-only bearer token.

The host should not create synthetic tools that bypass the manifest. It should also not infer write permissions from tool descriptions.

## Tenant And Role Context

The token carries the authenticated tenant. A tool input may also include tenant context, for example:

```json
{
  "input": {
    "context": {
      "tenantId": "stadtwerk-a"
    }
  }
}
```

If the input tenant and token tenant differ, the sidecar returns:

```json
{
  "success": false,
  "error": "sidecar_policy_blocked",
  "reason": "tenant_mismatch"
}
```

The MVP manifest declares `ROLE_UTILITY_HQ` and `ROLE_GRID_OPERATOR` as the intended roles. Operators should provision sidecar tokens only for users whose role assignment matches the intended usage.

## Blocked Operations

The MVP blocks actions whose target looks like write, delete, approve, reject, resolve, bulk, token, webhook or import behavior. It also blocks any `cernion.get_evidence_status` target that is not Hydration Registry allowlisted.

Expected block shape:

```json
{
  "success": false,
  "error": "sidecar_policy_blocked",
  "reason": "forbidden_target_action"
}
```

This block is a product feature. It proves that the agent host cannot turn the sidecar into an uncontrolled Cernion API client.

## Smoke Test Checklist

Before handing the sidecar to a user or tenant:

- `GET /api/agent-sidecar/tools` returns exactly five tools.
- The manifest has `policyOwner:"cernion"` and `maxToolCount:5`.
- `cernion.list_readonly_capabilities` succeeds through the call endpoint.
- `cernion.recommend_capability` returns a recommendation and does not execute it.
- `cernion.ask` or `cernion.answer_dossier` returns structured content for a harmless read-only question.
- A tenant mismatch returns `sidecar_policy_blocked/tenant_mismatch`.
- A forbidden target such as `hitl.approve` returns `sidecar_policy_blocked/forbidden_target_action`.
- A non-allowlisted evidence status action returns `sidecar_policy_blocked/target_action_not_hydration_allowlisted`.
- The read-only token is stored in the host secret store and is not printed in logs.

## Troubleshooting

### `auth_required`

The bearer token is missing or was not accepted by the API gateway. Check the `Authorization` header and token status.

### `unsupported_token_scope`

The token scope is neither `read-only` nor `full-access`. Provision a normal read-only Cernion API token for the sidecar.

### `tenant_mismatch`

The tenant in the tool input does not match the authenticated token tenant. Correct the input context or use the correct tenant token.

### `unknown_tool`

The host tried to call a tool name that is not in the current manifest. Reload `/api/agent-sidecar/tools` and expose only manifest-listed tools.

### `target_action_not_hydration_allowlisted`

The requested evidence/status target is not allowlisted for Dossier Hydration. Add an explicit Hydration Registry rule before exposing that target through the sidecar.

## Non-Goals

Do not use this MVP to:

- Export the full Cernion OpenAPI as tools.
- Trigger production writes, imports or approvals.
- Create or revoke tokens through the sidecar.
- Hide tenant or role context inside prompts.
- Reimplement Cernion process logic in OpenClaw or another host.

