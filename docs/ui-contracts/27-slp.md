# UI Contract: SLP-Service (Standardlastprofile)

> **Page ID:** `slp`
> **Version:** 0.38.1
> **Last updated:** 2026-05-01
> **Introduced:** v0.28.0

---

## Overview

Der SLP-Service stellt BDEW-Standardlastprofile (H0, G0, L0 u.a.) als dedizierter
Microservice bereit. Unterstützt Custom-Profile für individuelle Versorger-/Netzbetreiber-
Anpassungen. Wird von `edm-virtual`, `forecast-engine` und `settlement` als Prognose-
und Fallback-Basis genutzt.

---

## API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `GET`    | `/api/slp/profiles` | Alle Profile auflisten | Bearer |
| `GET`    | `/api/slp/profiles/:profileId` | Einzelnes Profil abrufen | Bearer |
| `POST`   | `/api/slp/generate` | SLP-Zeitreihe generieren | Bearer |
| `POST`   | `/api/slp/profiles` | Custom-Profil anlegen | Bearer (full-access) |
| `DELETE` | `/api/slp/profiles/:profileId` | Custom-Profil löschen | Bearer (full-access) |

---

## Profile auflisten (GET /api/slp/profiles)

| Feld | Wert |
|---|---|
| Method | GET |
| Path | /api/slp/profiles |
| Action | slp.listProfiles |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Response (200 OK)

```json
{
  "profiles": [
    {
      "profileId": "H0",
      "name": "Haushalt",
      "category": "residential",
      "source": "bdew",
      "description": "BDEW-Standardlastprofil für Privathaushalte"
    },
    {
      "profileId": "G0",
      "name": "Gewerbe allgemein",
      "category": "commercial",
      "source": "bdew",
      "description": "BDEW-Standardlastprofil für Gewerbebetriebe"
    },
    {
      "profileId": "L0",
      "name": "Landwirtschaft allgemein",
      "category": "agriculture",
      "source": "bdew",
      "description": "BDEW-Standardlastprofil für landwirtschaftliche Betriebe"
    },
    {
      "profileId": "custom-vnb-1",
      "name": "TWL Custom Gewerbe",
      "category": "commercial",
      "source": "custom",
      "description": "Angepasstes Profil für TWL-Gewerbekunden"
    }
  ],
  "total": 4
}
```

### BDEW-Standardprofile

| ID | Name | Kategorie |
|----|------|-----------|
| `H0` | Haushalt | Residential |
| `G0` | Gewerbe allgemein | Commercial |
| `G1` | Gewerbe werktags 8–18 Uhr | Commercial |
| `G2` | Gewerbe mit Abendverbrauch | Commercial |
| `G3` | Gewerbe durchlaufend | Commercial |
| `G4` | Laden/Friseur | Commercial |
| `G5` | Bäckerei mit Backstube | Commercial |
| `G6` | Wochenendbetrieb | Commercial |
| `L0` | Landwirtschaft allgemein | Agriculture |
| `L1` | Landwirtschaft mit Milchwirtschaft | Agriculture |
| `L2` | Andere Landwirtschaft | Agriculture |

---

## SLP-Zeitreihe generieren (POST /api/slp/generate)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/slp/generate |
| Action | slp.generate |
| Auth | Bearer Token |
| Sync/Async | Synchron (Timeout: 30 s) |

### Request Body

```json
{
  "profileId": "H0",
  "annualKWh": 4500,
  "dateFrom": "2025-01-01",
  "dateTo":   "2025-01-07",
  "resolution": "15min"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `profileId` | string | Yes | BDEW-Profil-ID oder Custom-Profil-ID |
| `annualKWh` | number | Yes | Jahresverbrauch zur Skalierung |
| `dateFrom` | date string | Yes | ISO 8601 (`YYYY-MM-DD`) |
| `dateTo` | date string | Yes | ISO 8601 |
| `resolution` | string | No | `"15min"` (Standard), `"hourly"`, `"daily"` |

### Response (200 OK)

```json
{
  "profileId": "H0",
  "annualKWh": 4500,
  "period": { "dateFrom": "2025-01-01", "dateTo": "2025-01-07" },
  "resolution": "15min",
  "totalKWh": 86.3,
  "dataPoints": [
    { "timestamp": "2025-01-01T00:00:00Z", "valueKWh": 0.142 },
    { "timestamp": "2025-01-01T00:15:00Z", "valueKWh": 0.135 }
  ],
  "intervals": 672
}
```

---

## Custom-Profil anlegen (POST /api/slp/profiles)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/slp/profiles |
| Action | slp.createProfile |
| Auth | Bearer Token (full-access) |
| Sync/Async | Synchron |

### Request Body

```json
{
  "profileId": "custom-vnb-1",
  "name": "TWL Custom Gewerbe",
  "category": "commercial",
  "description": "Angepasstes Profil für TWL-Gewerbekunden",
  "quarterHourFactors": {
    "weekday": [0.42, 0.38, 0.35, 0.33],
    "saturday": [0.55, 0.52, 0.48, 0.44],
    "sunday": [0.35, 0.30, 0.28, 0.25]
  }
}
```

- `profileId` muss mit `custom-` beginnen
- `quarterHourFactors`: Skalierungsfaktoren pro 15-min-Slot (96 Werte pro Tagtyp)
- Kurzform mit 4 Werten wird auf 96 Slots erweitert (gleichmäßige Verteilung)

### Response (201 Created)

```json
{
  "profileId": "custom-vnb-1",
  "name": "TWL Custom Gewerbe",
  "source": "custom",
  "createdAt": "2026-05-01T10:00:00Z"
}
```

---

## Verwandte Services

- **`edm-virtual`** — nutzt SLP zur Befüllung virtueller MeLos (→ Contract 26)
- **`forecast-engine`** — nutzt SLP als Basis für Lastprognosen (→ Contract 24)
- **`settlement`** — nutzt SLP als Prognosefallback bei EEG-Berechnung (→ Contract 22)

---

## Open Points

| # | Beschreibung | Status |
|---|---|---|
| [OFFEN-1] | Temperatursensitive SLP-Varianten (Heizgradtag-Korrektur) | v0.39 |
| [OFFEN-2] | Import von Custom-Profilen via CSV-Upload | ungeplant |
| [OFFEN-3] | Validierung der `quarterHourFactors` auf Summenkonstanz | v0.38.2 |
