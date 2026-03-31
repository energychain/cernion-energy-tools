# UI Contract: Energy Sharing Validation Page

> **Page ID:** `energy-sharing`
> **Version:** 0.19.0
> **Last updated:** 2026-03-31
> **Legal basis:** § 42c EnWG — Regulatory deadline: 01.06.2026

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/energy-sharing/validate` | Start 6-step validation (async, 202) |
| `GET`  | `/api/jobs/:jobId`             | Poll for completion |
| `GET`  | `/api/energy-sharing/list`     | List past validations |
| `GET`  | `/api/energy-sharing/:id`      | Get a specific validation |
| `DELETE` | `/api/energy-sharing/:id`    | Delete a validation record |

---

## Trigger (POST /api/energy-sharing/validate)

### Request body

```json
{
  "gridOperatorId": "SNB935578300972",
  "generators": [
    { "mastrId": "SEE900123", "capacityKW": 100, "malo": "DE000123456789" },
    { "mastrId": "SEE900456", "capacityKW": 50,  "malo": "DE000987654321" }
  ],
  "consumers": [
    { "malo": "DE000111111111", "sharePercent": 60 },
    { "malo": "DE000222222222", "sharePercent": 40 }
  ]
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `gridOperatorId` | string | Yes | MaStR SNB/GNB ID |
| `generators` | array | Yes | ≥ 1 generator required |
| `generators[].mastrId` | string | Yes | `SEE…` prefix |
| `generators[].malo` | string | Yes | DE + 11 digits |
| `consumers` | array | Yes | ≥ 1 consumer required |
| `consumers[].sharePercent` | number | Yes | Sum of all shares must equal 100 |

UI MUST validate that `sum(consumers[].sharePercent) === 100` before submission.

---

## Validation Result Shape

```json
{
  "id":           "es-001",
  "createdAt":    "2026-03-31T08:00:00Z",
  "gridOperator": { "name": "TWL Netze GmbH" },
  "decision":     "APPROVED_WITH_CONDITIONS",
  "findings": [...],
  "findingsCount": { "info": 3, "warning": 5, "error": 0 },
  "generatorResults": [
    { "mastrId": "SEE900123", "status": "valid", "dvValidated": true }
  ]
}
```

---

## UI Elements

### Decision Banner

Same as [Grid Connection](06-grid-connection.md) but with Energy Sharing decisions:

| Decision | Label | Colour |
|----------|-------|--------|
| `APPROVED` | "Energieverbrauch genehmigt" | green |
| `APPROVED_WITH_CONDITIONS` | "Genehmigt mit Auflagen" | yellow |
| `REJECTED` | "Abgelehnt" | red |
| `PENDING_DOCUMENTS` | "Dokumente ausstehend" | grey |
| `ELIGIBLE` | "Förderfähig (§ 42c EnWG)" | blue |
| `NOT_ELIGIBLE` | "Nicht förderfähig" | grey |

### Generator / Consumer Input Table

Two dynamic sections (add/remove rows):
- **Generators**: `mastrId` input, `capacityKW`, `malo` — validated MaLo format `DE + 11 digits`
- **Consumers**: `malo`, `sharePercent` — live share-sum validation (must equal 100%)

Share sum display: `ΣShare = 100%` ✓ green / `ΣShare = 85%` ✗ red.

### Per-Generator Result Chips

After completion, show each generator's `status` and `dvValidated`:

| Status | Chip | Colour |
|--------|------|--------|
| `valid` + `dvValidated: true` | "✓ DV aktiv" | green |
| `valid` + `dvValidated: false` | "⚠ DV inaktiv" | yellow |
| `invalid` | "✗ Fehler" | red |

---

## Regulatory Deadline Banner

Show a warning banner when the current date is within 90 days of `2026-06-01`:

> **⚠ Frist § 42c EnWG: 01.06.2026** — Validierung und Dokumentation muss bis dahin abgeschlossen sein.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Share sum ≠ 100% | Disable "Validate" button; show "Anteile müssen 100% ergeben (aktuell: N%)" |
| Invalid MaLo format | Inline field error: "MaLo muss mit 'DE' + 11 Stellen beginnen" |
| Generator not found in MaStR | Finding `ES_GENERATOR_NOT_FOUND`; show red chip in generator table |
