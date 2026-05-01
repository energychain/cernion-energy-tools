# UI Contract: Redispatch Ex-Post Audit Page

> **Page ID:** `redispatch`
> **Version:** 0.38.1
> **Last updated:** 2026-05-01

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/redispatch/audit`    | Start 7-step settlement audit (sync, 200) |
| `GET`  | `/api/redispatch/audits`     | List past audits |
| `GET`  | `/api/redispatch/audits/:id` | Get a specific audit |
| `DELETE` | `/api/redispatch/audits/:id` | Delete an audit record — ⚠ not yet implemented (see CR-0003) |

---

## Trigger (POST /api/redispatch/audit)

### Request body

```json
{
  "gridOperatorId": "SNB935578300972",
  "dateFrom":       "2025-01-01",
  "dateTo":         "2025-12-31",
  "skipSteps":      [4]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `gridOperatorId` | string | Yes\* | MaStR SNB/GNB ID. One of `gridOperatorId`, `gridOperatorBdew`, or `gridOperatorName` required |
| `dateFrom` | date string | Yes | ISO 8601 date (`YYYY-MM-DD`) |
| `dateTo` | date string | Yes | ISO 8601 date; must be > `dateFrom` |
| `skipSteps` | number[] | No | Only steps 3–6 may be skipped |

### Response (200 OK)

Returns the full audit result immediately. Execution may take up to 180 seconds (Moleculer timeout).

---

## Audit Result Shape

```json
{
  "id":           "550e8400-e29b-41d4-a716-446655440003",
  "success":      true,
  "gridOperator": { "name": "TWL Netze GmbH", "mastrId": "SNB935578300972", "bdew": "9907473000008" },
  "period":       { "dateFrom": "2025-01-01", "dateTo": "2025-12-31" },
  "settlementReadiness": {
    "totalInstallations":  59,
    "readyForSettlement":  52,
    "readinessPercent":    88.1,
    "blockedInstallations": 7,
    "blockedMastrNumbers": ["SEE...", "..."]
  },
  "riskAssessment": {
    "blockedFractionPercent":      11.86,
    "curtailmentGWh":              123.4,
    "avgCompensationEurPerMWh":    50,
    "estimatedLostCompensationEur": 45000,
    "riskLevel":                  "medium"
  },
  "summary": {
    "totalInstallations": 59,
    "findingsCount": { "info": 3, "warning": 8, "error": 2 },
    "skippedSteps":  [],
    "durationMs":    45230
  },
  "findings": [...],
  "steps": [
    { "step": 1, "name": "identity",              "status": "success", "durationMs": 500,  "findingsCount": 1 },
    { "step": 2, "name": "portfolio",             "status": "success", "durationMs": 3200, "findingsCount": 0 },
    { "step": 3, "name": "masterDataValidation",  "status": "success", "durationMs": 820,  "findingsCount": 4 },
    { "step": 4, "name": "curtailmentCorrelation","status": "success", "durationMs": 5100, "findingsCount": 3 },
    { "step": 5, "name": "settlementReadiness",   "status": "success", "durationMs": 210,  "findingsCount": 2 },
    { "step": 6, "name": "riskAssessment",        "status": "success", "durationMs": 80,   "findingsCount": 1 },
    { "step": 7, "name": "audit",                 "status": "success", "durationMs": 100,  "findingsCount": 0 }
  ],
  "metadata": { "pipelineVersion": "1.0.0", "executedAt": "2026-03-29T08:00:00Z", "regulatoryBasis": "Redispatch 2.0 (§ 13a EnWG)", "maxAgeMinutes": 120 }
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

Sub-line: `readyForSettlement / totalInstallations Anlagen abrechnungsbereit`

### Risk Assessment Card

| Field | Display |
|-------|---------|
| `riskAssessment.riskLevel` | Badge: low=green, medium=yellow, high=red |
| `riskAssessment.estimatedLostCompensationEur` | `€ N,NNN` formatted; bold if high risk |
| `riskAssessment.curtailmentGWh` | `N.N GWh` abgeregelt |
| `riskAssessment.blockedFractionPercent` | `N.N%` der Anlagen geblockt |

### Curtailment Data

Curtailment volume is available as `riskAssessment.curtailmentGWh` (from step 4 `curtailmentCorrelation`).
A high-frequency curtailment flag is raised by finding code `RD_HIGH_CURTAILMENT_PERIOD` in the findings array.

| Field | Display |
|-------|---------|
| `riskAssessment.curtailmentGWh` | `N.N GWh` abgeregelt |
| `findings[].finding === "RD_HIGH_CURTAILMENT_PERIOD"` | Yellow chip "⚠ Hohe Abregelungsfrequenz" |

> **Note:** Direct curtailment source attribution and `highFrequencyFlag` as a top-level field are
> not yet implemented. Tracked in CR-0003.

### Weg A / Weg B Indicator

> **Note:** A `portfolio.weg` field is not present in the audit response. The portfolio loading
> method can be inferred from findings: presence of `RD_USED_WEG_B` in `findings[].finding`
> indicates Weg B (datapoint fallback) was used; absence means Weg A (live MCP data).
> Direct `portfolio.weg` exposure is tracked in CR-0003.

### 7-Step Timeline

Same stepper component as Grid Connection (see [06-grid-connection.md](06-grid-connection.md)).
Steps 1–2 cannot be skipped (show as forced-enabled).

---

## Interactions

- **Period date pickers**: `dateFrom` / `dateTo` with calendar — validates `dateTo > dateFrom`.
- **Skip steps**: checkboxes for steps 3–6 only; 1 and 2 are always greyed out.
- **Blocked installations list**: expandable section listing `blockedCount` installations with their findings.
- **Export**: "Export CSV" → all findings; "Export PDF" → browser print.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| `RD_PORTFOLIO_EMPTY` | Full-page empty state: "Keine Redispatch-relevanten Anlagen gefunden" |
| Weg B fallback | Yellow info chip: "Portfolio via Datapunkt-Fallback geladen (Weg B)" — detect via `findings[].finding === "RD_USED_WEG_B"` |
| `RD_CURTAILMENT_DATA_UNAVAILABLE` | Grey info chip: "Netztransparenz-Daten nicht verfügbar — 0 GWh-Fallback" |
| `riskAssessment.estimatedLostCompensationEur` > 100000 | `RD_RISK_HIGH` — red banner at top |
| skipSteps includes 1 or 2 | UI prevents selection; show "Schritte 1–2 können nicht übersprungen werden" |

---

## Änderungen seit letzter Version

### v0.30.0 — Settlement-Service

Der neue `settlement`-Service (→ Contract 22) ergänzt den Redispatch-Audit um konkrete
Vergütungsberechnungen. Der Redispatch-Audit identifiziert blockierte Installationen;
`settlement.calculateRedispatch` berechnet daraus die §13a/14-EnWG-Entschädigung.

Typischer Workflow:
1. `POST /api/redispatch/audit` → ermittelt `blockedInstallations` und `curtailmentGWh`
2. `POST /api/settlement/redispatch/calculate` → berechnet `compensationEur`
3. `POST /api/settlement/a96/prepare` → A96-Export für BNetzA-Meldung

### v0.38.0 — Keine Änderungen am Redispatch-Audit-Contract

Der Redispatch-Audit-Service selbst wurde in v0.31–v0.38 nicht geändert.
Die §42c-Erweiterungen betreffen `bilanzkreis.checkReadiness` (→ Contract 23).
