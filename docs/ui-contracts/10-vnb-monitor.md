# UI Contract: VNB Monitor Panel

> **Page ID:** `vnb-monitor`
> **Version:** 0.19.0
> **Last updated:** 2026-03-31

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `GET`  | `/api/vnb-monitor/snapshot`    | Get full VNB monitor snapshot |
| `GET`  | `/api/vnb-monitor/thresholds`  | Get current alert thresholds |
| `PUT`  | `/api/vnb-monitor/thresholds`  | Update alert thresholds (full-access scope required) |
| `DELETE` | `/api/vnb-monitor/thresholds`| Reset thresholds to defaults |

---

## Snapshot Shape

```json
{
  "identity": {
    "name":    "STROMDAO Netze GmbH",
    "mastrId": "SNB935578300972",
    "bdew":    "9907473000008"
  },
  "mastr": {
    "totalInstallations":  312,
    "totalCapacityMW":     145.2,
    "redispatchEligible":  59,
    "solar":               201,
    "wind":                47,
    "storage":             29,
    "biomass":             35
  },
  "ewk": {
    "anschlussdauerWeeks":   35,
    "digitalisierungsScore": 58.2,
    "umsetzungsquote":       100,
    "benchmarkRank":         "P50"
  },
  "alerts": [
    {
      "id":        "A1",
      "severity":  "warning",
      "category":  "ewk",
      "message":   "Anschlussdauer überschreitet Schwellwert (35 > 30 Wochen)",
      "threshold": 30,
      "actual":    35
    }
  ],
  "alertSummary": { "total": 1, "critical": 0, "warning": 1, "info": 0 },
  "timestamp": "2026-03-31T12:00:00Z"
}
```

---

## UI Elements

### Alert Summary Bar

Horizontal bar with coloured segments: `alertSummary.critical` / `warning` / `info`.
If `total === 0`: show "✓ No active alerts" in green.

### VNB Identity Header

Same as [Dashboard Overview](01-dashboard-overview.md) identity section.

### MaStR Statistics Cards

| Card | Field | Unit |
|------|-------|------|
| Total installations | `mastr.totalInstallations` | — |
| Capacity | `mastr.totalCapacityMW` | MW |
| Redispatch eligible | `mastr.redispatchEligible` | — |
| Solar / Wind / Storage / Biomass | `mastr.solar` etc. | — |

Mini donut chart of technology split (solar/wind/storage/biomass).

### EWK Scores

| Metric | Field | Threshold warning |
|--------|-------|-------------------|
| Anschlussdauer | `ewk.anschlussdauerWeeks` weeks | > `threshold` set in thresholds |
| Digitalisierung | `ewk.digitalisierungsScore` | < threshold |
| Umsetzungsquote | `ewk.umsetzungsquote`% | < threshold |
| Benchmark rank | `ewk.benchmarkRank` | Shown as percentile label |

### Alert List

Full alert list card with sortable `severity` / `category` columns.
Each alert row expandable to show `threshold` vs `actual`.

### Threshold Editor

Inline editable table of current thresholds (PUT endpoint, full-access scope):

| Threshold | Default | Field name |
|-----------|---------|------------|
| Max Anschlussdauer | 30 weeks | `ewk.maxAnschlussdauerWeeks` |
| Min Digitalisierung | 50 | `ewk.minDigitalisierungsScore` |
| Min Umsetzungsquote | 90% | `ewk.minUmsetzungsquote` |

---

## Interactions

- **Edit thresholds**: inline edit → save → PUT → re-fetch snapshot to update alerts.
- **Reset thresholds**: DELETE → confirmation → re-fetch.
- **Alert dismiss**: frontend-only; persisted per session in localStorage.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| `ewk` null (EWK data unavailable) | EWK section shows "EWK-Daten nicht verfügbar" |
| `mastr.totalInstallations === 0` | Warning: "Keine Installationen im MaStR gefunden" |
| Read-only token on threshold edit | Show "🔒 Nur-Lesen-Modus — kein Bearbeiten möglich" |
