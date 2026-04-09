# UI Contract: Agent Quality Summary Panel

> **Page ID:** `quality-summary`
> **Version:** 0.20.5
> **Last updated:** 2026-04-06

---

## Primary API Endpoint

```
GET /api/dashboard/quality-summary
GET /api/dashboard/quality-summary?gridOperatorId=SNB935578300972
```

**Optional parameters:**
- `gridOperatorId` — MaStR SNB/GNB ID to filter results per operator

**Cache TTL:** 5 minutes (backend, keyed by `gridOperatorId`)
**Expected latency:** < 3 seconds (5 parallel upstream calls)
**Auth:** Bearer token (read-only scope sufficient)

---

## Response Shape

```json
{
  "agents": [
    {
      "type":    "mastr-quality",
      "label":   "MaStR Datenqualität",
      "lastRun": "2026-03-31T10:00:00Z",
      "keyMetric": { "name": "qualityScore", "value": 78 },
      "findingsCount": { "info": 12, "warning": 18, "error": 5 },
      "recentReports": [
        {
          "id":          "mq-001",
          "executedAt":  "2026-03-31T10:00:00Z",
          "qualityScore": 78
        }
      ]
    },
    {
      "type":    "grid-connection",
      "label":   "Netzanschluss-Validierung",
      "lastRun": "2026-03-30T14:00:00Z",
      "keyMetric": { "name": "decision", "value": "GO_CONDITIONAL" },
      "findingsCount": { "info": 4, "warning": 7, "error": 1 },
      "recentReports": [...]
    },
    {
      "type":    "energy-sharing",
      "label":   "Energy Sharing Validierung",
      "lastRun": null,
      "keyMetric": null,
      "findingsCount": null,
      "recentReports": []
    },
    {
      "type":    "redispatch-expost",
      "label":   "Redispatch Ex-Post",
      "lastRun": "2026-03-29T08:00:00Z",
      "keyMetric": { "name": "settlementReadiness", "value": { "readinessPercent": 88.1 } },
      "findingsCount": { "info": 3, "warning": 8, "error": 2 },
      "recentReports": [...]
    },
    {
      "type":    "energy-sharing-allocation",
      "label":   "Energy Sharing Allokation",
      "lastRun": null,
      "keyMetric": null,
      "findingsCount": null,
      "recentReports": []
    }
  ],
  "timestamp": "2026-03-31T12:00:00Z",
  "_errors": []
}
```

---

## UI Elements

### Agent Summary Table / Card Grid

Render each `agents` entry as a card with:

| Column | Field | Format | Notes |
|--------|-------|--------|-------|
| Agent name | `agents[].label` | Bold | Primary label |
| Type badge | `agents[].type` | Small monospace | Background: #f0f4ff |
| Last run | `agents[].lastRun` | `dd.MM.yyyy HH:mm` | "Never" if null |
| Key metric | `agents[].keyMetric` | See table below | null → "No data" |
| Findings | `agents[].findingsCount` | See below | null → "–" |
| Reports count | `agents[].recentReports.length` | `N report(s)` | 0 → "No reports yet" |
| Run CTA | — | "▶ Run now" button | Links to agent page |

#### `findingsCount` display (v0.20.5)

`findingsCount` is an object `{ info: number, warning: number, error: number }` or `null`.

| State | Display |
|-------|---------|
| `null` | "–" (dash placeholder) |
| All zeros | "✓ No findings" in green |
| `error > 0` | Red badge: `N errors` |
| `warning > 0` (no errors) | Yellow badge: `N warnings` |
| `info > 0` only | Grey badge: `N info` |

Render as a compact pill group: `🔴 5  🟡 18  ℹ️ 12` — or as a stacked bar micro-chart.

**Note:** `energy-sharing-allocation` always returns `findingsCount: null` because it is
a calculation engine without a findings pipeline.

#### Key metric display per agent type

| `type` | `keyMetric.name` | Display |
|--------|-----------------|---------|
| `mastr-quality` | `qualityScore` | Progress bar 0–100; < 60 → red, < 80 → yellow |
| `grid-connection` | `decision` | Decision badge (colours in [01-dashboard-overview.md](01-dashboard-overview.md)) |
| `energy-sharing` | `decision` | Decision badge |
| `redispatch-expost` | `settlementReadiness` | `keyMetric.value.readinessPercent`% bar; < 80 → red, < 99 → yellow |
| `energy-sharing-allocation` | `totalNetGenerationKWh` | kWh formatted |

### Recent Reports List (collapsed by default)

Each entry in `recentReports`:
- ID (truncated to 8 chars), executed timestamp, key metric value
- Clickable → navigate to full report detail page for that agent type

---

## Interactions

- **Operator filter**: input field for `gridOperatorId`; submitting re-calls the endpoint.
- **Card expand**: shows `recentReports` list inline.
- **"Run now" CTA**: navigates to the agent's input form (pre-fills `gridOperatorId` if set).
- **Refresh**: clears frontend cache; re-calls endpoint.

---

## Trend Computation (v0.20.5)

The backend returns up to **5 recent reports** per agent (`recentReports`, newest first).
Trend direction is computed **frontend-side** (Option A):

```javascript
const trend = recentReports.length >= 2
  ? recentReports[0].qualityScore - recentReports[1].qualityScore
  : null;
// trend > 0 → ▲ improving (green)
// trend < 0 → ▼ declining (red)
// trend === 0 or null → ● stable / no data (grey)
```

| Agent type | Metric for trend | Direction |
|------------|-----------------|-----------|
| `mastr-quality` | `qualityScore` (0–100) | ↑ higher = better |
| `grid-connection` | `decision` (categorical) | N/A — no numeric trend |
| `energy-sharing` | `decision` (categorical) | N/A — no numeric trend |
| `redispatch-expost` | `readinessPercent` (0–100) | ↑ higher = better |
| `energy-sharing-allocation` | `totalNetGenerationKWh` | ↑ higher = more generation |

**Note:** The backend intentionally does NOT compute trends — it returns raw data points
and leaves presentation logic to the frontend.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Agent in `_errors` | Card shows "⚠ Data unavailable" with retry link |
| `lastRun` null | "Never run" in grey italic |
| `keyMetric` null | "–" placeholder |
| All `recentReports` empty | "No reports yet. Click ▶ to run the first audit." |
