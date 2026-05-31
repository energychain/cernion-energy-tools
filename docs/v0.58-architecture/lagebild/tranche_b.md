# Audit Report - Tranche B: Die Infrastruktur & Transport (Layer 0)

**Zielschicht:** Layer 0
**Generiert am:** 2026-05-31T10:03:11.009Z (UTC)

## Zusammenfassung der Tranche

- **Geprüfte Services:** 22
- 🔴 **Rot (Schwere Mängel):** 0
- 🟡 **Gelb (Handlungsbedarf):** 1
- 🟢 **Grün (Schichtenrein):** 21

--- 

## Detailbewertung der Services

### api.service.js (93.1 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer-web","moleculer-auto-openapi","moleculer","crypto","path","fs","../package.json","../src/metrics","../src/rate-quota-store","../src/tracing"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### dashboard-api.service.js (51.4 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/validation-findings"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### auth.service.js (15.6 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","moleculer","../src/tenant-context","../src/auth/rbac","../src/auth/oidc","../src/auth/saml"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### token-manager.service.js (9.9 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["fs","path","crypto"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### datapoint.service.js (59.1 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["pouchdb","pouchdb-find","crypto","moleculer","../src/pagination","../src/oeo-mappings","../src/oemetadata-builder","../src/oeo-mappings"]`
- **Abgehende Service-Calls (ctx.call):** `["agent.loadSession","datapoint.list","datapoint.refresh"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### system.service.js (7.9 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/mcp-client","../src/llm-client"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### tenant-quota.service.js (8.3 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","../src/rate-quota-store"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### backup-orchestrator.service.js (17.3 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","fs","path","pouchdb","pouchdb-find"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### job-status.service.js (22.0 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/job-store"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### object-store.service.js (17.8 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["pouchdb","pouchdb-find","moleculer"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### observability.service.js (21.8 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["moleculer","../src/observability-store"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### webhooks.service.js (23.3 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","axios","pouchdb","pouchdb-find","moleculer","../src/tenant-context","../src/webhook-crypto"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### query.service.js (18.3 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["../src/mcp-client"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded German cities found in code.

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

### in-memory-join.service.js (57.3 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/date-utils","../src/period-normaliser"]`
- **Abgehende Service-Calls (ctx.call):** `["datasource-cache.query"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### presentation.service.js (41.7 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `[]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### datasource-registry.service.js (31.1 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","fs/promises","path","../src/semantic-domains","../src/pagination"]`
- **Abgehende Service-Calls (ctx.call):** `["datasource-connector.inferSchema"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### datasource-cache.service.js (16.8 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `[]`
- **Abgehende Service-Calls (ctx.call):** `["datasource-registry.get","datasource-connector.read"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### datasource-classifier.service.js (23.7 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["../src/semantic-domains","../src/oeo-mappings","../src/mcp-client","../src/period-normaliser"]`
- **Abgehende Service-Calls (ctx.call):** `["datasource-registry.updateClassification","datasource-classifier.classify","datasource-cache.status","datasource-cache.refresh","datasource-cache.query","datasource-registry.get"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### datasource-connector.service.js (11.2 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["fs","path"]`
- **Abgehende Service-Calls (ctx.call):** `["datasource-connector.read"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### datasource-discovery.service.js (12.7 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["path","../src/oeo-mappings"]`
- **Abgehende Service-Calls (ctx.call):** `["datasource-registry.list","datasource-cache.status"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### datasource-watcher.service.js (5.6 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["fs","path"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

### mqtt-broker.service.js (15.1 KB)
- **Status-Ampel:** 🟢 GRÜN
- **Imports (Auszug):** `["crypto","fs","path","pouchdb","pouchdb-find","moleculer"]`
- **Abgehende Service-Calls (ctx.call):** `[]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- Keine Schichtverletzungen oder kritischen Hartcodierungen gefunden. Der Service verhält sich schichtenkonform.

#### Konkrete Aufräum-Empfehlung:
*   Der Service ist stabil. Keine Änderungen notwendig. Bereit für die Broker-Registrierung.

--- 

