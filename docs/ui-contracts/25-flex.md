# UI Contract: §14a Flexibilitätsmanagement (flex)

> **Page ID:** `flex`
> **Version:** 0.38.1
> **Last updated:** 2026-05-01
> **Introduced:** v0.31.0

---

## Overview

Der `flex`-Service verwaltet steuerbare Verbrauchseinrichtungen (SVE) gemäß §14a EnWG:
Wallboxen, Wärmepumpen, Batteriespeicher, Klimaanlagen. Er plant und führt Dimming-Events
aus (MQTT QoS 2 via eingebettetem `mqtt-broker`), dokumentiert Entlastungsnachweise und
berechnet Netzentgelt-Reduktionen für Kunden.

### §14a-Constraints (hartkodiert, nicht überschreibbar)

| Constraint | Wert |
|---|---|
| Mindestleistung beim Dimming | 4.2 kW |
| Maximale Dimming-Dauer | 2 Stunden |
| Mindest-Cooldown zwischen Events | 2 Stunden |

---

## API Endpoints

| Method | URL | Purpose | Auth |
|--------|-----|---------|------|
| `POST` | `/api/flex/devices` | SVE registrieren | Bearer |
| `GET`  | `/api/flex/devices` | Alle SVEs auflisten | Bearer |
| `GET`  | `/api/flex/devices/:deviceId` | Einzelne SVE abrufen | Bearer |
| `PUT`  | `/api/flex/devices/:deviceId/status` | SVE-Status aktualisieren | Bearer |
| `POST` | `/api/flex/events/plan` | Dimming-Event planen | Bearer |
| `POST` | `/api/flex/events/execute` | Dimming-Event ausführen | Bearer (full-access) |
| `GET`  | `/api/flex/relief-proof/:period` | Entlastungsnachweis abrufen | Bearer |
| `GET`  | `/api/flex/customer/:deviceId/reduction` | Netzentgelt-Reduktion berechnen | Bearer |

---

## SVE registrieren (POST /api/flex/devices)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/flex/devices |
| Action | flex.registerDevice |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Request Body

```json
{
  "deviceId": "wallbox-001",
  "deviceType": "wallbox",
  "location": {
    "postleitzahl": "67063",
    "gridOperatorId": "SNB935578300972"
  },
  "ratedPowerKW": 11.0,
  "meloId": "DE000277691200000000000021A129569",
  "controllable14a": true
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `deviceId` | string | Yes | Eindeutige Geräte-ID |
| `deviceType` | string | Yes | `"wallbox"`, `"heat_pump"`, `"storage"`, `"air_conditioning"` |
| `location.postleitzahl` | string | Yes | PLZ des Standorts |
| `location.gridOperatorId` | string | Yes | MaStR SNB/GNB-ID |
| `ratedPowerKW` | number | Yes | Nennleistung in kW |
| `meloId` | string | No | Verknüpfte Messlokation |
| `controllable14a` | boolean | Yes | §14a-Steuerbarkeit bestätigt |

### Response (201 Created)

```json
{
  "deviceId": "wallbox-001",
  "deviceType": "wallbox",
  "status": "active",
  "ratedPowerKW": 11.0,
  "controllable14a": true,
  "registeredAt": "2026-05-01T10:00:00Z"
}
```

---

## Dimming-Event planen (POST /api/flex/events/plan)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/flex/events/plan |
| Action | flex.planDimming |
| Auth | Bearer Token |
| Sync/Async | Synchron (Timeout: 120 s) |

### Request Body

```json
{
  "gridOperatorId": "SNB935578300972",
  "plannedStart": "2025-01-15T18:00:00Z",
  "plannedEnd":   "2025-01-15T19:30:00Z",
  "targetLoadReductionKW": 500.0,
  "deviceTypes": ["wallbox", "heat_pump"]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `plannedStart` | datetime | Yes | ISO 8601 UTC |
| `plannedEnd` | datetime | Yes | max. 2 h nach `plannedStart` (§14a-Constraint) |
| `targetLoadReductionKW` | number | Yes | Gewünschte Lastreduktion |
| `deviceTypes` | string[] | No | Filter auf Gerätetypen; alle wenn nicht angegeben |

### Response (200 OK)

```json
{
  "planId": "plan-550e8400-e29b-41d4-a716-446655440040",
  "plannedStart": "2025-01-15T18:00:00Z",
  "plannedEnd":   "2025-01-15T19:30:00Z",
  "durationMinutes": 90,
  "devicesIncluded": 47,
  "estimatedReductionKW": 487.0,
  "targetMetPercent": 97.4,
  "constraint14aViolations": [],
  "createdAt": "2026-05-01T10:00:00Z"
}
```

- `constraint14aViolations`: Leer wenn keine Verletzungen. Array mit Beschreibungen wenn
  §14a-Constraints verletzt wären (z.B. zu kurze Cooldown-Zeit).
- Plan muss via `execute` aktiviert werden.

---

## Dimming-Event ausführen (POST /api/flex/events/execute)

| Feld | Wert |
|---|---|
| Method | POST |
| Path | /api/flex/events/execute |
| Action | flex.executeDimming |
| Auth | Bearer Token (full-access) |
| Sync/Async | Synchron |

### Request Body

```json
{
  "planId": "plan-550e8400-e29b-41d4-a716-446655440040",
  "confirmationCode": "EXEC-OK"
}
```

### Response (200 OK)

```json
{
  "executionId": "exec-550e8400-e29b-41d4-a716-446655440041",
  "planId": "plan-550e8400-...",
  "mqttMessageId": "mqtt-7f3a9b2c",
  "commandsSent": 47,
  "commandsFailed": 0,
  "executedAt": "2026-05-01T10:00:00Z"
}
```

- MQTT-Befehle werden mit `messageType='control_command'`, `retain=false`, kurzer TTL
  und `mqttMessageId` persistiert (verhindert stale Commands nach Restart).
- `full-access`-Token erforderlich — verhindert versehentliche Ausführung.

---

## Entlastungsnachweis (GET /api/flex/relief-proof/:period)

| Feld | Wert |
|---|---|
| Method | GET |
| Path | /api/flex/relief-proof/:period |
| Action | flex.getReliefProof |
| Auth | Bearer Token |
| Sync/Async | Synchron |

### Pfad-Parameter

- `period`: Abrechnungsperiode im Format `YYYY-MM` (z.B. `2025-01`)

### Response (200 OK)

```json
{
  "period": "2025-01",
  "eventsExecuted": 8,
  "totalDimmingMinutes": 420,
  "totalReductionKWh": 312.5,
  "devicesControlled": 47,
  "constraint14aCompliant": true,
  "events": [
    {
      "executionId": "exec-...",
      "start": "2025-01-15T18:00:00Z",
      "end": "2025-01-15T19:30:00Z",
      "reductionKWh": 38.7
    }
  ]
}
```

---

## Netzentgelt-Reduktion (GET /api/flex/customer/:deviceId/reduction)

### Response (200 OK)

```json
{
  "deviceId": "wallbox-001",
  "period": "2025",
  "reductionEurPerYear": 165.0,
  "baseGridFeeEur": 340.0,
  "reducedGridFeeEur": 175.0,
  "reductionPercent": 48.5,
  "eligibilityConfirmed": true,
  "basis": "§14a EnWG — controllable_device"
}
```

---

## Verwandte Services

- **`forecast-engine`** — Netzlast-Prognose als Basis für Dimming-Planung (→ Contract 24)
- **`mqtt-broker`** — Interner persistenter MQTT-Broker (kein öffentliches API)
- **`grid-operations.controlMeasures`** — VNBDigital §14a-Steuerungsmaßnahmen (→ Contract 01)

---

## Open Points

| # | Beschreibung | Status |
|---|---|---|
| [OFFEN-1] | Automatische Planung via Netzlast-Schwellwert-Trigger | v0.39 |
| [OFFEN-2] | Aggregierter Entlastungsnachweis für gesamtes VNB-Portfolio | ungeplant |
| [OFFEN-3] | Push-Benachrichtigung an Endkunde bei Dimming-Start | ungeplant |
