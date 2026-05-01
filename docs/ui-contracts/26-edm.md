# UI Contract: Energiedatenmanagement (EDM)

> **Page ID:** `edm`
> **Version:** 0.38.1
> **Last updated:** 2026-05-01
> **Introduced:** v0.28.0 (Core), v0.29.0 (Messkonzept, Validation, Virtual, MSCONS)

---

## Overview

Das EDM-Layer ist das Messdaten-Fundament der Plattform. Es besteht aus vier Services:

| Service | Beschreibung | Endpoints |
|---------|-------------|-----------|
| `edm` | Core: MeLo-Registry + Zeitreihen-Import/-Query | 10 |
| `edm-messkonzept` | Virtuelle Zähler (Formel-Engine: SUM/DIFF/NET/CALC) | 6 |
| `edm-validation` | 6 Validierungsregeln + automatische Lückenfüllung | 4 |
| `edm-virtual` | SLP-basierte Befüllung virtueller MeLos | 2 |
| `mscons-import` | EDIFACT MSCONS-Import (offline, KRITIS-konform) | 3 |

SQLite-Backend (`better-sqlite3`, WAL-Modus, quartalsweise Partitionierung).
KRITIS-konform: kein externer Server, kein Netzwerk-Port.

---

## EDM Core — API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `POST`   | `/api/edm/melos` | MeLo anlegen | Bearer |
| `GET`    | `/api/edm/melos` | MeLos auflisten | Bearer |
| `GET`    | `/api/edm/melos/:meloId` | Einzelne MeLo abrufen | Bearer |
| `PUT`    | `/api/edm/melos/:meloId` | MeLo aktualisieren | Bearer |
| `DELETE` | `/api/edm/melos/:meloId` | MeLo löschen | Bearer (full-access) |
| `POST`   | `/api/edm/melos/from-mastr` | MeLo aus MaStR-Anlage erstellen | Bearer |
| `POST`   | `/api/edm/timeseries/import` | Zeitreihe importieren (CSV/JSON) | Bearer |
| `GET`    | `/api/edm/timeseries/:meloId` | Zeitreihe abfragen | Bearer |
| `GET`    | `/api/edm/timeseries/:meloId/summary` | Zeitreihen-Zusammenfassung | Bearer |
| `DELETE` | `/api/edm/timeseries/:meloId` | Zeitreihendaten löschen | Bearer (full-access) |

---

## MeLo anlegen (POST /api/edm/melos)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/edm/melos |
| Action | edm.createMelo |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Request Body

```json
{
  "meloId": "DE000277691200000000000021A129569",
  "meloType": "physical",
  "obisCode": "1-0:1.8.0",
  "unit": "kWh",
  "description": "Solarpark Höheinöd — Netzeinspeisung",
  "mastrNummer": "SEE999952467552"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `meloId` | string | Yes | 33-stellige MeLo-ID (`DE...`) |
| `meloType` | string | Yes | `"physical"`, `"virtual"`, `"dummy"` |
| `obisCode` | string | No | OBIS-Kennzahl |
| `unit` | string | No | Einheit (default: `"kWh"`) |
| `mastrNummer` | string | No | Verknüpfte MaStR-Anlage |
| `sourceType` | string | No | `"manual"`, `"mscons"`, `"csv"`, `"slp"` |

### Response (201 Created)

```json
{
  "meloId": "DE000277691200000000000021A129569",
  "meloType": "physical",
  "obisCode": "1-0:1.8.0",
  "unit": "kWh",
  "mastrNummer": "SEE999952467552",
  "createdAt": "2026-05-01T10:00:00Z"
}
```

---

## Zeitreihe importieren (POST /api/edm/timeseries/import)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/edm/timeseries/import |
| Action | edm.importTimeseries |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Request Body (JSON-Format)

```json
{
  "meloId": "DE000277691200000000000021A129569",
  "format": "json",
  "resolution": "15min",
  "data": [
    { "timestamp": "2025-01-01T00:00:00Z", "value": 42.5 },
    { "timestamp": "2025-01-01T00:15:00Z", "value": 38.2 }
  ]
}
```

CSV-Format: deutsches Dezimalformat (`42,5`) mit Semikolon-Separator.

### Response (200 OK)

```json
{
  "meloId": "DE000277691200000000000021A129569",
  "imported": 2976,
  "skipped": 0,
  "errors": [],
  "period": { "from": "2025-01-01T00:00:00Z", "to": "2025-01-31T23:45:00Z" }
}
```

---

## Zeitreihe abfragen (GET /api/edm/timeseries/:meloId)

### Query-Parameter

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `from` | datetime | Yes | ISO 8601 UTC |
| `to` | datetime | Yes | ISO 8601 UTC |
| `resolution` | string | No | `"15min"` (Standard), `"hourly"`, `"daily"` |

### Response (200 OK)

```json
{
  "meloId": "DE000277691200000000000021A129569",
  "resolution": "15min",
  "unit": "kWh",
  "dataPoints": [
    { "timestamp": "2025-01-01T00:00:00Z", "value": 42.5 }
  ],
  "totalCount": 2976,
  "period": { "from": "2025-01-01T00:00:00Z", "to": "2025-01-31T23:45:00Z" }
}
```

---

## EDM-Messkonzept — API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `POST`   | `/api/edm/messkonzepte` | Messkonzept anlegen | Bearer |
| `GET`    | `/api/edm/messkonzepte` | Alle Messkonzepte auflisten | Bearer |
| `GET`    | `/api/edm/messkonzepte/:id` | Einzelnes Messkonzept abrufen | Bearer |
| `DELETE` | `/api/edm/messkonzepte/:id` | Messkonzept löschen | Bearer (full-access) |
| `POST`   | `/api/edm/messkonzepte/:id/evaluate` | Messkonzept auswerten | Bearer |
| `POST`   | `/api/edm/messkonzepte/evaluate-all` | Alle Messkonzepte auswerten (Batch) | Bearer |

### Messkonzept anlegen (POST /api/edm/messkonzepte)

```json
{
  "id": "nettoeinspeisung-hoeheinoed",
  "description": "Netto-Einspeisung = Erzeugt - Eigenverbrauch",
  "formula": "DIFF",
  "operands": [
    "DE000277691200000000000021A129569",
    "DE000277691200000000000021A129570"
  ]
}
```

- Formeltypen: `SUM`, `DIFF`, `NET`, `CALC` (freie Expression), `CUSTOM`
- `CALC` verwendet sichere Expression-Evaluation ohne `eval()`

### Auswertung (POST /api/edm/messkonzepte/:id/evaluate)

```json
{
  "period": { "from": "2025-01-01T00:00:00Z", "to": "2025-01-31T23:45:00Z" },
  "resolution": "15min"
}
```

Response: identische Struktur wie Zeitreihen-Query (`dataPoints`, `totalCount`, etc.)

---

## EDM-Validierung — API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `POST` | `/api/edm/validate` | Zeitreihe validieren | Bearer |
| `GET`  | `/api/edm/validate/:meloId/report` | Validierungsbericht abrufen | Bearer |
| `POST` | `/api/edm/validate/:meloId/fill-gaps` | Lücken automatisch füllen | Bearer |
| `GET`  | `/api/edm/validate/rules` | Regelkatalog abrufen | Bearer |

### Validierungsregeln

| Regel | Code | Beschreibung |
|-------|------|-------------|
| Bandbreite | `bandwidth` | Werte außerhalb min/max-Bereich |
| Lücken | `gaps` | Fehlende Intervalle |
| Monotonie | `monotony` | Nicht-steigende Zählerstände |
| Duplikate | `duplicates` | Identische Timestamps |
| SLP-Plausibilität | `slp_plausibility` | Abweichung > X% vom Standardlastprofil |
| Negative Werte | `negative` | Unerwartete negative Werte |

### Lückenfüllungs-Fallback-Kette

1. Interpolation (benachbarte Werte)
2. Vortag gleiche Uhrzeit
3. SLP-Standardprofil
4. Zero (wenn alles fehlschlägt)

---

## EDM-Virtual — API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `POST` | `/api/edm/virtual/populate-slp` | MeLo mit SLP-Profil befüllen | Bearer |
| `POST` | `/api/edm/virtual/auto-populate/day` | Tag automatisch befüllen | Bearer |

Für virtuelle/dummy-MeLos ohne reale Messdaten — ermöglicht vollständige
Bilanzierung und Testing ohne echte Zählerdaten.

---

## MSCONS-Import — API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `POST` | `/api/mscons/import` | MSCONS-Datei importieren | Bearer |
| `GET`  | `/api/mscons/imports/:importId` | Import-Status abrufen | Bearer |
| `GET`  | `/api/mscons/imports` | Alle Imports auflisten | Bearer |

### MSCONS-Import (POST /api/mscons/import)

```json
{
  "content": "UNA:+.? 'UNB+UNOC:3+...",
  "autoCreateMelo": true,
  "validate": true
}
```

- Eingebetteter EDIFACT-Parser: offline-fähig, keine externen Abhängigkeiten
- Unterstützte Segmente: UNH/BGM/DTM/NAD/LOC/CCI/QTY/STS
- `autoCreateMelo: true` → erstellt fehlende MeLos automatisch mit `sourceType: "mscons"`
- `validate: true` → führt `edm-validation` nach Import aus

### Response (200 OK)

```json
{
  "importId": "mscons-550e8400-...",
  "melosCreated": 2,
  "melosUpdated": 0,
  "dataPointsImported": 5952,
  "validationIssues": 0,
  "period": { "from": "2025-01-01T00:00:00Z", "to": "2025-01-31T23:45:00Z" }
}
```

---

## MeLos auflisten — sourceType-Filter (seit v0.29)

`GET /api/edm/melos?sourceType=mscons` filtert auf MSCONS-importierte MeLos.

Erlaubte `sourceType`-Werte: `manual`, `mscons`, `csv`, `slp`, `mastr`

---

## Verwandte Services

- **`slp`** — SLP-Standardlastprofile für edm-virtual (→ Contract 27)
- **`bilanzkreis`** — Konsumiert Zeitreihendaten (→ Contract 23)
- **`settlement`** — Nutzt Messdaten für Berechnungen (→ Contract 22)
- **`forecast-engine`** — Liest historische Messdaten für Korrekturen (→ Contract 24)

---

## Open Points

| # | Beschreibung | Status |
|---|---|---|
| [OFFEN-1] | Streaming-Import für große MSCONS-Dateien (>10 MB) | v0.39 |
| [OFFEN-2] | DSGVO-Lösch-Workflow (Retention-Policy UI) | ungeplant |
| [OFFEN-3] | Cross-Quarter-Query-Optimierung für Jahresauswertungen | v0.39 |
| [OFFEN-4] | `edm.stats`-Action ist intern — kein REST-Endpunkt | dokumentiert |
