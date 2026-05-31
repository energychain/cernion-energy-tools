# Audit Report - Tranche C: Die Orchestrierung & Use Cases (Layer 2)

**Zielschicht:** Layer 2
**Generiert am:** 2026-05-31T10:02:49.550Z (UTC)

## Zusammenfassung der Tranche

- **Geprüfte Services:** 31
- 🔴 **Rot (Schwere Mängel):** 0
- 🟡 **Gelb (Handlungsbedarf):** 5
- 🟢 **Grün (Schichtenrein):** 26

--- 

## Detailbewertung der Services

### agent-receipts.service.js (2.7 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["pouchdb","pouchdb-find"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'agent-receipts' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### capability-broker.service.js (29.6 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/capability-catalog","../src/agent-planning-utils"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'capability-broker' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### znp.service.js (99.7 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["path","crypto","moleculer","pouchdb","pouchdb-find","graphology","../src/job-store","../src/job-store","../src/znp-pdf-extractor","../src/znp-osm-buildings"]`
- **Abgehende Service-Calls (ctx.call):** `["interface-placeholder.canExecuteAction","interface-placeholder.listGaps","interface-placeholder.markGap"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'znp' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### cya.service.js (123.6 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["moleculer","../src/cya-data-retriever","../src/cya-regulatory-graph","../src/cya-ontology-graph","../src/cya-context-manager","../src/cya-grounding","../src/cya-synthesis","../src/job-store","../src/async-job-runner","../src/cya-agent-personas"]`
- **Abgehende Service-Calls (ctx.call):** `["object-store.query","cya.createProfile","object-store.list","cya.session.a2aLog"]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded German cities found in code.
- [ ] FILE_SIZE: Large file (123.6 KB) indicating potential bloat.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'cya' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

### vdmi.service.js (78.8 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","moleculer","../src/tenant-context","../src/vdmi-system-templates"]`
- **Abgehende Service-Calls (ctx.call):** `["hitl.create"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded German cities found in code.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'vdmi' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

### vdmi-evidence.service.js (9.6 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","pouchdb","../src/vdmi-audit-trail","../src/vdmi-signature"]`
- **Abgehende Service-Calls (ctx.call):** `["vdmi.getTask","vdmi.updateTask"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'vdmi-evidence' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### vdmi-findings.service.js (10.6 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","pouchdb","../src/vdmi-audit-trail"]`
- **Abgehende Service-Calls (ctx.call):** `["vdmi.update"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'vdmi-findings' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### vdmi-human-override.service.js (11.1 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","pouchdb","../src/vdmi-audit-trail"]`
- **Abgehende Service-Calls (ctx.call):** `["vdmi.get","vdmi.update","vdmi.getVersion"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'vdmi-human-override' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### vdmi-spectator.service.js (9.6 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","pouchdb"]`
- **Abgehende Service-Calls (ctx.call):** `["vdmi.getTask"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'vdmi-spectator' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### grid-connection.service.js (57.2 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","../src/mcp-client","../src/async-job-runner","../src/pagination","../src/validation-findings","../src/netzfahrplan-schema"]`
- **Abgehende Service-Calls (ctx.call):** `["interface-placeholder.listGaps","interface-placeholder.markGap","datapoint.data","ewk-monitoring.anschlussdauer","ewk-monitoring.umsetzungsquote"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'grid-connection' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### grid-operations.service.js (92.4 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["moleculer","../src/mcp-client","../src/async-job-poller","../src/job-store","../src/format-response","../src/netzfahrplan-schema","../src/validation-findings"]`
- **Abgehende Service-Calls (ctx.call):** `["company.enrichResults","interface-placeholder.listGaps","interface-placeholder.markGap"]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded German cities found in code.
- [ ] HARDCODING: Hardcoded ZIP codes found in code.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'grid-operations' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

### vnb-monitor.service.js (55.5 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/tenant-context","../src/vnb-monitor-defaults"]`
- **Abgehende Service-Calls (ctx.call):** `["grid-operations.vnbLookupCodes","grid-operations.marketPartners","grid-operations.vnbLookup","vnb-monitor.snapshot","object-store.put","object-store.delete","object-store.get"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'vnb-monitor' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### nbp-monitor.service.js (22.3 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/tenant-context"]`
- **Abgehende Service-Calls (ctx.call):** `["vnb-monitor.snapshot","grid-operations.vnbLookup","assets.all","object-store.put","object-store.delete","object-store.get"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'nbp-monitor' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### ewk-monitoring.service.js (26.4 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/mcp-client","../src/format-response"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'ewk-monitoring' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### energy-sharing.service.js (55.0 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","../src/mcp-client","../src/async-job-runner","../src/pagination","../src/validation-findings"]`
- **Abgehende Service-Calls (ctx.call):** `["datapoint.data"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'energy-sharing' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### energy-sharing-allocation.service.js (40.7 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","../src/mcp-client","../src/async-job-runner","../src/pagination","../src/timeseries-allocation"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'energy-sharing-allocation' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### utility-report.service.js (127.9 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["crypto","fs","path","../src/mcp-client","../src/llm-client","../src/metrics","../src/tracing","../src/observability-context","../src/market-role-classifier","../src/report-builder"]`
- **Abgehende Service-Calls (ctx.call):** `["utility-report.rebuild"]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded German cities found in code.
- [ ] FILE_SIZE: Large file (127.9 KB) indicating potential bloat.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'utility-report' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

### redispatch-expost.service.js (55.5 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","../src/mcp-client","../src/async-job-runner","../src/pagination","../src/validation-findings","../src/redispatch-risk"]`
- **Abgehende Service-Calls (ctx.call):** `["assets.applyOverridesToInstallations","datapoint.data"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'redispatch-expost' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### hitl.service.js (30.9 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","moleculer","../src/tenant-context"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "status": "ambiguous",
  "message": "Found 3 symbols matching 'hitl'. Use uid, file_path, or kind to disambiguate.",
  "candidates": [
    {
      "uid": "Const:services/vdmi.service.js:hitl",
      "name": "hitl",
      "kind": "",
      "filePath": "services/vdmi.service.js",
      "line": 702,
      "score": 0.5
    },
    {
      "uid": "Const:services/assets.service.js:hitl",
      "name": "hitl",
```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### cookbook.service.js (16.2 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/cookbook-recipes","../src/cookbook-embeddings","moleculer"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'cookbook' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### bilanzkreis.service.js (23.4 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","../src/tenant-context","../src/bilanzkreis-calculator"]`
- **Abgehende Service-Calls (ctx.call):** `["edm.getMelo","object-store.delete","object-store.put","object-store.get","object-store.list","object-store.query","edm.getTimeseries"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "status": "found",
  "symbol": {
    "uid": "Const:services/bilanzkreis.service.js:bilanzkreis",
    "name": "bilanzkreis",
    "filePath": "services/bilanzkreis.service.js",
    "startLine": 364,
    "endLine": 364
  },
  "incoming": {},
  "outgoing": {},
  "processes": []
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### blindflug-radar.service.js (21.1 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","moleculer","../src/tenant-context","../src/interface-placeholder-schema","../src/disturbance-schema"]`
- **Abgehende Service-Calls (ctx.call):** `["redispatch-expost.list","mastr-monitor.listWatches","mastr-monitor.getDeltas","mastr-quality.list","znp.listProjects","znp.assessPortfolio","hitl.create","interface-placeholder.listGaps","interface-placeholder.markGap"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'blindflug-radar' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### business-intelligence.service.js (27.2 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["../src/mcp-client","../src/async-job-poller","../src/format-response","../src/job-store"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded German cities found in code.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'business-intelligence' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

### company.service.js (18.3 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","../src/mcp-client","../src/market-role-classifier","moleculer","moleculer","moleculer","moleculer"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'company' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### eog-calculator.service.js (43.0 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","moleculer"]`
- **Abgehende Service-Calls (ctx.call):** `["eog-calculator.inputStatus","datapoint.create","datapoint.remove"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'eog-calculator' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### flex.service.js (24.0 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","../src/flex-calculator"]`
- **Abgehende Service-Calls (ctx.call):** `["object-store.put","flex.listDevices","mqtt-broker.publish","edm.getTimeseries","object-store.get","object-store.list","object-store.query","forecast-engine.forecastLoad"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'flex' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### forecast-engine.service.js (25.7 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","../src/forecast-calculator"]`
- **Abgehende Service-Calls (ctx.call):** `["slp.generateTimeseries","edm.getTimeseries","forecast-engine.forecastLoad","forecast-engine.forecastGeneration","forecast-engine.forecastResidual","object-store.put","object-store.get","object-store.list"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'forecast-engine' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### forecast.service.js (28.4 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/mcp-client","xlsx"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "status": "ambiguous",
  "message": "Found 7 symbols matching 'forecast'. Use uid, file_path, or kind to disambiguate.",
  "candidates": [
    {
      "uid": "Function:services/energy-market.service.js:forecast",
      "name": "forecast",
      "kind": "Function",
      "filePath": "services/energy-market.service.js",
      "line": 535,
      "score": 0.56
    },
    {
      "uid": "Const:src/flex-calculator.js:forecast",
      "name": "forecast",
```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### investment-planning.service.js (14.0 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","moleculer","../src/tenant-context","../src/interface-placeholder-schema","../src/investment-plan-utils"]`
- **Abgehende Service-Calls (ctx.call):** `["vdmi.list","hitl.create","redispatch-expost.get","redispatch-expost.list","interface-placeholder.listGaps","interface-placeholder.markGap"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'investment-planning' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### nova.service.js (48.4 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","stream","pouchdb","pouchdb-find","moleculer","../src/tenant-context","../src/nova-decision-machine","../src/async-job-runner","../src/pagination","../src/redispatch-utils"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "status": "found",
  "symbol": {
    "uid": "Function:src/cya-data-retriever.js:nova",
    "name": "nova",
    "kind": "Function",
    "filePath": "src/cya-data-retriever.js",
    "startLine": 33,
    "endLine": 34
  },
  "incoming": {},
  "outgoing": {},
  "processes": []
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### settlement.service.js (28.2 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","../src/tenant-context","../src/eeg-tariff-tables","../src/settlement-calculator"]`
- **Abgehende Service-Calls (ctx.call):** `["object-store.query","edm.getTimeseries","slp.generateTimeseries","edm.listMelos","object-store.put","object-store.get"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "status": "found",
  "symbol": {
    "uid": "Const:services/settlement.service.js:settlement",
    "name": "settlement",
    "filePath": "services/settlement.service.js",
    "startLine": 539,
    "endLine": 539
  },
  "incoming": {},
  "outgoing": {},
  "processes": []
}

```

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

