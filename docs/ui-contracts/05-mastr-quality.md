# UI Contract: MaStR Data Quality Audit Page

> **Page ID:** `mastr-quality`
> **Version:** 0.20.4
> **Last updated:** 2026-04-04

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/mastr-quality/audit` | Start a new 8-step MaStR quality audit (sync, 200) |
| `GET`  | `/api/mastr-quality/audits`     | List past audits (paginated) |
| `GET`  | `/api/mastr-quality/audits/:id` | Get a specific audit by ID |
| `DELETE` | `/api/mastr-quality/audits/:id` | Delete an audit record — ⚠ not yet implemented (see CR-0003) |

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

### Response (200 OK)

Returns the full audit result immediately. Execution may take up to 180 seconds (Moleculer timeout).

---

## Audit Result Shape

```json
{
  "id":           "550e8400-e29b-41d4-a716-446655440000",
  "success":      true,
  "gridOperator": { "name": "TWL Netze GmbH", "mastrId": "SNB935578300972" },
  "qualityScore": 78,
  "qualityDimensions": {
    "connectionPoints": { "score": 82, "findings": 3, "weight": 0.30 },
    "capacity":         { "score": 65, "findings": 5, "weight": 0.20 },
    "geo":              { "score": 80, "findings": 0, "weight": 0.20 },
    "status":           { "score": 91, "findings": 1, "weight": 0.15 },
    "duplicates":       { "score": 55, "findings": 2, "weight": 0.15 }
  },
  "summary": {
    "totalInstallations": 312,
    "installationsByType": { "solar": 201, "wind": 47, "storage": 29, "biomass": 35 },
    "findingsCount": { "info": 12, "warning": 18, "error": 5 },
    "skippedSteps": [],
    "durationMs":   45230
  },
  "findings": [
    { "id": "F-4-001", "step": 4, "stepName": "capacityAnomalies", "finding": "MQ_ZERO_CAPACITY", "severity": "error",   "title": "...", "reason": "...", "context": { "mastrNummer": "SEE..." }, "recommendation": "..." },
    { "id": "F-5-001", "step": 5, "stepName": "connectionPoints",  "finding": "MQ_MISSING_NAP",   "severity": "error",   "title": "...", "reason": "...", "context": { "mastrNummer": "SEE..." }, "recommendation": "..." }
  ],
  "steps": [
    { "step": 1, "name": "identity",           "status": "success", "durationMs": 150,  "findingsCount": 1 },
    { "step": 2, "name": "inventory",          "status": "success", "durationMs": 3200, "findingsCount": 0 },
    { "step": 3, "name": "statusAnomalies",    "status": "success", "durationMs": 820,  "findingsCount": 4 },
    { "step": 4, "name": "capacityAnomalies",  "status": "success", "durationMs": 630,  "findingsCount": 5 },
    { "step": 5, "name": "connectionPoints",   "status": "success", "durationMs": 710,  "findingsCount": 3 },
    { "step": 6, "name": "duplicateDetection", "status": "success", "durationMs": 290,  "findingsCount": 2 },
    { "step": 7, "name": "geoSpotCheck",       "status": "success", "durationMs": 950,  "findingsCount": 0 },
    { "step": 8, "name": "audit",              "status": "success", "durationMs": 100,  "findingsCount": 0 }
  ],
  "metadata": { "pipelineVersion": "1.0.0", "executedAt": "2026-03-31T10:00:00Z", "maxAgeMinutes": 120, "geoSampleSize": 10 }
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
| Netzanschlusspunkte | 30% | `qualityDimensions.connectionPoints.score` |
| Leistung | 20% | `qualityDimensions.capacity.score` |
| Geo | 20% | `qualityDimensions.geo.score` |
| Betriebsstatus | 15% | `qualityDimensions.status.score` |
| Duplikate | 15% | `qualityDimensions.duplicates.score` |

### Findings Table

Filterable table of `findings`:

| Column | Source | Notes |
|--------|--------|-------|
| Severity chip | `findings[].severity`            | error=red, warning=yellow, info=blue |
| Code          | `findings[].finding`             | Link to finding-codes reference |
| Installation  | `findings[].context.mastrNummer` | Truncated; hover → full ID |
| Detail        | `findings[].reason`              | Expandable; `findings[].recommendation` for next steps |

### Portfolio Summary Chips

Render `summary.installationsByType` entries as count chips alongside `summary.totalInstallations` as the total. Keys present depend on which installation types exist in the operator's portfolio.

### Step Timeline

Collapsible 8-step timeline showing which steps were run, skipped, or failed.

---

## Interactions

- **Run new audit**: opens a drawer with `gridOperatorId` input + optional `skipSteps` checkboxes (3–7 only).
- **Execution progress**: spinner + "Running audit…" indicator during execution (up to 180 seconds); disable form while running.
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
| Geo step skipped | `qualityDimensions.geo.score` null → show "–" in bar chart |
