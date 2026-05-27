# UI Contract: Settlement Service

> **Page ID:** `settlement`
> **Version:** 0.38.1
> **Last updated:** 2026-05-01
> **Introduced:** v0.30.0

---

## Overview

Der Settlement-Service berechnet Entschädigungen für Redispatch-Maßnahmen (§13a/14 EnWG),
EEG-Vergütungen, und exportiert A96-Abrechnungsdaten. Alle Berechnungen sind KRITIS-konform
mit internen Marktpreis- und Prognosefallbacks wenn externe Quellen nicht verfügbar sind.

---

## API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `POST` | `/api/settlement/redispatch/calculate` | Redispatch-Entschädigung berechnen | Bearer |
| `GET`  | `/api/settlement/redispatch/report/:settlementId` | Redispatch-Bericht abrufen | Bearer |
| `POST` | `/api/settlement/eeg/calculate` | EEG-Vergütung berechnen | Bearer |
| `GET`  | `/api/settlement/eeg/report/:settlementId` | EEG-Bericht abrufen | Bearer |
| `POST` | `/api/settlement/a96/prepare` | A96-Export vorbereiten | Bearer (full-access) |
| `POST` | `/api/settlement/a96/reconcile` | Externe A96-Daten gegen internes Settlement abgleichen | Bearer (full-access) |
| `GET`  | `/api/settlement/a96/export/:settlementId` | A96-Datei herunterladen | Bearer |
| `GET`  | `/api/settlement/eeg-tariff` | EEG-Tariflookup nach Inbetriebnahmejahr | Bearer |
| `GET`  | `/api/settlement/` | Alle Settlement-Datensätze auflisten | Bearer |

---

## Redispatch berechnen (POST /api/settlement/redispatch/calculate)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/settlement/redispatch/calculate |
| Action | settlement.calculateRedispatch |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Request Body

```json
{
  "gridOperatorId": "SNB935578300972",
  "mastrNummer": "SEE999952467552",
  "period": {
    "dateFrom": "2025-01-01",
    "dateTo":   "2025-12-31"
  },
  "curtailmentKWh": 1500.0,
  "marketPriceEurPerMWh": 85.50
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `gridOperatorId` | string | Yes | MaStR SNB/GNB-ID |
| `mastrNummer` | string | Yes | MaStR-Anlagennummer |
| `period.dateFrom` | date string | Yes | ISO 8601 (`YYYY-MM-DD`) |
| `period.dateTo` | date string | Yes | ISO 8601; muss > `dateFrom` sein |
| `curtailmentKWh` | number | Yes | Abgeregelter Energiebetrag in kWh |
| `marketPriceEurPerMWh` | number | No | Marktpreis; interner Fallback wenn nicht angegeben |

### Response (200 OK)

```json
{
  "settlementId": "550e8400-e29b-41d4-a716-446655440010",
  "type": "redispatch",
  "gridOperatorId": "SNB935578300972",
  "mastrNummer": "SEE999952467552",
  "period": { "dateFrom": "2025-01-01", "dateTo": "2025-12-31" },
  "curtailmentKWh": 1500.0,
  "compensationEur": 128.25,
  "marketPriceEurPerMWh": 85.50,
  "marketPriceFallback": false,
  "calculatedAt": "2026-05-01T10:00:00Z"
}
```

- `marketPriceFallback: true` wenn interner Fallback verwendet wurde — UI sollte
  Info-Chip zeigen: „Marktpreis aus internem Fallback"
- `compensationEur` = `curtailmentKWh / 1000 * marketPriceEurPerMWh`

---

## EEG-Vergütung berechnen (POST /api/settlement/eeg/calculate)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/settlement/eeg/calculate |
| Action | settlement.calculateEeg |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Request Body

```json
{
  "mastrNummer": "SEE999952467552",
  "feedInKWh": 12500.0,
  "commissioningYear": 2020,
  "capacityKWp": 749.0,
  "period": {
    "dateFrom": "2025-01-01",
    "dateTo":   "2025-12-31"
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `mastrNummer` | string | Yes | MaStR-Anlagennummer |
| `feedInKWh` | number | Yes | Eingespeiste Energie in kWh |
| `commissioningYear` | number | Yes | Inbetriebnahmejahr für Tarif-Lookup |
| `capacityKWp` | number | Yes | Nennleistung in kWp |
| `period` | object | Yes | Abrechnungszeitraum |

### Response (200 OK)

```json
{
  "settlementId": "550e8400-e29b-41d4-a716-446655440011",
  "type": "eeg",
  "mastrNummer": "SEE999952467552",
  "feedInKWh": 12500.0,
  "eegTariffCentPerKWh": 8.9,
  "compensationEur": 1112.50,
  "commissioningYear": 2020,
  "tariffSource": "eeg_table",
  "calculatedAt": "2026-05-01T10:00:00Z"
}
```

- `tariffSource`: `"eeg_table"` (interne Tabelle) oder `"fallback"` (Standardwert)
- EEG-Tariflookup via `GET /api/settlement/eeg-tariff?year=<commissioningYear>`

---

## EEG-Tariflookup (GET /api/settlement/eeg-tariff)

| Feld | Wert |
|---|---|
| Method | GET |
| Path | /api/settlement/eeg-tariff |
| Action | settlement.lookupEegTariff |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Query-Parameter

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `year` | number | Yes | Inbetriebnahmejahr (2000–2025) |
| `capacityKWp` | number | No | Nennleistung für gestaffelte Tarife |

### Response (200 OK)

```json
{
  "year": 2020,
  "tariffCentPerKWh": 8.9,
  "degression": 0.004,
  "source": "eeg_2023",
  "note": "Gilt für Anlagen bis 750 kWp; ab 750 kWp abweichender Satz"
}
```

---

## A96-Export vorbereiten (POST /api/settlement/a96/prepare)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/settlement/a96/prepare |
| Action | settlement.prepareA96 |
| Auth | Bearer Token (full-access) |
| Sync/Async | Synchron |

### Request Body

```json
{
  "settlementIds": [
    "550e8400-e29b-41d4-a716-446655440010",
    "550e8400-e29b-41d4-a716-446655440011"
  ],
  "exportFormat": "xml"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `settlementIds` | string[] | Yes | IDs aus calculate-Responses |
| `exportFormat` | string | No | `"xml"` (Standard) oder `"csv"` |

### Response (200 OK)

```json
{
  "settlementId": "a96-550e8400-e29b-41d4-a716-446655440099",
  "type": "a96_export",
  "includedSettlements": 2,
  "exportFormat": "xml",
  "totalCompensationEur": 1240.75,
  "preparedAt": "2026-05-01T10:00:00Z"
}
```

Anschließend via `GET /api/settlement/a96/export/:settlementId` herunterladen.

---

## A96-Reconciliation (POST /api/settlement/a96/reconcile)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/settlement/a96/reconcile |
| Action | settlement.reconcileA96 |
| Auth | Bearer Token (full-access) |
| Sync/Async | Synchron |

### Request Body

```json
{
  "settlementId": "redispatch_2026q2_SEE999952467552",
  "toleranceEur": 0.01,
  "incomingRows": [
    {
      "anlageId": "SEE999952467552",
      "timeSlice": "2026-04-01T10:00:00.000Z/2026-04-01T12:00:00.000Z",
      "compensationEur": 132.42
    }
  ]
}
```

### Response (200 OK)

```json
{
  "success": true,
  "settlementId": "redispatch_2026q2_SEE999952467552",
  "matchingKey": "anlageId/timeSlice",
  "toleranceEur": 0.01,
  "summary": {
    "totalExpectedRows": 1,
    "totalInboundRows": 1,
    "total": 1,
    "MATCH": 1
  },
  "deltas": [
    {
      "deltaClass": "MATCH",
      "anlageId": "SEE999952467552",
      "timeSlice": "2026-04-01T10:00:00.000Z/2026-04-01T12:00:00.000Z"
    }
  ]
}
```

- Vergleich erfolgt strikt über `anlageId/timeSlice`.
- `deltaClass` kann u. a. `MATCH`, `VALUE_MISMATCH`, `MISSING_IN_INTERNAL`, `MISSING_IN_INBOUND`, `INVALID_INBOUND` sein.
- Inbound-Reconciliationdaten werden **nicht** als Settlement gespeichert (nur stateless Response).

---

## Settlement-Liste (GET /api/settlement/)

### Response (200 OK)

```json
{
  "settlements": [
    {
      "settlementId": "550e8400-e29b-41d4-a716-446655440010",
      "type": "redispatch",
      "mastrNummer": "SEE999952467552",
      "compensationEur": 128.25,
      "calculatedAt": "2026-05-01T10:00:00Z"
    }
  ],
  "total": 1
}
```

---

## Verwandte Services

- **`bilanzkreis.checkReadiness`** — prüft §42c-Konformität vor Settlement (→ Contract 23)
- **`redispatch-expost`** — 7-Schritt Audit für Settlement-Bereitschaft (→ Contract 08)
- **`edm`** — liefert Messdaten für Berechnungen (→ Contract 26)
- **`slp`** — Standardlastprofile als Prognose-Fallback (→ Contract 27)

---

## Open Points

| # | Beschreibung | Status |
|---|---|---|
| [OFFEN-1] | `exportFormat: "mscons"` für direkten MSCONS-Export geplant | v0.39 |
| [OFFEN-2] | Batch-Berechnung für gesamtes VNB-Portfolio fehlt | ungeplant |
| [OFFEN-3] | A96-Felder `[BNetzA-OFFEN]` — regulatorische Klärung ausstehend | extern |
