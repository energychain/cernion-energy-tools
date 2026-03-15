# Cernion Energy Tools v0.9.3 — Real-World Acceptance Test
## Inhouse × External Data: Use Case Validation

**Purpose:** Validate that the v0.9.3 semantic onboarding flow produces
research-ready datasources that the agent can use in meaningful hybrid queries
combining inhouse CSV data with Cernion's external data sources (MCP tools).

**Scope:** Fixture generation, datasource registration, agent research queries,
result quality assessment, and use-case documentation.

**Prerequisite:** v0.9.3 is fully implemented and all 924 tests pass.
The Cernion MCP server is reachable at `https://mcp.cernion.de/...`.

---

## Step 1 — Generate Acceptance Test Fixtures

Create the following four CSV files in `tests/acceptance/`. These are
**realistic synthetic** datasets — plausible column names and values for a
mid-sized German Stadtwerk, but no real customer or market-partner data.

Each file must also have a companion `*.acceptance.json` sidecar (same format
as `*.fixture.json`) describing the expected classification domain and a set
of acceptance query strings.

---

### Fixture A — `beschaffungsportfolio.csv`

**Domain:** `procurement`
**Encoding:** UTF-8, delimiter `,`
**Rows:** 40–60
**Description:** Forward and spot electricity purchase positions for a
mid-sized Stadtwerk covering calendar year 2026.

**Required columns (use realistic German or mixed names):**

| Column | Example values |
|--------|---------------|
| `Lieferperiode` | `2026-Q1`, `2026-Q2`, `Jan 2026` |
| `Produkt` | `Base`, `Peak`, `HH` |
| `Menge_MWh` | `1200.0`, `800.5` |
| `Preis_EUR_MWh` | `89.40`, `95.10` |
| `Gegenpartei` | `EnBW Trading`, `Vattenfall`, `AXPO` |
| `Handelsart` | `Forward`, `Spot`, `OTC` |
| `Abschlussdatum` | `2025-09-15`, `2025-11-03` |
| `Status` | `aktiv`, `abgerechnet`, `offen` |

**Sidecar `beschaffungsportfolio.acceptance.json`:**
```json
{
  "domain": "procurement",
  "label": "Beschaffungsportfolio 2026",
  "description": "Strom-Einkaufsportfolio Stadtwerk Musterstadt, Lieferjahr 2026",
  "acceptanceQueries": [
    "Wie liegt unser Beschaffungsportfolio im Vergleich zum aktuellen Spotpreis?",
    "Welche Gegenpartei hat das größte offene Volumen in Q2 2026?",
    "Was ist der durchschnittliche Beschaffungspreis für Base-Produkte in 2026?"
  ]
}
```

---

### Fixture B — `imsys_rollout.csv`

**Domain:** `metering-point-master`
**Encoding:** UTF-8, delimiter `;`
**Rows:** 80–120
**Description:** iMSys rollout status list for the grid area, one row per
metering point, covering rollout progress as of Q1 2026.

**Required columns:**

| Column | Example values |
|--------|---------------|
| `Zaehlpunkt_ID` | `DE0001234500000000000000001234567` |
| `Zaehlernummer` | `1EMH0012345678` |
| `Geraeteart` | `iMSys`, `mME`, `konventionell` |
| `Einbaudatum` | `2025-06-12`, (empty if not yet installed) |
| `Rollout_Status` | `installiert`, `geplant`, `nicht_geplant`, `fehlgeschlagen` |
| `PLZ` | `67059`, `67061` |
| `Netzebene` | `NS`, `MS` |
| `Jahresverbrauch_kWh` | `3200`, `18500` |

**Sidecar `imys_rollout.acceptance.json`:**
```json
{
  "domain": "metering-point-master",
  "label": "iMSys Rollout-Status Q1 2026",
  "description": "Rollout-Fortschritt intelligente Messsysteme Netzgebiet Musterstadt",
  "acceptanceQueries": [
    "Wie ist unser iMSys-Rollout-Fortschritt im Vergleich zum EWK-Digitalisierungsindex?",
    "Welcher Anteil unserer Zählpunkte hat bereits ein iMSys installiert?",
    "Wie viele Zählpunkte mit Jahresverbrauch über 6000 kWh haben noch kein iMSys?"
  ]
}
```

---

### Fixture C — `stoerungshistorie.csv`

**Domain:** `grid-incidents`
**Encoding:** UTF-8, delimiter `,`
**Rows:** 50–80
**Description:** Fault history for grid assets in the distribution network,
calendar years 2024–2025.

**Required columns:**

| Column | Example values |
|--------|---------------|
| `Asset_ID` | `TRF-0042`, `KAB-0118`, `OS-0007` |
| `Asset_Typ` | `Trafo`, `Kabel`, `Ortsnetzstation` |
| `Stoerungsdatum` | `2024-03-12` |
| `Dauer_min` | `45`, `210`, `18` |
| `Ursache` | `Überlast`, `Kabelbruch`, `Alterung`, `Fremdeinwirkung` |
| `Spannungsebene` | `NS`, `MS` |
| `Betroffene_Kunden` | `12`, `340`, `4` |
| `Behebungszeit_min` | `30`, `185`, `15` |

**Sidecar `stoerungshistorie.acceptance.json`:**
```json
{
  "domain": "grid-incidents",
  "label": "Störungshistorie Netz 2024-2025",
  "description": "Störungsmeldungen und Behebungszeiten Verteilnetz Musterstadt",
  "acceptanceQueries": [
    "Gibt es eine Korrelation zwischen unseren Störungsereignissen und Redispatch-Aktivierungen im Netzgebiet?",
    "Welche Asset-Typen haben die längsten durchschnittlichen Störungsdauern?",
    "Wie hat sich die Störungshäufigkeit 2024 vs. 2025 entwickelt?"
  ]
}
```

---

### Fixture D — `pv_anlagenliste.csv`

**Domain:** `grid-assets`
**Encoding:** UTF-8, delimiter `;`
**Rows:** 60–100
**Description:** Inventory of PV installations connected to the local
distribution grid, derived from an internal asset register (not raw MaStR
export — internal column naming).

**Required columns:**

| Column | Example values |
|--------|---------------|
| `Anlagen_ID` | `PV-2021-00042`, `PV-2023-00118` |
| `MaStR_Nummer` | `SEE912345678901`, (may be empty) |
| `PLZ` | `67059`, `67063` |
| `Leistung_kWp` | `9.8`, `29.4`, `498.0` |
| `Inbetriebnahme` | `2021-04-15` |
| `Netzebene` | `NS`, `MS` |
| `Anschluss_Trafo` | `TRF-0042`, `TRF-0117` |
| `Einspeisemanagement` | `ja`, `nein` |
| `Status` | `aktiv`, `stillgelegt`, `in_pruefung` |

**Sidecar `pv_anlagenliste.acceptance.json`:**
```json
{
  "domain": "grid-assets",
  "label": "PV-Anlagenliste Netzgebiet",
  "description": "Interne Anlagenübersicht PV-Einspeisung Verteilnetz Musterstadt",
  "acceptanceQueries": [
    "Wie verteilt sich unsere installierte PV-Leistung im Vergleich zum Netzgebietsdurchschnitt laut EWK-Benchmark?",
    "Welche Trafostationen haben die höchste kumulierte PV-Einspeisung angeschlossen?",
    "Wie viel kWp sind seit 2023 neu ans Netz gegangen, und wie entwickelt sich der Trend?"
  ]
}
```

---

## Step 2 — Register and Classify All Four Datasources

For each fixture, perform the following steps via the UI or API:

1. Upload the CSV via `POST /api/datasources/uploads`.
2. Create the datasource with the correct connector config (`delimiter`,
   `encoding`, `skipRows: 0` for all four acceptance fixtures).
3. Click **Save & Run AI Inference**.
4. Wait for the semantic onboarding banner to appear.
5. Confirm or correct the suggested domain if needed.

**Expected classification results:**

| Fixture | Expected domain | Max acceptable `requiresUserInput` |
|---------|----------------|------------------------------------|
| `beschaffungsportfolio.csv` | `procurement` | `false` |
| `imys_rollout.csv` | `metering-point-master` | `false` |
| `stoerungshistorie.csv` | `grid-incidents` | `false` |
| `pv_anlagenliste.csv` | `grid-assets` | `false` |

If any fixture returns `requiresUserInput: true`, document the reason and
proceed with manual domain confirmation before running queries.

---

## Step 3 — Execute Acceptance Queries

For each fixture, run **all three** acceptance queries from the sidecar
JSON via the Research Agent (`POST /api/agent/analyze`), with
`inhouseSources: [<sourceId>]` set to the registered datasource.

### Evaluation Criteria per Query

Score each query result on three dimensions (1 = poor, 3 = good):

| Dimension | 1 | 2 | 3 |
|-----------|---|---|---|
| **Routing** | Wrong tool used or no external source joined | External source called but not joined with inhouse | Correct `in-memory-join` or intent class used |
| **Completeness** | Answer missing key figures | Answer partial, some figures from inhouse | Answer uses both inhouse and external data fully |
| **Usefulness** | Generic answer, could come from web search alone | Some inhouse context visible | Answer is only possible because of the inhouse–external combination |

Minimum acceptable score per query: **Routing ≥ 2, Usefulness ≥ 2**.

---

## Step 4 — Document Working Use Cases

For each query that scores Routing ≥ 2 and Usefulness ≥ 2, create a use-case
entry in `docs/use-cases/` with the following structure:

**File:** `docs/use-cases/<domain>-<slug>.md`

```markdown
# Use Case: <Short Title>

**Domain:** <domain-id>
**Department:** <Stadtwerk department>
**Inhouse datasource:** <fixture filename>
**External Cernion source:** <MCP tool or action name>

## Query

> <exact query string used>

## What the agent did

1. Resolved inhouse datasource via alias/discovery
2. Called <external tool> for <date range / context>
3. Joined on <key field> using <intent class or in-memory-join action>
4. Calculated <result>

## Result summary

<2–3 sentence description of what the answer contained>

## Why this is only possible with inhouse data

<1–2 sentences explaining what external-only research could NOT have answered>

## Scores

| Routing | Completeness | Usefulness |
|---------|-------------|------------|
| 3 | 3 | 3 |
```

---

## Step 5 — Release Gate

After all four fixture sets have been tested and at least **8 of 12 queries**
score Routing ≥ 2 + Usefulness ≥ 2:

- [ ] Commit use-case docs to `docs/use-cases/`
- [ ] Commit acceptance fixtures to `tests/acceptance/`
- [ ] Run `npm run release:check` — must pass
- [ ] Run `npm test` — 924+ tests, 0 failures
- [ ] Tag `v0.9.3` on `main`

If fewer than 8 queries pass the threshold, document the gaps as
known limitations in `CHANGELOG.md` under `[0.9.3] Known Limitations`
before tagging.

---

## Appendix — Cernion External Sources Expected per Use Case

| Acceptance query | Expected external Cernion action |
|-----------------|----------------------------------|
| Beschaffung vs. Spotpreis | `energy-market.prices` |
| iMSys-Rollout vs. EWK-Benchmark | `Cernion:ewk_digitalisierungsindex` |
| Störungen vs. Redispatch | `Cernion:netztransparenz_redispatch` |
| PV-Leistung vs. Netzgebiet-Benchmark | `Cernion:ewk_benchmark_vnb` or `Cernion:mastr_generation_forecast` |
