# Cernion Energy Tools — Architektur-Dokumentation

> **Version:** v0.47.2 · **Stand:** Mai 2026

---

## 1. System-Überblick

Cernion Energy Tools ist ein **Moleculer-basiertes Microservice-System** für
deutsche Energieversorger, Stadtwerke und Verteilnetzbetreiber. Alle Core-Services
in `services/` laufen im selben Node.js-Prozess und kommunizieren über
Moleculers In-Process-Transport. Ein einziger API Gateway
(`services/api.service.js`) exponiert die REST-Oberfläche auf Port 3000.

Die Zahlen in diesem Dokument sind **gegen den aktuellen Repository-Stand indiziert**:

- `63` Core-Services in `services/`
- `1` optionale lokale Erweiterung in `custom-services/`
- `224` OpenAPI-Pfade / `264` REST-Operationen aus `openapi-export.json`

```
HTTP-Clients / Enterprise UI (cernion-ui)
         │
         ▼ :3000
┌────────────────────────────────────────────────────────────────────┐
│ services/api.service.js  (Moleculer-Web + OpenAPI-Mixin)          │
│                                                                    │
│ GET  /api/dashboard/*          → dashboard-api     (v0.19+)        │
│ POST /api/mastr-quality/*      → mastr-quality     (v0.17+)        │
│ POST /api/grid-connection/*    → grid-connection   (v0.14+)        │
│ POST /api/energy-sharing/*     → energy-sharing    (v0.15+)        │
│ POST /api/knowledge-rag/*      → knowledge-rag     (v0.43.1+)      │
│ POST /api/hitl/*               → hitl              (v0.44.0+)      │
│ POST /api/webhooks/*           → webhooks          (v0.44.0+)      │
│ GET  /metrics                  → observability     (v0.44.1+)      │
│ … 224 Pfade / 264 Operationen, 63 Core-Services gesamt             │
└────────────────────────────────────────────────────────────────────┘
         │
         ├── MCP-Client (`src/mcp-client.js`) → Cernion MCP-Server (extern)
         ├── Lokale Persistenz (`data/*`)     → PouchDB / File Store / SQLite
         └── Lokale Wissens-/MaStR-Daten      → MaStR MongoDB + lokale Artefakte
```

---

## 2. Schichten-Architektur

| Schicht | Eingeführt | Beschreibung |
|---------|-----------|--------------|
| Execution Layer | v0.9.x | MCP-Services, REST-Gateway, Inhouse-Datenquellen, Query-/Agent-Orchestrierung |
| Geo Layer | v0.10 | OSM-basierte Netzinfrastruktur-Analyse (`osm-geo.*`) |
| Datapoint Layer | v0.11–v0.13 | Verwaltete Datenquellen mit PouchDB, OEO/OEMetadata, Snapshots |
| Agent Layer | v0.14 | Grid Connection Validation — 6-stufige deterministische Pipeline |
| Agent Layer | v0.15 | Energy Sharing Validation — §42c EnWG, 6 Stufen |
| Allocation Layer | v0.16 | Energy-Sharing-Allokationsengine |
| Agent Layer | v0.17 | MaStR Data Quality Audit — 8 Stufen, 25 `MQ_*`-Codes, gewichteter Score |
| Agent Layer | v0.18 | Redispatch Ex-Post Audit — 7 Stufen, 19 `RD_*`-Codes |
| Dashboard Layer | v0.19 | Read-only UI-Aggregator und Dashboard Contracts |
| Platform Layer | v0.20–v0.20.5 | Company-CRUD, Object Store, ZNP, API Cookbook |
| Decision Layer | v0.24 | NOVA SSE-Entscheidungsfeed |
| CYA Layer | v0.26 | Profilbasierter Narrativ-Generator, A²MDM, Onion Context |
| Monitor Layer | v0.27 | MaStR-Feldänderungs-Monitor, SMTP-Benachrichtigungen |
| EDM Layer | v0.28–v0.29 | MeLo-Registry, Zeitreihen-Import/Query, virtuelle Auto-Population |
| Forecast Layer | v0.30.1 | Last-/Erzeugungsprognosen, Residuallast, Day-Ahead-Schedules |
| Flex Layer | v0.31 | §14a SVE-Registry, Dimm-Planung/-Ausführung, Entlastungsnachweis |
| Observability Layer | v0.40.6 | Log-/Metrik-Erfassung, Summary- und Feedback-Endpunkte |
| Multi-Tenant Layer | v0.41.0 | Tenant-Propagation, tenant-isolierte Storage-Namespaces und Session-Trennung |
| OEO Export Layer | v0.42.0 | Produktiver OEO-JSON-LD-Export mit Version-Pinning und SHACL-Regressionen |
| LLM Provider Layer | v0.43.0 | `src/llm-client.js` mit `gemini`, `openai-compat`, `ollama`, Health-Probe |
| Knowledge Layer | v0.43.1 | Knowledge-RAG-Ingest, Reindex, Cutover und PII-Scrubbing |
| Webhook Layer | v0.44.0 | Tenant-skopierte Outbound Events mit HMAC, Replay, DLQ |
| HITL Layer | v0.44.0–v0.44.5 | Approval-Queue, Bulk-Actions, SLA-Heatmap, First-Class Dashboard |
| Observability Layer II | v0.44.1 | Prometheus, OTel, strukturierte Logs, Grafana-Starter-Dashboards |
| Pagination Layer | v0.44.2 | Globale Cursor-Pagination mit tamper-resistenten Tokens |
| Asset-Override Layer | v0.44.3 | Persistente Overrides, Effective View, HITL-kritische Felder |
| OEP Delta Layer | v0.44.4 | MaStR↔OEP-Vergleich mit semantischem Join und Async-Pfad |
| Job Runtime Layer | v0.45.1–v0.47.1 | Driver-basiertes Job-Store-Backend, idempotente Async-Runtime, SSE-Progress |
| Capability Broker | v0.46.0–v0.46.2 | Interner Empfehlungs-Layer für Planner/Assist-Flows, advisory only |

---

## 3. Architektur-Kernprinzipien

### 3.1 Deterministische Compliance vor LLM-Narrativen

Regulatorische Entscheidungen werden als Code modelliert. LLMs liefern Narrative,
Zusammenfassungen oder Retrieval-Assistenz, aber **keine** nicht erklärbaren
Compliance-Entscheidungen.

Beispiele:

- `grid-connection`, `energy-sharing`, `mastr-quality`, `redispatch-expost`
  arbeiten als deterministische Pipelines mit Audit Trail
- `cya` synthetisiert erst nach Retrieval, Regelauswertung und Grounding
- `finance-agent`, `znp`, `utility-report` nutzen Broker-/Planungsassistenz strikt advisory

### 3.2 CYA / A²MDM-Pipeline

Der CYA-Agent bleibt der wichtigste Architekturanker für narrative Outputs:

```
Retrieval → Regulatory Evaluation → Grounding → Synthesis
   │              │                    │            │
   │              │                    │            └─ LLM nur auf verifizierten Fakten
   │              │                    └─ Konfidenz, Datenlücken, HITL-Merge
   │              └─ deterministische Regeln, OEO-Mapping, Signals
   └─ MaStR, OSM, Knowledge-RAG, interne Datenquellen
```

Wesentliche Bausteine:

- `src/cya-data-retriever.js`
- `src/cya-regulatory-evaluator.js`
- `src/cya-grounding-engine.js`
- `src/cya-context-manager.js`
- `src/prompt-scrubber.js`

### 3.3 Querschnittsmechanismen

| Mechanismus | Relevante Module | Zweck |
|-------------|------------------|-------|
| Tenant-Kontext | `src/tenant-context.js`, API Gateway, storage-backende Services | Isolation pro Mandant |
| Async Runtime | `src/job-store/*`, `src/async-job-runner.js`, `job-status` | 202-Pattern, Idempotenz, Progress SSE |
| Observability | `src/logger.js`, `src/tracing.js`, `services/observability.service.js` | Betriebsmetriken, Debugging, Prometheus/OTel |
| HITL | `services/hitl.service.js`, `docs/ui-contracts/40-hitl.md` | menschliche Freigabe bei kritischen Entscheidungen |
| Webhooks | `services/webhooks.service.js`, `docs/INTEGRATION_WEBHOOKS.md` | Outbound-Ereignisse für Integrationen |
| Pagination | `src/pagination.js` | Cursor-basierte, manipulationsresistente List-Endpunkte |

---

## 4. Daten- und Integrationsflächen

### 4.1 Öffentliche und lokale Energiedaten

| Quelle | Zugang | Nutzung |
|--------|--------|---------|
| MaStR | lokale MongoDB + MCP / Assets | Portfolio-, NAP-, MeLo- und Anlagenanalyse |
| ENTSO-E | `entsoe.service.js` | Erzeugungsdaten, Wind/Solar-Istwerte, Prognosen |
| BNetzA EWK | `ewk-monitoring.service.js` | KPI-/Anschlussdauer-Benchmarking |
| OEP | `oep.service.js` | Szenarien, Forschungs- und Referenzdatensätze |
| Inhouse Datasources | `datasource-*`, `datapoint` | CSV/REST/GeoJSON/XLSX/Docx/Scraper, nur via `datasource-cache.query` |
| Knowledge-RAG | `knowledge-rag.service.js` | lokaler Wissensspeicher, Ingest, Reindex, Cutover |

### 4.2 Operative Integrationsoberflächen

| Oberfläche | Zweck | Referenz |
|------------|-------|----------|
| REST + OpenAPI | Primäre Integrationsschicht für UI, Partner und Automationen | `GET /api/openapi.json`, `GET /api/docs` |
| Webhooks | Tenant-skopierte Outbound Events mit HMAC, Replay und DLQ | [INTEGRATION_WEBHOOKS.md](INTEGRATION_WEBHOOKS.md) |
| HITL Dashboard | Freigaben, Bulk-Aktionen, SLA-Heatmap | [ui-contracts/40-hitl.md](ui-contracts/40-hitl.md) |
| Asset Override View | Effektive Sicht über MaStR + manuelle Korrekturen | [ui-contracts/31-asset-overrides.md](ui-contracts/31-asset-overrides.md) |
| Observability Dashboards | Prometheus/Grafana-Startpunkte | [observability/grafana/README.md](observability/grafana/README.md) |

---

## 5. Persistenz, Isolation und Laufzeit

### 5.1 Persistenzbausteine

| Baustein | Beispiele | Zweck |
|----------|-----------|-------|
| PouchDB | `data/datapoints/`, `data/energy-sharing/`, `data/mastr-quality/`, `data/redispatch-expost/`, `data/observability/`, `data/companies/` | Audit Trails, Metadaten, lokale Artefakte |
| Object Store | `services/object-store.service.js` | generische Namespaces für Artefakte und tenant-skopierte Daten |
| File-backed Job Store | `data/jobs/`, `src/job-store/file-driver.js` | Async-Job-Zustand und Resultate |
| alternative Job-Store-Backends | `src/job-store/pouchdb-driver.js`, `src/job-store/redis-compat-driver.js` | austauschbare Runtime-Backends |
| SQLite | EDM-nahe Services | lokale Zeitreihen- und Struktur-Daten |

**KRITIS-Constraint:** Rohdaten werden nicht dauerhaft in generischen Agent-Stores
persistiert; gespeichert werden Metadaten, Audit Trails, Provenance-Hashes und
arbeitsnotwendige Artefakte.

### 5.2 Tenant-Isolation

- Tenant-IDs werden am Gateway in `ctx.meta` propagiert
- Storage-Namespaces, Session-State, Watcher und Objekt-Keys werden tenant-spezifisch aufgelöst
- Default-Tenant bleibt rückwärtskompatibel, aber neue Features werden tenant-aware entwickelt

### 5.3 Async Job Pattern

Long-running Aktionen liefern `HTTP 202` und einen stabilen Poll-/Progress-Pfad:

```
POST /api/mastr-quality/audit  → 202 { jobId, pollUrl, progressUrl }
GET  /api/jobs/:jobId          → { status, result? }
GET  /api/jobs/:jobId/progress → { progress: { step, totalSteps, message } }
```

Seit v0.47.1 unterstützt die Runtime zusätzlich:

- deterministische Idempotenz-Keys
- Progress-SSE mit Replay (`Last-Event-ID`)
- driver-basiertes Job-Store-Backend

---

## 6. REST- und Service-Oberfläche

Die aktuelle Export-Spezifikation enthält `224` Pfade und `264` Operationen.
Die REST-Fläche ist in OpenAPI-Tags gruppiert; besonders relevant sind:

| Domäne | Typische Services |
|--------|-------------------|
| Plattform | `api`, `system`, `token-manager`, `job-status`, `object-store`, `company` |
| Data Foundation | `datapoint`, `datasource-*`, `in-memory-join` |
| Markt-/Geo-Daten | `assets`, `energy-market`, `entsoe`, `ewk-monitoring`, `oep`, `osm-geo`, `gas-storage`, `german-grid` |
| Deterministische Agents | `grid-connection`, `energy-sharing`, `mastr-quality`, `redispatch-expost`, `settlement` |
| Workflow & Decisioning | `cya`, `knowledge-rag`, `nova`, `finance-agent`, `znp`, `flex`, `hitl`, `webhooks` |
| Zeitreihe & Forecast | `edm*`, `slp`, `forecast`, `forecast-engine`, `residual-load`, `mqtt-broker` |

Weitere Details:

- Architektur- und Onboarding-Kontext: [BACKEND_CONTEXT.md](BACKEND_CONTEXT.md)
- UI-Verträge: [ui-contracts/](ui-contracts/)
- Release-Delta v0.40 → v0.46.2: [RELEASE_SUMMARY_v0.46.md](RELEASE_SUMMARY_v0.46.md)

---

## 7. TRL-Hybrid-Tabelle

Die Tabelle kombiniert zwei Perspektiven:

1. **Release-kritische Capabilities** mit explizitem TRL-Fortschritt seit dem alten Stand
2. **Service-Coverage-Gruppen**, damit alle `63` Core-Services aus `services/` einer
   aktuellen Architektur- und Reife-Sicht zugeordnet sind

| Typ | Scope / Komponente | Primäre Services / Module | Coverage | TRL alt | TRL neu | Begründung |
|-----|--------------------|---------------------------|----------|---------|---------|------------|
| Capability | OEO-Export | `cya.export.oeo`, `src/oeo-context.js` | 1 Service + Exportmodule | 4 | **6** | Produktiver JSON-LD-Export, SHACL-Tests, Version-Pinning |
| Capability | Multi-Tenant | `src/tenant-context.js`, Gateway, storage-backende Services | 12+ Services | 4 (PoC) | **8** | Roll-out auf produktive Namespaces, E2E-Isolationstests |
| Capability | LLM-Client | `src/llm-client.js`, Adapter, `system.llmHealth` | Querschnitt | n/a | **6** | 3 Adapter, strukturiertes Fallback, Health-Probe |
| Capability | Knowledge RAG | `knowledge-rag`, Chunker, Scrubber | 1 Service + Ingest-Pfad | 4 (Wrapper) | **6** | eigener Ingest, Reindex, Cutover, PII-Scrubbing |
| Capability | Webhooks | `webhooks`, `src/webhook-crypto.js` | 1 Service | n/a | **6** | HMAC, Outbox, Replay, DLQ |
| Capability | HITL | `hitl`, Dashboard Contracts | 1 Service + UI | n/a | **6** | First-Class Dashboard, Bulk-Actions, SLA-Heatmap |
| Capability | Observability | `observability`, `src/logger.js`, `src/tracing.js` | Querschnitt | n/a | **6** | Prometheus, OTel, strukturierte Logs, Grafana-Starter |
| Capability | Pagination | `src/pagination.js` | 11 migrierte Endpunkte | n/a | **7** | Cursor-Tokens, Manipulationsschutz, breite Nutzung |
| Capability | Asset Overrides | `assets.*`, Override-Flows, HITL-Anbindung | Asset-Oberfläche | 3 (Stub) | **7** | Persistenz, Effective View, HITL-kritische Felder |
| Capability | OEP Delta | `oep.compare-mastr` | 1 Service | 5 | **7** | semantischer Join, Async für große Portfolios |
| Capability | Job Store | `src/job-store/*`, `src/async-job-runner.js` | Querschnitt | 5 (file) | **6** | Driver-Interface, 3 Backends, Idempotenz, Progress SSE |
| Capability | Capability Broker | `capability-broker`, `src/capability-catalog.js` | intern | n/a | **5** (intern) | v1 produktiv als Advisory-Layer, aber internal-only |
| Capability | §42c Energy Sharing | `energy-sharing`, `energy-sharing-allocation` | Kernworkflow | 7 | **7** | Cutover-Plan vorhanden, produktive Sub-Tracks laufen noch |
| Capability | NOVA Decision Engine | `nova`, `src/nova-decision-machine.js` | 1 Service + state machine | 5 | **7** | Projekt-skopierte, tenant-gebundene Decisions mit Lifecycle, HITL-Bridge, SSE-Events und async Replay-Basis |
| Capability | ZNP | `znp` | 1 Service | 4 | 4 | unverändert; Produktionspfad separat offen |
| Capability | Flex §14a | `flex` | 1 Service | 5 | 5 | unverändert; Regulatorik-Konkretisierung noch laufend |
| Coverage | Plattform Runtime & Governance | `api`, `system`, `token-manager`, `job-status`, `object-store`, `company`, `dashboard-api`, `observability`, `webhooks`, `hitl`, `backup-orchestrator` | 11 Services | — | 6–8 | Produktiver Kernbetrieb, Auth, UI-Aggregation, Ops- und Governance-Flows |
| Coverage | Planning & Orchestration | `agent`, `capability-broker`, `cookbook`, `query`, `finance-agent`, `utility-report`, `customer-service`, `business-intelligence`, `web-search` | 9 Services | — | 5–7 | Beratungs-, Analyse- und Orchestrierungsfläche mit Advisory-LLM-Einsatz |
| Coverage | Data Foundation | `datapoint`, `datasource-cache`, `datasource-classifier`, `datasource-connector`, `datasource-discovery`, `datasource-registry`, `datasource-watcher`, `in-memory-join` | 8 Services | — | 6–8 | zentrale Datengrundlage, Provenance und Registry-Funktionen |
| Coverage | Markt-, Geo- und Referenzdaten | `assets`, `energy-market`, `entsoe`, `ewk-monitoring`, `gas-storage`, `german-grid`, `grid-operations`, `eic-codes`, `oep`, `osm-geo` | 10 Services | — | 5–7 | externe Datenanbindung; Reife abhängig von Upstream-Stabilität |
| Coverage | Audit-, Validation- und Settlement-Flows | `grid-connection`, `energy-sharing`, `energy-sharing-allocation`, `mastr-quality`, `redispatch-expost`, `settlement`, `mastr-monitor`, `bilanzkreis` | 8 Services | — | 7–8 | stärkste produktive Compliance-Fläche mit Audit Trail und Cutover-Planung |
| Coverage | Zeitreihe, EDM und Forecast | `edm`, `edm-messkonzept`, `edm-validation`, `edm-virtual`, `mscons-import`, `slp`, `forecast`, `forecast-engine`, `residual-load`, `mqtt-broker` | 10 Services | — | 5–7 | operative Energie- und Messdatenverarbeitung mit lokalem Persistenzpfad |
| Coverage | Decisioning & Advanced Workflows | `cya`, `nova`, `knowledge-rag`, `vnb-monitor`, `nbp-monitor`, `flex`, `znp` | 7 Services | — | 4–7 | narrative, monitoring- und entscheidungsnahe Workflows mit differierendem Reifegrad |

**Abdeckung:** Die Coverage-Zeilen summieren sich auf alle `63` Core-Services in
`services/`. Der lokale Workspace-Service in `custom-services/` ist absichtlich
nicht Teil der offiziellen TRL-Bewertung.

---

## 8. Bekannte Einschränkungen / offene Risiken

### Direktvermarktungs-Daten (MaStR)

`DirektvermarkterMastrNummer` fehlt weiterhin in öffentlichen Bulk-Exporten
(BNetzA-Policy). Öffentlicher Proxy bleibt `fernsteuerbarkeitDv: true` plus
`minCapacity: 100` für geeignete Wind-/Biomasse-Anlagen.

### Hygiene-Sprint

Status laut [feedback/HYGIENE_SPRINT.md](../feedback/HYGIENE_SPRINT.md):

- Prio `1`, `2` und `5` erledigt
- Prio `3` Block A teilweise bereinigt
- Prio `3B` und Prio `4` (kognitive Komplexität) bleiben offen

### Capability Broker ist internal-only

Der Capability Broker (`v0.46.x`) ist bewusst **kein** öffentliches REST-Produkt.
Er dient internen Advisory-/Planning-Flows; Ausführung bleibt bei den
domänenspezifischen Services und deren deterministischer Logik.

### §42c-Cutover: offene Sub-Tracks und Betriebsrisiken

Die Grundlagen für den produktiven §42c-Cutover sind gelegt, aber mehrere
Sub-Tracks bleiben operativ relevant:

- finale A96-Feldspezifikation enthält weiterhin offene/defensiv vorbelegte Felder
- Pilot-Tenant-/Rollback-/Restore-Pfade müssen weiter im Echtbetrieb abgesichert werden
- Last- und Settlement-Härtetests bleiben für große Portfolios kritisch
- DR-/Snapshot-Nachweise sind zwar angelegt, müssen aber als wiederholbarer Operativprozess gepflegt werden

### Jest Open Handles

Jest beendet den Prozess weiter nicht in allen Fällen sauber ohne `--forceExit`
(wahrscheinlicher Kandidat: Watcher-/`fs.watch`-Teardown). Der Release-Gate nutzt
weiter die bestehende Mitigation.

### `xlsx` High Advisory

Für `xlsx` besteht weiterhin eine dokumentierte Ausnahme in
[SECURITY.md](../SECURITY.md). Die Warnung ist bekannt und im Projektkontext
akzeptiert, aber nicht endgültig beseitigt.

### OEP- und ENTSO-E-Upstream-Grenzen

- OEP ist ein externer Dienst ohne SLA-Garantie; Delta- und Query-Endpunkte brauchen Timeout- und Retry-Strategien
- ENTSO-E liefert nur Länder-/Gebotszonenebene und ist kein Ersatz für VNB-scharfe lokale Prognosen

---

## 9. Querverweise

- [README.md](../README.md)
- [BACKEND_CONTEXT.md](BACKEND_CONTEXT.md)
- [INTEGRATION_WEBHOOKS.md](INTEGRATION_WEBHOOKS.md)
- [observability/grafana/README.md](observability/grafana/README.md)
- [ui-contracts/31-asset-overrides.md](ui-contracts/31-asset-overrides.md)
- [ui-contracts/40-hitl.md](ui-contracts/40-hitl.md)
- [RELEASE_SUMMARY_v0.46.md](RELEASE_SUMMARY_v0.46.md)
