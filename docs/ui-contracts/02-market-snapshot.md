# UI Contract: Energy Market Snapshot Panel

> **Page ID:** `market-snapshot`
> **Version:** 0.19.1
> **Last updated:** 2026-03-31

---

## Primary API Endpoint

```
GET /api/dashboard/market-snapshot
GET /api/dashboard/market-snapshot?location=Heidelberg&region=Bayern
```

**Optional parameters:**
- `location` — CO₂ intensity lookup location (default: `Deutschland`)
- `region` — wind/solar generation forecast region (default: `Germany`)

**Cache TTL:** 15 minutes (backend, keyed by `location` + `region`, stampede-safe)
**Expected latency:** < 3 seconds (4 parallel upstream calls, 1 MCP session each)
**Auth:** Bearer token (read-only scope sufficient)

---

## Response Shape

```json
{
  "spotPrice": {
    "current":  50.10,
    "avgToday": 45.10,
    "minToday": 40.00,
    "maxToday": 50.10,
    "trend":    "rising",
    "source":   "energy-market"
  },
  "co2": {
    "current":  380,
    "avgToday": 364.5,
    "signal":   "yellow",
    "location": "Deutschland"
  },
  "renewableForecast24h": {
    "solarPeakMW":    32500,
    "windPeakMW":     18200,
    "combinedPeakAt": "2026-03-31T13:00:00Z"
  },
  "timestamp": "2026-03-31T12:00:00Z",
  "_errors": []
}
```

---

## UI Elements

### Spot Price Card

| Element | Field | Format | Notes |
|---------|-------|--------|-------|
| Current price (hero) | `spotPrice.current` | `€/MWh`, 2 decimal | Large font, trend arrow |
| Trend arrow | `spotPrice.trend` | ↑ / ↓ / → | green=rising, red=falling, grey=stable |
| Today avg | `spotPrice.avgToday` | `€/MWh` | Secondary stat |
| Today min | `spotPrice.minToday` | `€/MWh` | Small chip |
| Today max | `spotPrice.maxToday` | `€/MWh` | Small chip |
| Data source | `spotPrice.source` | `energy-market` / `german-grid` | Small attribution label |

**Colour coding for current price:**
- < 0 €/MWh → dark blue ("negative price period")
- 0–40 €/MWh → green
- 40–80 €/MWh → yellow
- > 80 €/MWh → red

### CO₂ Intensity Card

| Element | Field | Format | Notes |
|---------|-------|--------|-------|
| Signal badge | `co2.signal` | `🟢 / 🟡 / 🔴` | Green < 300, Yellow 300–450, Red > 450 gCO₂eq/kWh |
| Current value | `co2.current` | `gCO₂eq/kWh` | Bold |
| Daily average | `co2.avgToday` | `gCO₂eq/kWh` | Secondary |
| Location | `co2.location` | Plain text | Small caption |

### Renewable Generation Forecast Card

| Element | Field | Format | Notes |
|---------|-------|--------|-------|
| Solar peak | `renewableForecast24h.solarPeakMW` | `GW` (÷1000, 1 decimal) | ☀️ icon |
| Wind peak | `renewableForecast24h.windPeakMW` | `GW` (÷1000, 1 decimal) | 💨 icon |
| Combined peak time | `renewableForecast24h.combinedPeakAt` | `HH:mm` local time | "Solar peak at ..." |

---

## Interactions

- **Location / Region dropdowns**: update query params → new API call (clears 15-min frontend cache).
- **Refresh button**: forces new backend call by appending `?_ts={epoch}` to bust cache.
- **Price card click**: expands to show hourly price chart (second API call to `energy-market.prices`).

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| `spotPrice` null | Show "Spot price unavailable" with data source attribution |
| `co2` null | Show "CO₂ data unavailable" |
| `renewableForecast24h` null | Show "Forecast unavailable" |
| Negative prices | Show dark-blue card with "⚠ Negative price period" banner |
| `_errors` non-empty | Show partial-data banner (see architecture doc) |
