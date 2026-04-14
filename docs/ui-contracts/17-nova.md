# UI Contract: NOVA Decisions API

> **Page ID:** `nova`
> **Version:** 0.25.0
> **Last updated:** 2026-04-14

---

## Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `GET` | `/api/znp/projects/:projectId/nova/pending-decisions` | Compute dynamic NOVA decisions for one project |
| `POST` | `/api/znp/projects/:projectId/nova/apply/:id` | Apply one decision and persist graph changes |
| `GET` | `/api/nova/stream` | Server-Sent Events stream (`text/event-stream`) |

---

## 1) Pending decisions

`GET /api/znp/projects/:projectId/nova/pending-decisions`

### Response

Array of decision DTOs:

```json
[
  {
    "id": "dec_a1b2c3d4_SUB_1_RD_CURTAILMENT",
    "type": "RD_CURTAILMENT",
    "gridNode": "SUB_1",
    "description": "3 Redispatch-fähige Großanlagen (>100 kW) ...",
    "capex": 0,
    "capacity_gain_kw": 540
  }
]
```

### Decision types

- `QU` — Q(U) optimization on PV
- `rONT` — reinforcement by replacing SONT with rONT
- `RD_CURTAILMENT` — redispatch curtailment potential from eligible assets

---

## 2) Apply decision

`POST /api/znp/projects/:projectId/nova/apply/:id`

### Response

```json
{ "success": true, "id": "dec_a1b2c3d4_SUB_1_QU" }
```

### Error cases

- `404 NOVA_DECISION_NOT_FOUND` if decision ID is unknown
- `400 NOVA_DECISION_TYPE_UNSUPPORTED` for unsupported decision type
- `503 NOVA_ZNP_SERVICE_UNAVAILABLE` if ZNP service is unavailable

### Side effects (UI relevant)

On success, backend emits `znp.project.updated` with:

```json
{
  "type": "nova-decision-applied",
  "data": {
    "projectId": "a1b2c3d4-...",
    "id": "dec_a1b2c3d4_SUB_1_QU",
    "decisionType": "QU",
    "gridNode": "SUB_1",
    "capacity_gain_kw": 120,
    "capex": 0
  }
}
```

---

## 3) SSE stream

`GET /api/nova/stream`

### Transport

- Content-Type: `text/event-stream`
- Keep-alive comment every 15s: `: keep-alive`
- Initial event: `event: connected`

### Event payloads

NOVA forwards `znp.project.updated` events as SSE messages. Typical payload types:

- `assumption-confirmed`
- `layer2-activated`
- `nova-decision-applied`

UI should parse by `event` + `data.type` and update feed state incrementally.

---

## Frontend sequencing

1. Call pending decisions for active project
2. Render list and enable per-item `apply`
3. Subscribe to `/api/nova/stream`
4. On `nova-decision-applied`, refresh pending decisions and project KPIs (`/api/znp/projects/:projectId/g-factor`)

---

## Notes

- NOVA decisions are calculated against hydrated ZNP graph state.
- `pendingDecisions` can be called repeatedly; server re-computes when needed.
- Apply path persists to PouchDB via ZNP service.
