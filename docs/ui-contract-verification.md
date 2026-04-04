# UI-Contract Verification — v0.20.2

> **Purpose:** Verify agent response shapes against `docs/ui-contracts/05–08`
> before the frontend builds v0.20.3 agent pages.
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
| `createdAt` | `metadata.executedAt` | ⚠️ | Not at top level. Stored in PouchDB; use metadata.executedAt in audit response. |
| `gridOperator.name` | `gridOperator.name` | ✅ |  |
| `gridOperator.mastrId` | `gridOperator.mastrId` | ✅ |  |
| `qualityScore` | `qualityScore` | ✅ |  |
| `dimensions` | `qualityDimensions` | ⚠️ | Top-level key is qualityDimensions, not dimensions. |
| `dimensions.registration` | `qualityDimensions.connectionPoints` | ⚠️ | registration → connectionPoints (QUALITY_DIMENSION_WEIGHTS key in src/validation-findings.js) |
| `dimensions.registration.score` | `qualityDimensions.connectionPoints.score` | ⚠️ |  |
| `dimensions.registration.weight` | `qualityDimensions.connectionPoints.weight` | ⚠️ |  |
| `dimensions.capacity.score` | `qualityDimensions.capacity.score` | ⚠️ | key correct but parent is qualityDimensions |
| `dimensions.capacity.weight` | `qualityDimensions.capacity.weight` | ⚠️ |  |
| `dimensions.connectivity` | `qualityDimensions.status` | ⚠️ | connectivity → status |
| `dimensions.connectivity.score` | `qualityDimensions.status.score` | ⚠️ |  |
| `dimensions.connectivity.weight` | `qualityDimensions.status.weight` | ⚠️ |  |
| `dimensions.deduplication` | `qualityDimensions.duplicates` | ⚠️ | deduplication → duplicates |
| `dimensions.deduplication.score` | `qualityDimensions.duplicates.score` | ⚠️ |  |
| `dimensions.deduplication.weight` | `qualityDimensions.duplicates.weight` | ⚠️ |  |
| `dimensions.geo.score` | `qualityDimensions.geo.score` | ⚠️ | key correct but parent is qualityDimensions |
| `dimensions.geo.weight` | `qualityDimensions.geo.weight` | ⚠️ |  |
| `findings[].code` | `findings[].finding` | ⚠️ | createFinding() uses field name "finding" not "code" |
| `findings[].severity` | `findings[].severity` | ✅ |  |
| `findings[].installationId` | `findings[].context.mastrNummer` | ⚠️ | installationId does not exist; use findings[].context.mastrNummer |
| `findingsCount` | `summary.findingsCount` | ⚠️ | findingsCount is nested inside summary, not top-level |
| `findingsCount.info` | `summary.findingsCount.info` | ⚠️ |  |
| `findingsCount.warning` | `summary.findingsCount.warning` | ⚠️ |  |
| `findingsCount.error` | `summary.findingsCount.error` | ⚠️ |  |
| `portfolio` | `summary (restructured)` | ❌ | No top-level portfolio object. Use summary.totalInstallations + summary.installationsByType. |
| `portfolio.total` | `summary.totalInstallations` | ⚠️ |  |
| `portfolio.solar` | `summary.installationsByType.solar` | ⚠️ |  |
| `portfolio.wind` | `summary.installationsByType.wind` | ⚠️ |  |
| `portfolio.storage` | `summary.installationsByType.storage` | ⚠️ |  |
| `portfolio.biomass` | `summary.installationsByType.biomass` | ⚠️ |  |

## 2. `POST /api/grid-connection/validate`  ->  UI-Contract 06

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `id` | `id` | ✅ |  |
| `createdAt` | `metadata.executedAt` | ⚠️ | Not at top level. Use metadata.executedAt. |
| `gridOperator.name` | `gridOperator.name` | ✅ |  |
| `gridOperator.mastrId` | `gridOperator.mastrId` | ✅ |  |
| `decision` | `decision` | ✅ |  |
| `findings[].code` | `findings[].finding` | ⚠️ | createFinding() uses "finding" not "code" |
| `findings[].severity` | `findings[].severity` | ✅ |  |
| `findings[].step` | `findings[].step` | ✅ |  |
| `findings[].detail` | `findings[].reason` | ⚠️ | createFinding() uses "reason" not "detail" |
| `findingsCount.info` | `summary.findingsCount.info` | ⚠️ | nested in summary |
| `findingsCount.warning` | `summary.findingsCount.warning` | ⚠️ |  |
| `findingsCount.error` | `summary.findingsCount.error` | ⚠️ |  |
| `steps[].id` | `steps[].step` | ⚠️ | step number is in "step" field, not "id" |
| `steps[].name` | `steps[].name` | ✅ |  |
| `steps[].status` | `steps[].status` | ✅ |  |
| `steps[].findingCode` | `(not present)` | ❌ | stepSummaries do not include findingCode; per-step findings are in the top-level findings[] array filtered by step number |
| `REQUEST: applicant (object)` | `not validated — gridOperatorId only required` | ✅ | applicant is optional and accepted but not validated or stored |

## 3. `POST /api/energy-sharing/validate`  ->  UI-Contract 07

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `id` | `id` | ✅ |  |
| `createdAt` | `metadata.executedAt` | ⚠️ | Use metadata.executedAt. |
| `gridOperator.name` | `gridOperator.name` | ✅ |  |
| `decision` | `decision` | ✅ |  |
| `findings[].code` | `findings[].finding` | ⚠️ |  |
| `findingsCount.info` | `summary.findingsCount.info` | ⚠️ | nested in summary |
| `findingsCount.warning` | `summary.findingsCount.warning` | ⚠️ |  |
| `findingsCount.error` | `summary.findingsCount.error` | ⚠️ |  |
| `generatorResults` | `generators` | ⚠️ | Key is "generators" (enriched input array), not "generatorResults" |
| `generatorResults[].mastrId` | `generators[].mastrNummer` | ⚠️ | Field is mastrNummer (matches MaStR spec), not mastrId |
| `generatorResults[].status` | `generators[].status` | ⚠️ | Correct value but wrong parent key |
| `generatorResults[].dvValidated` | `generators[].hasDvFlag` | ⚠️ | dvValidated does not exist; closest is hasDvFlag (boolean) |
| `REQUEST: generators[].mastrId` | `generators[].mastrNummer` | 🔴 | Service reads gen.mastrNummer; sending mastrId will be ignored |
| `REQUEST: consumers[].malo` | `consumers[].maloId` | 🔴 | Service checks c.maloId; field in contract is malo (no Id suffix) |

## 4. `POST /api/redispatch/audit`  ->  UI-Contract 08

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `id` | `id` | ✅ |  |
| `createdAt` | `metadata.executedAt` | ⚠️ | Use metadata.executedAt. |
| `gridOperator.name` | `gridOperator.name` | ✅ |  |
| `gridOperator.mastrId` | `gridOperator.mastrId` | ✅ |  |
| `period.from` | `period.dateFrom` | ⚠️ | period uses dateFrom/dateTo not from/to |
| `period.to` | `period.dateTo` | ⚠️ |  |
| `settlementReadiness.readinessPercent` | `settlementReadiness.readinessPercent` | ✅ |  |
| `settlementReadiness.readyCount` | `(not present)` | ❌ | No readyCount field. readinessPercent * totalInstallations / 100 = implied ready count. Use totalInstallations - blockedInstallations. |
| `settlementReadiness.blockedCount` | `settlementReadiness.blockedInstallations` | ⚠️ |  |
| `settlementReadiness.totalCount` | `settlementReadiness.totalInstallations` | ⚠️ |  |
| `riskAssessment.level` | `riskAssessment.riskLevel` | ⚠️ | "level" → "riskLevel" in src/redispatch-risk.js |
| `riskAssessment.estimatedExposureEur` | `riskAssessment.estimatedLostCompensationEur` | ⚠️ | Full field name: estimatedLostCompensationEur |
| `curtailment` | `(not present)` | ❌ | No top-level curtailment object. curtailmentGWh available only in findings[step=4].context. highFrequencyFlag is finding RD_HIGH_CURTAILMENT_PERIOD. |
| `curtailment.totalGWh` | `findings[step=4].context.curtailmentGWh` | ❌ |  |
| `curtailment.source` | `findings[step=4].context (implied)` | ❌ |  |
| `curtailment.highFrequencyFlag` | `finding code RD_HIGH_CURTAILMENT_PERIOD` | ❌ | Check findings[].finding === "RD_HIGH_CURTAILMENT_PERIOD" |
| `findingsCount.info` | `summary.findingsCount.info` | ⚠️ | nested in summary |
| `findingsCount.warning` | `summary.findingsCount.warning` | ⚠️ |  |
| `findingsCount.error` | `summary.findingsCount.error` | ⚠️ |  |
| `portfolio.total` | `(not present)` | ❌ | No top-level portfolio object. Installation count in step 2 finding context. |
| `portfolio.weg` | `(not present)` | ❌ | usedWegB boolean is in step 2 finding context only (findings[step=2].context.usedWegB) |
| `REQUEST: periodFrom` | `dateFrom` | 🔴 | Service params are dateFrom/dateTo, not periodFrom/periodTo |
| `REQUEST: periodTo` | `dateTo` | 🔴 |  |

## 5. `GET /api/mastr-quality/list`  ->  UI-Contract 05 (list)

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `audits` | `audits` | ✅ |  |
| `total` | `count` | ⚠️ | list returns { count, audits }, not { total, audits } |
| `audits[0].id` | `audits[0].id` | ✅ |  |
| `audits[0].qualityScore` | `audits[0].qualityScore` | ✅ |  |
| `audits[0].createdAt` | `audits[0].createdAt` | ✅ |  |
| `audits[0].gridOperator.name` | `audits[0].gridOperator.name` | ✅ |  |

## 6. `GET /api/grid-connection/list`  ->  UI-Contract 06 (list)

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `validations` | `validations` | ✅ |  |
| `total` | `count` | ⚠️ | list returns { count, validations } |
| `validations[0].id` | `validations[0].id` | ✅ |  |
| `validations[0].decision` | `validations[0].decision` | ✅ |  |
| `validations[0].createdAt` | `validations[0].createdAt` | ✅ |  |

## 7. `GET /api/energy-sharing/list`  ->  UI-Contract 07 (list)

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `validations` | `validations` | ✅ |  |
| `total` | `count` | ⚠️ | list returns { count, validations } |
| `validations[0].id` | `validations[0].id` | ✅ |  |
| `validations[0].decision` | `validations[0].decision` | ✅ |  |
| `validations[0].createdAt` | `validations[0].createdAt` | ✅ |  |

## 8. `GET /api/redispatch/list`  ->  UI-Contract 08 (list)

| UI-Contract Field | Actual Field | Match | Notes |
|---|---|:---:|---|
| `audits` | `audits` | ✅ |  |
| `total` | `count` | ⚠️ | list returns { count, audits } |
| `audits[0].id` | `audits[0].id` | ✅ |  |
| `audits[0].createdAt` | `audits[0].createdAt` | ✅ |  |
| `audits[0].settlementReadinessPercent` | `audits[0].settlementReadiness.readinessPercent` | ⚠️ | Not a flat field. Nested: audits[0].settlementReadiness.readinessPercent |

---

## Summary

| Metric | Count |
|--------|-------|
| Total fields checked | 107 |
| Correct | 37 |
| Renamed (contract update needed) | 57 |
| Missing (field absent from response) | 9 |
| Request body mismatch | 4 |

**Match rate:** 35%
**Actionable:** 70 items

---

## Required UI-Contract Updates

The following UI-Contract files need updating before the frontend builds v0.20.3.
These are all **code-is-correct, contract-is-wrong** cases.

### docs/ui-contracts/05-mastr-quality.md

```diff
-  "dimensions": {
-    "registration":  { "score": 82, "weight": 0.3 },
-    "connectivity":  { "score": 91, "weight": 0.2 },
-    "deduplication": { "score": 55, "weight": 0.15 }
-  },
-  "findings": [{ "code": "MQ_ZERO_CAPACITY", "installationId": "SEE..." }],
-  "findingsCount": { "info": 12 },
-  "portfolio": { "total": 312, "solar": 201 }
+  "qualityDimensions": {
+    "connectionPoints": { "score": 82, "weight": 0.30 },
+    "status":           { "score": 91, "weight": 0.15 },
+    "duplicates":       { "score": 55, "weight": 0.15 }
+  },
+  "findings": [{ "finding": "MQ_ZERO_CAPACITY", "context": { "mastrNummer": "SEE..." } }],
+  "summary": { "findingsCount": { "info": 12 }, "totalInstallations": 312, "installationsByType": { "solar": 201 } }
```

Actual dimension keys (from QUALITY_DIMENSION_WEIGHTS in src/validation-findings.js):
connectionPoints (0.30) | capacity (0.20) | geo (0.20) | status (0.15) | duplicates (0.15)

### docs/ui-contracts/06-grid-connection.md

```diff
-  "findings": [{ "code": "GO_CONDITIONAL", "detail": "..." }],
-  "findingsCount": { "info": 4 },
-  "steps": [{ "id": 1, "findingCode": "VNB_RESOLVED" }]
+  "findings": [{ "finding": "GO_CONDITIONAL", "reason": "..." }],
+  "summary": { "findingsCount": { "info": 4 } },
+  "steps": [{ "step": 1 }]
```

Note: steps[].findingCode does not exist. Filter findings[] by step number to get per-step findings.

### docs/ui-contracts/07-energy-sharing.md

```diff
- Request: generators[].mastrId
- Request: consumers[].malo
+ Request: generators[].mastrNummer
+ Request: consumers[].maloId

- Response: "generatorResults": [{ "mastrId": "SEE...", "dvValidated": true }]
+ Response: "generators": [{ "mastrNummer": "SEE...", "hasDvFlag": true }]
```

### docs/ui-contracts/08-redispatch.md

```diff
- Request: periodFrom / periodTo
+ Request: dateFrom / dateTo

-  "period": { "from": "2025-01-01", "to": "2025-12-31" },
-  "settlementReadiness": { "readyCount": 52, "blockedCount": 7, "totalCount": 59 },
-  "riskAssessment": { "level": "medium", "estimatedExposureEur": 45000 },
-  "curtailment": { "totalGWh": 123.4, "source": "netztransparenz", "highFrequencyFlag": false },
-  "portfolio": { "total": 59, "weg": "A" }
+  "period": { "dateFrom": "2025-01-01", "dateTo": "2025-12-31" },
+  "settlementReadiness": { "readinessPercent": 88.1, "blockedInstallations": 7, "totalInstallations": 59 },
+  "riskAssessment": { "riskLevel": "medium", "estimatedLostCompensationEur": 45000 },
+  // curtailment: derive from findings[step=4].context.curtailmentGWh
+  //   highFrequency: findings[].finding === "RD_HIGH_CURTAILMENT_PERIOD"
+  // portfolio: derive from findings[step=2].context.total + .usedWegB
```

### All list endpoints (05-08)

```diff
- { "total": N, "audits": [...] }
+ { "count": N, "audits": [...] }
```

Also: redispatch list audits[0].settlementReadinessPercent (flat)
  -> audits[0].settlementReadiness.readinessPercent (nested object).

---

## Decision: Update Contracts, Not Code

All mismatches are intentional implementation choices — the service code
is correct. The UI-Contracts were written ahead of implementation (v0.19.0)
and contain idealized field names that differ from the actual conventions.

**Exceptions (potential small code fixes):**

| Issue | Recommendation |
|-------|----------------|
| createdAt absent from audit responses | Add alias: metadata.executedAt -> createdAt |
| steps[].findingCode missing | Low priority: derive from findings[] filtered by step |
| curtailment top-level missing | Promote curtailmentGWh + highFrequencyFlag to top-level |
| portfolio top-level missing | Promote total + usedWegB to top-level in redispatch |
