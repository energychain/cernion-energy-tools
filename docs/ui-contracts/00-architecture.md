# UI Contracts — Architecture Overview

> **Version:** 0.26.3
> **Purpose:** This directory defines the binding contract between the Cernion backend
> and any frontend consumer (dashboard, admin portal, embedded widgets). Each file
> describes one UI "page" or "panel" with its API endpoints, response field mapping,
> display rules, interactions, and edge cases.
>
> These documents are **backend-owned**. Frontend teams must treat them as the source
> of truth. Backend changes that alter a contract MUST update the corresponding file
> and bump the minor version.

---

## Document Index

| # | File | Page / Panel | Primary API |
|---|------|--------------|-------------|
| 00 | [00-architecture.md](00-architecture.md) | This document — overview | — |
| 01 | [01-dashboard-overview.md](01-dashboard-overview.md) | Dashboard landing / VNB overview | `GET /api/dashboard/vnb-overview` |
| 02 | [02-market-snapshot.md](02-market-snapshot.md) | Energy market snapshot panel | `GET /api/dashboard/market-snapshot` |
| 03 | [03-quality-summary.md](03-quality-summary.md) | Agent quality summary panel | `GET /api/dashboard/quality-summary` |
| 04 | [04-finding-codes.md](04-finding-codes.md) | Finding codes reference / filter chips | `GET /api/dashboard/finding-codes` |
| 05 | [05-mastr-quality.md](05-mastr-quality.md) | MaStR Data Quality audit page | `POST /api/mastr-quality/audit` |
| 06 | [06-grid-connection.md](06-grid-connection.md) | Grid Connection Validation page | `POST /api/grid-connection/validate` |
| 07 | [07-energy-sharing.md](07-energy-sharing.md) | Energy Sharing Validation page | `POST /api/energy-sharing/validate` |
| 08 | [08-redispatch.md](08-redispatch.md) | Redispatch Ex-Post audit page | `POST /api/redispatch/audit` |
| 09 | [09-datapoints.md](09-datapoints.md) | Datapoints management panel | `GET /api/datapoints` |
| 10 | [10-vnb-monitor.md](10-vnb-monitor.md) | VNB Monitor panel | `GET /api/vnb-monitor/snapshot` |
| 11 | [11-nbp-monitor.md](11-nbp-monitor.md) | NBP Monitor panel | `GET /api/nbp-monitor/status` |
| 12 | [12-auth.md](12-auth.md) | Token management | `GET /api/tokens` |
| 13 | [13-shared-components.md](13-shared-components.md) | Shared UI components | Multiple |
| 14 | [14-finding-code-recommendations.md](14-finding-code-recommendations.md) | Finding-Code recommendations panel | `GET /api/dashboard/finding-codes/recommendations` |
| 15 | [15-nova-decision-feed.md](15-nova-decision-feed.md) | NOVA Decision Feed panel | `GET /api/znp/projects/:projectId/nova/pending-decisions` |
| 16 | [16-znp.md](16-znp.md) | ZNP workspace and layer lifecycle | `POST /api/znp/projects` |
| 17 | [17-nova.md](17-nova.md) | NOVA operations and SSE stream | `GET /api/znp/projects/:projectId/nova/pending-decisions` |
| 18 | [18-cookbook.md](18-cookbook.md) | Cookbook recipes and validation | `GET /api/cookbook` |
| 19 | [14-company.md](14-company.md) | Company entity management | `GET /api/companies` |
| 20 | [20-cya.md](20-cya.md) | CYA narrative generation panel | `POST /api/cya/generate` |
| 30 | [30-observability-mini.md](30-observability-mini.md) | Observability mini panel + agent prompt | `GET /api/dashboard/observability-mini` |

---

## General Conventions

### Authentication

All API calls MUST include one of:
- `Authorization: Bearer <token>` header — for programmatic access
- `?token=<token>` query parameter — for URL-based integrations

Tokens are issued by `POST /api/tokens`. Scopes: `read-only` (GET endpoints) or
`full-access` (all endpoints). See [12-auth.md](12-auth.md).

### Async jobs

Long-running endpoints (audit, validate, export) return `HTTP 202` with:
```json
{ "jobId": "job_abc123", "status": "queued", "pollUrl": "/api/jobs/job_abc123" }
```
Poll `GET /api/jobs/:jobId` until `status` is `"completed"` or `"failed"`.
Recommended interval: 2 seconds. Timeout after 200 seconds.

### Error envelope

All errors return a standard envelope:
```json
{
  "code": 422,
  "type": "VALIDATION_ERROR",
  "message": "...",
  "data": [{ "field": "bdewCode", "message": "required" }]
}
```

### Validation errors (422)

All Dashboard API endpoints return structured validation errors when parameters are
invalid. The `data` array contains one entry per invalid field (v0.20.1):

```json
{
  "code": 422,
  "type": "VALIDATION_ERROR",
  "message": "Parameters validation error!",
  "data": [{
    "type": "stringPattern",
    "message": "bdewCode muss 7-13 Ziffern enthalten (Beispiel: 9907473000008)",
    "field": "bdewCode",
    "actual": "INVALID"
  }]
}
```

Use `data[].field` for inline error highlighting and `data[].message` for the
error text. Messages are in German (matching the domain language).

| Endpoint | Field | Pattern | Example error message |
|----------|-------|---------|----------------------|
| `vnbOverview` | `bdewCode` | `/^\d{7,13}$/` | `bdewCode muss 7-13 Ziffern enthalten (Beispiel: 9907473000008)` |
| `marketSnapshot` | `location` | min 2 chars | `location muss mindestens 2 Zeichen lang sein` |
| `marketSnapshot` | `region` | min 2 chars | `region muss mindestens 2 Zeichen lang sein` |
| `qualitySummary` | `gridOperatorId` | `/^[SG]NB\d+$/` | `gridOperatorId muss im Format SNBxxx oder GNBxxx sein (Beispiel: SNB935578300972)` |

### Null vs missing fields

- If a downstream service fails, affected fields are set to **`null`** (never omitted).
- `_errors` array is always present; it lists the names of failed internal actions.
- UI MUST handle `null` for any field in the response — display a graceful fallback.

### Timestamps

All timestamps are **ISO 8601 UTC** (`2026-03-31T10:00:00.000Z`).
Display in local time using the browser's timezone. Use `Intl.DateTimeFormat` or
`date-fns` — never hard-code timezone.

### Numbers

- Capacities: `kW` or `MW` as documented per field.
- Prices: `€/MWh` unless otherwise stated.
- CO₂: `gCO₂eq/kWh`.
- Percentages: `0–100` range (not `0.0–1.0`), unless noted.

### Version compatibility

If `x-version` on the OpenAPI export differs from the running server, the UI
should warn the user that documentation may be stale.

---

## Architecture Diagram

```
Browser / Frontend
      │
      ▼
  API Gateway (port 3000)
  ┌─────────────────────────────────────────────────────────┐
  │  GET  /api/dashboard/*           → dashboard-api.service  │  ← AP1 (v0.19)
  │  POST /api/mastr-quality/audit   → mastr-quality.service  │  ← v0.17
  │  POST /api/grid-connection/valid.→ grid-connection.service│  ← v0.14
  │  POST /api/energy-sharing/valid. → energy-sharing.service │  ← v0.15
  │  POST /api/redispatch/audit      → redispatch-expost.svc  │  ← v0.18
  │  GET  /api/datapoints            → datapoint.service      │  ← v0.11
  │  GET  /api/vnb-monitor/*         → vnb-monitor.service    │
  │  GET  /api/nbp-monitor/*         → nbp-monitor.service    │
  │  GET  /api/tokens                → token-manager.service  │
  └─────────────────────────────────────────────────────────┘
        │
        ▼
  Upstream data sources:
  MaStR (MongoDB), ENTSO-E, SMARD, Netztransparenz, Overpass/OSM,
  Cernion MCP (EWK, AGSI, energy-market)
```
