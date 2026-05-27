````markdown
# UI Contract: Lastgangdaten Bewegungsstrom Monitor

> **Page ID:** `load-profile-stream-monitor`
> **Version:** 0.55.x (Unreleased)
> **Last updated:** 2026-05-27

---

## Primary API Endpoint

`GET /api/dashboard/load-profile-stream-monitor`

### Query parameters

- `meloId` (required): Marktlokation ID
- `from` (required): ISO start timestamp (inclusive)
- `to` (required): ISO end timestamp (exclusive)
- `obis` (optional, default `1-0:1.8.0`)
- `gridOperatorId` (optional): MaStR VNB context (`SNB...` / `GNB...`)
- `profileId` (optional, default `H0`)
- `annualConsumptionKwh` (optional)

---

## Response Shape

```json
{
  "streamStatus": {
    "signal": "yellow",
    "partial": true,
    "classification": {
      "dataQualityGap": 2,
      "realAnomaly": 1,
      "forecastProblem": 1,
      "processGovernanceBreak": 0
    },
    "dataQuality": 0.9375
  },
  "qualityFindings": {
    "summary": {
      "totalValues": 96,
      "findings": 4,
      "errors": 1,
      "warnings": 2,
      "infos": 1,
      "autoFixed": 0,
      "dataQuality": 0.9375
    },
    "recommendations": [
      "Lücken erkannt: Gap-Filling mit Interpolation oder Vortagswerten ausführen."
    ],
    "total": 4,
    "errors": 1,
    "warnings": 2,
    "infos": 1
  },
  "anomalySignals": {
    "dataQualityGap": [],
    "realAnomaly": [],
    "forecastProblem": [],
    "processGovernanceBreak": []
  },
  "restrictionRefs": [
    {
      "ref": "GAP_DETECTION",
      "source": "edm-validation.validate",
      "class": "dataQualityGap",
      "severity": "warning"
    }
  ],
  "forecastQuality": {
    "rmse": 0.282144,
    "mae": 0.216441,
    "mape": 12.312,
    "bias": 0.031,
    "correlation": 0.91,
    "sampleSize": 96,
    "rating": "fair",
    "signal": "yellow"
  },
  "decisionNotes": [
    "Partial findings active: mindestens eine Quelle ist nicht verfügbar, vorhandene Evidenz wurde dennoch ausgewertet.",
    "Forecast problem signal erkannt: SLP-/Forecast-Parameter und Vergleichsfenster nachkalibrieren.",
    "Gesamtstatus: yellow."
  ],
  "sourceActions": {
    "edm.getTimeseriesSummary": { "success": true, "partial": false, "groups": 1 },
    "edm-validation.validate": { "success": true, "partial": false, "findings": 4 },
    "forecast-engine.evaluateQuality": { "success": false, "partial": false, "rating": null },
    "vdmi.findings": { "success": true, "partial": true, "findings": 2 }
  },
  "timestamp": "2026-05-27T11:00:00.000Z",
  "_errors": ["forecast-engine.evaluateQuality"]
}
```

---

## Strict Anomaly Classes

Der Endpoint trennt Auffälligkeiten strikt in genau vier Klassen:

1. `dataQualityGap` — Datenqualitätslücken (z. B. Gap/Duplicate/Monotony)
2. `realAnomaly` — reale Messanomalien (z. B. Bandbreite/Negativwerte)
3. `forecastProblem` — Prognose-/Modellproblem (z. B. schlechte Forecast-Qualität)
4. `processGovernanceBreak` — Governance-Prozessbruch (kritische offene VDMI-Findings)

Keine vermischten Klassen, keine implizite Umdeutung.

---

## Partial Findings Policy

- Der Endpoint bleibt **read-only** und liefert auch bei Teilfehlern einen `200`.
- Fehlgeschlagene Quellen werden in `_errors` aufgeführt.
- Verfügbare Evidenz wird dennoch in den vier Buckets ausgewertet.
- `streamStatus.partial=true` signalisiert degradierte Vollständigkeit.

---

## Data Sources (read-only)

- `edm.getTimeseriesSummary`
- `edm-validation.validate`
- `forecast-engine.evaluateQuality`
- `vdmi.findings`

Keine neue Persistenz, keine doppelte Validierungslogik.

````
