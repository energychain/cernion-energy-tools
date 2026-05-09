# NOVA Decision Guide (v0.49 Baseline)

## Scope

NOVA decisions are **project-scoped** and every project is **tenant-bound** on first access.

- Scope key: `projectId`
- Isolation key: `tenantId`
- Binding rule: first tenant that touches a project in NOVA owns its decision namespace (`NOVA_PROJECT_TENANT_MISMATCH` on mismatch).

## Lifecycle

`proposed -> triaged -> pending_approval -> approved -> applied`

Terminal states:
- `rejected`
- `expired`

Every transition writes:
- lifecycle history entry
- `agent_interventions` audit marker
- SSE event (`decision.*`)
- broker event (`decision.*`) for webhook fan-out

## Decision Kinds (baseline)

- `mastr_correction` (signal-based)
- `threshold_update` (QU heuristic)
- `asset_override` (rONT heuristic)
- `settlement_correction` (RD curtailment heuristic)
- `other`

## HITL Bridge (baseline)

Automatic HITL creation for:
- `mastr_correction`
- `threshold_update`
- `asset_override` (including critical/capex-driven variants)

On reject, NOVA attempts HITL reject resolution if linked item exists.

## REST Endpoints (project-scoped)

- `GET /api/znp/projects/:projectId/nova/pending-decisions`
- `POST /api/znp/projects/:projectId/nova/apply/:id`
- `GET /api/znp/projects/:projectId/nova/decisions`
- `GET /api/znp/projects/:projectId/nova/decisions/:id`
- `POST /api/znp/projects/:projectId/nova/decisions/:id/approve`
- `POST /api/znp/projects/:projectId/nova/decisions/:id/reject`
- `GET /api/znp/projects/:projectId/nova/decisions/stats`
- `POST /api/znp/projects/:projectId/nova/decisions/:id/replay-trigger`

## Replay

Replay is **always async** for consistency.

`replay-trigger` returns a queued job descriptor (202 style) and reconstructs proposal evidence in a background worker.

## SSE

`GET /api/nova/stream`

- tenant-aware subscription
- optional `projectId` filter
- heartbeat every 15s
- lifecycle event types:
  - `decision.proposed`
  - `decision.approved`
  - `decision.rejected`
  - `decision.applied`
  - `decision.expired`
