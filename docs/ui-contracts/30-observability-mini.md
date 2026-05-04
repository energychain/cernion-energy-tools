````markdown
# UI Contract: Observability Mini Panel + Agent Prompt

> **Page ID:** `dashboard-observability-mini`
> **Version:** 0.40.7
> **Last updated:** 2026-05-04

---

## Primary API Endpoints

```
GET /api/dashboard/observability-mini
GET /api/observability/agent-prompt
```

**Auth:** Bearer token (read-only scope sufficient)  
**Cache TTL (`observability-mini`):** 60 seconds (backend, stampede-safe)  
**Purpose:** Fast production feedback slice for operators and a copy-ready prompt for agentic debugging.

---

## 1) Observability Mini Panel

### Request

```
GET /api/dashboard/observability-mini?sinceMinutes=60&slowActionThresholdMs=1000&limit=5
```

Query params:
- `sinceMinutes` (optional, integer, default `60`)
- `slowActionThresholdMs` (optional, integer, default `1000`)
- `limit` (optional, integer, default `5`, max `20`)

### Response shape

```json
{
  "cards": {
    "errors": { "value": 3, "signal": "warning", "label": "Errors (window)" },
    "errorRate": { "value": 4.2, "signal": "ok", "label": "Error rate (%)" },
    "p95LatencyMs": { "value": 920, "signal": "warning", "label": "P95 latency (ms)" },
    "slowActions": { "value": 2, "signal": "warning", "label": "Slow actions" }
  },
  "recentErrors": [
    {
      "timestamp": "2026-05-04T08:00:00.000Z",
      "service": "grid-connection",
      "action": "grid-connection.validate",
      "message": "...redacted..."
    }
  ],
  "slowestActions": [
    {
      "action": "mastr-quality.audit",
      "p95Ms": 1720,
      "avgMs": 1010,
      "calls": 12,
      "errorRate": 8.3
    }
  ],
  "window": {
    "sinceMinutes": 60,
    "slowActionThresholdMs": 1000
  },
  "timestamp": "2026-05-04T08:01:00.000Z",
  "_errors": []
}
```

### UI rules

- Render four compact KPI cards from `cards`.
- Show up to `limit` rows for `recentErrors` and `slowestActions`.
- If `_errors` is non-empty, show a non-blocking warning badge: **"partial data"**.
- Never display raw secrets. Messages are already backend-redacted.

---

## 2) Agent Prompt Endpoint

### Request

```
GET /api/observability/agent-prompt?sinceMinutes=60&slowActionThresholdMs=1000&limit=5
```

### Response shape

```json
{
  "generatedAt": "2026-05-04T08:01:00.000Z",
  "window": {
    "sinceMinutes": 60,
    "slowActionThresholdMs": 1000,
    "limit": 5
  },
  "prompt": "You are debugging a production issue...",
  "context": {
    "logs": {
      "total": 120,
      "byLevel": { "info": 95, "warn": 18, "error": 7 },
      "recentErrors": []
    },
    "metrics": {
      "total": 340,
      "overview": { "totalCalls": 340, "errors": 7 },
      "slowestActions": []
    }
  }
}
```

### UI rules

- Provide a **Copy Prompt** button for `prompt`.
- Offer optional **Open in agent workflow** action with the same payload context.
- Keep `context` collapsible by default.

---

## Error handling

- `401`: redirect to token/login flow.
- `422`: show inline validation message from `data[].message`.
- `503`: show retry state, keep last successful payload in client cache.

````
