# UI Contract: MaStR Data Quality Audit Page

> **Page ID:** `mastr-quality`
> **Version:** 0.19.0
> **Last updated:** 2026-03-31

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/mastr-quality/audit` | Start a new 8-step MaStR quality audit (async, 202) |
| `GET`  | `/api/jobs/:jobId`         | Poll for audit completion |
| `GET`  | `/api/mastr-quality/list`  | List past audits (paginated) |
| `GET`  | `/api/mastr-quality/:id`   | Get a specific audit by ID |
| `DELETE` | `/api/mastr-quality/:id` | Delete an audit record |

---

## Trigger (POST /api/mastr-quality/audit)

### Request body

```json
{
  "gridOperatorId": "SNB935578300972",
  "skipSteps": [6, 7]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `gridOperatorId` | string | Yes | MaStR SNB/GNB ID |
| `skipSteps` | number[] | No | Only steps 3–7 may be skipped |

### Response (202 Accepted)

```json
{ "jobId": "job_abc123", "status": "queued", "pollUrl": "/api/jobs/job_abc123" }
```

Poll `GET /api/jobs/job_abc123` every 2 seconds. Timeout after 180 seconds.

---

## Audit Result Shape

```json
{
  "id":           "mq-001",
  "gridOperator": { "name": "TWL Netze GmbH", "mastrId": "SNB935578300972" },
  "createdAt":    "2026-03-31T10:00:00Z",
  "qualityScore": 78,
  "dimensions": {
    "registration":  { "score": 82, "weight": 0.3 },
    "capacity":      { "score": 65, "weight": 0.25 },
    "connectivity":  { "score": 91, "weight": 0.2 },
    "deduplication": { "score": 55, "weight": 0.15 },
    "geo":           { "score": 80, "weight": 0.1 }
  },
  "findings": [
    { "code": "MQ_ZERO_CAPACITY", "severity": "error", "installationId": "SEE...", "detail": "..." },
    { "code": "MQ_MISSING_NAP",   "severity": "error", "installationId": "SEE...", "detail": "..." }
  ],
  "findingsCount": { "info": 12, "warning": 18, "error": 5 },
  "portfolio": { "total": 312, "solar": 201, "wind": 47, "storage": 29, "biomass": 35 }
}
```

---

## UI Elements

### Quality Score Gauge

- Large circular gauge 0–100
- Colour: < 60 → red, 60–79 → yellow, 80–100 → green
- Centre: score value + "/ 100"
- Sub-label: "based on 5 dimensions"

### Dimension Scores Bar Chart

5 horizontal bars (or spider/radar chart):

| Dimension | Weight | Field |
|-----------|--------|-------|
| Registrierung | 30% | `dimensions.registration.score` |
| Leistung | 25% | `dimensions.capacity.score` |
| Konnektivität | 20% | `dimensions.connectivity.score` |
| Deduplizierung | 15% | `dimensions.deduplication.score` |
| Geo | 10% | `dimensions.geo.score` |

### Findings Table

Filterable table of `findings`:

| Column | Source | Notes |
|--------|--------|-------|
| Severity chip | `findings[].severity` | error=red, warning=yellow, info=blue |
| Code | `findings[].code` | Link to finding-codes reference |
| Installation | `findings[].installationId` | Truncated; hover → full ID |
| Detail | `findings[].detail` | Expandable |

### Portfolio Summary Chips

Render `portfolio` fields as count chips: Total / Solar / Wind / Storage / Biomass.

### Step Timeline

Collapsible 8-step timeline showing which steps were run, skipped, or failed.

---

## Interactions

- **Run new audit**: opens a drawer with `gridOperatorId` input + optional `skipSteps` checkboxes (3–7 only).
- **Poll progress**: progress bar + "Step N/8 in progress…" message while polling.
- **Finding code tooltip**: hover over code → description from [finding-codes endpoint](04-finding-codes.md).
- **Export findings CSV**: downloads `findings.csv` with all rows.
- **Delete audit**: confirmation dialog → DELETE call.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| No installations found | Empty state with "No MaStR installations found for this operator" |
| `skipSteps` includes 1 or 2 | UI prevents selection with "Steps 1–2 cannot be skipped" |
| Audit times out (180s) | Show "Audit timed out — partial results may be available" |
| Geo step skipped | `dimensions.geo.score` null → show "–" in bar chart |
