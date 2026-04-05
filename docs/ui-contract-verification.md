# UI-Contract Verification — v0.20.4

> **Purpose:** Verify agent response shapes against `docs/ui-contracts/05–08`
> All contracts verified and aligned with actual API shapes as of v0.20.4.
> **Source:** Static code analysis of agent services vs. UI-Contract field specs.
> **Generated:** 2026-04-04

## Legend

| Icon | Meaning |
|------|---------|
| ✅ | Field present with correct name |
| ⚠️ | Field present but under a different name / path — UI-Contract must be updated |
| ❌ | Field absent from response — either add to service or remove from contract |
| 🔴 | Request body field mismatch — frontend sends wrong field name |

---

## 1. `POST /api/mastr-quality/audit`  ->  UI-Contract 05

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `id` | `id` | ✅ |  |
| `metadata.executedAt` | `metadata.executedAt` | ✅ |  |
| `gridOperator.name` | `gridOperator.name` | ✅ |  |
| `gridOperator.mastrId` | `gridOperator.mastrId` | ✅ |  |
| `qualityScore` | `qualityScore` | ✅ |  |
| `qualityDimensions.connectionPoints.score` | `qualityDimensions.connectionPoints.score` | ✅ |  |
| `qualityDimensions.connectionPoints.weight` | `qualityDimensions.connectionPoints.weight` | ✅ |  |
| `qualityDimensions.capacity.score` | `qualityDimensions.capacity.score` | ✅ |  |
| `qualityDimensions.capacity.weight` | `qualityDimensions.capacity.weight` | ✅ |  |
| `qualityDimensions.geo.score` | `qualityDimensions.geo.score` | ✅ |  |
| `qualityDimensions.geo.weight` | `qualityDimensions.geo.weight` | ✅ |  |
| `qualityDimensions.status.score` | `qualityDimensions.status.score` | ✅ |  |
| `qualityDimensions.status.weight` | `qualityDimensions.status.weight` | ✅ |  |
| `qualityDimensions.duplicates.score` | `qualityDimensions.duplicates.score` | ✅ |  |
| `qualityDimensions.duplicates.weight` | `qualityDimensions.duplicates.weight` | ✅ |  |
| `findings[].finding` | `findings[].finding` | ✅ |  |
| `findings[].severity` | `findings[].severity` | ✅ |  |
| `findings[].reason` | `findings[].reason` | ✅ |  |
| `findings[].context.mastrNummer` | `findings[].context.mastrNummer` | ✅ |  |
| `summary.findingsCount.info` | `summary.findingsCount.info` | ✅ |  |
| `summary.findingsCount.warning` | `summary.findingsCount.warning` | ✅ |  |
| `summary.findingsCount.error` | `summary.findingsCount.error` | ✅ |  |
| `summary.totalInstallations` | `summary.totalInstallations` | ✅ |  |
| `summary.installationsByType` | `summary.installationsByType` | ✅ |  |

## 2. `POST /api/grid-connection/validate`  ->  UI-Contract 06

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `id` | `id` | ✅ |  |
| `metadata.executedAt` | `metadata.executedAt` | ✅ |  |
| `gridOperator.name` | `gridOperator.name` | ✅ |  |
| `gridOperator.mastrId` | `gridOperator.mastrId` | ✅ |  |
| `decision` | `decision` | ✅ |  |
| `findings[].finding` | `findings[].finding` | ✅ |  |
| `findings[].severity` | `findings[].severity` | ✅ |  |
| `findings[].reason` | `findings[].reason` | ✅ |  |
| `findings[].step` | `findings[].step` | ✅ |  |
| `summary.findingsCount.info` | `summary.findingsCount.info` | ✅ |  |
| `summary.findingsCount.warning` | `summary.findingsCount.warning` | ✅ |  |
| `summary.findingsCount.error` | `summary.findingsCount.error` | ✅ |  |
| `steps[].step` | `steps[].step` | ✅ |  |
| `steps[].name` | `steps[].name` | ✅ |  |
| `steps[].status` | `steps[].status` | ✅ |  |
| `steps[].findingCode` | `(not present)` | ❌ | Not emitted. Filter findings[] by step number for per-step findings. Tracked CR-0003. |

## 3. `POST /api/energy-sharing/validate`  ->  UI-Contract 07

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `id` | `id` | ✅ |  |
| `metadata.executedAt` | `metadata.executedAt` | ✅ |  |
| `gridOperator.name` | `gridOperator.name` | ✅ |  |
| `decision` | `decision` | ✅ |  |
| `findings[].finding` | `findings[].finding` | ✅ |  |
| `findings[].severity` | `findings[].severity` | ✅ |  |
| `summary.findingsCount.info` | `summary.findingsCount.info` | ✅ |  |
| `summary.findingsCount.warning` | `summary.findingsCount.warning` | ✅ |  |
| `summary.findingsCount.error` | `summary.findingsCount.error` | ✅ |  |
| `generators[].mastrNummer` | `generators[].mastrNummer` | ✅ |  |
| `generators[].status` | `generators[].status` | ✅ |  |
| `generators[].dvConfirmed` | `generators[].dvConfirmed` | ✅ | Boolean set by step 3 DV check. hasDvFlag is a separate MaStR field (FernsteuerbarkeitDv). |
| `generators[].hasDvFlag` | `generators[].hasDvFlag` | ✅ |  |
| `consumers[].maloId` | `consumers[].maloId` | ✅ |  |

## 4. `POST /api/redispatch/audit`  ->  UI-Contract 08

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `id` | `id` | ✅ |  |
| `metadata.executedAt` | `metadata.executedAt` | ✅ |  |
| `gridOperator.name` | `gridOperator.name` | ✅ |  |
| `gridOperator.mastrId` | `gridOperator.mastrId` | ✅ |  |
| `period.dateFrom` | `period.dateFrom` | ✅ |  |
| `period.dateTo` | `period.dateTo` | ✅ |  |
| `settlementReadiness.totalInstallations` | `settlementReadiness.totalInstallations` | ✅ |  |
| `settlementReadiness.readyForSettlement` | `settlementReadiness.readyForSettlement` | ✅ |  |
| `settlementReadiness.readinessPercent` | `settlementReadiness.readinessPercent` | ✅ |  |
| `settlementReadiness.blockedInstallations` | `settlementReadiness.blockedInstallations` | ✅ |  |
| `riskAssessment.riskLevel` | `riskAssessment.riskLevel` | ✅ |  |
| `riskAssessment.estimatedLostCompensationEur` | `riskAssessment.estimatedLostCompensationEur` | ✅ |  |
| `riskAssessment.curtailmentGWh` | `riskAssessment.curtailmentGWh` | ✅ |  |
| `riskAssessment.blockedFractionPercent` | `riskAssessment.blockedFractionPercent` | ✅ |  |
| `summary.findingsCount.info` | `summary.findingsCount.info` | ✅ |  |
| `summary.findingsCount.warning` | `summary.findingsCount.warning` | ✅ |  |
| `summary.findingsCount.error` | `summary.findingsCount.error` | ✅ |  |
| `curtailment (top-level)` | `(not present)` | ❌ | No top-level curtailment. curtailmentGWh is in riskAssessment. highFrequencyFlag via finding RD_HIGH_CURTAILMENT_PERIOD. Tracked CR-0003. |
| `portfolio.weg` | `(not present)` | ❌ | Weg A/B not exposed at top level. Infer from finding RD_USED_WEG_B. Tracked CR-0003. |

## 5. `GET /api/mastr-quality/list`  ->  UI-Contract 05 (list)

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `count` | `count` | ✅ |  |
| `audits` | `audits` | ✅ |  |
| `audits[0].qualityScore` | `audits[0].qualityScore` | ✅ |  |
| `audits[0].gridOperator.name` | `audits[0].gridOperator.name` | ✅ |  |

## 6. `GET /api/grid-connection/list`  ->  UI-Contract 06 (list)

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `count` | `count` | ✅ |  |
| `validations` | `validations` | ✅ |  |
| `validations[0].decision` | `validations[0].decision` | ✅ |  |

## 7. `GET /api/energy-sharing/list`  ->  UI-Contract 07 (list)

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `count` | `count` | ✅ |  |
| `validations` | `validations` | ✅ |  |
| `validations[0].decision` | `validations[0].decision` | ✅ |  |

## 8. `GET /api/redispatch/list`  ->  UI-Contract 08 (list)

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `count` | `count` | ✅ |  |
| `audits` | `audits` | ✅ |  |
| `audits[0].settlementReadiness.readinessPercent` | `audits[0].settlementReadiness.readinessPercent` | ✅ |  |

---

## 9. `GET /api/dashboard/quality-summary`  →  dashboard-api.qualitySummary (v0.20.4)

> **Verifikation der internen Feldpfade** — `dashboard-api.service.js` liest aus den
> jeweiligen Agent-List-Responses. Verifiziert per statischer Code-Analyse (2026-04-05).

| Agent | safeCall-Ziel | collection key | metricKey | Korrekt? |
|-------|--------------|----------------|-----------|:--------:|
| mastr-quality | `mastr-quality.list` | `value?.audits` | `qualityScore` | ✅ |
| grid-connection | `grid-connection.list` | `value?.validations` | `decision` | ✅ |
| energy-sharing | `energy-sharing.list` | `value?.validations` | `decision` | ✅ |
| redispatch-expost | `redispatch-expost.list` | `value?.audits` | `settlementReadiness` | ✅ |
| energy-sharing-allocation | `energy-sharing-allocation.list` | `value?.allocations` | `totalNetGenerationKWh` | ✅ |

**Ergebnis:** Alle fünf Pfade sind korrekt — kein Korrektur-Bedarf in `dashboard-api.service.js`.

**Anmerkung `settlementReadiness`:** `buildAgentEntry` liest `audits[0].settlementReadiness`
als volles Objekt (nicht als flacher Scalar). `buildKpis` hingegen liest korrekt
`audit.settlementReadiness?.readinessPercent` für den KPI-Wert. Dieses Verhalten ist
Contract-konform: `qualitySummary.agents[3].keyMetric.value` ist das vollständige
`settlementReadiness`-Objekt; das flache `readinessPercent` steht im separaten KPI.

---

## 10. `POST /api/energy-sharing-allocation/allocate` — Live-Test (v0.20.4)

> **Live-Test:** 2026-04-05, Server `10.0.0.8:3900`

### Korrektes Request-Schema

```json
{
  "communityId":  "ES-2026-VERIFY",
  "generators":   [{ "mastrNummer": "SEE904837264953", "sharePercent": 100 }],
  "consumers":    [{ "maloId": "DE0001234567890123456789012345678", "sharePercent": 100, "name": "Wohnung 1" }],
  "dateFrom":     "2026-06-01",
  "dateTo":       "2026-06-03",
  "dataSource":   "forecast"
}
```

### Endpoint-Ergebnisse

| Endpoint | HTTP | Ergebnis |
|----------|:----:|---------|
| `POST /allocate` | **200** ✅ | Volles Allokations-Objekt zurückgegeben |
| `GET /allocations` | **200** ✅ | `{ count: 1, allocations: [...] }` |
| `GET /allocations/:id` | **200** ✅ | Einzelner Datensatz |
| `GET /allocations/:id/download?maloId=...` | **200** ✅ | CSV (text/csv, semicolon-delimited) |
| `GET /allocations/export` (bulk) | **404** — | Kein Bulk-Export-Endpunkt vorhanden (by design) |

### Beispiel-Response `POST /allocate`

```json
{
  "success":            true,
  "id":                 "11bc7d5d-b36e-422d-aaf1-a0b7ef65b4e7",
  "communityId":        "ES-2026-VERIFY",
  "validationReportId": null,
  "dateFrom":           "2026-06-01",
  "dateTo":             "2026-06-03",
  "dataSource":         "forecast",
  "redispatchApplied":  false,
  "warnings":           [],
  "generators":         [{ "mastrNummer": "SEE904837264953", "sharePercent": 100 }],
  "consumers":          [{
    "maloId":           "DE0001234567890123456789012345678",
    "name":             "Wohnung 1",
    "sharePercent":     100,
    "totalKWh":         0,
    "peakKW":           0,
    "zeroIntervals":    288,
    "intervalCount":    288,
    "avgKWhPerInterval":0
  }],
  "summary": {
    "totalGenerationKWh":         0,
    "totalRedispatchDeductionKWh":0,
    "totalNetGenerationKWh":      0,
    "intervalCount":              288,
    "dateFrom":                   "2026-06-01",
    "dateTo":                     "2026-06-03",
    "dataSource":                 "forecast",
    "durationMs":                 1578
  },
  "metadata": {
    "pipelineVersion":  "0.16.0",
    "executedAt":       "2026-04-05T09:53:38.654Z",
    "regulatoryBasis":  "§ 42c EnWG, § 12 StromNZV"
  }
}
```

**Anmerkung:** `totalNetGenerationKWh: 0` ist erwartet — die Prognose-Pipeline
(`dataSource: "forecast"`) liefert für nicht-registrierte MaStR-Nummern eine synthetische
Null-Zeitreihe. Mit einer realen MaStR-Nummer werden echte Ertragswerte zurückgegeben.

### Wichtig: Früheres 422-Fehlermuster

Das Request-Schema war in der Verifikation zunächst falsch aufgebaut:
`{ gridOperatorId, validationId, period }` — das liefert **HTTP 422** (VALIDATION_ERROR).
**Korrekte Pflichtfelder:** `generators`, `consumers`, `dateFrom`, `dateTo`.

---

## Summary

| Metric | Count |
|--------|-------|
| Total fields checked | 86 |
| Correct | 83 |
| Renamed (contract update needed) | 0 |
| Missing (field absent from response) | 3 |
| Request body mismatch | 0 |

**Match rate:** 97%
**Actionable:** 3 items (tracked in `feedback/CR-0003.md` + `feedback/CR-0003-missing-agent-fields.md`)

**dashboard-api.qualitySummary:** All 5 internal field paths verified correct (see §9). No code changes required.

**Allocation endpoints:** All 4 primary endpoints operational (see §10).

---

## Changes Applied (v0.20.4)

All contract-vs-reality naming mismatches were resolved in v0.20.4. The following changes were applied to `docs/ui-contracts/05–08`:

| Contract | Change |
|----------|--------|
| 05, 06, 07, 08 | `async, 202 + jobId polling` → `sync, 200` (all agents return full result immediately) |
| 05 | `dimensions.*` → `qualityDimensions.*`; dimension keys corrected (registration→connectionPoints, connectivity→status, deduplication→duplicates); weights corrected (30/25/20/15/10 → 30/20/20/15/15) |
| 05 | `findings[].code` → `findings[].finding`; `findings[].installationId` → `findings[].context.mastrNummer` |
| 05 | `findingsCount` (top-level) → `summary.findingsCount`; `portfolio.*` → `summary.totalInstallations` / `summary.installationsByType` |
| 06 | `findings[].code` → `findings[].finding`; `findings[].detail` → `findings[].reason` |
| 06 | `NO_GO_CRITICAL` removed from decision table (constant does not exist in service) |
| 07 | Decision values `REJECTED`, `PENDING_DOCUMENTS`, `ELIGIBLE`, `NOT_ELIGIBLE` replaced with `REJECTED_STRUCTURAL`, `REJECTED_GENERATOR_INVALID`, `REJECTED_OTHER` |
| 07 | `generatorResults[].mastrId` → `generators[].mastrNummer`; `dvValidated` → `dvConfirmed` |
| 08 | `period.from/to` → `period.dateFrom/dateTo`; `settlementReadiness.*` and `riskAssessment.*` field names corrected |

---

## Open Bugs — CR-0003 (structural gaps)

The 3 remaining ❌ entries are **absent from the service response** — not naming issues.
The contracts already document workarounds. Actual code changes tracked in CR-0003.

| # | Field | Workaround in contract |
|---|-------|------------------------|
| 1 | `steps[].findingCode` (grid-connection) | Filter `findings[]` by `step` number |
| 2 | `curtailment` top-level (redispatch) | `riskAssessment.curtailmentGWh` + finding `RD_HIGH_CURTAILMENT_PERIOD` |
| 3 | `portfolio.weg` (redispatch) | Finding `RD_USED_WEG_B` presence indicates Weg B |

---

## Allocation Endpoint Status

`POST /api/energy-sharing-allocation/allocate` → **HTTP 200** — implemented. See §10 for full live-test documentation.
`GET /api/energy-sharing-allocation/allocations` → **HTTP 200** — implemented.
`GET /api/energy-sharing-allocation/allocations/:id/download?maloId=...` → **HTTP 200** — CSV download functional.
