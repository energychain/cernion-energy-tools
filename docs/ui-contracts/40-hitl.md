# UI Contract: HITL Approval Dashboard

> **Page ID:** `hitl`
> **Version:** 0.55.3
> **Last updated:** 2026-05-06

---

## Primary API Endpoints

- `GET /api/hitl/items`
- `GET /api/hitl/items/:id`
- `POST /api/hitl/items/:id/approve`
- `POST /api/hitl/items/:id/reject`
- `POST /api/hitl/items/:id/escalate`
- `POST /api/hitl/items/bulk-approve`
- `POST /api/hitl/items/bulk-reject`
- `POST /api/hitl/items/bulk-escalate`
- `GET /api/hitl/summary`
- `GET /api/hitl/sla-heatmap`

**Auth:** Bearer token (`read-only` for GET, `full-access` for POST)

---

## 1) Queue list

### Request

`GET /api/hitl/items?status=pending&originService=finance-agent&overdueOnly=true`

### Supported filters

- `status`: `pending | approved | rejected | expired`
- `kind`
- `originService`
- `originAction`
- `severity`
- `overdueOnly`
- `limit` (default `50`, max `200`)

### Response shape

```json
{
  "success": true,
  "count": 2,
  "items": [
    {
      "id": "hitl_abc123",
      "status": "pending",
      "kind": "finance-hypothetical-review",
      "severity": "warning",
      "originService": "finance-agent",
      "originAction": "analyze",
      "requiredScope": "full-access",
      "payload": {
        "analysisId": "fa_123"
      },
      "responsibleRole": "ROLE_NETZPLANUNG",
      "requiredResolverRoles": ["ROLE_NETZPLANUNG", "ROLE_KAUFMAENNISCHE_LEITUNG"],
      "personaId": "tenant-a/persona-1",
      "personaName": "Thorsten Zoerner",
      "personaType": "human",
      "notification": {
        "dispatchId": "dispatch-123",
        "status": "queued",
        "inboxMessageId": "inbox-123",
        "inboxStatus": "queued",
        "warnings": [],
        "idempotencyKey": "tenant-a:hitl_abc123:tenant-a/persona-1",
        "embedRef": "hitl_item_hitl_abc123",
        "updatedAt": "2026-05-25T12:00:00.000Z"
      },
      "dueAt": "2026-05-13T10:00:00.000Z",
      "createdAt": "2026-05-06T10:00:00.000Z",
      "updatedAt": "2026-05-06T10:00:00.000Z",
      "agent_interventions": [
        {
          "at": "2026-05-06T10:00:00.000Z",
          "action": "created",
          "actor": "system",
          "comment": "HITL item created"
        }
      ]
    }
  ]
}
```

---

## 2) Queue summary

### Request

`GET /api/hitl/summary?sinceDays=30`

### Response shape

```json
{
  "success": true,
  "generatedAt": "2026-05-06T10:10:00.000Z",
  "window": {
    "sinceDays": 30,
    "dateFrom": "2026-04-06T10:10:00.000Z",
    "dateTo": "2026-05-06T10:10:00.000Z"
  },
  "currentQueue": {
    "total": 17,
    "pending": 5,
    "overdue": 2,
    "approved": 7,
    "rejected": 2,
    "expired": 1
  },
  "byStatus": [
    { "value": "approved", "count": 7 },
    { "value": "pending", "count": 5 }
  ],
  "byKind": [
    { "value": "asset-override-approval", "count": 8 },
    { "value": "finance-hypothetical-review", "count": 5 }
  ],
  "byOriginService": [
    { "value": "assets", "count": 8 },
    { "value": "finance-agent", "count": 5 }
  ],
  "bySeverity": [
    { "value": "warning", "count": 11 },
    { "value": "critical", "count": 6 }
  ]
}
```

---

## 3) SLA heatmap

### Request

`GET /api/hitl/sla-heatmap?sinceDays=14`

### Response shape

```json
{
  "success": true,
  "generatedAt": "2026-05-06T10:10:00.000Z",
  "window": {
    "sinceDays": 14,
    "dateFrom": "2026-04-23T00:00:00.000Z",
    "dateTo": "2026-05-06T10:10:00.000Z"
  },
  "buckets": [
    {
      "date": "2026-05-05",
      "created": 3,
      "approved": 1,
      "rejected": 0,
      "expired": 1,
      "resolvedWithinSla": 1,
      "pendingOpen": 4,
      "overdueOpen": 1
    }
  ]
}
```

---

## 4) Single-item review actions

### Approve

`POST /api/hitl/items/:id/approve`

```json
{ "comment": "Approved after legal review." }
```

### Reject

`POST /api/hitl/items/:id/reject`

```json
{
  "comment": "Missing supporting evidence.",
  "feedbackToAgent": "Please add the legal citation."
}
```

### Escalate

`POST /api/hitl/items/:id/escalate`

```json
{ "comment": "Escalate to second review level." }
```

---

## 5) Bulk actions

### Bulk approve

`POST /api/hitl/items/bulk-approve`

```json
{
  "ids": ["hitl_1", "hitl_2"],
  "comment": "Approved in daily review board."
}
```

### Bulk reject

`POST /api/hitl/items/bulk-reject`

```json
{
  "ids": ["hitl_3", "hitl_4"],
  "comment": "Insufficient evidence.",
  "feedbackToAgent": "Collect stronger references."
}
```

### Bulk escalate

`POST /api/hitl/items/bulk-escalate`

```json
{
  "ids": ["hitl_5", "hitl_6"],
  "comment": "Escalate to legal steering group."
}
```

### Bulk response shape

```json
{
  "success": false,
  "processed": 3,
  "succeeded": 2,
  "failed": [
    {
      "id": "hitl_missing",
      "code": "HITL_ITEM_NOT_FOUND",
      "message": "HITL item not found"
    }
  ],
  "items": [
    {
      "id": "hitl_1",
      "status": "approved"
    }
  ]
}
```

---

## UI rules

- Default list view sorts newest-first by `createdAt`.
- Show status badges for `pending`, `approved`, `rejected`, `expired`.
- Use `overdueOpen` from the heatmap and `currentQueue.overdue` from summary for SLA warnings.
- Deep-link from caller flows using direct return payloads:
  - `assets.override` → `hitlItem`
  - `finance-agent.analyze` → `hitlItem`
  - `cya` unresolved multi-agent response → `hitl_item`
- Bulk actions must surface partial failures and keep successful rows updated optimistically.
