# Cernion Energy Tools — Architektur-Dokumentation

> **Version:** v0.99.22 · **Stand:** 2. Oktober 2026

---

## 1. System-Überblick

Cernion Energy Tools ist ein **Moleculer-basiertes Microservice-System** für
deutsche Energieversorger, Stadtwerke und Verteilnetzbetreiber. Alle Core-Services
in `services/` laufen im selben Node.js-Prozess und kommunizieren über
Moleculers In-Process-Transport. Ein einziger API Gateway
(`services/api.service.js`) exponiert die REST-Oberfläche auf Port 3000.

Die Zahlen in diesem Dokument sind **gegen den aktuellen Repository-Stand indiziert**:

- `147` Core-Services in `services/`
- `1` optionale lokale Erweiterung in `custom-services/`
- `1120` OpenAPI-Pfade / `1238` REST-Operationen aus `openapi-export.json`

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
│ POST /api/domain-router/*      → domain-router     (v0.99.22+)     │
│ POST /api/agent-sidecar/*      → agent-sidecar     (v0.99.22+)     │
│ POST /api/webhooks/*           → webhooks          (v0.44.0+)      │
│ GET  /metrics                  → observability     (v0.44.1+)      │
│ … 1120 Pfade / 1238 Operationen, 147 Core-Services gesamt          │
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
| Domain Routing / AgentOS Integration Layer | v0.99.22 | Domain Router, CET Case State, Case Event Outbox/MWI, Related-Session-Discovery, CET-governed Sidecar Tools |

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
| Domain Router | `services/domain-router.service.js`, `src/domain-router*` | Rollen-/Domänenrouting, Case State, No-Dead-End-Transitions |
| Case Event Outbox | `src/domain-router-events.js`, `cet_case_events` | MWI/Poll-Ack für asynchrone Case-Ereignisse |

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
| PouchDB | `data/datapoints/`, `data/energy-sharing/`, `data/mastr-quality/`, `data/redispatch-expost/`, `data/observability/`, `data/companies/`, `cet_case_state`, `cet_case_events` | Audit Trails, Metadaten, lokale Artefakte, Domain-Router-Case-State und MWI/Outbox ohne externe Queue/DB |
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

Die aktuelle Export-Spezifikation enthält `1120` Pfade und `1238` Operationen.
Die REST-Fläche ist in OpenAPI-Tags gruppiert; besonders relevant sind:

| Domäne | Typische Services |
|--------|-------------------|
| Plattform | `api`, `system`, `token-manager`, `job-status`, `object-store`, `company` |
| Data Foundation | `datapoint`, `datasource-*`, `in-memory-join` |
| Markt-/Geo-Daten | `assets`, `energy-market`, `entsoe`, `ewk-monitoring`, `oep`, `osm-geo`, `gas-storage`, `german-grid` |
| Deterministische Agents | `grid-connection`, `energy-sharing`, `mastr-quality`, `redispatch-expost`, `settlement` |
| Workflow & Decisioning | `cya`, `knowledge-rag`, `nova`, `finance-agent`, `znp`, `flex`, `hitl`, `webhooks` |
| AgentOS Integration | `domain-router`, `agent-sidecar`, `personal-agent`, `capability-broker` |
| Zeitreihe & Forecast | `edm*`, `slp`, `forecast`, `forecast-engine`, `residual-load`, `mqtt-broker` |

Weitere Details:

- Domain Router / Sidecar: [domain-router.md](domain-router.md)
- Architektur- und Onboarding-Kontext: [BACKEND_CONTEXT.md](BACKEND_CONTEXT.md)
- UI-Verträge: [ui-contracts/](ui-contracts/)
- Release-Delta v0.40 → v0.46.2: [RELEASE_SUMMARY_v0.46.md](RELEASE_SUMMARY_v0.46.md)

---

### 6.1 Domain Router und AgentOS-Integration

Der Domain Router ist der CET-seitige fachliche Arbeitskern für Hermes/OpenClaw/Open WebUI/Matrix-Clients. Clients starten einen Fall mit `POST /api/domain-router/classify`, führen ihn mit `POST /api/domain-router/continue` fort und übergeben `cetCaseId` statt fachliche Routinglogik selbst zu besitzen.

Wichtige Eigenschaften:

- `cetCaseId` + `caseStateVersion` bilden den stabilen Case-State-Kontrakt.
- No-Dead-End-Transitions erlauben `continue`, `reclassify`, `branch`, `clarify`, `handoff` und `fallback`.
- Response-Felder enthalten u.a. `primaryDomain`, `alternativeDomains`, `selectedCapabilities`, `selectedReceipts`, `allowedActions`, `blockedActions`, `requiredClarifications`, Readiness-/No-Call-Hinweise und optional Laufkarten-/Control-Point-Kontext.
- Die Case Event Outbox schreibt MWI-Ereignisse in `cet_case_events`; Clients pollen `/api/domain-router/events` und quittieren mit `/api/domain-router/events/:eventId/ack`.
- Related-Session-Discovery verbindet Cases über `cetCaseId`, Session-IDs, EvidenceRefs, ProcessRefs, Matrix/VDMI-Kontext, `laufkarteId`, `stationId`, `edgeId`, `traceId`, `controlPoint`, `ownerRole` und `roleFamily`.

Der Agent Sidecar ist **CET-governed**: interne CET Case-/Event-State-Änderungen sind zulässig, sofern der authentifizierte Tenant/User durch CET autorisiert ist. Der Token ist Identitäts-/Mandanten-/Client-Kontext, nicht die fachliche Read/Write-Entscheidung. Externe oder bindende Wirkungen bleiben durch CET-RBAC, Mandanten-/User-Freischaltung, HITL und No-Call-Guards blockiert.

---

## 7. TRL-Hybrid-Tabelle

Die Tabelle kombiniert zwei Perspektiven:

1. **Release-kritische Capabilities** mit explizitem TRL-Fortschritt seit dem alten Stand
2. **Service-Coverage-Gruppen**, damit alle `147` Core-Services aus `services/` einer
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
| Capability | Domain Router / AgentOS Integration | `domain-router`, `agent-sidecar`, `src/domain-router*`, `src/agent-sidecar*` | 2 Services + Sidecar/Policy-Module | n/a | **6** | Implementiert, CI-getestet und PouchDB-basiert; produktiver Matrix/OpenClaw-Betrieb weiter auszuwerten |
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

**Abdeckung:** Die Coverage-Zeilen gruppieren die produktprägenden Core-Service-Familien in
`services/`; durch die Erweiterung auf 147 Services werden Spezial- und Hilfsservices nicht einzeln
in dieser Tabelle wiederholt. Der lokale Workspace-Service in `custom-services/` ist absichtlich
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

### Domain Router / Sidecar Betrieb

Der Domain Router ist CET-governed und zustandsfähig, aber keine externe Automationsfreigabe:

- QDrant/Knowledge-Hits sind Routing-/Grounding-Evidenz, keine alleinige Antwortfakt-Quelle.
- Case Event Outbox/MWI benötigt echte Trigger plus Client-seitiges Poll/Ack; ohne Poll-Vertrag sieht ein externer Client keine späteren Events.
- Externe/bindende Wirkungen bleiben trotz interner Case-/Event-State-Writes durch CET-RBAC, HITL und No-Call-Guards gesperrt.
- Tenant-, Rollen- und Sensitivity-Checks müssen vor Router, Sidecar, Discovery und Outbox-Sichtbarkeit greifen.

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

### Dependency-Security-Stand

Der RC3-Bereinigungsstand vom 2. Oktober 2026 meldet mit dem geprüften Lockfile
`0 vulnerabilities` in `npm audit`. Kompatible Patches für `brace-expansion`,
`fast-uri`, `hono`, `nodemailer` und `qs` wurden aufgelöst. Historische
Ausnahmen in [SECURITY.md](../SECURITY.md) sind keine Aussage über den aktuellen
Audit. Neue Advisories und abweichende Installationen müssen erneut geprüft werden.

### OEP- und ENTSO-E-Upstream-Grenzen

- OEP ist ein externer Dienst ohne SLA-Garantie; Delta- und Query-Endpunkte brauchen Timeout- und Retry-Strategien
- ENTSO-E liefert nur Länder-/Gebotszonenebene und ist kein Ersatz für VNB-scharfe lokale Prognosen

---

## 9. Querverweise

- [README.md](../README.md)
- [BACKEND_CONTEXT.md](BACKEND_CONTEXT.md)
- [domain-router.md](domain-router.md)
- [INTEGRATION_WEBHOOKS.md](INTEGRATION_WEBHOOKS.md)
- [observability/grafana/README.md](observability/grafana/README.md)
- [ui-contracts/31-asset-overrides.md](ui-contracts/31-asset-overrides.md)
- [ui-contracts/40-hitl.md](ui-contracts/40-hitl.md)
- [RELEASE_SUMMARY_v0.46.md](RELEASE_SUMMARY_v0.46.md)

## RC3 Workbench / Open WebUI Tenant-Gateway (`workbench`)

RC3 adds a customer-facing Workbench API so Open WebUI can use CET without AgentOS, Hermes or OpenClaw. This is not a replacement for CET governance: Open WebUI is only the UI/client, while CET owns Domain Router decisions, Case State, Case Event Outbox/MWI, EvidenceRefs, No-Call-Guards and audit semantics.

Primary endpoints:

- `POST /api/workbench/chat` — CET-led chat turn; classifies new Open WebUI conversations and continues mapped CET cases.
- `GET /api/workbench/cases/:caseId` — UI-safe case summary.
- `GET /api/workbench/cases` — Workbench case inbox.
- `POST /api/workbench/conversations/link-case` — server-side Open WebUI conversation ↔ CET case mapping.
- `GET /api/workbench/conversations/resolve` — resolve conversation mapping.
- `GET /api/workbench/events` — UI-safe Case Event Outbox/MWI list.
- `POST /api/workbench/events/:eventId/ack` — explicit event acknowledgement.
- `POST /api/workbench/cases/:caseId/evidence` — attach Open-WebUI file refs as CET EvidenceRefs.
- `POST /api/workbench/cases/:caseId/dossier` — render a case-centered internal dossier.
- `POST /api/workbench/delivery-clients` — register tenant-bound MWI poll clients.
- `POST /api/workbench/admin/tenant-mappings`, `POST /api/workbench/admin/user-mappings`, `GET /api/workbench/admin/user-mappings/:externalUserId` — admin-only Open WebUI ↔ CET tenant/user/role mapping.

OpenAI-compatible clients may use `POST /v1/chat/completions` with `model: "cernion-governance-assistant"`. That mode routes through `workbench.chat` and returns OpenAI-compatible output plus CET metadata (`cetCaseId`, `caseStateVersion`, `primaryDomain`, `readinessState`). Existing `/v1/chat/completions` behavior for other supported models remains unchanged.

Security boundary: CET service tokens remain server-side. Open-WebUI org/user/group values are mapped server-side into CET tenant, actor, roles and sensitivity clearance. Missing or disabled mappings fail closed. Polling events does not ack them; explicit ack is required after visible delivery.


## 10. RC3-Architekturreview — 2. Oktober 2026

### Prüfgrundlage und Bewertung

Geprüft wurde `origin/main` ab `a14797a0` in einem isolierten Task-Worktree,
mit einem frisch erstellten GitNexus-Index, den offenen GitHub-Issues/PRs,
Quellcodeprüfung und lokalen Release-Prüfungen. Der ursprüngliche Checkout auf
`release/v0.99.19` enthält umfangreiche lokale Forecast-/AgentOS-Änderungen.
Diese Änderungen sind weder Bestandteil dieser Bewertung von `main` noch
ungeprüft in die RC3-Bereinigung übernommen worden.

| Kriterium | Bewertung | Befund |
|-----------|-----------|--------|
| Architekturzuschnitt | Tragfähig | In-Process-Moleculer, gemeinsame MCP-/LLM-Clients, PouchDB-Lifecycle-Mixin und Job-Store sind etablierte Verantwortungsgrenzen. Ein Prozess bleibt ein gemeinsamer Fehler- und Ressourcenbereich; 147 Service-Dateien bedeuten keine unabhängigen Deployments. |
| Fachliche Entscheidungshoheit | Gut | Domain Router und CET besitzen Case State und Governance; Clients liefern Eingaben und EvidenceRefs. LLM-Narrative und Entscheidungssignale ersetzen keine Freigabe oder Ausführung. |
| Mandanten-/Identitätsgrenzen | Gut im geprüften Scope | `domain-router-policy.principal`, Workbench-Mappings und tenant-skopierte Governance-Dokument-IDs sind vorhanden. Die Servicetests prüfen Fremdmandanten-Abweisung. Dies ist kein Nachweis für sämtliche REST-Endpunkte oder einen produktiven Identity-Provider. |
| Wartbarkeit | Ausbaufähig | Große Services und mehrere parallel gepflegte Metadaten-/Projektionsflächen erhöhen Drift-Risiken. Die Bereinigung beschränkt sich auf nachgewiesene Vertragslücken. |
| API-Verträge | Teilweise vollständig | Export und Capability-Index werden generiert; der Audit meldet keine Fehler, aber zahlreiche Warnungen zu fehlenden Beispielen/Metadaten. Ein grüner Audit beweist keine fachliche Vollständigkeit. |
| Reife-/Releaseaussagen | An Nachweise gebunden | Lokale Tests und Gates sind erforderlich; Live-MCP-, SMTP-, Identity-Provider- und produktive Restore-/Lastnachweise werden dadurch nicht ersetzt. UI-Discovery-Issues bleiben eigene Arbeit. |

Gesamtbewertung: Der Backend-Zuschnitt ist für die RC3-Vorbereitung geeignet.
Die nachgewiesenen Governance-Vertragslücken sind innerhalb der vorhandenen
Module behebbar. Eine allgemeine Service-Aufteilung, neue Persistenzschicht,
Neuentwicklung funktionierender Forecast-Modelle oder UI-Implementierung ist
für diese Bereinigung nicht erforderlich.

### Nachgewiesene Doppelpflege und bereinigte Verträge

1. Governance-Karten hatten getrennte Eingabe-, Read- und Dossier-Feldlisten.
   Typisierte technische und kaufmännische Felder wurden angenommen, aber im
   generischen Persistenzmodell verworfen. `CARD_DETAIL_FIELDS` und
   `normalizeCardDetails` bilden jetzt einen gemeinsamen, begrenzten Vertrag
   für Persistenz, Read-Projektion und Dossier. Freie Objekt-Payloads werden
   nicht übernommen; Texte und Listen bleiben begrenzt.
2. Asset-Entscheidungssignale dürfen nicht den generischen Signalvorrat
   erweitern. `listTypes.allowedDecisionSignals` und die Eingabevalidierung
   verwenden jetzt denselben typabhängigen Vertrag.
3. Ein technischer Asset-Fall darf vor der kaufmännischen Prüfung entstehen.
   `affectedProcess` wird nicht aus `requiredCommercialChecks[0]` abgeleitet
   und ist für die initiale Asset-Karte nicht verpflichtend. Bestehende
   generische Eingabefelder und technische Aliase bleiben nutzbar. Befund,
   Annahmen, offene Klärungen und kaufmännische Bewertungen bleiben getrennt.
4. `decisionSignal`, `riskLevel` und `commercialReviewNeeded` sind tatsächliche
   Listenfilter. `riskLevel` ist eine explizite Einschätzung aus
   `low|medium|high|critical`, keine automatisch abgeleitete Bewertung.
   Kaufmännischer Prüfbedarf besteht bei aktiven Asset-Karten, wenn
   Budget-, Liquiditäts-, Mittelfristplanungs- oder Return-Bewertung fehlt
   oder das Entscheidungssignal `review` lautet. Dies ist eine
   Vollständigkeits-/Workflowhilfe, keine wirtschaftliche Freigabe.
5. PATCH durfte den gesonderten Lifecycle-Transition-Endpunkt umgehen.
   Die Normalisierung prüft jetzt dieselbe Transition-Tabelle; außerdem
   bleibt der Kartentyp nach Erstellung unveränderlich. Ein Signal `fund`
   löst weiterhin weder Budgetfreigabe noch Beschaffung oder Buchung aus.
6. Der Architekturtext zählte noch 145 Services und 1.039 API-Pfade.
   Der aktuelle Stand enthält 147 Services, 1.120 Pfade und 1.238 Operationen.
   OpenAPI und Operation-Capability-Index wurden erneut generiert.

Forecast-Produkt und Portfolio-Runtime sind keine pauschal zu entfernenden
Duplikate: `forecast-product` prüft den authentifizierten Tenant und erzeugt
Produkt-Trainingsaufgaben; `forecast-portfolio-runtime` verwaltet tenant-skopierte,
versionierte Historien und delegiert an dieses Modul. Auch Domain-Router-
Case-State und Workbench-Conversation-Mapping haben unterschiedliche
Lebenszyklen. Diese bewussten Grenzen bleiben erhalten.

GitNexus meldete für die geänderten Governance-Funktionen LOW Risk mit ein
bis zwei direkten Abhängigkeiten und ohne zugeordneten Execution Flow.
Dynamisch gebundene Moleculer-Handler sind im Graphen nicht vollständig
repräsentiert; deshalb ergänzen Servicetests die Impact-Analyse. Vor jedem
Integrationscommit wird `detect_changes` auf dem expliziten Worktree ausgeführt.
GitNexus erkennt Auswirkungen; Git löst Merge-Konflikte, anschließend prüfen
Tests und generierte Verträge das Ergebnis. Der Quality-Job erhält 40 statt
20 Minuten Laufzeit, weil #675/#678 nach den Unit-Tests in den realen
Python-Modelltests abgebrochen wurden; keine Test- oder Coverage-Gates werden reduziert.

### Offene PRs: Integrationsentscheidung

Die Tabelle dokumentiert die Sichtung vom 2. Oktober 2026. Grün allein reicht
bei unvollständiger fachlicher Abnahme nicht für eine Integration. Historische
CI-Fehler sind getrennt von der Prüfung gegen den aktuellen Stand zu betrachten.

| PR | Entscheidung / Befund |
|----|-----------------------|
| #671 Axios | Integriert; bestehende grüne Checks, anschließend gemeinsame Release-Prüfung. |
| #649 ip-address | Integriert; reine Lockfile-Aktualisierung. |
| #588 js-yaml | Integriert; Override und Lockfile bleiben konsistent. |
| #581 N3 | Integriert; RDF-/SHACL-Verbraucher bleiben Bestandteil der Unit-Prüfung. |
| #579 Jest | Integriert; Konflikt im Package-/Lockfile unter Erhalt des N3-Updates gelöst. |
| #648 Nodemailer | Integriert; Node >=22 erfüllt die neue Laufzeitanforderung. Zusätzliche kompatible Security-Patches werden im Lockfile aufgelöst. |
| #675 Asset-Governance | Mit Korrekturen integriert: Feldpersistenz, technische Erstaufnahme, Signale je Typ, Listenfilter und Regressionen für Anreicherung/Lifecycle. |
| #679 Forecast-Preview | Trotz grüner Checks zurückgestellt: CSV-Zeitspalte falsch bezeichnet, Evidenz-/Reproduktionsmetadaten unvollständig; dokumentierte Preview erfüllt die UI-Akzeptanz von #669 nicht. |
| #678 Inspector-Spezifikation | Zurückgestellt: Quality-Job abgebrochen; Review benennt fehlende nutzergebundene Identität, serverseitige ToolRun-Projektion und Endpoint-Tests. Keine UI-Implementierung in dieser Bereinigung. |
| #593 Asset-to-Decision Seed | Zurückgestellt: Konflikte, fehlgeschlagene Checks und fehlende seed-spezifische Validierung des `source_hint_only`-API-Vertrags. |
| #578 Formatwechsel Seed | Zurückgestellt: Konflikte und fehlgeschlagene Quality-/Sonar-Prüfungen; keine ungeprüfte Erweiterung des Blueprint-Katalogs. |
| #573 Budibase Existing-Target Gate | Zurückgestellt: Konflikte und fehlgeschlagene Checks; weder Live-Apply noch UI-Arbeit beauftragt. |
| #574 Infrastruktur-Panel | Zurückgestellt: UI-Scope, Konflikte und fehlgeschlagene Checks. |
| #566 Digitalprogramm-Panel | Zurückgestellt: UI-Scope, Konflikte, Quality-Fehler und offene semantische Review-Befunde zu EvidenceClass/Workbook-Label. |
| #552 Glama-Metadaten | Zurückgestellt: Konflikte/Quality-Fehler; Änderungen umfassen auch API-Service und Generator und sind keine reine Textpflege. |
| #594 CodeQL Action | Zurückgestellt: historische Quality-Fehler; separater Workflow-Update-Scope. |
| #585 Hono, #576 qs, #575 fast-uri | Security-Bedarf über kompatible Lockfile-Korrektur bearbeitet; #575 liegt mit 3.1.7 noch im aktuellen Advisory-Bereich. Alte PR-Checks sind fehlgeschlagen. |
| #584 PDFKit, #583 Nodemailer 9.x, #580 Moleculer | Zurückgestellt: fehlgeschlagene Checks; Nodemailer 9.x wird durch #648 und aktuelle Security-Patches überholt. |
| #569 Swagger UI, #568 ESLint, #557 better-sqlite3 | Zurückgestellt: fehlgeschlagene Checks; zusätzliche unabhängige Tool-/Runtime-Updates sind kein belegter RC3-Vertragsfix. |

### Offene Issues: fachliche Abgrenzung

| Issues | Einordnung für RC3 |
|--------|--------------------|
| #666 | Asset-Governance-Vertrag in dieser Bereinigung umgesetzt; technische Erstaufnahme, Anreicherung, Signale, Filter und Dossier sind getestet. |
| #668, #669 | Überlappender Forecast-Self-Service-Produktbedarf. Ein gemeinsamer verbindlicher Abnahmepfad sollte Input, Auswertungszeitraum, Einheiten, Metrikdefinitionen und Evidenzmetadaten festlegen. UI-Akzeptanz bleibt offen. |
| #660, #599 | Workbench-/Inspector-Discovery: Backend-Routing ist vorhanden; daraus folgt keine fertig implementierte UI. Auth-/Projektion-/Demo-Gates bleiben separate Abnahmekriterien. |
| #592, #577 | Blueprint-Seeds hängen an #593/#578. Metadaten dürfen nicht mit validierter ausführbarer Integration verwechselt werden. |
| #572, #565, #555, #471, #527 | Workbench-/Budibase-Produkt- und Panelarbeit; zurückgestellt, keine UI-Arbeit. |
| #537 | Neuer Redispatch-Billing-/Reconciliation-Scope: vor Umsetzung Mengen-/Einheitenvertrag, Intervallgrenzen, Korrekturversionen und Abrechnungseffekte festlegen. |
| #530, #529, #528, #522, #521, #517 | Fachliche Erweiterungen für Readiness, Investition, Prüfqueue, Formatwechsel, Datenpunktänderungen und Versandnachweise. Governance-Karten liefern Evidenz, ersetzen aber keine spezifizierte Ranking-, Freigabe- oder Abrechnungslogik. |
| #506, #505, #504 | Zusammenhängender Wallet-Governance-Passport-Vertrag; Preview, Broker-Routing und dokumentierte Consumer-Grenze gemeinsam abnehmen. Keine automatische Wallet-Transaktion. |
| #503 | MQTT-EDM-Ingest: neues Transport-/Ingest-Feature; Idempotenz, OBIS/Einheiten, Tenantbindung, Retention und Fehler-/Replay-Vertrag vor Implementierung spezifizieren. |
| #436 | Breiter Legacy-ERP-Integrations-Scope; keine Voraussetzung für die hier geprüfte additive RC3-Bereinigung. |
| #251 | Querschnittlicher Capability-to-Dossier-Vertrag. Das Governance-Feldverlustproblem ist bereinigt; eine flächendeckende fachliche Abnahme aller Services ist damit nicht abgeschlossen. |

Zurückgestellte Issues werden nicht allein aufgrund einer Spezifikation oder
Teilimplementierung als erledigt bewertet. Externe Deployments, produktive
Datenänderungen, UI-Implementierung und der eigentliche RC3-Release gehören
nicht zu dieser Bereinigung.


### Validierungsnachweise des bereinigten Stands

Lokale Laufzeiten: Node.js 24.18.0 und Python 3.12.3; der CI-Workflow prüft
weiterhin Node.js 22. Keine Live-MCP-/SMTP-/Identity-Provider-Abnahme und kein
produktiver UI-/Deploy-Nachweis sind darin enthalten.

- `npm run lint`, `npm run build` und `git diff --check`: bestanden.
- `npm run test:unit:ci`: 338 Suiten / 7.777 Tests bestanden;
  7 Suiten / 54 Tests durch vorhandene Suite-Bedingungen übersprungen.
  Statements 81,77 %, Branches 66,57 %, Functions 86,07 %, Lines 83,64 %;
  alle bestehenden globalen Schwellen bestanden.
- `npm run test:tdd-matrix` und `npm run check:tdd-matrix-coverage`:
  100 % der verpflichtenden T-* IDs bestanden; MT-* bleibt als Blackbox-
  Coverage explizit getrennt. Der Matrixlauf enthält 82 bestandene und
  4 übersprungene Tests, ohne fehlgeschlagene Tests.
- Python-Unittests mit den unveränderten Forecast-Suiten: 26 Product-,
  28 Portfolio-, 16 Quality- und 33 XLSX-Tests bestanden (insgesamt 103).
- `npm run audit:openapi`: 0 Fehler, 471 bestehende Metadatenwarnungen.
- `npm run check:llm`, `npm run check:operation-capability-index` und
  `npm run check:quality-gate`: bestanden.
- `npm run audit:security` sowie `npm audit --audit-level=moderate`:
  bestanden; aktuelles Lockfile mit 0 Vulnerabilities.
- Integrationstest-Discovery: bestanden; Live-Integrationstests nicht ausgeführt.

Der kombinierte `release:check`-Lauf bestand Unit-Coverage, Matrix und API-Audit
und fand anschließend einen veralteten OpenAPI-Hash in `llm.txt`. Nach
sequentieller Neugenerierung wurden LLM-Sync und alle nachfolgenden Release-
Gates erfolgreich geprüft. Nach dieser Artefaktkorrektur wurde kein Runtime-
Code geändert. GitNexus bestätigt den erwarteten Änderungsumfang gegen
`origin/main` mit LOW Risk.
