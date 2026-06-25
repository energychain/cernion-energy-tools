# VDMI Satellite Consistency Audit

Issues: #290, #297

This inventory classifies the four legacy VDMI satellite services against the current
`services/vdmi.service.js` action surface and records the #297 compatibility alignment.
It is not a new VDMI capability.

## Current VDMI Core Surface

The current `vdmi.service.js` exposes matrix-oriented actions such as `list`, `get`,
`create`, `update`, `revert`, `evidence`, `negotiationTrace`, `dossier`, and
`findings`. It does not expose task-level compatibility actions named
`vdmi.getTask`, `vdmi.updateTask`, or `vdmi.getVersion`.

## Satellite Classification

| Satellite | Runtime exposure | Current dependency evidence | Classification | Decision |
| --- | --- | --- | --- | --- |
| `vdmi-evidence` | API routes `POST /api/vdmi/tenants/:tenantId/tasks/:taskId/evidence` and `POST /api/vdmi/tenants/:tenantId/evidence/:evidenceId/sign` | Previously called missing `vdmi.getTask` and `vdmi.updateTask`. #297 maps evidence to canonical `vdmi.evidence` only when `affectedMatrix.matrixId` is supplied. | partially aligned compatibility facade | Matrix-scoped evidence is forwarded to core VDMI. Legacy task-only evidence fails closed with `VDMI_LEGACY_TASK_EVIDENCE_RETIRED`. |
| `vdmi-spectator` | API routes `GET /api/vdmi/tenants/:tenantId/tasks/:taskId/negotiation-trace` and `GET /api/vdmi/tenants/:tenantId/tasks/:taskId/dossier` | Previously called missing `vdmi.getTask`; core VDMI already exposes `vdmi.negotiationTrace` and `vdmi.dossier` over task IDs. | aligned compatibility facade | Delegate to core `vdmi.negotiationTrace` / `vdmi.dossier` with tenant metadata preserved. |
| `vdmi-human-override` | API routes `PATCH /api/vdmi/tenants/:tenantId/matrices/:matrixId` and `POST /api/vdmi/tenants/:tenantId/matrices/:matrixId/revert` | `override` now unwraps `{ success, matrix }`; versioned `vdmi.getVersion` does not exist. | fail-closed compatibility facade | Canonical `overrides.patch` can use `vdmi.update`; legacy role-object override fails with `VDMI_LEGACY_ROLE_OVERRIDE_RETIRED`. Immediate one-step revert can use `vdmi.revert`; arbitrary target-version rollback fails with `VDMI_VERSIONED_REVERT_RETIRED`. |
| `vdmi-findings` | API routes `GET /api/vdmi/tenants/:tenantId/findings`, `POST /mitigate`, and `POST /resolve` | Own PouchDB datastore for findings; old `resolve(applyChanges)` attempted an incomplete `vdmi.update` patch. Core VDMI has a separate `vdmi.findings` action over core finding documents. | fail-closed compatibility facade | Read-only listing and legacy finding lifecycle remain separate. `resolve(applyChanges)` fails before writing with `VDMI_FINDING_APPLY_CHANGES_RETIRED` until a canonical finding-to-matrix patch contract exists. |

## Scope Decision

No new Capability Broker route, Hydration Registry rule, Slim Dossier formatter, REST
route, cockpit UI, or Personal-Agent shortcut is introduced here. The #297 slice only
aligns existing satellite facades where the canonical action mapping is deterministic
and fails closed where legacy task/history semantics do not exist in core VDMI.

## Follow-Up Required

Remaining follow-up decisions should happen in #291/#292 or later dedicated issues:

- define a first-class VDMI task evidence/history model before re-enabling task-only
  evidence or arbitrary target-version rollback,
- define the canonical VDMI row/control-case schema before accepting legacy role-object
  overrides, and
- define a tested finding-to-matrix patch contract before enabling `applyChanges`.

New VDMI governance schema/policy work should continue to use `vdmi.service.js` as the
source of truth and treat the four satellite services as compatibility surfaces.
