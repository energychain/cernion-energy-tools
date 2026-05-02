# Hygiene Sprint — Cernion v0.38.4
Generiert: 2026-05-01
ESLint-Version: 8.57.1 (node/handle-callback-err gefiltert)

## Zusammenfassung
- Gesamt (roh): 906 Findings
- Gefiltert (node/handle-callback-err, inkompatibel ESLint v8): 127
- Bereinigt: 779 Findings
- Ignoriert (detect-object-injection, >95% Falsch-Positive Moleculer-Bracket-Notation): 403
- **Actionable: 376**

| Prio | Regel | Findings |
|------|-------|----------|
| 1 | no-unused-vars | 22 |
| 2 | prefer-immediate-return + no-collapsible-if | 17 |
| 3 | no-duplicate-string (≥ 6 Duplikate) | 77 |
| 4 | cognitive-complexity (> 30) | 31 |
| 5 | detect-non-literal-regexp | 3 |

---

## Prio 1: Nicht verwendete Variablen / Imports [S]
(no-unused-vars — echter Bug-Hinweis, schnell zu fixen)

- [x] services/api.service.js:909 — `_res` definiert aber nie verwendet [S]
- [x] services/api.service.js:1340 — `_ctx` definiert aber nie verwendet [S]
- [x] services/api.service.js:1340 — `_route` definiert aber nie verwendet [S]
- [x] services/api.service.js:1340 — `_req` definiert aber nie verwendet [S]
- [x] services/api.service.js:1348 — `_route` definiert aber nie verwendet [S]
- [x] services/api.service.js:1348 — `_req` definiert aber nie verwendet [S]
- [x] services/cya.service.js:15 — `buildNegotiationPrompt` zugewiesen aber nie verwendet [S]
- [x] services/datapoint.service.js:525 — `ctx` definiert aber nie verwendet [S]
- [x] services/energy-sharing.service.js:29 — `DV_INACTIVE` zugewiesen aber nie verwendet [S]
- [x] services/energy-sharing.service.js:658 — `params` definiert aber nie verwendet [S]
- [x] services/grid-connection.service.js:828 — `capacityByVoltage` zugewiesen aber nie verwendet [S]
- [x] services/mastr-monitor.service.js:134 — `payload` definiert aber nie verwendet [S]
- [x] services/mastr-quality.service.js:1301 — `allNap` zugewiesen aber nie verwendet [S]
- [x] services/utility-report.service.js:277 — `scrubReportPrompt` zugewiesen aber nie verwendet [S]
- [x] src/bilanzkreis-calculator.js:119 — `_hours` zugewiesen aber nie verwendet [S]
- [x] src/cya-context-manager.js:19 — `queryNodes` zugewiesen aber nie verwendet [S]
- [x] src/cya-data-retriever.js:4 — `isToolAllowed` zugewiesen aber nie verwendet [S]
- [x] src/cya-ontology-graph.js:165 — `attrs` definiert aber nie verwendet [S]
- [x] src/forecast-calculator.js:334 — `chargeEnergyKwh` zugewiesen aber nie verwendet [S]
- [x] src/oemetadata-builder.js:68 — `INSTALLATION_TYPES` zugewiesen aber nie verwendet [S]
- [x] src/oemetadata-builder.js:438 — `_ext` zugewiesen aber nie verwendet [S]
- [x] src/znp-pdf-extractor.js:83 — `applyCosPhi` zugewiesen aber nie verwendet [S]

---

## Prio 2: Sofortige Vereinfachungen [S]
(prefer-immediate-return, no-collapsible-if — mechanische Fixes)

### prefer-immediate-return (11)
- [x] services/cookbook.service.js:533 — temp. Variable `rows` sofort zurückgeben [S]
- [x] services/datapoint.service.js:602 — temp. Variable `doc` sofort zurückgeben [S]
- [x] services/datasource-classifier.service.js:384 — temp. Variable `classification` sofort zurückgeben [S]
- [x] services/datasource-classifier.service.js:661 — temp. Variable `rows` sofort zurückgeben [S]
- [x] services/residual-load.service.js:754 — temp. Variable `result` sofort zurückgeben [S]
- [x] services/vnb-monitor.service.js:1426 — temp. Variable `results` sofort zurückgeben [S]
- [x] src/async-job-poller.js:292 — temp. Variable `result` sofort zurückgeben [S]
- [x] src/connectors/scraper.connector.js:73 — temp. Variable `rows` sofort zurückgeben [S]
- [x] src/edm-csv-importer.js:122 — temp. Variable `autoParsed` sofort zurückgeben [S]
- [x] src/edm-validation-rules.js:144 — temp. Variable `overflowDetected` sofort zurückgeben [S]
- [x] src/oemetadata-builder.js:283 — temp. Variable `metadata` sofort zurückgeben [S]

### no-collapsible-if (6)
- [x] services/assets.service.js:131 — verschachtelte if-Statements zusammenführen [S]
- [x] services/datasource-connector.service.js:299 — verschachtelte if-Statements zusammenführen [S]
- [x] services/datasource-connector.service.js:323 — verschachtelte if-Statements zusammenführen [S]
- [x] services/datasource-connector.service.js:329 — verschachtelte if-Statements zusammenführen [S]
- [x] services/mastr-quality.service.js:1725 — verschachtelte if-Statements zusammenführen [S]
- [x] src/cya-ontology-graph.js:435 — verschachtelte if-Statements zusammenführen [S]

---

## Prio 3: Magic Strings → Konstanten [S-M]
(no-duplicate-string — nur Findings mit ≥ 6 Duplikaten, 77 gesamt)

### Sehr hoch (≥ 15×)
- [ ] src/validation-findings.js:458 — Literal 32× dupliziert → Konstante [S]
- [ ] src/validation-findings.js:619 — Literal 25× dupliziert → Konstante [S]
- [ ] services/entsoe.service.js:66 — Literal 24× dupliziert → Konstante [S]
- [ ] src/validation-findings.js:357 — Literal 20× dupliziert → Konstante [S]
- [ ] src/validation-findings.js:745 — Literal 19× dupliziert → Konstante [S]
- [ ] services/entsoe.service.js:715 — Literal 15× dupliziert → Konstante [S]

### Hoch (10–14×)
- [ ] src/cya-report-builder.js:95 — Literal 14× dupliziert → Konstante [S]
- [ ] services/entsoe.service.js:96 — Literal 13× dupliziert → Konstante [S]
- [ ] services/znp.service.js:162 — Literal 12× dupliziert → Konstante [S]
- [ ] services/mastr-monitor.service.js:146 — Literal 12× dupliziert → Konstante [S]
- [ ] services/grid-operations.service.js:98 — Literal 12× dupliziert → Konstante [S]
- [ ] services/entsoe.service.js:278 — Literal 12× dupliziert → Konstante [S]
- [ ] services/forecast-engine.service.js:130 — Literal 11× dupliziert → Konstante [S]
- [ ] services/energy-market.service.js:86 — Literal 11× dupliziert → Konstante [S]
- [ ] services/in-memory-join.service.js:595 — Literal 10× dupliziert → Konstante [S]
- [ ] services/in-memory-join.service.js:121 — Literal 10× dupliziert → Konstante [S]
- [ ] services/grid-operations.service.js:143 — Literal 10× dupliziert → Konstante [S]
- [ ] services/edm.service.js:253 — Literal 10× dupliziert → Konstante [S]
- [x] services/datapoint.service.js:97 — Literal 10× dupliziert → `EXAMPLE_DATAPOINT_NAME` ✅ v0.38.6

### Mittel (6–9×) — weitere 52 Findings in eslint-findings-clean.txt

**Block A (agent/api/assets/bilanzkreis/bi/company/cookbook/cya/dashboard-api/datapoint/datasource-cache/datasource-registry) — v0.38.6 ✅**
- [x] services/agent.service.js — `ACTION_DS_CACHE_QUERY`, `EXAMPLE_SESSION_ID`
- [x] services/api.service.js — `CONTENT_TYPE_HEADER`, `CONTENT_TYPE_JSON`
- [x] services/assets.service.js — 21 Beschreibungs-Konstanten extrahiert
- [x] services/bilanzkreis.service.js — `OPENAPI_TAG`
- [x] services/business-intelligence.service.js — `SERVICE_NAME`, `OPENAPI_TAG`
- [x] services/cookbook.service.js — `OEO_CLASS_KEY`, `OEO_CLASS_URL`
- [x] services/cya.service.js — `DEFAULT_TONE`, `OS_PUT`, `OS_GET`, `EXAMPLE_TRIGGER`
- [x] services/dashboard-api.service.js — `OPENAPI_TAG`, 4 Action-Konstanten
- [x] services/datapoint.service.js — `EXAMPLE_DATAPOINT_NAME`
- [x] services/datasource-cache.service.js — `COL_LEISTUNG_BEZUG`, `COL_LEISTUNG_EINSPEISUNG`

**Block B (energy-*/entsoe/flex/forecast/gas-storage/german-grid/grid-*/in-memory-join/mastr-*/src/) — offen**

---

## Prio 4: Hohe Kognitive Komplexität [M-L]
(cognitive-complexity — nur Funktionen mit Komplexität > 30, 31 Findings)

### KRITISCH (Komplexität > 100) — eigener Refactoring-Prompt empfohlen
- [ ] services/utility-report.service.js:1533 — Komplexität 335 [L]
- [ ] services/api.service.js:1078 — Komplexität 205 [L]
- [ ] services/agent.service.js:2405 — Komplexität 153 [L]
- [ ] services/assets.service.js:270 — Komplexität 129 [L]

### HOCH (Komplexität 31–100)
- [ ] src/edm-mscons-parser.js:175 — Komplexität 85 [M]
- [ ] services/edm-validation.service.js:192 — Komplexität 85 [M]
- [ ] services/in-memory-join.service.js:1100 — Komplexität 82 [M]
- [ ] src/cya-tool-registry.js:223 — Komplexität 73 [M]
- [ ] services/energy-market.service.js:879 — Komplexität 71 [M]
- [ ] src/report-builder.js:983 — Komplexität 57 [M]
- [ ] services/in-memory-join.service.js:1524 — Komplexität 54 [M]
- [ ] src/edm-messkonzept-engine.js:156 — Komplexität 52 [M]
- [ ] services/datasource-connector.service.js:281 — Komplexität 50 [M]
- [ ] services/api.service.js:84 — Komplexität 48 [M]
- [ ] services/vnb-monitor.service.js:498 — Komplexität 47 [M]
- [ ] services/in-memory-join.service.js:777 — Komplexität 47 [M]
- [ ] src/edm-replacement-values.js:95 — Komplexität 44 [M]
- [ ] services/vnb-monitor.service.js:1024 — Komplexität 44 [M]
- [ ] src/report-builder.js:1550 — Komplexität 43 [M]
- [ ] src/forecast-calculator.js:287 — Komplexität 42 [M]
- [ ] services/api.service.js:909 — Komplexität 42 [M]
- [ ] services/agent.service.js:3411 — Komplexität 40 [M]
- [ ] src/report-builder.js:3058 — Komplexität 39 [M]
- [ ] src/report-builder.js:3702 — Komplexität 36 [M]
- [ ] src/report-builder.js:2444 — Komplexität 34 [M]
- [ ] services/mastr-quality.service.js:1607 — Komplexität 34 [M]
- [ ] services/energy-sharing.service.js:494 — Komplexität 34 [M]
- [ ] services/mscons-import.service.js:133 — Komplexität 33 [M]
- [ ] services/datasource-cache.service.js:477 — Komplexität 32 [M]
- [ ] services/assets.service.js:111 — Komplexität 32 [M]
- [ ] services/residual-load.service.js:399 — Komplexität 31 [M]

### MITTEL (Komplexität 15–30) — weitere 64 Findings in eslint-findings-clean.txt

---

## Prio 5: Security (echte Findings) [M]
(detect-non-literal-regexp — 3 Findings, real)

- [x] services/company.service.js:366 — non-literal RegExp → `String.includes` (kein RegExp nötig) ✅ v0.38.7
- [x] services/vnb-monitor.service.js:176 — non-literal RegExp → Literal-Regex (LEGAL_SUFFIXES statisch) ✅ v0.38.7
- [x] src/edm-messkonzept-engine.js:26 — non-literal RegExp → zwei Literal-Konstanten (blocklist statisch) ✅ v0.38.7

---

## Legende
[S] < 30 Min | [M] 30–90 Min | [L] > 90 Min, eigener Prompt

## Status
- Prio 1: 22/22 erledigt ✅
- Prio 2: 17/17 erledigt ✅
- Prio 3: 0/77 erledigt
- Prio 4: 0/31 erledigt
- Prio 5: 3/3 erledigt ✅ v0.38.7
