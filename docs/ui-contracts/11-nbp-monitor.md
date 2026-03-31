# UI Contract: NBP Monitor Panel

> **Page ID:** `nbp-monitor`
> **Version:** 0.19.0
> **Last updated:** 2026-03-31

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `GET`  | `/api/nbp-monitor/status`      | Get current NBP monitor status |
| `GET`  | `/api/nbp-monitor/parameters`  | Get current monitoring parameters |
| `PUT`  | `/api/nbp-monitor/parameters`  | Update parameters (full-access) |
| `DELETE` | `/api/nbp-monitor/parameters`| Reset to defaults |

---

## Status Shape

```json
{
  "status":   "active",
  "lastCheck": "2026-03-31T11:50:00Z",
  "nextCheck": "2026-03-31T12:05:00Z",
  "alerts": [
    {
      "id":       "NBP-01",
      "severity": "warning",
      "type":     "ABOVE_THRESHOLD",
      "metric":   "priceEurMWh",
      "value":    82.5,
      "threshold": 80.0,
      "timestamp": "2026-03-31T11:40:00Z"
    }
  ],
  "metrics": {
    "currentPriceEurMWh": 82.5,
    "avgPrice24h":        46.0,
    "negativeHoursToday": 0,
    "renewableSharePct":  68.2
  },
  "parameters": {
    "checkIntervalMin":     15,
    "priceThresholdHigh":   80.0,
    "priceThresholdNeg":    0.0,
    "renewableShareAlert":  30
  }
}
```

---

## UI Elements

### Status Indicator

Top-level status pill:

| `status` | Label | Colour |
|----------|-------|--------|
| `active` | "Aktiv — läuft planmäßig" | green |
| `paused` | "Pausiert" | grey |
| `error`  | "Fehler" | red |

Next check: `nextCheck` displayed as countdown (`in N min`).

### Live Metrics Cards

| Card | Field | Unit | Alert threshold |
|------|-------|------|-----------------|
| Current price | `metrics.currentPriceEurMWh` | €/MWh | `parameters.priceThresholdHigh` |
| 24h avg | `metrics.avgPrice24h` | €/MWh | — |
| Negative hours today | `metrics.negativeHoursToday` | h | > 0 → blue highlight |
| Renewable share | `metrics.renewableSharePct` | % | `parameters.renewableShareAlert` |

### Alert Feed

Ordered by `timestamp` descending, max 20 shown, "Show more" loads next page.
Each alert: severity chip, metric name, value vs threshold, timestamp.

### Parameters Editor

Inline editable form (PUT, full-access):

| Parameter | Field | Type | Validation |
|-----------|-------|------|------------|
| Check interval | `checkIntervalMin` | number | 1–60 minutes |
| High price alert | `priceThresholdHigh` | number | > 0 |
| Negative price alert | `priceThresholdNeg` | number | ≤ 0 |
| Renewable share alert | `renewableShareAlert` | number | 0–100 |

---

## Interactions

- **Save parameters**: PUT → toast "Parameter gespeichert" → refresh status.
- **Reset parameters**: DELETE → confirmation → toast "Standardwerte wiederhergestellt".
- **Alert click**: expands to show full metric history mini-chart (7-day sparkline).

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| `status === 'error'` | Red banner with last error message |
| No alerts | "✓ Keine aktiven Alarme" |
| `negativeHoursToday > 0` | Blue info card "Negative Preisphase aktiv" |
