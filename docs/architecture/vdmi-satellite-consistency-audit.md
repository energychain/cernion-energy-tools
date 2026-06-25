# VDMI Satellite Consistency Audit

Issue: #290

This inventory classifies the four legacy VDMI satellite services against the current
`services/vdmi.service.js` action surface. It is a repository-local audit slice, not a
new VDMI capability.

## Current VDMI Core Surface

The current `vdmi.service.js` exposes matrix-oriented actions such as `list`, `get`,
`create`, `update`, `revert`, `evidence`, `negotiationTrace`, `dossier`, and
`findings`. It does not expose task-level compatibility actions named
`vdmi.getTask`, `vdmi.updateTask`, or `vdmi.getVersion`.

## Satellite Classification

| Satellite | Runtime exposure | Current dependency evidence | Classification | Decision |
| --- | --- | --- | --- | --- |
| `vdmi-evidence` | API routes `POST /api/vdmi/tenants/:tenantId/tasks/:taskId/evidence` and `POST /api/vdmi/tenants/:tenantId/evidence/:evidenceId/sign` | Calls missing `vdmi.getTask` and `vdmi.updateTask` actions before updating task evidence. | incomplete integration requiring follow-up | Keep as a legacy exposed satellite for now, but do not build new work on it until it is either adapted to `vdmi.evidence` / matrix tasks or replaced by the core VDMI evidence path. |
| `vdmi-spectator` | API routes `GET /api/vdmi/tenants/:tenantId/tasks/:taskId/negotiation-trace` and `GET /api/vdmi/tenants/:tenantId/tasks/:taskId/dossier` | Calls missing `vdmi.getTask`; core VDMI already exposes `vdmi.negotiationTrace` and `vdmi.dossier` over task IDs. | incomplete integration requiring follow-up | Treat as a legacy compatibility facade. Future work should route to the core `vdmi.negotiationTrace` / `vdmi.dossier` actions or remove the duplicate facade. |
| `vdmi-human-override` | API routes `PATCH /api/vdmi/tenants/:tenantId/matrices/:matrixId` and `POST /api/vdmi/tenants/:tenantId/matrices/:matrixId/revert` | `override` calls existing `vdmi.get` / `vdmi.update`, but expects a raw matrix shape while current `vdmi.get` returns `{ success, matrix }`; `revert` calls missing `vdmi.getVersion`. | incomplete integration requiring follow-up | Do not use as the canonical matrix update path until its contract is aligned with `vdmi.update` / `vdmi.revert` or explicitly retired. |
| `vdmi-findings` | API routes `GET /api/vdmi/tenants/:tenantId/findings`, `POST /mitigate`, and `POST /resolve` | Own PouchDB datastore for findings; `resolve(applyChanges)` calls `vdmi.update` with an incomplete matrix patch shape. Core VDMI has a separate `vdmi.findings` action over core finding documents. | incomplete integration requiring follow-up | Read-only listing is an intentionally separate legacy datastore. Mutating flows and `applyChanges` need a follow-up before they are treated as part of the canonical VDMI governance path. |

## Scope Decision

No new Capability Broker route, Hydration Registry rule, Slim Dossier formatter, REST
route, cockpit UI, or Personal-Agent shortcut is introduced here. The #290 slice only
records the inconsistency and adds static checks so later #291/#292 governance work
cannot silently assume the satellite actions are aligned with the real VDMI service.

## Follow-Up Required

Open or link a follow-up implementation issue before changing runtime behavior. The
follow-up should choose one explicit path:

- adapt the satellite facades to the current core `vdmi.*` matrix/task actions,
- replace public routes with the core VDMI actions where equivalent routes already
  exist, or
- retire dead compatibility routes after confirming no supported client still uses
  them.

Until that follow-up is complete, new VDMI governance schema/policy work should use
`vdmi.service.js` as the source of truth and treat the four satellite services as
legacy compatibility surfaces.
