# Feature Specification: Cernion Energy Tools v0.9.7
## Netzbetreiberprüfungs-Monitor (NBP Monitor)

**Target release:** v0.9.7
**Status:** Draft
**Prerequisite:** v0.9.6 complete, Integration Hub panel in place
**Scope:** New `nbp-monitor.service.js`, `vnb-monitor.service.js` extension,
`src/app.html` Integration Hub extension, `api.service.js`

---

## 1. Motivation

Every German VNB accumulates a queue of installations in status
`NetzbetreiberPrüfung ausstehend` (MaStR Status 2955). This queue is
a strategic risk indicator with three dimensions that matter to
management:

- **Volume risk** — how much capacity (kWp) is unprocessed, by age class
- **Financial risk** — estimated cumulative billing uncertainty in € from
  delayed registrations
- **Process risk** — how many open tickets are waiting on the VNB itself
  vs. on the plant operator or BNetzA

Today this data is queryable via Cernion's MaStR tools but is not
aggregated into a persistent, monitorable view. v0.9.7 adds a dedicated
NBP Monitor service, a REST endpoint, an interactive dashboard in the
Integration Hub, and a Power BI M-Query in the Connector Generator.

---

## 2. Data Source & Availability

All data is derived from the public Marktstammdatenregister (MaStR) via
the existing `Cernion:cernion_grid_operator_analysis` and
`Cernion:cernion_installations` MCP tools. No internal data is required.

**Key fields per installation:**

| MaStR field | Used for |
|-------------|----------|
| `EinheitMastrNummer` | Unique identifier |
| `Einheittyp` | PV / Wind / Speicher / Sonstige |
| `Nettonennleistung` | kWp / kW |
| `DatumLetzteAktualisierung` | Age of open ticket |
| `SystemStatus` (2955) | Filter: NBP ausstehend |
| `Postleitzahl` | Geographic distribution |
| `AnschlussAnNetzMitSpannungId` | Voltage level (NS/MS/HS) |

**Age derivation:** The MaStR does not expose the exact ticket-open date.
Instead, `DatumLetzteAktualisierung` is used as a proxy — this is the
last status change timestamp. For installations still in status 2955,
this represents the moment they entered the review queue.

---

## 3. KPI Definitions

### 3.1 KPI 1 — Volume Indicator (kWp by Age Class)

**Definition:** Sum of `Nettonennleistung` (kWp) per age class and unit type.

**Age classes:**

| Class | Range | Label |
|-------|-------|-------|
| A | < 12 months | Aktuell |
| B | 12–36 months | 1–3 Jahre |
| C | 36–60 months | 3–5 Jahre |
| D | > 60 months | Altlast > 5 J. |

**Visualisation:** Stacked horizontal bar chart by age class, coloured by
unit type (PV / Wind / Speicher / Sonstige).

**Alert thresholds (configurable, initial defaults set wide):**

| Metric | 🟢 Green | 🟡 Yellow | 🔴 Red |
|--------|----------|-----------|--------|
| Total kWp in NBP | < 50 MW | 50–150 MW | > 150 MW |
| kWp class C+D (> 3 yrs) | < 10 MW | 10–50 MW | > 50 MW |

### 3.2 KPI 2 — Risk Indicator (€)

**Definition:** Estimated cumulative billing uncertainty from delayed
registrations.

**Formula per installation:**

```
riskEur = nettonennleistung_kWp
        × volllaststunden_h             // technology-specific, configurable
        × einspeiseverguetung_EurKWh    // technology-specific, configurable
        × altlastenJahre                // age class midpoint in years
        / 1000                          // kWp × h → MWh, × EUR/kWh → EUR
```

**Default parameters (configurable in UI):**

| Technology | Volllaststunden (h/a) | Einspeisevergütung (ct/kWh) |
|------------|-----------------------|-----------------------------|
| PV | 950 | 8.2 |
| Wind | 1800 | 6.5 |
| Speicher | 500 | 8.2 |
| Sonstige | 800 | 8.0 |

**Age class midpoints used in formula:**

| Class | Midpoint (years) |
|-------|-----------------|
| A (< 1 yr) | 0.5 |
| B (1–3 yrs) | 2.0 |
| C (3–5 yrs) | 4.0 |
| D (> 5 yrs) | 6.5 |

**Displayed as:** Single number card with trend arrow (vs. previous
snapshot). Accompanied by disclaimer: *"Näherungswert — keine Rechtsgrundlage,
keine Bilanzierungspflicht. Dient als Steuerungsgröße."*

### 3.3 KPI 3 — Process Indicator (VNB vs. Betreiber/BNetzA)

**Definition:** Estimated share of open NBP tickets where the bottleneck
lies with the VNB itself vs. external parties.

**Derivation from MaStR timestamp patterns:**

The MaStR `DatumLetzteAktualisierung` reflects the last update by any
party. The following heuristic classifies responsibility:

| Condition | Classification |
|-----------|----------------|
| Last update > 6 weeks ago AND status still 2955 | VNB-seitig — within §118 EnWG deadline risk |
| Last update < 6 weeks ago | In Bearbeitung (VNB or Betreiber) |
| Last update > 52 weeks ago | Altlast — likely external blockage (BNetzA, Betreiber unresponsive) |

**Output:**

```js
{
  totalOpen: 2066,
  vnbSeitig: 834,        // > 6 weeks, < 52 weeks
  inBearbeitung: 420,    // < 6 weeks
  altlast: 812,          // > 52 weeks
  vnbSeitigPercent: 40.4,
  disclaimer: "Heuristik basierend auf MaStR-Zeitstempeln — nicht rechtssicher"
}
```

**Displayed as:** Donut chart (three segments) with percentage labels.
Disclaimer shown below chart.

---

## 4. New REST Endpoint

### `GET /api/vnb-monitor/:bdewCode/nbp-monitor`

Returns the full NBP Monitor snapshot for a VNB.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `refresh` | boolean | `false` | Force cache bypass |
| `lang` | string | `de` | Language for labels and disclaimers |

**Response schema:**

```json
{
  "schemaVersion": "1.0",
  "bdewCode": "10002954",
  "timestamp": "2026-03-18T...",
  "cachedAt": "2026-03-18T...",
  "ttlSeconds": 86400,

  "summary": {
    "totalOpenCount": 2066,
    "totalOpenKWp": 121500,
    "oldestTicketDays": 1847,
    "newestTicketDays": 3
  },

  "kpi1_volume": {
    "byAgeClass": [
      { "class": "A", "label": "Aktuell (< 1 J.)", "kWp": 28400,
        "count": 512, "byType": { "PV": 18000, "Wind": 0, "Speicher": 8400, "Sonstige": 2000 } },
      { "class": "B", "label": "1–3 Jahre", "kWp": 45200,
        "count": 830, "byType": { "PV": 22000, "Wind": 8000, "Speicher": 12000, "Sonstige": 3200 } },
      { "class": "C", "label": "3–5 Jahre", "kWp": 31600,
        "count": 490, "byType": { "PV": 18000, "Wind": 6000, "Speicher": 5600, "Sonstige": 2000 } },
      { "class": "D", "label": "Altlast > 5 J.", "kWp": 16300,
        "count": 234, "byType": { "PV": 9000, "Wind": 4000, "Speicher": 2000, "Sonstige": 1300 } }
    ],
    "totalKWp": 121500,
    "alertLevel": "yellow",
    "classCD_kWp": 47900,
    "classCD_alertLevel": "yellow"
  },

  "kpi2_risk": {
    "totalRiskEur": 4820000,
    "byAgeClass": [
      { "class": "A", "riskEur": 320000 },
      { "class": "B", "riskEur": 1240000 },
      { "class": "C", "riskEur": 1680000 },
      { "class": "D", "riskEur": 1580000 }
    ],
    "parametersUsed": {
      "PV":      { "volllaststunden": 950,  "einspeiseverguetung_ctKWh": 8.2 },
      "Wind":    { "volllaststunden": 1800, "einspeiseverguetung_ctKWh": 6.5 },
      "Speicher":{ "volllaststunden": 500,  "einspeiseverguetung_ctKWh": 8.2 },
      "Sonstige":{ "volllaststunden": 800,  "einspeiseverguetung_ctKWh": 8.0 }
    },
    "disclaimer": "Näherungswert — keine Rechtsgrundlage, keine Bilanzierungspflicht."
  },

  "kpi3_process": {
    "totalOpen": 2066,
    "vnbSeitig": 834,
    "inBearbeitung": 420,
    "altlast": 812,
    "vnbSeitigPercent": 40.4,
    "inBearbeitungPercent": 20.3,
    "altlastPercent": 39.3,
    "disclaimer": "Heuristik basierend auf MaStR-Zeitstempeln — nicht rechtssicher."
  },

  "byType": {
    "PV":      { "count": 605,  "kWp": 48200 },
    "Wind":    { "count": 17,   "kWp": 38100 },
    "Speicher":{ "count": 356,  "kWp": 27900 },
    "Sonstige":{ "count": 1088, "kWp": 7300  }
  },

  "byPLZ": [
    { "plz": "67059", "count": 312, "kWp": 18400 },
    { "plz": "67061", "count": 287, "kWp": 16200 }
  ],

  "filters": {
    "ageClasses": ["A","B","C","D"],
    "types": ["PV","Wind","Speicher","Sonstige"],
    "powerClasses": ["<10kWp","10-100kWp",">100kWp"],
    "voltageLevels": ["NS","MS","HS"]
  }
}
```

---

## 5. `nbp-monitor.service.js` — Service Design

```js
module.exports = {
  name: 'nbp-monitor',

  settings: {
    cacheTtlSeconds: 86400,       // 24h — MaStR data changes slowly
    defaultParameters: {
      PV:      { volllaststunden: 950,  einspeiseverguetung_ctKWh: 8.2 },
      Wind:    { volllaststunden: 1800, einspeiseverguetung_ctKWh: 6.5 },
      Speicher:{ volllaststunden: 500,  einspeiseverguetung_ctKWh: 8.2 },
      Sonstige:{ volllaststunden: 800,  einspeiseverguetung_ctKWh: 8.0 },
    },
    parametersFile: process.env.NBP_PARAMETERS_FILE ||
                    './uploads/.nbp-parameters.json',
    vnbSeitigThresholdWeeks: 6,
    altlastThresholdWeeks: 52,
  },

  dependencies: [],   // all data via broker.call to existing services

  actions: {
    snapshot:         { /* GET /api/vnb-monitor/:bdewCode/nbp-monitor */ },
    getParameters:    { /* GET /api/nbp-monitor/parameters             */ },
    setParameters:    { /* PUT /api/nbp-monitor/parameters             */ },
    resetParameters:  { /* DELETE /api/nbp-monitor/parameters          */ },
  },
};
```

**Data fetching strategy:**

```js
// Parallel calls inside snapshot handler
const [operatorAnalysis, installations] = await Promise.all([
  ctx.call('grid-operations.operatorAnalysis', {
    gridOperatorBdewCode: bdewCode,
    includeRedispatch: false,
    includeFeedInPatterns: false,
    includeCapacityMap: false,
  }),
  ctx.call('assets.all', {
    bdewCode,
    status: 'NetzbetreiberPruefung',
    limit: 5000,   // fetch all NBP installations
  }),
]);
```

All KPI calculations (age classification, risk formula, process heuristic)
are performed **in-memory** after the data is fetched — no additional
broker calls during calculation.

---

## 6. KPI Parameter Management

### 6.1 New REST endpoints

```
GET    /api/nbp-monitor/parameters    → current parameters (defaults or custom)
PUT    /api/nbp-monitor/parameters    → save custom parameters
DELETE /api/nbp-monitor/parameters    → reset to defaults
```

### 6.2 Parameter storage

Custom parameters are persisted to `NBP_PARAMETERS_FILE`
(`./uploads/.nbp-parameters.json`, git-ignored). Format:

```json
{
  "PV":      { "volllaststunden": 950,  "einspeiseverguetung_ctKWh": 8.2 },
  "Wind":    { "volllaststunden": 1800, "einspeiseverguetung_ctKWh": 6.5 },
  "Speicher":{ "volllaststunden": 500,  "einspeiseverguetung_ctKWh": 8.2 },
  "Sonstige":{ "volllaststunden": 800,  "einspeiseverguetung_ctKWh": 8.0 }
}
```

On parameter save: clears all NBP Monitor cache entries so next poll
uses updated parameters.

---

## 7. Integration Hub UI Extension

The NBP Monitor is added as a fifth sub-section within the existing
`#integration-hub-panel`, after the Threshold Editor.

### 7.1 NBP Monitor Sub-panel Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ 📊 Netzbetreiberprüfungs-Monitor          BDEW: [10002954     ] │
│                                           [🔄 Aktualisieren]    │
├───────────────────────┬─────────────────────────────────────────┤
│ KPI 1 — Volumen       │ KPI 2 — Risiko                          │
│                       │                                          │
│ [Stacked bar chart]   │     4.820.000 €  ↑                       │
│ D ████████ 16 MW      │   geschätztes Bilanzierungsrisiko        │
│ C ████████████ 32 MW  │   [⚙️ Parameter anpassen]               │
│ B ██████████████ 45MW │                                          │
│ A ██████████ 28 MW    │ KPI 3 — Prozess                          │
│                       │                                          │
│ 🟡 Gesamt: 121,5 MW   │    [Donut chart]                         │
│                       │   40% VNB-seitig                         │
│                       │   20% In Bearbeitung                     │
│                       │   40% Altlast                            │
├───────────────────────┴─────────────────────────────────────────┤
│ Filter: [Alle Typen ▼] [Alle Altersklassen ▼] [NS/MS/HS ▼]     │
├─────────────────────────────────────────────────────────────────┤
│ Detailtabelle: PLZ-Ebene                                        │
│ PLZ    │ Anzahl │ kWp    │ Risikoklasse                         │
│ 67059  │ 312    │ 18.400 │ 🟡 Mittel                           │
│ 67061  │ 287    │ 16.200 │ 🟢 Gering                           │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 KPI 2 Parameter Editor

Inline collapsible `<details>` below the risk card:

```
▼ Parameter anpassen
┌──────────┬───────────────────┬────────────────────────────┐
│ Typ      │ Volllaststunden/a │ Einspeisevergütung (ct/kWh)│
├──────────┼───────────────────┼────────────────────────────┤
│ PV       │ [  950          ] │ [  8.2                    ]│
│ Wind     │ [ 1800          ] │ [  6.5                    ]│
│ Speicher │ [  500          ] │ [  8.2                    ]│
│ Sonstige │ [  800          ] │ [  8.0                    ]│
└──────────┴───────────────────┴────────────────────────────┘
                [💾 Speichern]  [Auf Standard zurück]
```

Uses existing `.dict-table`, `.icon-btn`, `toast()` patterns from v0.9.1.

### 7.3 Chart Implementation

Both charts are rendered as **inline SVG** in `app.html` — no external
charting library required for v0.9.7.

**KPI 1 stacked bar:** SVG `<rect>` elements, fixed viewBox, color per
unit type using existing CSS custom properties:

```
--color-pv:      var(--accent, #f59e0b)
--color-wind:    var(--success, #10b981)
--color-speicher:#6366f1
--color-sonstige:var(--muted, #6b7280)
```

**KPI 3 donut:** SVG `<circle>` with `stroke-dasharray` technique,
three segments (VNB-seitig / In Bearbeitung / Altlast).

Both charts re-render client-side when filters change — no server
round-trip for filter interactions.

### 7.4 Filter Behaviour

Filters are applied client-side to the cached snapshot data. The
`byPLZ` detail table updates instantly. The three KPI cards update
their values but not their alert levels (alert levels reflect
unfiltered totals).

---

## 8. Power BI Connector Generator Extension

A new **NBP Monitor** section is added to the Power BI tab in the
Connector Generator (below the existing VNB Monitor M-Query).

**Generated M-Query — NBP Monitor:**

```powerquery
let
    Source = Json.Document(
        Web.Contents(
            "https://<host>/api/vnb-monitor/10002954/nbp-monitor",
            [ Headers = [ #"Authorization" = "Bearer ck_xxx" ] ]
        )
    ),

    // KPI 1 — Volume by age class (flat table for bar chart)
    volumeTable = Table.FromList(
        Source[kpi1_volume][byAgeClass],
        Splitter.SplitByNothing(), null, null, ExtraValues.Error
    ),
    volumeExpanded = Table.ExpandRecordColumn(
        volumeTable, "Column1",
        {"class","label","kWp","count"}
    ),

    // KPI 2 — Risk summary (single-row table for card)
    riskTable = Table.FromRecords({[
        totalRiskEur = Source[kpi2_risk][totalRiskEur],
        disclaimer   = Source[kpi2_risk][disclaimer]
    ]}),

    // KPI 3 — Process split (three-row table for donut)
    processTable = Table.FromRecords({[
        vnbSeitig      = Source[kpi3_process][vnbSeitigPercent],
        inBearbeitung  = Source[kpi3_process][inBearbeitungPercent],
        altlast        = Source[kpi3_process][altlastPercent]
    ]})
in
    volumeTable   // switch to riskTable or processTable as needed
```

**Suggested Power BI Dashboard Structure** (static SVG diagram in UI):

```
┌─────────────────────────────────────────────────────────────────┐
│  NBP Monitor — Netzbetreiberprüfungs-Dashboard                  │
├───────────────┬────────────────┬────────────────────────────────┤
│ Card          │ Card           │ Card                           │
│ Offene Anlagen│ Offene kWp     │ Bilanzierungsrisiko            │
│ 2.066         │ 121,5 MW       │ 4.820.000 €                    │
├───────────────┴────────────────┴────────────────────────────────┤
│ 100% Stacked Bar: kWp je Altersklasse × Einheitstyp            │
├─────────────────────────────────┬───────────────────────────────┤
│ Donut: Prozessstatus            │ Karte: PLZ-Heatmap (optional) │
│ VNB / In Bearbeitung / Altlast  │                               │
├─────────────────────────────────┴───────────────────────────────┤
│ Tabelle: Detailansicht je PLZ mit Risikoklasse                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. `.env.example` Additions

```
# NBP Monitor
NBP_PARAMETERS_FILE=./uploads/.nbp-parameters.json
```

---

## 10. Tests

| File | Coverage |
|------|----------|
| `tests/nbp-monitor.service.test.js` | Snapshot with mock MaStR data; age class assignment (boundary values); KPI 2 formula correctness for each technology; KPI 3 heuristic (6-week and 52-week boundaries); parameter save/reset; cache invalidation on parameter change |
| `tests/api.service.test.js` | New routes in OpenAPI; `GET /api/vnb-monitor/:bdewCode/nbp-monitor` returns 200; parameter endpoints return correct shapes |

---

## 11. Acceptance Criteria

- [ ] `GET /api/vnb-monitor/10002954/nbp-monitor` returns valid JSON with
  all three KPI groups populated
- [ ] KPI 1 totals match `mastr.netzbetreiberPruefung.leistungMW` from
  the existing VNB Monitor snapshot (consistency check)
- [ ] KPI 2 risk value changes correctly when parameters are updated via UI
- [ ] KPI 3 disclaimer visible in UI and in JSON response
- [ ] SVG charts render correctly in `app.html` and update when filters change
- [ ] Power BI M-Query loads in Power BI Desktop without errors (manual test)
- [ ] All new REST endpoints covered by OpenAPI annotations (audit: 0 issues)
- [ ] Full test suite passes: 1004+ tests
- [ ] `npm run release:check` passes

---

## 12. Out of Scope for v0.9.7

- **Unbundling compliance check** — automated comparison of own-project
  vs. third-party processing times (as discussed in the EWR report).
  Requires legal framing; tracked for v0.10.
- **Historical trend** — storing NBP snapshots over time to show queue
  reduction/growth trend. Requires persistence layer; tracked for v0.10.
- **Individual ticket deep-dive** — clicking a PLZ to see individual
  MaStR installation IDs. Tracked for v0.9.8.
- **Power Automate alert integration** — triggering Teams alerts when
  KPI 1 alert level changes. Can be wired manually by customer using
  the generated HTTP snippet; native integration tracked for v0.9.8.
