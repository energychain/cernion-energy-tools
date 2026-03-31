# UI Contract: Redispatch Ex-Post Audit Page

> **Page ID:** `redispatch`
> **Version:** 0.19.0
> **Last updated:** 2026-03-31

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/redispatch/audit`    | Start 7-step settlement audit (async, 202) |
| `GET`  | `/api/jobs/:jobId`         | Poll for completion |
| `GET`  | `/api/redispatch/list`     | List past audits |
| `GET`  | `/api/redispatch/:id`      | Get a specific audit |
| `DELETE` | `/api/redispatch/:id`    | Delete an audit record |

---

## Trigger (POST /api/redispatch/audit)

### Request body

```json
{
  "gridOperatorId": "SNB935578300972",
  "periodFrom":     "2025-01-01",
  "periodTo":       "2025-12-31",
  "skipSteps":      [4]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `gridOperatorId` | string | Yes | MaStR SNB/GNB ID |
| `periodFrom` | date string | Yes | ISO 8601 date |
| `periodTo` | date string | Yes | ISO 8601 date; must be > `periodFrom` |
| `skipSteps` | number[] | No | Only steps 3–6 may be skipped |

### Response (202 Accepted)

```json
{ "jobId": "job_rd123", "status": "queued", "pollUrl": "/api/jobs/job_rd123" }
```

---

## Audit Result Shape

```json
{
  "id":           "rd-001",
  "createdAt":    "2026-03-29T08:00:00Z",
  "gridOperator": { "name": "TWL Netze GmbH", "mastrId": "SNB935578300972" },
  "period":       { "from": "2025-01-01", "to": "2025-12-31" },
  "settlementReadiness": {
    "readinessPercent": 88.1,
    "readyCount":       52,
    "blockedCount":     7,
    "totalCount":       59
  },
  "riskAssessment": {
    "level":              "medium",
    "estimatedExposureEur": 45000
  },
  "curtailment": {
    "totalGWh":          123.4,
    "source":            "netztransparenz",
    "highFrequencyFlag": false
  },
  "findings": [...],
  "findingsCount": { "info": 3, "warning": 8, "error": 2 },
  "portfolio": { "total": 59, "weg": "A" }
}
```

---

## UI Elements

### Settlement Readiness KPI

Large circular gauge:
- `settlementReadiness.readinessPercent`%
- < 80% → red ("🚨 Kritisch")
- 80–99% → yellow ("⚠ Teilbereit")
- 100% → green ("✓ Vollständig")

Sub-line: `readyCount / totalCount Anlagen abrechnungsbereit`

### Risk Assessment Card

| Field | Display |
|-------|---------|
| `riskAssessment.level` | Badge: low=green, medium=yellow, high=red |
| `riskAssessment.estimatedExposureEur` | `€ N,NNN` formatted; bold if high risk |

### Curtailment Summary

| Field | Display |
|-------|---------|
| `curtailment.totalGWh` | `N.N GWh` abgeregelt |
| `curtailment.source` | Attribution: "Quelle: Netztransparenz" |
| `curtailment.highFrequencyFlag` | If true: yellow chip "⚠ Hohe Abregelungsfrequenz" |

### Weg A / Weg B Indicator

Pill badge: `portfolio.weg` — "Weg A (MCP)" or "Weg B (Datapoint)"

### 7-Step Timeline

Same stepper component as Grid Connection (see [06-grid-connection.md](06-grid-connection.md)).
Steps 1–2 cannot be skipped (show as forced-enabled).

---

## Interactions

- **Period date pickers**: `periodFrom` / `periodTo` with calendar — validates `to > from`.
- **Skip steps**: checkboxes for steps 3–6 only; 1 and 2 are always greyed out.
- **Blocked installations list**: expandable section listing `blockedCount` installations with their findings.
- **Export**: "Export CSV" → all findings; "Export PDF" → browser print.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| `RD_PORTFOLIO_EMPTY` | Full-page empty state: "Keine Redispatch-relevanten Anlagen gefunden" |
| Weg B fallback | Yellow info chip: "Portfolio via Datapunkt-Fallback geladen (Weg B)" |
| `RD_CURTAILMENT_DATA_UNAVAILABLE` | Grey info chip: "Netztransparenz-Daten nicht verfügbar — 0 GWh-Fallback" |
| `estimatedExposureEur` > 100000 | `RD_RISK_HIGH` — red banner at top |
| skipSteps includes 1 or 2 | UI prevents selection; show "Schritte 1–2 können nicht übersprungen werden" |
