# UI Contract: Energy Sharing Validation Page

> **Page ID:** `energy-sharing`
> **Version:** 0.20.6
> **Last updated:** 2026-04-06
> **Legal basis:** § 42c EnWG — Regulatory deadline: 01.06.2026

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/energy-sharing/validate` | Start 6-step validation (sync, 200) |
| `GET`  | `/api/energy-sharing/validations`     | List past validations |
| `GET`  | `/api/energy-sharing/validations/:id` | Get a specific validation |
| `DELETE` | `/api/energy-sharing/validations/:id` | Delete a validation record — ⚠ not yet implemented (see CR-0003) |

---

## Trigger (POST /api/energy-sharing/validate)

### Request body

```json
{
  "gridOperatorId": "SNB935578300972",
  "communityName":  "Solargemeinschaft Rheinallee",
  "communityId":    "ES-2026-001",
  "generators": [
    { "mastrNummer": "SEE904837264953", "sharePercent": 100, "direktvermarkter": "Next Kraftwerke GmbH" }
  ],
  "consumers": [
    { "maloId": "DE00012345678901234567890123456789", "sharePercent": 60, "name": "Whg. 1" },
    { "maloId": "DE00098765432109876543210987654321", "sharePercent": 40, "name": "Whg. 2" }
  ]
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `gridOperatorId` | string | Yes\* | MaStR SNB/GNB ID. One of `gridOperatorId`, `gridOperatorBdew`, or `gridOperatorName` required |
| `communityName` | string | No | Display name for the energy community |
| `communityId` | string | No | Internal identifier for the community |
| `generators` | array | Yes | ≥ 1 generator required |
| `generators[].mastrNummer` | string | Yes | MaStR installation ID (`SEE…` prefix, 16 chars) |
| `generators[].sharePercent` | number | Yes | Generator’s share of the community |
| `generators[].direktvermarkter` | string | No | Direct marketer company name for cross-check |
| `consumers` | array | Yes | ≥ 1 consumer required |
| `consumers[].maloId` | string | Yes | Market Location ID: `DE` + 33 chars (34 total) |
| `consumers[].sharePercent` | number | Yes | Sum of all consumer shares must equal 100 |
| `consumers[].name` | string | No | Optional display name for the consumer |

UI MUST validate that `sum(consumers[].sharePercent) === 100` before submission.

---

## Validation Result Shape

```json
{
  "id":            "550e8400-e29b-41d4-a716-446655440002",
  "success":       true,
  "communityName": "Solargemeinschaft Rheinallee",
  "communityId":   "ES-2026-001",
  "gridOperator":  { "name": "TWL Netze GmbH", "mastrId": "SNB935578300972" },
  "decision":      "APPROVED_WITH_CONDITIONS",
  "summary": {
    "generatorsSubmitted": 1,
    "generatorsValid":     1,
    "generatorsInvalid":   0,
    "consumersSubmitted":  2,
    "dvStatus":            "all_confirmed",
    "totalGeneratorCapacityKW": 350,
    "findingsCount": { "info": 3, "warning": 5, "error": 0 },
    "durationMs":    5200
  },
  "generators": [
    { "mastrNummer": "SEE904837264953", "sharePercent": 100, "status": "valid", "dvConfirmed": true, "hasDvFlag": true, "capacityKW": 350, "type": "solar" }
  ],
  "consumers": [
    { "maloId": "DE00012345678901234567890123456789", "sharePercent": 60 },
    { "maloId": "DE00098765432109876543210987654321", "sharePercent": 40 }
  ],
  "findings": [...],
  "steps": [
    { "step": 1, "name": "identity",       "status": "success", "durationMs": 150,  "findingsCount": 0 },
    { "step": 2, "name": "generators",     "status": "success", "durationMs": 2100, "findingsCount": 0 },
    { "step": 3, "name": "directMarketer", "status": "success", "durationMs": 800,  "findingsCount": 0 },
    { "step": 4, "name": "eligibility",    "status": "success", "durationMs": 420,  "findingsCount": 2 },
    { "step": 5, "name": "decision",       "status": "success", "durationMs": 50,   "findingsCount": 1 },
    { "step": 6, "name": "audit",          "status": "success", "durationMs": 100,  "findingsCount": 0 }
  ],
  "snapshot": null,
  "metadata": { "pipelineVersion": "1.0.0", "executedAt": "2026-03-31T08:00:00Z", "regulatoryBasis": "§ 42c EnWG", "deadline": "2026-06-01" }
}
```

---

## UI Elements

### Decision Banner

Same as [Grid Connection](06-grid-connection.md) but with Energy Sharing decisions:

| API-Response-Wert | Label | Colour |
|-------------------|-------|--------|
| `APPROVED` | "Energieverbrauch genehmigt" | green |
| `APPROVED_WITH_CONDITIONS` | "Genehmigt mit Auflagen" | yellow |
| `REJECTED_STRUCTURAL` | "Strukturell abgelehnt" | red |
| `REJECTED_GENERATOR_INVALID` | "Anlage nicht qualifiziert" | red |
| `REJECTED_OTHER` | "Abgelehnt (sonstig)" | red |

> **Wichtig — Präfix-Konvention:** Die JavaScript-Konstantennamen im Backend tragen
> ein `ES_`-Präfix (z.B. `ES_REJECTED_STRUCTURAL`), aber die **API-Responses
> verwenden die Werte ohne Präfix** (`REJECTED_STRUCTURAL`). Dies gilt für alle
> Energy-Sharing-Finding-Codes und Decision-Werte.
>
> Matching im Frontend immer gegen den **Wert** (ohne Präfix), nicht gegen den
> Konstantennamen:
> ```typescript
> // ✅ Korrekt
> decision === 'REJECTED_STRUCTURAL'
> // ❌ Falsch
> decision === 'ES_REJECTED_STRUCTURAL'
> ```
> Verifizierte Enum-Werte: `docs/agent-decision-enums.ts`

### Generator / Consumer Input Table

Two dynamic sections (add/remove rows):
- **Generators**: `mastrNummer` input, optional `direktvermarkter` — capacity is looked up from MaStR, not an input field
- **Consumers**: `maloId` (format: `DE` + 33 chars = 34 total), `sharePercent`, optional `name` — live share-sum validation (must equal 100%)

Share sum display: `ΣShare = 100%` ✓ green / `ΣShare = 85%` ✗ red.

### Per-Generator Result Chips

After completion, show each generator's `status` and `dvValidated`:

| Status | Chip | Colour |
|--------|------|--------|
| `valid` + `dvConfirmed: true`  | "✓ DV aktiv"   | green  |
| `valid` + `dvConfirmed: false` | "⚠ DV inaktiv" | yellow |
| `invalid`                      | "✗ Fehler"     | red    |

---

## Regulatory Deadline Banner

Show a warning banner when the current date is within 90 days of `2026-06-01`:

> **⚠ Frist § 42c EnWG: 01.06.2026** — Validierung und Dokumentation muss bis dahin abgeschlossen sein.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Share sum ≠ 100% | Disable "Validate" button; show "Anteile müssen 100% ergeben (aktuell: N%)" |
| Invalid MaLo format | Inline field error: "MaLo-ID muss mit 'DE' beginnen und 34 Zeichen haben (z.B. DE00012345678901234567890123456789)" |
| Generator not found in MaStR | Finding `ES_GENERATOR_NOT_FOUND`; show red chip in generator table |
