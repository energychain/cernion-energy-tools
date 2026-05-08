# Release Summary v0.46 — Komponenten-Diff zu v0.40.x

> **Erstellt:** 2026-05-08
> **Ziel:** Architektur- und Release-Brücke zwischen dem v0.40.x-Stand und den in
> `docs/ARCHITECTURE.md` nachgezogenen Änderungen bis `v0.46.2`.

---

## Überblick

Zwischen `v0.40.x` und `v0.46.2` wurde die Plattform nicht nur erweitert,
sondern in mehreren Querschnittsfunktionen neu ausgerichtet:

- **von punktueller Telemetrie zu vollständiger Observability**
- **von single-tenant Annahmen zu produktiver Tenant-Isolation**
- **von einem einzelnen LLM-Backend zu einer provider-abstrahierten Runtime**
- **von RAG-Wrappern zu eigener Knowledge-Ingestion**
- **von internen Ergebnissen zu webhook-/HITL-fähigen Betriebsworkflows**
- **von Einzel-Endpoints zu gehärteten API-Patterns mit Pagination und Async-Runtime**

---

## Delta-Übersicht nach Release

| Release | Schwerpunkt | Relevante Komponenten |
|---------|-------------|-----------------------|
| `v0.40.6` | Observability Feedback Endpoints | `observability`, `src/observability-store.js`, API/OpenAPI-Erweiterung |
| `v0.41.0` | Multi-Tenant Platform | `src/tenant-context.js`, `vnb-monitor`, `nbp-monitor`, `bilanzkreis`, `settlement`, `cya` |
| `v0.42.0` | Productive OEO Export | `cya`, `src/oeo-context.js`, `src/oeo-exporter-stub.js` |
| `v0.43.0` | LLM Provider Abstraction | `src/llm-client.js`, Adapter für `gemini`, `openai-compat`, `ollama`, `system.llmHealth` |
| `v0.43.1` | Knowledge-RAG Ingestion | `knowledge-rag`, `src/knowledge-rag-chunker.js`, Ingest-/Cutover-Pfade |
| `v0.44.0` | Outbound Webhooks + HITL Ownership | `webhooks`, `hitl`, `src/webhook-crypto.js`, API Gateway |
| `v0.44.1` | Observability Stack Foundation | `src/logger.js`, `src/tracing.js`, `docs/observability/grafana/` |
| `v0.44.2` | Global Cursor Pagination Framework | `src/pagination.js`, migrierte List-Endpunkte |
| `v0.44.3` | Asset Override Production Path | `assets.*`, Override-Persistenz, Effective View, HITL-Kritikalität |
| `v0.44.4` | MaStR↔OEP Delta Engine | `oep.compare-mastr`, semantischer Join, Async-Fallback |
| `v0.44.5` | HITL Approval Workflow First-Class | HITL Dashboard, Bulk-Actions, SLA-Heatmap, UI-Contract |
| `v0.45.0` | §42c Production Cutover Plan | `energy-sharing`, `energy-sharing-allocation`, operative Cutover-Sub-Tracks |
| `v0.45.1` | Job-Store Driver Interface | `src/job-store/*`, `mastr-quality` Async-Angleichung |
| `v0.46.0` | Capability Broker v1 | `capability-broker`, `src/capability-catalog.js`, Planner-Hilfen |
| `v0.46.1` | Finance Agent Planning Assist | `finance-agent`, iteratives `agent.analyze` |
| `v0.46.2` | Planning-Assist Rollout | `utility-report`, `znp`, `cya` |

---

## Thematische Veränderung gegenüber v0.40.x

### 1. Observability wurde zur Plattformfunktion

**Ausgangslage v0.40.x:** produktionsnahe Log-/Metrik-Endpunkte beginnen, aber
noch ohne vollständige Metrik-/Tracing-Schicht.

**Stand v0.46.2:**

- operative Log-, Metrik- und Summary-Endpunkte vorhanden
- strukturierte Logs mit Korrelation über Service-/Action-Grenzen
- OpenTelemetry-Hooks und Prometheus-Metriken im Core-Runtime-Pfad
- Grafana-Starter-Dashboards für schnelle Inbetriebnahme

### 2. Multi-Tenant ist produktiv ausgerollt

**Ausgangslage v0.40.x:** Tenant-Isolation noch kein durchgängiges Architekturprinzip.

**Stand v0.46.2:**

- Tenant-Kontext wird am Gateway propagiert
- Storage-gebundene Services nutzen tenant-spezifische Namespaces/Resolver
- kritische Pfade wie `cya`, `bilanzkreis`, `settlement`, Monitore und spätere
  Cutover-Flows sind mandantenfähig ausgelegt

### 3. LLM-Nutzung wurde abstrahiert und gehärtet

**Ausgangslage v0.40.x:** Callsites sind noch enger an Gemini ausgerichtet.

**Stand v0.46.2:**

- zentraler `llm-client` als Runtime-Fassade
- drei Adapter (`gemini`, `openai-compat`, `ollama`)
- strukturiertes Fallback für nicht-native Schema-Ausgabe
- Health-Probe für Text + Embeddings

### 4. Knowledge-RAG wurde zum eigenen Produktpfad

**Ausgangslage v0.40.x:** Retrieval ist primär externer Wrapper.

**Stand v0.46.2:**

- Collection-Erstellung, Ingest, Ingest aus Datasources/Audits
- lokaler Chunker und Modell-Cutover
- verpflichtendes PII-Scrubbing vor Persistenz/Embeddings
- Tenant-default Collections für nachgelagerte Agenten

### 5. Governance-Workflows wurden sichtbar und integrierbar

**Neue Bausteine ab v0.44.x:**

- Webhooks mit HMAC, Replay und DLQ
- HITL als First-Class-Freigabeschicht
- Asset Overrides mit `effective`-Sicht und HITL-kritischen Feldern
- Pagination als API-Härtung für Listenendpunkte

### 6. Planungshilfen wurden als Advisory-Layer eingeführt

**Stand v0.46.x:**

- Capability Broker v1 empfiehlt passende Aktionen und Flows
- `agent.analyze` und darauf aufbauende Services nutzen die Empfehlungen
- `utility-report`, `znp` und `cya` übernehmen Assistenzsignale, ohne Ausführungshoheit abzugeben

---

## Komponenten-Diff auf einen Blick

| Bereich | v0.40.x | v0.46.2 |
|--------|---------|---------|
| Observability | Basis-Endpoints | Logs + Metrics + Summary + Prometheus + OTel + Grafana |
| Mandantenfähigkeit | partiell / uneinheitlich | produktiv in 12+ storage-lastigen Services |
| LLM-Runtime | provider-nah | provider-abstrahiert mit Fallback |
| Knowledge / RAG | Wrapper-orientiert | eigener Ingest-, Reindex- und Cutover-Pfad |
| Governance | begrenzte manuelle Prozesse | Webhooks, HITL, Asset Overrides |
| API-Härtung | klassische Listen/Jobs | Cursor Pagination, Job Driver Interface, Planner Assist |
| Planung / Routing | service-lokal | Capability Broker + iterative Assistenz |

---

## Offene Themen nach v0.46.2

Die Releases bis `v0.46.2` schaffen die Grundlage für die aktuelle Plattform,
lassen aber bewusst weitere Ausbaupfade offen:

- `capability-broker` bleibt `internal-only`
- §42c-Cutover benötigt weiter operative Härtung und wiederholbare DR-/Rollback-Nachweise
- `nova`, `znp` und `flex` bleiben eigenständige Reifepfade jenseits des Plattform-Cutovers
- Hygiene-Sprint-Arbeit in Prio `3B` und `4` ist noch offen

---

## Verknüpfte Dokumente

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [README.md](../README.md)
- [INTEGRATION_WEBHOOKS.md](INTEGRATION_WEBHOOKS.md)
- [observability/grafana/README.md](observability/grafana/README.md)
- [ui-contracts/31-asset-overrides.md](ui-contracts/31-asset-overrides.md)
- [ui-contracts/40-hitl.md](ui-contracts/40-hitl.md)
