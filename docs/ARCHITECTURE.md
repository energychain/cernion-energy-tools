# Cernion Energy Tools — Architektur-Dokumentation

> **Version:** v0.38.7 · **Stand:** Mai 2026

---

## 1. System-Überblick

Cernion Energy Tools ist ein **Moleculer-basiertes Microservice-System** für
deutsche Energieversorger und Verteilnetzbetreiber. Alle 56 Services laufen im
selben Node.js-Prozess und kommunizieren über Moleculers In-Process-Transport —
kein Netzwerk-Overhead für interne Aufrufe. Ein einziger API Gateway
(`services/api.service.js`) exponiert alle Services als REST-Endpunkte auf
Port 3000.

```
HTTP-Clients / Enterprise UI (cernion-ui)
         │
         ▼ :3000
┌──────────────────────────────────────────────────────────────────┐
│  services/api.service.js  (Moleculer-Web + OpenAPI-Mixin)        │
│                                                                  │
│  GET  /api/dashboard/*      → dashboard-api  (v0.19)            │
│  POST /api/mastr-quality/*  → mastr-quality  (v0.17)            │
│  POST /api/grid-connection/* → grid-connection (v0.14)          │
│  POST /api/energy-sharing/* → energy-sharing (v0.15)            │
│  POST /api/redispatch/*     → redispatch-expost (v0.18)         │
│  POST /api/cya/*            → cya            (v0.26)            │
│  GET  /api/datapoints/*     → datapoint      (v0.11)            │
│  … ~306 Endpunkte, 56 Services gesamt                           │
└──────────────────────────────────────────────────────────────────┘
         │ MCP-Client (src/mcp-client.js)
         ▼
  Cernion MCP-Server (extern) ──── MaStR MongoDB (lokal)
```

---

## 2. Schichten-Architektur

| Schicht | Eingeführt | Beschreibung |
|---------|-----------|--------------|
| Execution Layer | v0.9.x | MCP-Services, REST-Gateway, Inhouse-Datenquellen, AI-Agent |
| Geo Layer | v0.10 | OSM-basierte Netzinfrastruktur-Analyse (`osm-geo.*`) |
| Datapoint Layer | v0.11–v0.13 | Verwaltete Datenquellen mit PouchDB, OEO/OEMetadata, Snapshots |
| Agent Layer | v0.14 | Grid Connection Validation — 6-stufige deterministische Pipeline |
| Agent Layer | v0.15 | Energy Sharing Validation — §42c EnWG, 6 Stufen |
| Allocation Layer | v0.16 | Energy-Sharing-Allokationsengine |
| Agent Layer | v0.17 | MaStR Data Quality Audit — 8 Stufen, 25 `MQ_*`-Codes, gewichteter Score |
| Agent Layer | v0.18 | Redispatch Ex-Post Audit — 7 Stufen, 19 `RD_*`-Codes |
| Dashboard Layer | v0.19 | Read-only UI-Aggregator (4 Composite-Endpunkte) |
| Platform Layer | v0.20–v0.20.5 | Company-CRUD, Object Store, ZNP, API Cookbook |
| Decision Layer | v0.24 | NOVA SSE-Entscheidungsfeed |
| CYA Layer | v0.26 | Profilbasierter Narrativ-Generator, multi-Stakeholder-Personas |
| Monitor Layer | v0.27 | MaStR-Feldänderungs-Monitor, SMTP-Benachrichtigungen |
| EDM Layer | v0.28–v0.29 | MeLo-Registry, Zeitreihen-Import/Query, virtuelle Auto-Population |
| Forecast Layer | v0.30.1 | Last-/Erzeugungsprognosen, Residuallast, Day-Ahead-Schedules |
| Flex Layer | v0.31 | §14a SVE-Registry, Dimm-Planung/-Ausführung, Entlastungsnachweis |

---

## 3. CYA Agent (A²MDM)

Der CYA-Agent ist eine **deterministisch-evidenzbasierte Narrativ-Pipeline**
mit 4 sequenziellen Phasen. Kein LLM trifft regulatorische Entscheidungen —
LLMs erzeugen ausschließlich Narrative aus bereits verifizierten Fakten.

### 3.1 4-Phasen-Pipeline

```
Phase 1: RETRIEVAL         Phase 2: REGULATORY        Phase 3: GROUNDING       Phase 4: SYNTHESIS
──────────────────         ──────────────────         ──────────────────        ──────────────────
Datenbeschaffung           Regelauswertung            Faktenextraktion          LLM-Narrative
- query.ask                - 9 deterministische       - Konfidenzwert           - Gemini-Aufruf
- MaStR-Fakten               Regeln                  - Datenlücken             - Profil-Injektion
- OSM-Topologie            - OEO-Mapping             - HITL-Override           - XAI-Guardrails
- HITL-Merge               - Signal-Scores           - Qualitäts-Guard
       ↓                          ↓                          ↓                         ↓
  evidence[]              signals[] + rulesMeta[]     facts[] + clarification?   narrative{}
```

Implementierung: `src/cya-data-retriever.js`, `src/cya-regulatory-evaluator.js`,
`src/cya-grounding-engine.js`, `services/cya.service.js`

### 3.2 Zwiebelmodus / CyaContextManager

Der `CyaContextManager` (`src/cya-context-manager.js`) hält den Kontext-Zoom-
Zustand persistent über Sessions:

- **Außen → Innen**: VNB-Portfolio → Umspannwerk → Leitungsabschnitt → Einzelanlage
- Session-ID bindet den Zoom-Zustand an eine Nutzer-Sitzung
- Kontext-Akkumulation ohne Wiederholung bereits verarbeiteter Evidenz

### 3.3 Regulatory Graph (deterministische Regeln)

9 regulatorische Regeln werden als reiner Code ausgewertet (keine LLM-Inferenz):

| Regel | Rechtsgrundlage | Beschreibung |
|-------|----------------|--------------|
| R01 | §14 EnWG | Netzanschluss-Kapazitätsprüfung |
| R02 | §17 EnWG | Technische Mindestanforderungen |
| R03 | §42c EnWG | Energieteilung: Erzeuger-/Verbraucher-Eignung |
| R04 | §14a EnWG | Steuerbare Verbrauchseinrichtungen |
| R05 | Redispatch 2.0 | NAP/MeLo-Vollständigkeit ≥100 kW |
| R06 | EWK | Netzkapazitäts-Benchmark |
| R07 | MaStR | Registrierungsvollständigkeit |
| R08 | OEO | Ontologie-Konsistenz |
| R09 | EU AI Act | Audit-Trail-Vollständigkeit (Art. 12) |

### 3.4 A2A-Protokoll (Agent-to-Agent)

Drei Stakeholder-Personas (`src/cya-agent-personas.js`) verhandeln Konflikte:

- **Investor** — fokussiert auf wirtschaftliche Rentabilität und Risiko
- **Planer** — technische Machbarkeit, Netzstabilität
- **Betreiber** — operative Umsetzbarkeit, Compliance

Jede Persona liefert strukturierte Einschätzungen; Konflikte werden explizit
dokumentiert, nicht durch LLM-Mehrheitsentscheid aufgelöst.

### 3.5 EU AI Act Compliance (Art. 12/13)

- Jeder Pipeline-Durchlauf erzeugt einen unveränderlichen Audit-Trail in PouchDB
- `agent_interventions[]` protokolliert automatische Agent-Korrekturen
- SHA-256 `provenanceHash` über Schrittergebnisse (v0.11.5)
- Snapshots versiegeln Gruppen von Datenpunkten mit `snapshotHash` (v0.13)
- `src/prompt-scrubber.js` maskiert PII vor LLM-Aufrufen

---

## 4. Datenquellen-Integration

### 4.1 MaStR (Marktstammdatenregister)

- Lokale MongoDB-Instanz mit Bulk-Export-Daten (BNetzA)
- Zugriff über `cernion_installations_local` (MCP-Tool) oder `assets.service.js`
- Verfügbare Felder: Einheitentyp, Kapazität, Standort, NAP, MeLo, Status
- **Einschränkung**: `DirektvermarkterMastrNummer` ist in öffentlichen Bulk-
  Exporten nicht enthalten (BNetzA-Policy)

### 4.2 ENTSO-E

- Tatsächliche Erzeugung (Doktyp A74, A75), Wind-/Solar-Ist-Daten, Prognosen
- Service: `services/entsoe.service.js`
- Nur Länder-/Gebotszonenebene — kein VNB-Gebietsbezug

### 4.3 BNetzA EWK (Engpassmanagement-Werkzeugkasten)

- Kapazitäts-Benchmarks für Netzanschluss-Bewertung
- Eingebunden in Grid Connection Validation (Stufe 4)
- Service: `services/ewk-monitoring.service.js`

### 4.4 Open Energy Platform (OEP)

- Lesezugriff auf Szenariodaten, NEP-Referenzen, Forschungsdatensätze
- Service: `services/oep.service.js` (v0.12)
- Endpunkte: `GET /api/oep/*`

### 4.5 Inhouse Datasource Layer (v0.9)

Eigene VNB-Datensätze neben öffentlichen Quellen:

| Connector | Format | Beschreibung |
|-----------|--------|--------------|
| `csv` | CSV, `.gz` | Delimited Files von Disk |
| `rest` | JSON/CSV | HTTP-Endpunkte |
| `geojson` | GeoJSON | Feature-Flattening mit Zentroid |
| `xlsx` | XLSX | Tabellen-Extraktion via SheetJS |
| `docx` | DOCX | Word-Extraktion (optionale `mammoth`-Abhängigkeit) |
| `scraper` | HTML | Tabellen-Extraktion via `cheerio`/`puppeteer` |

Alle Inhouse-Zugriffe laufen über `datasource-cache.query` —
**niemals** direkt über SQL oder DB-Lookups.

---

## 5. Persistenz-Schicht

### 5.1 PouchDB-Stores (9 Stores)

| Store | Pfad | Präfix | Zweck |
|-------|------|--------|-------|
| datapoints | `data/datapoints/` | `dp:` | Datenpunkt-Metadaten + Snapshots |
| grid-connections | `data/grid-connections/` | `gc:` | Netzanschluss-Audit-Trails |
| energy-sharing | `data/energy-sharing/` | `es:` | §42c-Validierungsberichte |
| mastr-quality | `data/mastr-quality/` | `mq:` | MaStR-Qualitätsaudits |
| redispatch-expost | `data/redispatch-expost/` | `rd:` | Redispatch-Ex-Post-Audits |
| object-store | `data/object-store/` | (Namespace/Key) | Generischer KV-Store |
| allocation-engine | `data/allocation-engine/` | — | Allokations-Engine |
| companies | `data/companies/` | — | Unternehmens-Registry |
| energy-sharing | `data/energy-sharing/` | — | Energieteilungs-Allokation |

**KRITIS-Constraint**: Rohdaten werden **nie** persistiert —
nur Metadaten und Provenance-Hashes.

### 5.2 Object Store (v0.20.4)

- Generischer Namespace/Key-Value-Store für Agent-Artefakte
- REST: `GET/PUT/DELETE /api/object-store/:namespace/:key`
- Tenant-Isolation: Namespace-Validierung mit `NS_PATTERN` (v0.38.0+)
- PouchDB-Backend: `data/object-store/`

### 5.3 Tenant-Isolation

Seit v0.38.0 erzwingt der Object Store Namespace-Validierung:
- Namespaces dürfen nur `[a-z0-9-]` enthalten, Länge 3–64 Zeichen
- Isolation verhindert Cross-Tenant-Datenzugriff

---

## 6. REST API

### 6.1 Endpunkt-Übersicht

~306 REST-Endpunkte, gruppiert nach OpenAPI-Tags:

| Tag-Gruppe | Beispiel-Endpunkte |
|-----------|-------------------|
| Assets (MaStR) | `POST /api/energy-market/installations` |
| Agenten (Deterministic) | `POST /api/grid-connection/validate`, `POST /api/mastr-quality/audit` |
| Dashboard | `GET /api/dashboard/vnb-overview` |
| Datapoints | `GET /api/datapoints`, `POST /api/datapoints/:name/refresh` |
| CYA | `POST /api/cya/generate`, `POST /api/cya/refine` |
| EDM | `POST /api/edm/melo`, `GET /api/edm/timeseries` |
| Forecast | `POST /api/forecast/demand`, `POST /api/forecast-engine/residual-load` |
| ENTSO-E | `GET /api/entsoe/actual-generation` |
| Object Store | `PUT /api/object-store/:namespace/:key` |
| ZNP | `POST /api/znp/projects` |
| Tokens | `POST /api/tokens/create`, `DELETE /api/tokens/:id` |

Vollständige Dokumentation: `GET /api/openapi.json` · `GET /api/docs` (Swagger UI)

### 6.2 Auth (Token Manager)

- Service: `services/token-manager.service.js`
- Token-Präfix: `ck_`, SHA-256-Storage
- Scopes: `read-only`, `full-access`
- Header: `Authorization: Bearer ck_...`
- Leitfaden: [BEARER_TOKEN_AUTHENTICATION.md](../BEARER_TOKEN_AUTHENTICATION.md)

### 6.3 Async-Job-Pattern

Long-running REST-Aktionen (>30 s) geben HTTP 202 mit `jobId` zurück:

```
POST /api/mastr-quality/audit  →  202 { jobId: "abc123" }
GET  /api/jobs/abc123          →  { status: "running" | "succeeded" | "failed", result: … }
```

File-backed Persistenz: `src/job-store.js` → `data/jobs/`

---

## 7. TRL-Status-Tabelle

Abgeleitet aus Codebase-Stand und BACKEND_CONTEXT v0.38.7:

| Komponente | Service | TRL | Begründung |
|-----------|---------|-----|-----------|
| AI Agent (Gemini-Plan) | `agent.service.js` | 6 | Produktiv, aber Gemini-abhängig; Robustheit im Feldtest |
| Grid Connection Validation | `grid-connection.service.js` | 7 | Deterministisch, EU AI Act konform, PouchDB-Audit |
| Energy Sharing §42c | `energy-sharing.service.js` | 7 | Regelwerk vollständig, Frist 01.06.2026 |
| MaStR Quality Audit | `mastr-quality.service.js` | 7 | 8-Stufen, 25 Codes, gewichteter Score |
| Redispatch Ex-Post | `redispatch-expost.service.js` | 7 | 7-Stufen, 19 Codes, Weg A/B |
| CYA Agent | `cya.service.js` | 5 | Evidenz-Pipeline stabil; LLM-Narrative im Feldeinsatz |
| Dashboard API | `dashboard-api.service.js` | 8 | Read-only, graceful degradation, Enterprise-UI-Integration |
| Datapoint Layer | `datapoint.service.js` | 8 | CRUD + Scheduling + Snapshots stabil seit v0.13 |
| Object Store | `object-store.service.js` | 8 | Tenant-Isolation v0.38.0, produktiv |
| OSM Geo Layer | `osm-geo.service.js` | 6 | Overpass-abhängig, Verfügbarkeit variiert |
| NOVA SSE-Feed | `nova.service.js` | 5 | SSE-Protokoll stabil; Anwendungslogik im Aufbau |
| EDM Virtual Auto-Pop | `edm-virtual.service.js` | 6 | SLP-Algorithmus validiert; Produktionslast noch gering |
| Flex §14a | `flex.service.js` | 5 | Rechtliche Anforderungen unklar (§14a-Konkretisierung läuft) |
| ZNP | `znp.service.js` | 4 | G-Factor-Scoring konzeptionell; Feldvalidierung ausstehend |
| Forecast Engine | `forecast-engine.service.js` | 6 | Day-Ahead-Schedules produktiv; Residuallast-Kalibrierung läuft |
| MaStR Monitor | `mastr-monitor.service.js` | 7 | Double-Opt-In, SMTP, Feldänderungsdetektion stabil |
| OEP Connector | `oep.service.js` | 6 | Read-only; upstream-Stabilität OEP-API nicht garantiert |
| Inhouse Datasource | `datasource-*.service.js` | 7 | CSV/REST/GeoJSON/XLSX stabil; docx/scraper TRL 4 |

---

## 8. Bekannte Einschränkungen / Open Points

### Direktvermarktungs-Daten (MaStR)

`DirektvermarkterMastrNummer` fehlt in öffentlichen Bulk-Exporten (BNetzA-Policy).
Workaround: `fernsteuerbarkeitDv: true` + `minCapacity: 100` als besten
öffentlichen Proxy für Wind/Biomasse-Anlagen in Direktvermarktung.

### ESLint-Hygiene (v0.38.x)

~37 nicht-blockierende `no-unused-vars`-Warnungen werden bereinigt
(tracked in `feedback/HYGIENE_SPRINT.md`). Prio 3 Block B und Prio 4
(cognitive-complexity > 30) stehen noch aus.

### Jest Open Handles

Jest-Tests beenden sich nicht sauber ohne `--forceExit` (vermutlich `fs.watch`-
Teardown in `datasource-watcher`). Mitigiert mit `--forceExit` in `jest.config.js`.

### xlsx High Advisory

Bekannte Sicherheitswarnung für `xlsx`-Paket — dokumentierte Ausnahme in
[SECURITY.md](../SECURITY.md). Keine kritische Severity.

### ENTSO-E Granularität

ENTSO-E liefert nur Länder-/Gebotszonenebene. Für VNB-gebietsscharfe
Erzeugungs-Forecasts: `mastr_generation_forecast` (MCP-Tool, nutzt lokale MaStR-Daten).

### OEP-Upstream-Stabilität

Die OEP-API ist ein externer Dienst ohne SLA-Garantie. OEP-abhängige Endpunkte
können temporär fehlen; alle OEP-Aufrufe haben Timeout-Handling.
