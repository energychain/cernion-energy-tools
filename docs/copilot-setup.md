# Cernion Energy Tools — MS365 Copilot Setup Guide

## Overview

The Cernion Energy Assistant is a Declarative Agent for Microsoft 365 Copilot. It uses a Plugin Manifest (v2.4) to call the Cernion REST API.

**Relevant files:**

| File | Purpose |
|------|---------|
| `docs/copilot-agent.json` | Declarative Agent Manifest v1.7 |
| `docs/copilot-plugin.json` | Plugin Manifest v2.4 |
| `openapi-export.json` | Static OpenAPI export (used as spec reference) |

---

## What This Agent Supports (Phase 2)

### Search (read-only)
| operationId | Endpoint | Description |
|-------------|----------|-------------|
| `searchCernionData` | `GET /api/query/search` | Cross-domain search: companies, VNB, VDMI, ZNP, grid connection, EDM MeLo IDs |

### Process Read-Only
| operationId | Endpoint | Description |
|-------------|----------|-------------|
| `getVdmiContext` | `GET /api/copilot-process/vdmi/:matrixId/context` | VDMI matrix status, open tasks, evidence count |
| `listOpenResponsibilities` | `GET /api/copilot-process/vdmi/responsibilities` | Open VDMI tasks for a user/actor |
| `getZnpProjectStatus` | `GET /api/copilot-process/znp/:projectId/status` | ZNP project metadata and graph stats |
| `getGridConnectionValidation` | `GET /api/copilot-process/grid-connection/:validationId` | Validation report detail |

### Process Draft/Propose (no writes)
| operationId | Endpoint | requiredConfirmation | Description |
|-------------|----------|---------------------|-------------|
| `prepareVdmiValidation` | `POST /api/copilot-process/vdmi/:matrixId/prepare-validation` | **true** | Nomination proposal — no write |
| `draftVdmiEvidence` | `POST /api/copilot-process/vdmi/:matrixId/draft-evidence` | false | Evidence suggestions — no write |
| `prepareGridConnectionValidation` | `POST /api/copilot-process/grid-connection/prepare-validation` | **true** | Validation config draft — no write |

### Not Yet Supported (Phase 3)
The following actions are documented as `consequentialAction` references in draft responses but are **not implemented**:

| Planned operationId | Description |
|---------------------|-------------|
| `executeVdmiNomination` | Actually nominate a VDMI matrix |
| `runGridConnectionValidation` | Execute the 6-step validation pipeline |
| `addVdmiEvidence` | Inject evidence into a VDMI matrix task |

---

## Deployment Steps

### 1. Set environment variables

```env
# Deployment base URL (no trailing slash)
COPILOT_DEPLOYMENT_URL=https://your-cernion-deployment.example.com

# Vault reference ID for API key (from your secret store / Azure Key Vault)
COPILOT_VAULT_REFERENCE_ID=<your-vault-reference-id>
```

### 2. Update `docs/copilot-plugin.json`

Replace the two placeholders before uploading to Copilot Studio:

```json
"runtimes": [{
  "auth": {
    "type": "ApiKeyPluginVault",
    "reference_id": "<COPILOT_VAULT_REFERENCE_ID>"
  },
  "spec": {
    "url": "<COPILOT_DEPLOYMENT_URL>/api/openapi-copilot.json"
  }
}]
```

### 3. Authentication configuration

The API uses `BearerAuth` or `X-API-Key` header authentication (configured via `CERNION_TOKEN`). In Copilot Studio:

- Select **API Key** as the authentication type.
- Store the token in Azure Key Vault and reference it via the `reference_id` field.
- The vault reference replaces `TODO_REPLACE_WITH_VAULT_REFERENCE_ID`.

### 4. Upload to Copilot Studio / M365 Agent Builder

Required files (assemble into a `.zip` for Teams App Package):
1. `docs/copilot-agent.json` — Declarative Agent Manifest
2. `docs/copilot-plugin.json` — Plugin Manifest (with replaced TODOs)
3. A `manifest.json` following the [Microsoft 365 App Manifest schema](https://developer.microsoft.com/en-us/graph/changelog) with a `declarativeAgents` reference pointing to `copilot-agent.json`.

The Teams App Package (`manifest.json` + agent/plugin files + icons) is outside the scope of this repository.

### 5. Verify OpenAPI spec

After deployment, verify the live Copilot spec contains the allowlisted operationIds:

```bash
curl -s https://your-cernion-deployment.example.com/api/openapi-copilot.json \
  | python3 -c "
import json, sys
spec = json.load(sys.stdin)
ids = [op.get('operationId') for p in spec['paths'].values() for op in p.values()]
expected = ['searchCernionData','getVdmiContext','listOpenResponsibilities',
            'getZnpProjectStatus','getGridConnectionValidation',
            'prepareVdmiValidation','draftVdmiEvidence','prepareGridConnectionValidation']
for e in expected:
    print(e, '✓' if e in ids else '✗ MISSING')
"
```

---

## Safety Model

| Tier | Actions | `x-openai-isConsequential` | Side effects |
|------|---------|--------------------------|--------------|
| Read-only | `searchCernionData`, `get*`, `list*` | `false` | None |
| Draft/Propose | `prepare*`, `draft*` | `false` | None — returns proposal only |
| Execute (Phase 3) | `execute*`, `run*`, `add*` | `true` (planned) | Persistent writes |

Draft actions always return `requiredConfirmation: true` (for state-changing proposals) or `false` (for suggestions only). The agent must show the `confirmationMessage` and wait for explicit user approval before calling any Phase-3 execute action.

---

## Audit Trail

Every process action response includes an `auditTrail` object:

```json
{
  "requestedAt": "2026-06-11T10:00:00.000Z",
  "requestedBy": "grid_operator",
  "correlationId": "req-2026-001",
  "idempotencyKey": "idem-abc123-20260611",
  "reason": "Jahresprüfung abgeschlossen"
}
```

Pass `correlationId` and `idempotencyKey` in requests to link agent interactions to your existing trace infrastructure.
