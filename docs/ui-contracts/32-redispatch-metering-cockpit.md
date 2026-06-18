# UI Contract: Redispatch Metering Datenfluss Cockpit

> **Page ID:** `redispatch-metering-cockpit`
> **Version:** 0.55.x (Unreleased)
> **Last updated:** 2026-05-27

---

## Primary API Endpoint

`GET /api/dashboard/redispatch-metering-cockpit`

### Query parameters

- `gridOperatorId` (optional): MaStR operator ID (`SNB...` / `GNB...`)
- `bdewCode` (optional): BDEW code (`7-13` digits), used to resolve `gridOperatorId`

> If both are missing, response is still returned but contains explicit blocker `MISSING_OPERATOR_CONTEXT`.

---

## Response Shape

```json
{
  "operator": {
    "gridOperatorId": "SNB935578300972",
    "bdewCode": "9907473000008",
    "name": "STROMDAO Netze GmbH"
  },
  "decisionReadiness": {
    "signal": "yellow",
    "score": 76.2,
    "blocked": true
  },
  "evidence": {
    "redispatch": {
      "settlementReadinessPercent": 88.1,
      "riskLevel": "medium",
      "lastAuditAt": "2026-03-29T08:00:00Z",
      "auditId": "rd-001"
    },
    "metering": {
      "datapointsHealthy": 5,
      "datapointsStale": 1,
      "datapointsErrored": 0,
      "lastAllocationAt": null,
      "allocationId": null
    },
    "masterData": {
      "qualityScore": 78,
      "lastAuditAt": "2026-03-31T10:00:00Z",
      "auditId": "mq-001"
    },
    "governance": {
      "openCriticalFindings": 1,
      "openFindingsTotal": 3
    }
  },
  "blockingEvidenceGaps": [
    {
      "code": "VDMI_OPEN_CRITICAL",
      "severity": "high",
      "source": "vdmi.findings",
      "message": "1 offene kritische VDMI-Findings."
    }
  ],
  "staleData": [
    {
      "source": "datapoint.health",
      "indicator": "staleDatapoints",
      "value": 1
    }
  ],
  "sourceReports": {
    "redispatchExpostId": "rd-001",
    "energySharingAllocationId": null,
    "mastrQualityAuditId": "mq-001"
  },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "_errors": []
}
```

---

## Semantics

- `decisionReadiness.signal`
  - `green`: no blockers and robust evidence
  - `yellow`: medium blockers or incomplete evidence
  - `red`: high-severity blockers (e.g. critical VDMI findings, high redispatch risk)
- `blockingEvidenceGaps`: authoritative list for UI blocker cards
- `staleData`: stale indicators for freshness badges
- `_errors`: upstream failures from safe fan-out; response remains read-only and partial

---

## Data Sources (read-only)

- `redispatch-expost.list`
- `energy-sharing-allocation.list`
- `mastr-quality.list`
- `vdmi.findings`
- `datapoint.health`
- `grid-operations.vnbLookupCodes` (optional identity resolution from `bdewCode`)

No separate scoring backend is introduced. The endpoint derives UI-ready readiness metadata from existing deterministic reports.
