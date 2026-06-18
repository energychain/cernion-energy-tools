# UI Contract: Grid Connection Validation Page

> **Page ID:** `grid-connection`
> **Version:** 0.20.4
> **Last updated:** 2026-04-04

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/grid-connection/validate` | Start 6-step validation (sync, 200) |
| `GET`  | `/api/grid-connection/validations`     | List past validations |
| `GET`  | `/api/grid-connection/validations/:id` | Get a specific validation |
| `DELETE` | `/api/grid-connection/validations/:id` | Delete a validation record — ⚠ not yet implemented (see CR-0003) |

### Additional deterministic Phase-5 endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/grid-connection/fnav/validate` | Validate flexible Netzanschlussvertrag profile and governance blockers |
| `POST` | `/api/netzfahrplan/generate` | Build the Phase-5 Netzfahrplan / N-1 / governance assessment |

For flexible fNAV profiles, both endpoints accept additive optional fields `signalPriorityPolicy` and `controlEvidenceRef`. Missing values do not break the API contract, but they produce explicit contract-gate blockers instead of implicit approval.

---

## Trigger (POST /api/grid-connection/validate)

### Request body

```json
{
  "gridOperatorId":       "SNB935578300972",
  "skipSteps":            [],
  "maxAgeMinutes":        120,
  "includeCapacityCheck": true
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `gridOperatorId` | string | Yes\* | MaStR SNB/GNB ID. One of `gridOperatorId`, `gridOperatorBdew`, or `gridOperatorName` required |
| `gridOperatorBdew` | string | Yes\* | BDEW code (alternative to `gridOperatorId`) |
| `gridOperatorName` | string | Yes\* | Name (fuzzy, alternative to `gridOperatorId`) |
| `skipSteps` | number[] | No | Skippable steps: 3–6 only (1 and 2 always run) |
| `maxAgeMinutes` | number | No | Datapoint freshness gate in minutes (default: 120) |
| `includeCapacityCheck` | boolean | No | Enable step 3 capacity analysis (default: true) |

### Response (200 OK)

Returns the full validation result immediately. Execution may take up to 180 seconds (Moleculer timeout).

---

## Validation Result Shape

```json
{
  "id":           "550e8400-e29b-41d4-a716-446655440001",
  "success":      true,
  "gridOperator": { "name": "STROMDAO Netze GmbH", "mastrId": "SNB935578300972" },
  "decision":     "GO_CONDITIONAL",
  "summary": {
    "totalInstallations": 59,
    "totalCapacityMW":    73.4,
    "installationsByType": { "solar": 30, "wind": 15, "storage": 14 },
    "findingsCount": { "info": 4, "warning": 7, "error": 1 },
    "durationMs":    12450
  },
  "findings": [
    { "id": "F-5-001", "step": 5, "stepName": "decision",  "finding": "GO_CONDITIONAL",  "severity": "warning", "title": "...", "reason": "...", "context": {}, "recommendation": null },
    { "id": "F-1-001", "step": 1, "stepName": "inventory", "finding": "GC_VNB_RESOLVED", "severity": "info",    "title": "...", "reason": "...", "context": {}, "recommendation": null }
  ],
  "steps": [
    { "step": 1, "name": "inventory",  "status": "success", "durationMs": 3200, "findingsCount": 1 },
    { "step": 2, "name": "delta",      "status": "success", "durationMs": 820,  "findingsCount": 2 },
    { "step": 3, "name": "capacity",   "status": "success", "durationMs": 630,  "findingsCount": 1 },
    { "step": 4, "name": "benchmark",  "status": "success", "durationMs": 1100, "findingsCount": 3 },
    { "step": 5, "name": "decision",   "status": "success", "durationMs": 50,   "findingsCount": 1 },
    { "step": 6, "name": "audit",      "status": "success", "durationMs": 200,  "findingsCount": 0 }
  ],
  "snapshot": null,
  "metadata": { "pipelineVersion": "1.0.0", "executedAt": "2026-03-30T14:00:00Z", "maxAgeMinutes": 120 }
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
| `DATA_QUALITY_INSUFFICIENT` | "Datenlage unzureichend" | ℹ️ | grey |

### 6-Step Pipeline Timeline

Vertical stepper showing each step:
- Completed: ✓ with `findingsCount` badge
- Running: spinner
- Failed: ✗ in red
- Skipped: dashed border + "Skipped"

Step fields: `{ step, name, status, durationMs, findingsCount }`. No `findingCode` per step — filter `findings[]` by step number to show per-step findings.

### Findings Table

Same structure as MaStR Quality (see [05-mastr-quality.md](05-mastr-quality.md)).

---

## Interactions

- **New validation**: form drawer with `gridOperatorId` (or BDEW code / name) input + optional `skipSteps` checkboxes (3–6 only).
- **Re-run with same input**: button on existing result → pre-fills form.
- **Print / export PDF**: browser `window.print()` with print stylesheet.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| VNB not resolved (`VNB_NOT_FOUND`) | Red banner: "Grid operator could not be identified" |
| `DATA_QUALITY_INSUFFICIENT` | Show missing-data checklist with required fields |
| Validation in progress | Disable "New validation" button until complete |
