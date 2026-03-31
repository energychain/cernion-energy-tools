# UI Contract: Grid Connection Validation Page

> **Page ID:** `grid-connection`
> **Version:** 0.19.0
> **Last updated:** 2026-03-31

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/grid-connection/validate` | Start 6-step validation (async, 202) |
| `GET`  | `/api/jobs/:jobId`              | Poll for completion |
| `GET`  | `/api/grid-connection/list`     | List past validations |
| `GET`  | `/api/grid-connection/:id`      | Get a specific validation |
| `DELETE` | `/api/grid-connection/:id`    | Delete a validation record |

---

## Trigger (POST /api/grid-connection/validate)

### Request body

```json
{
  "gridOperatorId":  "SNB935578300972",
  "applicant":       { "name": "Mustermann GmbH", "address": "Musterstraße 1, 67063 Ludwigshafen" },
  "installation": {
    "type":         "solar",
    "capacityKW":   500,
    "voltage":      "MS",
    "postalCode":   "67063"
  }
}
```

### Response (202 Accepted)

```json
{ "jobId": "job_gc123", "status": "queued", "pollUrl": "/api/jobs/job_gc123" }
```

---

## Validation Result Shape

```json
{
  "id":           "gc-001",
  "createdAt":    "2026-03-30T14:00:00Z",
  "gridOperator": { "name": "TWL Netze GmbH", "mastrId": "SNB935578300972" },
  "decision":     "GO_CONDITIONAL",
  "findings": [
    { "code": "GO_CONDITIONAL", "severity": "warning", "step": 5, "detail": "..." },
    { "code": "VNB_RESOLVED",   "severity": "info",    "step": 1, "detail": "..." }
  ],
  "findingsCount": { "info": 4, "warning": 7, "error": 1 },
  "steps": [
    { "id": 1, "name": "VNB Identity", "status": "completed", "findingCode": "VNB_RESOLVED" },
    { "id": 2, "name": "Capacity Check", "status": "completed" },
    { "id": 3, "name": "Voltage Check", "status": "completed" },
    { "id": 4, "name": "Data Quality", "status": "completed" },
    { "id": 5, "name": "Decision", "status": "completed", "findingCode": "GO_CONDITIONAL" },
    { "id": 6, "name": "Summary", "status": "completed" }
  ]
}
```

---

## UI Elements

### Decision Banner

Full-width banner at the top of the result:

| Decision | Label | Icon | Colour |
|----------|-------|------|--------|
| `GO_DIRECT` | "Netzanschluss genehmigt" | ✅ | green |
| `GO_CONDITIONAL` | "Genehmigt mit Auflagen" | ⚠️ | yellow |
| `NO_GO_EXPANSION` | "Keine Erweiterung möglich" | 🚫 | orange |
| `NO_GO_CRITICAL` | "Netzanschluss abgelehnt" | ❌ | red |
| `DATA_QUALITY_INSUFFICIENT` | "Datenlage unzureichend" | ℹ️ | grey |

### 6-Step Pipeline Timeline

Vertical stepper showing each step:
- Completed: ✓ with finding code chip
- Running: spinner
- Failed: ✗ in red
- Skipped: dashed border + "Skipped"

### Findings Table

Same structure as MaStR Quality (see [05-mastr-quality.md](05-mastr-quality.md)).

---

## Interactions

- **New validation**: form drawer with installation type, capacity, voltage, postal code.
- **Re-run with same input**: button on existing result → pre-fills form.
- **Print / export PDF**: browser `window.print()` with print stylesheet.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| VNB not resolved (`VNB_NOT_FOUND`) | Red banner: "Grid operator could not be identified" |
| `DATA_QUALITY_INSUFFICIENT` | Show missing-data checklist with required fields |
| Validation in progress | Disable "New validation" button until complete |
