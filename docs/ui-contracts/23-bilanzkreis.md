# UI Contract: Bilanzkreis Service

> **Page ID:** `bilanzkreis`
> **Version:** 0.38.1
> **Last updated:** 2026-05-01
> **Introduced:** v0.30.0 — §42c-KPIs in v0.38.0

---

## Overview

Der Bilanzkreis-Service verwaltet reale und virtuelle Bilanzkreise mit
15-Minuten-Intervall-Bilanzierung. Unterstützt Energy Sharing (§42c EnWG),
Mieterstrom, Arealnetze und VPP. Der `checkReadiness`-Endpoint liefert seit
v0.38.0 explizite §42c-Konformitäts-KPIs (`PARAGRAF_42C_KONFORM`, `A96_FAEHIG`).

---

## API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `POST`   | `/api/bilanzkreis/` | Neuen Bilanzkreis anlegen | Bearer |
| `GET`    | `/api/bilanzkreis/` | Alle Bilanzkreise auflisten | Bearer |
| `GET`    | `/api/bilanzkreis/:id` | Einzelnen Bilanzkreis abrufen | Bearer |
| `DELETE` | `/api/bilanzkreis/:id` | Bilanzkreis löschen | Bearer (full-access) |
| `POST`   | `/api/bilanzkreis/:id/calculate` | 15-min-Bilanzierung berechnen | Bearer |
| `GET`    | `/api/bilanzkreis/:id/readiness` | Settlement-Readiness prüfen | Bearer |

---

## Bilanzkreis anlegen (POST /api/bilanzkreis/)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/bilanzkreis/ |
| Action | bilanzkreis.create |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Request Body

```json
{
  "name": "Energieteilen Solarpark Höheinöd",
  "type": "virtual_energy_sharing",
  "generators": [
    { "mastrNummer": "SEE999952467552", "capacityKWp": 2103.7 }
  ],
  "consumers": [
    { "meloId": "DE000277691200000000000021A129569", "annualKWh": 45000 },
    { "meloId": "DE000277691200000000000021A129570", "annualKWh": 32000 }
  ],
  "allocationMethod": "proportional"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | Frei wählbarer Name |
| `type` | string | Yes | `real`, `virtual_energy_sharing`, `mieterstrom`, `arealnetz`, `vpp` |
| `generators` | array | Bedingt | Pflicht für `virtual_energy_sharing` und `mieterstrom` |
| `consumers` | array | Bedingt | Pflicht für `virtual_energy_sharing` und `mieterstrom` |
| `allocationMethod` | string | No | `"proportional"` (Standard) oder `"fixed"` |

### Response (201 Created)

```json
{
  "id": "bk-550e8400-e29b-41d4-a716-446655440020",
  "name": "Energieteilen Solarpark Höheinöd",
  "type": "virtual_energy_sharing",
  "generatorCount": 1,
  "consumerCount": 2,
  "createdAt": "2026-05-01T10:00:00Z"
}
```

---

## Bilanzierung berechnen (POST /api/bilanzkreis/:id/calculate)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/bilanzkreis/:id/calculate |
| Action | bilanzkreis.calculate |
| Auth | Bearer Token |
| Sync/Async | Synchron (Timeout: 120 s) |

### Request Body

```json
{
  "period": {
    "dateFrom": "2025-01-01",
    "dateTo":   "2025-01-31"
  },
  "resolution": "15min"
}
```

### Response (200 OK)

```json
{
  "bilanzkreisId": "bk-550e8400-...",
  "period": { "dateFrom": "2025-01-01", "dateTo": "2025-01-31" },
  "resolution": "15min",
  "totalGenerationKWh": 142500.0,
  "totalConsumptionKWh": 118300.0,
  "sharedEnergyKWh": 97200.0,
  "eigenverbrauchsquote": 0.682,
  "autarkiegrad": 0.822,
  "gridFeedInKWh": 45300.0,
  "gridDrawKWh": 21100.0,
  "intervals": 2976,
  "calculatedAt": "2026-05-01T10:05:00Z"
}
```

- `eigenverbrauchsquote`: Anteil der Erzeugung, die vor Ort verbraucht wird (0–1)
- `autarkiegrad`: Anteil des Verbrauchs aus eigener Erzeugung (0–1)

---

## Settlement-Readiness prüfen (GET /api/bilanzkreis/:id/readiness)

| Feld | Wert |
|---|---|
| Method | GET |
| Path | /api/bilanzkreis/:id/readiness |
| Action | bilanzkreis.checkReadiness |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Response (200 OK)

```json
{
  "bilanzkreisId": "bk-550e8400-...",
  "type": "virtual_energy_sharing",
  "readyForSettlement": true,
  "PARAGRAF_42C_KONFORM": true,
  "A96_FAEHIG": true,
  "issues": [],
  "checkedAt": "2026-05-01T10:00:00Z"
}
```

### §42c-KPI-Felder (neu in v0.38.0)

Nur für `type: "virtual_energy_sharing"` gesetzt. Für alle anderen Typen sind
die Felder `undefined` (nicht im Response enthalten).

| Feld | Bedeutung | Bedingung |
|------|-----------|-----------|
| `PARAGRAF_42C_KONFORM` | Bilanzkreis ist §42c-konform | `true` wenn keine `missing_data`-Issues |
| `A96_FAEHIG` | A96-Settlement möglich | `true` wenn zusätzlich keine `low_data_quality`- oder `mscons_incomplete`-Issues |

### Issues-Struktur

```json
{
  "issues": [
    {
      "code": "missing_data",
      "severity": "error",
      "description": "Keine Messdaten für MeLo DE000277691200000000000021A129569 im Zeitraum"
    }
  ]
}
```

Mögliche `code`-Werte: `missing_data`, `low_data_quality`, `mscons_incomplete`,
`generator_unlinked`, `consumer_unlinked`.

---

## Verwandte Services

- **§42c Deadline 01.07.2026** — Energieteilen muss bis dann produktiv sein
- **`energy-sharing`** — 6-Schritt Validierungs-Pipeline (→ Contract 07)
- **`settlement`** — Berechnet Vergütungen auf Basis der Bilanzierung (→ Contract 22)
- **`edm`** — Messdaten-Backend (→ Contract 26)

---

## Open Points

| # | Beschreibung | Status |
|---|---|---|
| [OFFEN-1] | Echtzeitdaten-Stream für laufende Bilanzierung | ungeplant |
| [OFFEN-2] | `allocationMethod: "dynamic"` (lastgangbasiert) | v0.39 |
| [OFFEN-3] | `PARAGRAF_42C_KONFORM` für weitere Typen (`mieterstrom`, `arealnetz`) | v0.39 |
