# Cernion Roadmap — Welle 2 · Codebase-Analyse v0.46.2 → v0.50

> Stand: 2026-05-04 · Basis: `llm.txt` (v0.46.2), `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `feedback/HYGIENE_SPRINT.md`, OpenAPI-Export
> Vorgängerwelle: [`docs/roadmap/README.md`](../README.md) · Issues #50–#61 (alle geschlossen)

## 1. Aktueller Stand des Systems

| Kennzahl | v0.40.5 | **v0.46.2** | Δ |
|---|---|---|---|
| Services | 56–58 | **62** | +6 |
| OpenAPI-Operationen | 222 | **256** | +34 |
| OpenAPI-Pfade | 186 | **218** | +32 |
| Test-Files | 128+ | **144** | +16 |
| Cookbook-Recipes | 37 | **39** | +2 |
| Neue Tag-Domänen | — | HITL (11), Observability (4), Webhooks (6), Knowledge RAG (5→12) | |

### 1.1 Welle-1-Ergebnisse (alle geschlossen)

| Issue | Release | Liefergegenstand |
|---|---|---|
| #51 Multi-Tenant Rollout | v0.41.0 | Tenant-Isolation in CYA, VNB-/NBP-Monitor, Bilanzkreis, Settlement |
| #50 OEO-Export produktiv | v0.42.0 | JSON-LD, Pin auf OEO 2.11.0, SHACL-Tests |
| #52 LLM-Provider-Abstraktion | v0.43.0 | `llm-client` mit Gemini/OpenAI-compat/Ollama, `/api/system/llm/health` |
| #53 Knowledge-RAG Ingestion | v0.43.1 | Eigener Ingest-Pfad, Re-Index, Cutover, PII-Scrubbing |
| #54 Outbound Webhooks + HITL | v0.44.0 | `webhooks` + `hitl` Services, HMAC-Signaturen |
| #55 Observability Stack | v0.44.1 | `/metrics`, `pino`, OTel-Tracing |
| #56 Pagination | v0.44.2 | `src/pagination.js`, Cursor-Rollout in 11 Endpunkten |
| #57 Asset-Override Produktiv | v0.44.3 | Persistenz, Effective-View, Critical-Field-HITL |
| #58 OEP-Delta-Engine | v0.44.4 | `src/oep-delta-engine.js`, `installationType=all`, async für >5000 |
| #61 HITL First-Class | v0.44.5 | Dashboard-Endpoints, Bulk-Actions, SLA-Heatmap |
| #59 §42c Cutover-Plan | v0.45.0 | **Planungs-Artefakt** (kein Code) |
| #60 Job-Store-Driver | v0.45.1 | `file/pouchdb/redis-compat`-Driver (nur `mastr-quality.audit` migriert) |

### 1.2 Zusätzliche Features seit v0.45.x

- **v0.46.0 Capability Broker v1** (intern, Action-only) — `capability-broker.recommend`, `…catalog`
- **v0.46.1** Finance-Agent iterative `agent.analyze`-Loop mit Quality-Signals und adaptivem Stop
- **v0.46.2** Planning-Assist in `utility-report`, `znp.strategicPrompts`, CYA-Retrieval

### 1.3 Whitespots Welle 2

| # | Bereich | Symptom | Priorität |
|---|---|---|---|
| 13 | §42c Cutover Sub-Tracks | 7 Sub-Tracks alle offen, Frist 01.07.2026 | **Kritisch** |
| 14 | Async-Job-Cutover unvollständig | Nur `mastr-quality` migriert; `utility-report`, `oep.compare`, `redispatch`, `grid-connection`, `energy-sharing`, `allocation` stehen aus | Hoch |
| 15 | TRL-Tabelle veraltet | `docs/ARCHITECTURE.md` hängt bei v0.38.7 | Hoch |
| 16 | Capability Broker v1 nur intern | Keine API-Route, keine Versionsstrategie, keine Tenant-Tests | Hoch |
| 17 | Auth: nur Bearer-Token | Kein OIDC/SAML — Stadtwerk-SSO blockiert | Hoch |
| 18 | Rate Limiting / Quota | Keine Throttle, kein Tenant-Quota → LLM-Budget-Risiko | Hoch |
| 19 | NOVA SSE TRL 5 | `nova.service.js` „im Aufbau"; Decision-Engine fehlt | Mittel |
| 20 | ZNP TRL 4 | Layer 1+2 sind „stub"; G-Factor nicht feldvalidiert | Mittel |
| 21 | Flex §14a SMGW-Lücke | Kein BSI-SMGW-Konnektor, kein NES2/EEBUS | Mittel |
| 22 | OEMetadata FAIR-Export nur Datapoints | Audit-Reports ohne FAIR-Export | Mittel |
| 23 | Connector-Lücken | PDF/EDIFACT/MaStR-XML/ENTSO-E-XML fehlen als Plugin | Mittel |
| 24 | Streaming/Live-Updates | Nur `/api/nova/stream` SSE — keine Live-Feeds für CYA/RAG/HITL | Mittel |
| 25 | Backup/DR-Runbook | Kein Multi-Tenant-Backup, kein DR-Failover-Test | Mittel |
| 26 | MQTT-Broker single-process | Embedded, kein HA → Doppel-Dispatch bei zweiter Instanz | Niedrig |

## 2. Roadmap (v0.47 → v0.50)

### v0.47 — „Cutover-Reif" (§42c Bereitschaft + Async-Vollendung)

Ziel: §42c-Frist haltbar, alle Long-Running-Endpunkte auf Driver-Backend.

- [Issue 13 — §42c Sub-Track Implementierung](issues/13-energy-sharing-42c-subtracks.md) ⚠️ **Frist**
- [Issue 14 — Async-Job-Cutover für alle Long-Runner](issues/14-async-job-cutover-rollout.md)
- [Issue 15 — Architecture-Dokumentation v0.46](issues/15-architecture-doc-update.md)

### v0.48 — „Enterprise-fähig" (Auth + Rate-Limit + Capability extern)

Ziel: SaaS-Tauglich für Stadtwerke mit IT-Compliance.

- [Issue 16 — Capability Broker v2 (extern + Versionierung)](issues/16-capability-broker-v2.md)
- [Issue 17 — OIDC/SAML SSO](issues/17-oidc-saml-sso.md)
- [Issue 18 — Rate Limiting + Tenant-Quota](issues/18-rate-limit-quota.md)

### v0.49 — „Operativ erwachsen" (NOVA + ZNP + Flex)

Ziel: TRL 4–5-Komponenten auf TRL 6+ heben.

- [Issue 19 — NOVA Decision-Engine produktiv](issues/19-nova-decision-engine.md)
- [Issue 20 — ZNP Layer 1/2 produktiv + G-Factor-Validierung](issues/20-znp-production.md)
- [Issue 21 — Flex §14a SMGW-Connector](issues/21-flex-smgw-connector.md)

### v0.50 — „Open Science + DR" (FAIR + Operations)

Ziel: Open-Science-Konsolidierung + DR-Bereitschaft.

- [Issue 22 — OEMetadata für Audit-Reports](issues/22-oemetadata-audit-reports.md)
- [Issue 23 — DR Runbook + Multi-Tenant-Backup](issues/23-dr-runbook-backup.md)
- [Issue 24 — Live-Streaming Endpoints (SSE/WS)](issues/24-streaming-live-endpoints.md)

## 3. Issue-Index

| Datei | Titel | Priorität | Bereich |
|---|---|---|---|
| [13](issues/13-energy-sharing-42c-subtracks.md) | §42c Sub-Track Implementation | Kritisch | Regulatorik |
| [14](issues/14-async-job-cutover-rollout.md) | Async-Job-Cutover Rollout | Hoch | Skalierung |
| [15](issues/15-architecture-doc-update.md) | Architecture-Doku v0.46.2 | Hoch | Dokumentation |
| [16](issues/16-capability-broker-v2.md) | Capability Broker v2 | Hoch | Architektur |
| [17](issues/17-oidc-saml-sso.md) | OIDC/SAML SSO | Hoch | Security |
| [18](issues/18-rate-limit-quota.md) | Rate Limiting + Quota | Hoch | Plattform |
| [19](issues/19-nova-decision-engine.md) | NOVA Decision-Engine produktiv | Mittel | Domäne |
| [20](issues/20-znp-production.md) | ZNP Production-Readiness | Mittel | Domäne |
| [21](issues/21-flex-smgw-connector.md) | Flex §14a SMGW-Connector | Mittel | Domäne |
| [22](issues/22-oemetadata-audit-reports.md) | OEMetadata für Audits | Mittel | Open Science |
| [23](issues/23-dr-runbook-backup.md) | DR Runbook + Multi-Tenant-Backup | Mittel | Operations |
| [24](issues/24-streaming-live-endpoints.md) | Live-Streaming Endpoints | Mittel | UX |

## 4. Cross-Cutting Voraussetzungen

- **§42c-Frist 01.07.2026** ist die führende Deadline; Welle 2 muss diese ungeachtet anderer Reihenfolgen treffen.
- **TRL-Gates** vor jedem Merge prüfen (`docs/ARCHITECTURE.md` §7).
- **gitnexus_impact** vor Änderungen an Querschnittsmodulen (`llm-client`, `tenant-context`, `pagination`, `webhook-crypto`, `tracing`).
