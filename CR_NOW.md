# Feature Specification: Cernion Energy Tools v0.9.5
## VNB Monitor API — KPI Aggregation for Power Automate & Power BI

**Target release:** v0.9.5
**Status:** Draft
**Prerequisite:** v0.9.4 stability pass complete, all 973 tests passing
**Scope:** New `vnb-monitor.service.js`, `api.service.js` extension,
`.env.example`, optional `vnb-monitor-alerts.config.json`

---

## 1. Motivation

Cernion's MCP tools already deliver all data needed for a comprehensive
VNB performance view: EWK benchmarks, MaStR installation counts, pipeline
capacity, Netzbetreiberprüfung queues, and spot-price context. Today this
data is consumed interactively via the Research Agent or as a one-off PDF
report.

The next step is to make the same data available as a **stable, machine-readable
JSON endpoint** that external tools like Microsoft Power Automate and Power BI
can poll on a schedule — enabling automated alerts, dashboards, and governance
workflows without any manual Cernion interaction.

This feature adds a `vnb-monitor` Moleculer service that aggregates KPIs for
one or more VNBs identified by BDEW code, caches results with a configurable
TTL, and exposes a REST endpoint with a structured JSON response including
an `alerts` array for threshold-based notifications.

---

## 2. Goals

- Single REST endpoint returns all KPIs from the EWR analysis report as JSON.
- Response is stable and schema-versioned so Power Automate flows and Power BI
  datasets do not break on Cernion updates.
- TTL cache prevents hammering MCP tools on every poll; configurable per
  environment.
- `alerts` array allows Power Automate to act conditionally: only send a Teams
  message when `alerts.length > 0` or when a specific `severity` is present.
- Multiple BDEW codes can be compared in a single call (useful for
  multi-entity Stadtwerk groups like EWR with two registrations).
- No authentication changes required — existing Bearer token / API key
  mechanism applies.

---

## 3. New REST Endpoints

### 3.1 `GET /api/vnb-monitor/:bdewCode`

Returns the full KPI snapshot for a single VNB.

**Path parameter:** `bdewCode` — BDEW registration number, e.g. `10002954`

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `refresh` | boolean | `false` | Force cache bypass and re-fetch all KPIs |
| `alerts` | boolean | `true` | Include `alerts` array in response |
| `lang` | string | `de` | Language for alert messages (`de` or `en`) |

**Response:** `200 OK` — see Section 5 for full schema.

---

### 3.2 `GET /api/vnb-monitor`

Returns KPI snapshots for multiple VNBs in a single call. Useful for
Power BI datasets that visualise a peer comparison (e.g. EWR vs. SW
Frankenthal vs. SW Walldorf).

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `bdewCodes` | string | — | Comma-separated BDEW codes, e.g. `10002954,9900386000008` |
| `refresh` | boolean | `false` | Force cache bypass |
| `lang` | string | `de` | Language for alert messages |

**Response:** Array of KPI snapshots, same schema per item.

---

### 3.3 `GET /api/vnb-monitor/:bdewCode/alerts`

Returns only the `alerts` array for a VNB — optimised for Power Automate
polling where only changed/new alerts trigger a downstream action.

**Response:**
```json
{
  "bdewCode": "10002954",
  "timestamp": "2026-03-16T08:00:00Z",
  "alertCount": 2,
  "criticalCount": 1,
  "alerts": [ ... ]
}
```

---

## 4. `vnb-monitor.service.js` — Service Design

### 4.1 Service Schema

```js
module.exports = {
  name: 'vnb-monitor',

  settings: {
    cacheTtlSeconds: 3600,          // 1 hour default; override via env
    alertThresholds: null,          // loaded from vnb-monitor-alerts.config.json
    defaultLang: 'de',
  },

  dependencies: [
    // No hard dependencies — all MCP tools called via broker.call
    // Gracefully degrades if individual tools are unavailable
  ],

  actions: {
    snapshot:      { /* GET /api/vnb-monitor/:bdewCode */ },
    snapshotMulti: { /* GET /api/vnb-monitor */ },
    alerts:        { /* GET /api/vnb-monitor/:bdewCode/alerts */ },
    clearCache:    { /* POST /api/vnb-monitor/:bdewCode/cache/clear */ },
  },
};
```

### 4.2 Data Fetching Strategy

Each `snapshot` call triggers **parallel** broker calls to:

| Source | Cernion action | KPI group |
|--------|---------------|-----------|
| BNetzA EWK | `Cernion:ewk_benchmark_vnb` | EWK KPIs, ranks, digitalisierungsindex |
| BNetzA EWK | `Cernion:ewk_anschlussdauer` | Phase 1 / Phase 2 split |
| BNetzA EWK | `Cernion:ewk_umsetzungsquote` | Realisation rates |
| BNetzA EWK | `Cernion:ewk_digitalisierungsindex` | Digital sub-scores |
| MaStR | `Cernion:cernion_installations` | Installed capacity, pipeline, queue |
| MaStR | `Cernion:cernion_grid_operator_analysis` | Prüfungs-queue details |
| Spot market | `Cernion:cernion_energy_prices` | Current Day-Ahead price |
| Gas storage | `Cernion:agsi_eu_statistics` | DE gas storage fill level |

**Graceful degradation:** If an individual source is unavailable, the
corresponding KPI group is returned as `null` with a `sourceError` flag.
The response is still valid JSON — it never fails entirely due to one
source being down.

### 4.3 Caching

Results are cached in-memory per BDEW code with a configurable TTL.
Cache key: `vnb-monitor:${bdewCode}`.

The cache is **not** persisted across restarts (unlike the datasource registry).
On restart, the first poll rebuilds the cache from MCP tools.

Cache entries store:
```js
{
  data: { /* full snapshot */ },
  cachedAt: ISO-timestamp,
  expiresAt: ISO-timestamp,
}
```

---

## 5. Response Schema

```json
{
  "schemaVersion": "1.0",
  "bdewCode": "10002954",
  "timestamp": "2026-03-16T08:00:00Z",
  "cachedAt": "2026-03-16T07:00:00Z",
  "ttlSeconds": 3600,

  "identity": {
    "name": "EWR Netz GmbH",
    "mastrId": "SNE953789382174",
    "bdewCode": "10002954",
    "location": "Alzey",
    "resolvedAt": "2026-03-16T07:00:00Z"
  },

  "ewk": {
    "sourceAvailable": true,
    "reportYear": 2024,
    "anschlussdauer": {
      "eeNS_weeks": 82,
      "eeNS_phase1_weeks": 7,
      "eeNS_phase2_weeks": 75,
      "verbrauchNS_weeks": 218,
      "eeMS_weeks": null,
      "rankEeNS": 604,
      "rankVerbrauchNS": 701,
      "totalVnbs": 740,
      "bundesmedianEeNS_weeks": 40,
      "bundesmedianVerbrauchNS_weeks": 30
    },
    "umsetzungsquote": {
      "eeNS_percent": 38.6,
      "verbrauchNS_percent": 11.7,
      "verbrauchMS_percent": 98.6,
      "rankEeNS": 639,
      "totalVnbs": 698
    },
    "digitalisierungsindex": {
      "gesamt_percent": 24,
      "smartGrids_percent": 5,
      "kundenportal_percent": 83,
      "datenmanagement_percent": 64,
      "kiEinsatz_percent": 0,
      "rank": 475,
      "totalVnbs": 656,
      "bundesmedian_percent": 30
    }
  },

  "mastr": {
    "sourceAvailable": true,
    "asOf": "2026-03-16",
    "inBetrieb": {
      "anlagenCount": 5500,
      "leistungMW": 224,
      "pvAnlagen": 4389,
      "pvLeistungMW": 61,
      "windAnlagen": 50,
      "windLeistungMW": 135,
      "speicherAnlagen": 1000,
      "speicherLeistungMW": 7
    },
    "inPlanung": {
      "anlagenCount": 157,
      "leistungMW": 153.6,
      "percentOfInstalledCapacity": 68.6
    },
    "netzbetreiberPruefung": {
      "anlagenCount": 2066,
      "leistungMW": 121.5,
      "davonSpeicher": 356,
      "davonPv": 605,
      "davonWind": 17
    }
  },

  "market": {
    "sourceAvailable": true,
    "dayAheadPrice_eurMWh": 89.08,
    "co2Intensity_gCO2eqKWh": 196,
    "gasStorageDE_percent": 22,
    "gasStorageStatus": "CRITICAL",
    "timestamp": "2026-03-16T07:00:00Z"
  },

  "alerts": [
    {
      "severity": "critical",
      "code": "ANSCHLUSSDAUER_VERBRAUCH_CRITICAL",
      "group": "ewk.anschlussdauer",
      "field": "verbrauchNS_weeks",
      "currentValue": 218,
      "threshold": 100,
      "rank": "701/708",
      "message": "Anschlussdauer Verbrauch NS: 218 Wo. (Schwelle: 100 Wo.) — Rang 701/708",
      "message_en": "Connection time consumption NS: 218 weeks (threshold: 100 weeks) — rank 701/708",
      "recommendation": "Prozessanalyse Phase 2 Verbrauchsanschlüsse priorisieren",
      "ewkImpact": true
    },
    {
      "severity": "warning",
      "code": "UMSETZUNGSQUOTE_EE_LOW",
      "group": "ewk.umsetzungsquote",
      "field": "eeNS_percent",
      "currentValue": 38.6,
      "threshold": 60,
      "rank": "639/698",
      "message": "Umsetzungsquote EE NS: 38,6 % (Schwelle: 60 %) — Rang 639/698",
      "message_en": "EE NS realisation rate: 38.6% (threshold: 60%) — rank 639/698",
      "recommendation": "NetzbetreiberPrüfungs-Stau abbauen — §118 EnWG Fristdruck beachten",
      "ewkImpact": true
    },
    {
      "severity": "warning",
      "code": "GAS_STORAGE_CRITICAL",
      "group": "market.gasStorage",
      "field": "gasStorageDE_percent",
      "currentValue": 22,
      "threshold": 30,
      "message": "DE Gasspeicher 22 % (Schwelle: 30 %) — Handlungsbedarf bis 1. November",
      "message_en": "DE gas storage 22% (threshold: 30%) — action required by November 1",
      "recommendation": "Einkaufsstrategie für Q3/Q4 überprüfen",
      "ewkImpact": false
    }
  ],

  "alertSummary": {
    "total": 3,
    "critical": 1,
    "warning": 2,
    "info": 0,
    "ewkRelevant": 2
  },

  "sourceErrors": []
}
```

---

## 6. Alert Thresholds Configuration

Default thresholds are defined in `src/vnb-monitor-defaults.js` and can
be overridden per deployment via `vnb-monitor-alerts.config.json` in the
project root.

### 6.1 Default Thresholds

```js
// src/vnb-monitor-defaults.js
module.exports = {
  thresholds: {
    // EWK — Anschlussdauer
    'ewk.anschlussdauer.eeNS_weeks':       { warning: 60,  critical: 90  },
    'ewk.anschlussdauer.verbrauchNS_weeks':{ warning: 60,  critical: 100 },

    // EWK — Umsetzungsquote
    'ewk.umsetzungsquote.eeNS_percent':    { warning: 60,  critical: 40  }, // lower = worse
    'ewk.umsetzungsquote.verbrauchNS_percent':{ warning: 40, critical: 20 },

    // EWK — Digitalisierungsindex
    'ewk.digitalisierungsindex.gesamt_percent':    { warning: 25, critical: 15 },
    'ewk.digitalisierungsindex.smartGrids_percent':{ warning: 10, critical: 5  },

    // MaStR — Prüfungs-Queue
    'mastr.netzbetreiberPruefung.leistungMW': { warning: 50,  critical: 100 },

    // Market
    'market.gasStorageDE_percent':            { warning: 30,  critical: 20  },
  }
};
```

### 6.2 Override File

`vnb-monitor-alerts.config.json` (optional, git-ignored):
```json
{
  "thresholds": {
    "ewk.anschlussdauer.verbrauchNS_weeks": { "warning": 80, "critical": 150 },
    "mastr.netzbetreiberPruefung.leistungMW": { "warning": 80, "critical": 120 }
  }
}
```

---

## 7. Power Automate Integration

### 7.1 Recommended Flow Structure

```
Trigger: Recurrence — Every day at 06:00
  → HTTP GET https://<cernion-host>/api/vnb-monitor/10002954
       Headers: Authorization: Bearer <token>
  → Parse JSON (schema from Section 5)
  → Condition: alertSummary.critical > 0
       Yes → Post Teams message (critical alert details)
  → Condition: alertSummary.ewkRelevant > 0
         AND current week = week 1 of month
       Yes → Send Email to Regulierungsbeauftragter
```

### 7.2 Power BI Direct Query

Power BI can consume the multi-VNB endpoint directly:

```
Source: Web
URL: https://<cernion-host>/api/vnb-monitor?bdewCodes=10002954,9900386000008
Headers: Authorization: Bearer <token>
```

The flat structure of the response (no deeply nested arrays except
`alerts`) is intentional — Power BI's JSON connector handles it without
transformation.

### 7.3 `schemaVersion` Guarantee

The `schemaVersion` field in the response is incremented only on
**breaking changes** to the response structure. Power Automate flows and
Power BI datasets can check `schemaVersion` and fail gracefully if an
unexpected version is returned.

Minor additions (new fields) are non-breaking and do not increment the
version.

---

## 8. `.env.example` Additions

```
# VNB Monitor
VNB_MONITOR_CACHE_TTL_SECONDS=3600
VNB_MONITOR_DEFAULT_BDEW_CODES=10002954,9900386000008
VNB_MONITOR_ALERT_CONFIG_FILE=./vnb-monitor-alerts.config.json
```

---

## 9. Tests

| File | Coverage |
|------|----------|
| `tests/vnb-monitor.service.test.js` | All three actions; cache hit/miss; graceful degradation when one MCP source fails; alert generation for each threshold category; multi-VNB response shape |
| `tests/api.service.test.js` | New routes present in OpenAPI; auth enforced; `?refresh=true` bypasses cache |
| `tests/vnb-monitor.alerts.test.js` | Alert threshold logic: boundary values, critical vs. warning, ewkImpact flag, lang=en message |

---

## 10. OpenAPI Annotations

All three endpoints require full OpenAPI annotations:
- `tags: ['VNBMonitor']`
- `summary` and `description`
- `parameters` (path + query)
- `responses.200` with full JSON schema reference
- `responses.404` for unknown BDEW code
- `responses.503` for all sources unavailable

OpenAPI audit gate must pass with 0 issues after implementation.

---

## 11. Acceptance Criteria

- [ ] `GET /api/vnb-monitor/10002954` returns valid JSON matching schema v1.0
- [ ] Response includes all KPI groups: `ewk`, `mastr`, `market`, `alerts`
- [ ] `alertSummary.critical >= 1` for EWR Netz GmbH (known poor performer)
- [ ] `GET /api/vnb-monitor?bdewCodes=10002954,9900386000008` returns array with 2 items
- [ ] `GET /api/vnb-monitor/10002954/alerts` returns only alerts, faster response
- [ ] `?refresh=true` bypasses cache and re-fetches all sources
- [ ] If one MCP source is unavailable, response still returns with `sourceErrors` populated
- [ ] `schemaVersion: "1.0"` present in all responses
- [ ] Power Automate HTTP action can consume the response without transformation
- [ ] OpenAPI audit: 0 issues
- [ ] Full test suite passes: 973+ tests
- [ ] `npm run release:check` passes

---

## 12. Out of Scope for v0.9.5

- **Push/webhook notifications** — Power Automate pull is sufficient;
  push adds infrastructure complexity without proportional benefit.
- **Historical KPI tracking** — storing time series of KPIs for trend
  analysis. Tracked for v0.10.
- **Unbundling compliance monitoring** — automated Netzbetreiberprüfung
  timestamp comparison (as described in Section 10 of the EWR report).
  Requires careful legal framing; tracked for v0.10.
- **Authentication scoping per BDEW code** — multi-tenant access control.
  Current single Bearer token is sufficient for v0.9.5.
