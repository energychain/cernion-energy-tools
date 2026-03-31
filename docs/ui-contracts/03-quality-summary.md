# UI Contract: Agent Quality Summary Panel

> **Page ID:** `quality-summary`
> **Version:** 0.19.1
> **Last updated:** 2026-03-31

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
      "recentReports": [...]
    },
    {
      "type":    "energy-sharing",
      "label":   "Energy Sharing Validierung",
      "lastRun": null,
      "keyMetric": null,
      "recentReports": []
    },
    {
      "type":    "redispatch-expost",
      "label":   "Redispatch Ex-Post",
      "lastRun": "2026-03-29T08:00:00Z",
      "keyMetric": { "name": "settlementReadiness", "value": { "readinessPercent": 88.1 } },
      "recentReports": [...]
    },
    {
      "type":    "energy-sharing-allocation",
      "label":   "Energy Sharing Allokation",
      "lastRun": null,
      "keyMetric": null,
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
| Reports count | `agents[].recentReports.length` | `N report(s)` | 0 → "No reports yet" |
| Run CTA | — | "▶ Run now" button | Links to agent page |

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

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Agent in `_errors` | Card shows "⚠ Data unavailable" with retry link |
| `lastRun` null | "Never run" in grey italic |
| `keyMetric` null | "–" placeholder |
| All `recentReports` empty | "No reports yet. Click ▶ to run the first audit." |
