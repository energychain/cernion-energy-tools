# UI Contract: Dashboard Overview — VNB Overview Panel

> **Page ID:** `dashboard`
> **Version:** 0.20.2
> **Last updated:** 2026-04-02

---

## Primary API Endpoint

```
GET /api/dashboard/vnb-overview?bdewCode={bdewCode}
```

**Required parameter:** `bdewCode` (BDEW code of the grid operator, e.g. `9907473000008`)
**Cache TTL:** 5 minutes (backend, stampede-safe)
**Expected latency:** < 4 seconds (two-phase: Phase 1 sequential MCP, Phase 2 parallel PouchDB)
**Auth:** Bearer token (read-only scope sufficient)

> **Execution model (v0.19.1 / v0.20.2):**
> Phase 1 runs `grid-operations.vnbLookupCodes` → `vnb-monitor.snapshot` **sequentially**
> (limits peak MCP sessions to ≤10). Phase 2 fires `datapoint.health` + 4 agent list calls
> + `assets.redispatchCount` **in parallel**. `gridOperatorId` from Phase 1 is forwarded to
> all Phase 2 calls. `assets.redispatchCount` uses one MCP session (local MongoDB, fast).

---

## Response Shape

```json
{
  "identity": {
    "name":    "STROMDAO Netze GmbH",
    "mastrId": "SNB935578300972",
    "bdew":    "9907473000008",
    "bnr":     "10002345"
  },
  "kpis": {
    "totalInstallations":       312,
    "totalCapacityMW":          145.2,
    "redispatchEligible":       59,
    "redispatchCapacityMW":     73.4,
    "ewkAnschlussdauerWeeks":   35,
    "ewkDigitalisierungsScore": 58.2,
    "ewkUmsetzungsquote":       100,
    "mastrQualityScore":        78,
    "datapointsHealthy":        5,
    "datapointsStale":          1,
    "datapointsErrored":        0
  },
  "latestAgentResults": {
    "mastrQuality": {
      "id":           "mq-001",
      "executedAt":   "2026-03-31T10:00:00Z",
      "qualityScore": 78,
      "findingsCount": { "info": 12, "warning": 18, "error": 5 }
    },
    "gridConnection": {
      "id":           "gc-001",
      "executedAt":   "2026-03-30T14:00:00Z",
      "decision":     "GO_CONDITIONAL",
      "findingsCount": { "info": 4, "warning": 7, "error": 1 }
    },
    "energySharing":  null,
    "redispatch": {
      "id":                         "rd-001",
      "executedAt":                 "2026-03-29T08:00:00Z",
      "settlementReadinessPercent": 88.1,
      "riskLevel":                  "medium",
      "findingsCount": { "info": 3, "warning": 8, "error": 2 }
    }
  },
  "alerts": [
    { "id": "A1", "severity": "warning", "message": "EWK score below threshold" }
  ],
  "timestamp": "2026-03-31T12:00:00Z",
  "_errors": []
}
```

---

## UI Elements

### Header / Identity Section

| Element | Field | Format | Notes |
|---------|-------|--------|-------|
| Operator name | `identity.name` | Plain text | Fallback: "–" if null |
| BDEW code badge | `identity.bdew` | Monospace badge | Always present (passed as query param) |
| MaStR ID | `identity.mastrId` | `SNB…` prefix | Link to MaStR portal if non-null |
| BNR | `identity.bnr` | Small secondary label | Hide if null |
| Last updated | `timestamp` | `dd.MM.yyyy HH:mm` | Relative time on hover |

### KPI Cards (2×5 grid)

| Card | Field | Unit | Threshold | Colour |
|------|-------|------|-----------|--------|
| Installations | `kpis.totalInstallations` | — | — | neutral |
| Capacity | `kpis.totalCapacityMW` | MW, 1 decimal | — | neutral |
| Redispatch eligible | `kpis.redispatchEligible` | — (sub-label: `redispatchCapacityMW` MW) | — | neutral |
| Anschlussdauer | `kpis.ewkAnschlussdauerWeeks` | Weeks | > 52 → red | traffic-light |
| Digitalisierung | `kpis.ewkDigitalisierungsScore` | Score 0–100 | < 50 → red, < 70 → yellow | traffic-light |
| MaStR Quality | `kpis.mastrQualityScore` | Score 0–100 | < 60 → red, < 80 → yellow | traffic-light |
| Datapoints healthy | `kpis.datapointsHealthy` | — | — | neutral |
| Datapoints stale | `kpis.datapointsStale` | — | > 0 → yellow | traffic-light |
| Datapoints errored | `kpis.datapointsErrored` | — | > 0 → red | traffic-light |

Show `–` for null values. Never show `null` or `undefined` to the user.

### Latest Agent Results

Four agent cards in a 2×2 grid:

| Card | Source field | Key metric | CTA |
|------|-------------|------------|-----|
| MaStR Quality | `latestAgentResults.mastrQuality` | `qualityScore` (0–100 gauge) | → MaStR Quality page |
| Grid Connection | `latestAgentResults.gridConnection` | `decision` badge | → Grid Connection page |
| Energy Sharing | `latestAgentResults.energySharing` | `decision` badge | → Energy Sharing page |
| Redispatch Ex-Post | `latestAgentResults.redispatch` | `settlementReadinessPercent` % | → Redispatch page |

If a card's source is `null`: show "No reports yet" with a greyed-out card + CTA to run first audit.

#### Decision badge colours

| Value | Colour |
|-------|--------|
| `GO_DIRECT` | green |
| `GO_CONDITIONAL` | yellow |
| `NO_GO_EXPANSION` | orange |
| `NO_GO_CRITICAL` | red |
| `DATA_QUALITY_INSUFFICIENT` | grey |
| `APPROVED` | green |
| `APPROVED_WITH_CONDITIONS` | yellow |
| `REJECTED` | red |
| `PENDING_DOCUMENTS` | grey |

#### Findings count chips

For each card, show three chips: `info: N`, `warning: N`, `error: N`.
Colour: info → blue, warning → yellow, error → red.

### Alerts Section

Render only if `alerts.length > 0`.
Each alert: icon (severity) + message text + timestamp if present.

| Severity | Icon | Background |
|----------|------|------------|
| `critical` | 🔴 | red-50 |
| `warning` | 🟡 | yellow-50 |
| `info` | 🔵 | blue-50 |

---

## Interactions

- **Refresh button**: clears frontend cache and re-requests with same `bdewCode`.
- **Agent card click**: navigates to the corresponding agent page with `bdewCode` pre-filled.
- **KPI card click**: opens a tooltip with description and data source attribution.
- **Alert dismiss**: frontend-only dismissal (persisted in localStorage per session).

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| `_errors` non-empty | Show a small "⚠ partial data" banner; list failed services in tooltip |
| `identity` null | Show bdewCode as title; "Identity not resolved" subtitle |
| All KPIs null | Show skeleton loaders resolved to "–" |
| `alerts` empty | Hide alerts section entirely |
| All `latestAgentResults` null | Show empty state with "Run first audit" CTA for each card |
| bdewCode not found | `identity.name` is null; UI shows "No operator found for this BDEW code" |
| Multiple BDEW codes for same VNB | Backend promotes BDEW with MaStR-ID (v0.20.1, BR-0001). `identity.mastrId` will be populated if any alias resolves. If no alias resolves, `identity.mastrId` remains null — show warning banner and prompt user to verify the BDEW code. |
| `redispatchEligible` null | Hide the KPI card (legacy backend without v0.20.2). Reduce 2×5 KPI grid to 2×4. |
| `redispatchEligible` present | Show card with count as primary value; `redispatchCapacityMW` as sub-label (e.g. "59 Anlagen · 73.4 MW"). |
| HTTP 401 | Redirect to login / token entry page |
| HTTP 422 (invalid bdewCode) | Show inline field error: use `data[0].message` from the ValidationError response (e.g. "bdewCode muss 7-13 Ziffern enthalten") |
| HTTP 503 | Show "Backend unavailable" full-page error with retry button |
