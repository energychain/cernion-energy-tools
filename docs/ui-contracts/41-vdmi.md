# UI Contract 41 — VDMI API (v0.50.0)

## Scope
VDMI matrix lifecycle, nomination governance, findings workflows, and A2A spectator transparency.

## Base
- Service: `vdmi`
- Base path: `/api/vdmi`
- Tenant scope: required via gateway tenant context (`tenantId`)

## Endpoints

### Matrix lifecycle
- `GET /api/vdmi`
- `GET /api/vdmi/:id`
- `POST /api/vdmi`
- `POST /api/vdmi/detect`

### Nomination
- `GET /api/vdmi/nominations`
- `POST /api/vdmi/:id/nominate`
- `POST /api/vdmi/:id/confirm-nomination`
- `GET /api/vdmi/templates`

### Human governance
- `PATCH /api/vdmi/:id`
- `POST /api/vdmi/:id/revert`
- `POST /api/vdmi/:id/evidence`

### Spectator mode
- `GET /api/vdmi/tasks/:taskId/negotiation-trace`
- `GET /api/vdmi/tasks/:taskId/dossier`

### Findings workflow
- `GET /api/vdmi/findings`
- `POST /api/vdmi/findings/:findingId/mitigate`
- `POST /api/vdmi/findings/:findingId/resolve`

### Role/context lookups
- `GET /api/vdmi/my-responsibilities`
- `GET /api/vdmi/my-informed`
- `GET /api/vdmi/agent/:agentId/role`
- `GET /api/vdmi/context`

## Core response fragments

### Matrix
```json
{
  "id": "<uuid>",
  "processId": "job-123",
  "processType": "adhoc",
  "name": "Netzanschluss-Genehmigung PV",
  "tasks": [],
  "nominationStatus": "pending",
  "detectionConfidence": 0.92,
  "patternMatchCount": 6,
  "promotionThreshold": 10,
  "version": 2
}
```

### Finding
```json
{
  "id": "<uuid>",
  "matrixId": "<uuid>",
  "code": "VD_SHADOW_SHAREPOINT_BYPASS_H",
  "severity": "H",
  "status": "open",
  "message": "Shadow-process signal detected",
  "occurrenceCount": 1
}
```

## UI behaviors
- Require mandatory reason text for `PATCH` and `revert` flows.
- Use `negotiation-trace` for timeline replay and `dossier` for management summary card.
- Expose findings by severity/status tabs (`L/M/H/K`, `open/mitigated/resolved`).
- Show tenant-local data only; no cross-tenant references are valid.
