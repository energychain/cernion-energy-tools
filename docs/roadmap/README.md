# Cernion Roadmap — Codebase-Analyse v0.40.5 → v0.45

> Stand: 2026-05-04 · Basis: `llm.txt` (v0.40.5), `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `feedback/HYGIENE_SPRINT.md`, `feedback/CR-TENANT-001.md`, OpenAPI-Export

## 1. Aktueller Stand des Systems

| Kennzahl | Wert |
|---|---|
| Version | 0.40.5 |
| Services | 56–58 |
| OpenAPI-Operationen | 222 (186 Pfade) |
| Tests | 1.782+ (128+ Suites) |
| Cookbook-Recipes | 37 |
| Finding-Codes | 92 (`mq`, `rd`, `gc`, `es`, `fa`) |
| Node.js | 22+ |

### 1.1 Reife (TRL)

| Komponente | Service | TRL |
|---|---|---|
| Dashboard API, Datapoint Layer, Object Store | `dashboard-api`, `datapoint`, `object-store` | **8** |
| Grid-Connection, Energy-Sharing §42c, MaStR-Quality, Redispatch Ex-Post, MaStR-Monitor, Inhouse Datasource | div. | **7** |
| Agent (Gemini-Plan), OSM-Geo, EDM-Virtual, OEP, Forecast Engine | div. | **6** |
| CYA Agent, NOVA SSE, Flex §14a | `cya`, `nova`, `flex` | **5** |
| ZNP | `znp` | **4** |
| Finance Agent (neu, v0.40) | `finance-agent` | **5** (eigene Einschätzung) |
| Knowledge RAG (Wrapper, v0.39) | `knowledge-rag` | **4** (Lese-Wrapper) |

### 1.2 Letzte Sprint-Schwerpunkte

- **v0.40.x** Finance Agent + A²MDM (CYA + OEO + Datapoints + Multi-Hop) + zentraler `src/llm-client.js` mit `generateStructured`-Schemas
- **v0.39.0** Knowledge RAG Service (`cernion_rag_search`-Wrapper)
- **v0.38.x** Multi-Tenant-Fundament (PoC), A2A-Replay, OEP-Connector-Ausbau, Hygiene Sprint Prio 1+2
- **v0.37.x** Zwiebelmodus Context Manager Persistenz, 360° Utility Report Stabilisierung
- **v0.36.x** Central Ontology Graph Persistenz (Cache), Installations Filter-Bugfixes
- **v0.35.x** A2A-Protokoll auf Moleculer-Event-Bus, Tool-Router (v0.33), Progressive Profiling (v0.34)

### 1.3 Identifizierte Whitespots & Lücken

| # | Bereich | Symptom | Priorität |
|---|---|---|---|
| 1 | OEO-Exporter | `transformToOEO` wirft `OEO_NOT_IMPLEMENTED`, Mappings sind Stubs | **Hoch** |
| 2 | Multi-Tenant | Nur PoC im CYA-Service; `mastr-quality`, `datapoint`, `mastr-monitor`, `bilanzkreis` etc. nicht tenant-aware | **Hoch** |
| 3 | LLM-Provider | `src/llm-client.js` hängt an Gemini-API; KRITIS-Air-Gap blockiert | **Hoch** |
| 4 | Knowledge-RAG | Nur Lese-Wrapper, keine Ingestion-Pipeline → Finance-Agent liefert „no hits" | **Hoch** |
| 5 | Webhooks | Event-Bus rein in-process, keine Außenanbindung (Power Automate, Zammad) | Mittel |
| 6 | Observability | Keine Prometheus-Metriken, kein OTel-Tracing, printf-Logs | Mittel |
| 7 | Pagination | TODO `cya.service.js:1041`, `mastr-monitor` `limitApplied` Workaround, Listing-Endpunkte ohne Cursor | Mittel |
| 8 | Asset-Override | OpenAPI: *"No persistence yet"* — Stub-Endpoint | Mittel |
| 9 | OEP-Delta | `delta: null` in `compareWithMastr` (TODO) | Mittel |
| 10 | §42c Cutover | Frist 01.07.2026, kein formales Tracking | **Hoch** |
| 11 | Job-Store | File-backed, single-process — kein HA-Setup möglich | Mittel |
| 12 | HITL-Eskalation | Nur Hook in `cya.a2a.consensus.failed`-Listener | Mittel |
| 13 | EU AI Act Art. 13 | Nutzer-Information unterhalb des Audit-Trails (Art. 12) unterbelichtet | Niedrig |
| 14 | Hygiene Prio 3B/4 | Cognitive-Complexity >30 in 31 Stellen, Magic-Strings in 77 Stellen | Niedrig |

## 2. Roadmap (v0.41 → v0.45)

### v0.41 — „Plattformfähig" (Mehr-Mandanten-Hygiene)

Ziel: SaaS-fähig, Pagination überall, Asset-Override produktiv.

- [Issue 02 — Multi-Tenant Rollout](issues/02-multi-tenant-rollout.md)
- [Issue 07 — Pagination-Framework](issues/07-pagination-framework.md)
- [Issue 08 — Asset-Override Produktiv](issues/08-asset-override-produktiv.md)
- Hygiene-Sprint Prio 3B + Prio 4 abschließen

### v0.42 — „Open & Erklärbar" (Open Science + EU AI Act)

Ziel: Open-Science-Anschluss, OEP-Delta produktiv, HITL als First-Class-Workflow.

- [Issue 01 — OEO-Exporter produktiv](issues/01-oeo-exporter-produktiv.md)
- [Issue 09 — OEP-MaStR Delta-Engine](issues/09-oep-mastr-delta-engine.md)
- [Issue 12 — HITL-Workflow](issues/12-hitl-workflow.md) *(verbunden mit altem Issue #33)*

### v0.43 — „On-Prem & RAG-fähig"

Ziel: KRITIS-Air-Gap-Deployments + tenant-eigene Wissensbasis.

- [Issue 03 — LLM-Provider-Abstraktion](issues/03-llm-provider-abstraktion.md)
- [Issue 04 — Knowledge-RAG Ingestion](issues/04-knowledge-rag-ingestion.md)

### v0.44 — „Operativ produktionsreif"

Ziel: Externe Integration, Observability, Skalierung.

- [Issue 05 — Outbound Webhooks](issues/05-outbound-webhooks.md)
- [Issue 06 — Observability Stack](issues/06-observability-stack.md)
- [Issue 11 — Job-Store-Driver-Interface](issues/11-job-store-scaling.md)

### v0.45 — „§42c Production Cutover"

Ziel: Stichtag 01.07.2026 erreichen.

- [Issue 10 — §42c Cutover-Track](issues/10-energy-sharing-42c-cutover.md)

## 3. Issue-Index

| Datei | Titel | Priorität | Bereich |
|---|---|---|---|
| [01](issues/01-oeo-exporter-produktiv.md) | OEO-Exporter produktiv | Hoch | Open Science |
| [02](issues/02-multi-tenant-rollout.md) | Multi-Tenant über alle Services | Hoch | Plattform |
| [03](issues/03-llm-provider-abstraktion.md) | LLM-Provider-Abstraktion | Hoch | Architektur |
| [04](issues/04-knowledge-rag-ingestion.md) | Knowledge-RAG Ingestion | Hoch | RAG |
| [05](issues/05-outbound-webhooks.md) | Outbound Webhook Service | Mittel | Integration |
| [06](issues/06-observability-stack.md) | Prometheus + OTel + structured logs | Mittel | Ops |
| [07](issues/07-pagination-framework.md) | Globales Pagination-Framework | Mittel | API |
| [08](issues/08-asset-override-produktiv.md) | Asset-Override Persistenz + NOVA-Trail | Mittel | Plattform |
| [09](issues/09-oep-mastr-delta-engine.md) | MaStR↔OEP Delta-Engine | Mittel | Daten |
| [10](issues/10-energy-sharing-42c-cutover.md) | §42c Production Cutover (01.07.2026) | Hoch | Regulatorik |
| [11](issues/11-job-store-scaling.md) | Job-Store Driver-Interface (HA) | Mittel | Skalierung |
| [12](issues/12-hitl-workflow.md) | HITL-Approval-Workflow First-Class | Mittel | Compliance |

## 4. Cross-Cutting Voraussetzungen

- **Branch-Strategie:** Jeder Issue-Track auf eigenem Feature-Branch, Squash-Merge in `main`.
- **TRL-Gate:** Neue Features starten TRL 3/4, Produktion erfordert TRL 7+ (`docs/ARCHITECTURE.md` §7).
- **Tests vor Code:** Pro Issue mindestens eine `tests/<feature>.e2e.test.js` plus Unit-Tests entlang `src/<modul>.js`.
- **`gitnexus_impact`** vor jeder Änderung — Branch-Schutz erinnert daran (`CLAUDE.md`).
- **`npm run audit:openapi` + `npm run release:check`** als Release-Gate.
