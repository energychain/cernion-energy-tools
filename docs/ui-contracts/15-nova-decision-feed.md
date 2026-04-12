# UI Contract: NOVA Decision Feed

> **Page ID:** 15-nova-decision-feed
> **Version:** 0.20.6
> **Last updated:** 2026-04-10

---

## Overview

This contract defines the backend interface used by the NOVA CoPilot Decision Feed UI.
The current implementation is **Phase B heuristic-driven** and project-scoped.

Implemented endpoints:

- `GET /api/znp/projects/:projectId/nova/pending-decisions`
- `POST /api/znp/projects/:projectId/nova/apply/:id`
- `GET /api/nova/stream` (SSE)
- `POST /api/assets/:assetId/override`

---

## 1) Pending Decisions

### Endpoint

`GET /api/znp/projects/:projectId/nova/pending-decisions`

### Response Shape

Returns dynamic decisions generated from project graph analysis (Layer 1 baseline).

```json
[
  {
    "id": "dec_<projectId>_<gridNode>_QU",
    "type": "QU",
    "gridNode": "SUB_1",
    "description": "Aktivierung Q(U)-Regelung für PV-Wechselrichter.",
    "capex": 0,
    "capacity_gain_kw": 135
  },
  {
    "id": "dec_<projectId>_<gridNode>_rONT",
    "type": "rONT",
    "gridNode": "SUB_1",
    "description": "Austausch SONT gegen rONT. Hebt PV-Kapazität um ca. 50%.",
    "capex": 5500,
    "capacity_gain_kw": 525
  }
]
```

### Contract Notes

- `projectId` is mandatory and defines the graph workspace scope.
- Decisions are generated only for detected overloads.
- Heuristic O (`QU`): +15% PV hosting capacity, `capex: 0`.
- Heuristic V (`rONT`): +50% PV and +25% WP/EV hosting capacity, `capex: 5500`.

---

## 2) Apply Decision

### Endpoint

`POST /api/znp/projects/:projectId/nova/apply/:id`

### Response (stub)

```json
{
  "success": true,
  "id": "dec_001"
}
```

### Notes

- Applies mutation in the in-memory project graph.
- Triggers graph recalculate/persist and emits `znp.project.updated`.
- No request body required.

---

## 3) Realtime Feed (SSE)

### Endpoint

`GET /api/nova/stream`

### Protocol

- `Content-Type: text/event-stream`
- Keep-alive comments are sent periodically.
- On connection, backend emits an initial event:

```text
event: connected
data: {"success":true}
```

### Event Forwarding Contract

The stream forwards existing broker events from `znp.project.updated` as SSE frames:

```text
event: znp.project.updated
data: { ...payload... }
```

For assumption confirmation, the payload contract is:

```json
{
  "type": "assumption-confirmed",
  "data": {
    "id": "<assumptionId>",
    "text": "<originalText>"
  }
}
```

---

## 4) Asset Override (stub)

### Endpoint

`POST /api/assets/:assetId/override`

### Request Body

```json
{
  "field": "string",
  "value": "any",
  "reason": "string"
}
```

### Response (stub)

```json
{
  "success": true
}
```

### Notes

- Current implementation is a stub.
- No persistence or audit trail is written yet.

---

## 5) Frontend Integration Notes

- Applying a decision means `POST /api/znp/projects/:projectId/nova/apply/:id`.
- `GET /api/nova/stream` should be consumed via `EventSource`.
- Decision updates from ZNP are delivered as realtime events without polling.
- If Layer 2 measurements exist, NOVA still evaluates structural Layer 1 bottlenecks for proposals.
