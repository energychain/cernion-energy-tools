# UI Contract: Forecast Engine

> **Page ID:** `forecast-engine`
> **Version:** 0.38.1
> **Last updated:** 2026-05-01
> **Introduced:** v0.30.1

---

## Overview

Die Forecast Engine liefert Lastprognosen (SLP + historische Korrektur + Temperatur),
Erzeugungsprognosen (MCP mit KRITIS-Fallback), Residuallast-Berechnungen,
Day-Ahead-Fahrplanmanagement, Speicher-Dispatch-Optimierung (Greedy) und
Prognosequalitäts-Tracking (RMSE/MAE/MAPE). Timeout: 120 s.

---

## API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `POST` | `/api/forecast-engine/load` | Lastprognose erstellen | Bearer |
| `POST` | `/api/forecast-engine/generation` | Erzeugungsprognose erstellen | Bearer |
| `POST` | `/api/forecast-engine/residual` | Residuallast berechnen | Bearer |
| `POST` | `/api/forecast-engine/schedule/day-ahead` | Day-Ahead-Fahrplan erstellen | Bearer |
| `GET`  | `/api/forecast-engine/schedule/:scheduleId` | Fahrplan abrufen | Bearer |
| `GET`  | `/api/forecast-engine/schedules` | Alle Fahrpläne auflisten | Bearer |
| `POST` | `/api/forecast-engine/quality` | Prognosequalität bewerten (RMSE/MAE/MAPE) | Bearer |
| `POST` | `/api/forecast-engine/storage-dispatch` | Speicher-Dispatch optimieren | Bearer |

---

## Lastprognose (POST /api/forecast-engine/load)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/forecast-engine/load |
| Action | forecast-engine.forecastLoad |
| Auth | Bearer Token |
| Sync/Async | Synchron (Timeout: 120 s) |

### Request Body

```json
{
  "meloId": "DE000277691200000000000021A129569",
  "dateFrom": "2025-01-01",
  "dateTo":   "2025-01-07",
  "resolution": "15min",
  "slpProfile": "H0",
  "temperatureCorrection": true
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `meloId` | string | Yes | MeLo-ID aus EDM |
| `dateFrom` | date string | Yes | ISO 8601 |
| `dateTo` | date string | Yes | ISO 8601 |
| `resolution` | string | No | `"15min"` (Standard), `"hourly"`, `"daily"` |
| `slpProfile` | string | No | BDEW-Profil: `"H0"`, `"G0"`, `"L0"` etc. |
| `temperatureCorrection` | boolean | No | Temperatur-Korrektur anwenden (default: false) |

### Response (200 OK)

```json
{
  "forecastId": "fc-550e8400-e29b-41d4-a716-446655440030",
  "type": "load",
  "meloId": "DE000277691200000000000021A129569",
  "period": { "dateFrom": "2025-01-01", "dateTo": "2025-01-07" },
  "resolution": "15min",
  "totalKWh": 1823.5,
  "peakKW": 18.4,
  "dataPoints": [
    { "timestamp": "2025-01-01T00:00:00Z", "valueKW": 2.4 },
    { "timestamp": "2025-01-01T00:15:00Z", "valueKW": 2.1 }
  ],
  "slpProfile": "H0",
  "method": "slp_with_historical_correction",
  "createdAt": "2026-05-01T10:00:00Z"
}
```

- `method`: `"slp"`, `"slp_with_historical_correction"`, `"historical"`, `"kritis_fallback"`

---

## Erzeugungsprognose (POST /api/forecast-engine/generation)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/forecast-engine/generation |
| Action | forecast-engine.forecastGeneration |
| Auth | Bearer Token |
| Sync/Async | Synchron (Timeout: 120 s) |

### Request Body

```json
{
  "mastrNummer": "SEE999952467552",
  "dateFrom": "2025-01-01",
  "dateTo":   "2025-01-07",
  "resolution": "15min",
  "useMcpForecast": true
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `mastrNummer` | string | Yes | MaStR-Anlagennummer |
| `dateFrom` | date string | Yes | ISO 8601 |
| `dateTo` | date string | Yes | ISO 8601 |
| `useMcpForecast` | boolean | No | MCP-Prognose nutzen; fällt auf KRITIS-Fallback zurück wenn nicht verfügbar |

### Response (200 OK)

```json
{
  "forecastId": "fc-550e8400-e29b-41d4-a716-446655440031",
  "type": "generation",
  "mastrNummer": "SEE999952467552",
  "totalKWh": 42150.0,
  "peakKW": 1987.3,
  "mcpUsed": true,
  "kritisfallback": false,
  "dataPoints": [
    { "timestamp": "2025-01-01T00:00:00Z", "valueKW": 0.0 },
    { "timestamp": "2025-01-01T12:00:00Z", "valueKW": 1523.4 }
  ],
  "createdAt": "2026-05-01T10:00:00Z"
}
```

- `kritisfallback: true` wenn MCP nicht verfügbar war — UI sollte Info-Chip zeigen

---

## Day-Ahead-Fahrplan (POST /api/forecast-engine/schedule/day-ahead)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/forecast-engine/schedule/day-ahead |
| Action | forecast-engine.createSchedule |
| Auth | Bearer Token |
| Sync/Async | Synchron (Timeout: 120 s) |

### Request Body

```json
{
  "gridOperatorId": "SNB935578300972",
  "scheduleDate": "2025-01-02",
  "loadForecastIds": ["fc-..."],
  "generationForecastIds": ["fc-..."],
  "includeStorageDispatch": true
}
```

### Response (200 OK)

```json
{
  "scheduleId": "sched-550e8400-e29b-41d4-a716-446655440032",
  "scheduleDate": "2025-01-02",
  "gridOperatorId": "SNB935578300972",
  "peakResidualKW": 4521.3,
  "minResidualKW": -892.1,
  "storageDispatchIncluded": true,
  "intervals": 96,
  "createdAt": "2026-05-01T10:00:00Z"
}
```

---

## Prognosequalität (POST /api/forecast-engine/quality)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/forecast-engine/quality |
| Action | forecast-engine.evaluateQuality |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Request Body

```json
{
  "forecastId": "fc-550e8400-...",
  "actualMeloId": "DE000277691200000000000021A129569",
  "period": { "dateFrom": "2025-01-01", "dateTo": "2025-01-07" }
}
```

### Response (200 OK)

```json
{
  "forecastId": "fc-550e8400-...",
  "rmse": 1.23,
  "mae": 0.98,
  "mape": 0.054,
  "rating": "good",
  "dataPointsCompared": 672
}
```

- `rating`: `"excellent"` (MAPE < 3%), `"good"` (< 7%), `"acceptable"` (< 15%), `"poor"` (≥ 15%)

---

## Verwandte Services

- **`edm`** — Messdaten und MeLo-Registry (→ Contract 26)
- **`slp`** — Standardlastprofile als Prognose-Basis (→ Contract 27)
- **`settlement`** — Nutzt Prognosen für Fallback-Berechnungen (→ Contract 22)
- **`bilanzkreis`** — Residuallast für Bilanzkreis-Berechnung (→ Contract 23)
- **`flex`** — Lastprognose als Basis für §14a-Dimming-Planung (→ Contract 25)

---

## Open Points

| # | Beschreibung | Status |
|---|---|---|
| [OFFEN-1] | Multi-Anlagen-Aggregation in einem Aufruf | v0.39 |
| [OFFEN-2] | Probabilistische Prognose (Konfidenzintervalle) | ungeplant |
| [OFFEN-3] | ENTSO-E Wetterdaten als Temperatur-Input | v0.39 |
