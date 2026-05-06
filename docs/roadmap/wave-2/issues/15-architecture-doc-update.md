# Issue 15 — Architecture-Dokumentation auf v0.46.2 aktualisieren

**Bereich:** Dokumentation · **Priorität:** Hoch · **Ziel-Release:** v0.47

## Problem

`docs/ARCHITECTURE.md` referenziert `v0.38.7`. Seit dem haben 8 Major-Releases stattgefunden (v0.41 → v0.46.2): OEO-Export produktiv, Multi-Tenant rolled-out, LLM-Provider-Abstraktion, Knowledge-RAG-Ingestion, Webhooks, HITL, Observability, Pagination, Capability Broker. Das Dokument ist damit irreführend und für Onboarding/Compliance unbrauchbar.

## Scope

1. **Schichten-Architektur** §2 erweitern um:
   - Webhook Layer (v0.44.0)
   - HITL Layer (v0.44.0/0.44.5)
   - Observability Layer (v0.40.6/0.44.1)
   - Capability Broker (v0.46.0)
2. **TRL-Tabelle** §7 aktualisieren:

| Komponente | Service | TRL alt | TRL neu | Begründung |
|---|---|---|---|---|
| OEO-Export | `cya.export.oeo` | 4 | **6** | Productive JSON-LD, SHACL-Tests, Version-Pinning |
| Multi-Tenant | quer | 4 (PoC) | **8** | Roll-out auf 12+ Services, E2E-Isolationstests |
| LLM-Client | `src/llm-client.js` | n/a | **6** | 3 Adapter, Fallback, Health-Probe |
| Knowledge RAG | `knowledge-rag` | 4 (Wrapper) | **6** | Eigener Ingest, Re-Index, Cutover, PII-Scrubbing |
| Webhooks | `webhooks` | n/a | **6** | HMAC, Outbox, Replay, DLQ |
| HITL | `hitl` | n/a | **6** | First-Class Dashboard, Bulk-Actions, SLA-Heatmap |
| Observability | `observability` | n/a | **6** | Prometheus, OTel, structured logs |
| Pagination | `src/pagination.js` | n/a | **7** | 11 Endpoints migriert, Tamper-resistant |
| Asset-Override | `assets.*` | 3 (Stub) | **7** | Persistence, Effective-View, HITL-Critical |
| OEP-Delta | `oep.compare-mastr` | 5 | **7** | Semantischer Join, async für Large Portfolios |
| Job-Store | `src/job-store/*` | 5 (file) | **6** | Driver-Interface, 3 Backends |
| Capability Broker | `capability-broker` | n/a | **5** (intern) | v1, internal-only |
| §42c | `energy-sharing` | 7 | **7** | Cutover-Plan vorhanden, Sub-Tracks offen |
| NOVA SSE | `nova` | 5 | 5 | unverändert; siehe Issue 19 |
| ZNP | `znp` | 4 | 4 | unverändert; siehe Issue 20 |
| Flex §14a | `flex` | 5 | 5 | unverändert; siehe Issue 21 |

3. **§8 Bekannte Einschränkungen** aktualisieren:
   - Hygiene-Sprint-Status: Prio 1+2+5 erledigt, Prio 3B + Prio 4 offen
   - Capability Broker explizit `internal-only` markieren
   - §42c-Cutover Sub-Tracks (Issue 13) als offene Risiken aufnehmen
4. **Diagramm** im Header aktualisieren auf 62 Services + 256 Endpunkte + neue Layer.
5. **Querverweise** zu neuen Dokumenten:
   - `docs/INTEGRATION_WEBHOOKS.md`
   - `docs/observability/grafana/`
   - `docs/ui-contracts/40-hitl.md`, `…/31-asset-overrides.md`

## Akzeptanzkriterien

- README + ARCHITECTURE konsistent auf v0.46.2 referenzieren.
- TRL-Tabelle deckt alle 62 Services ab.
- Rendering-Test (`grip` o. ä.) zeigt keine toten Anker.
- `docs/RELEASE_SUMMARY_v0.46.md` neu angelegt mit Komponenten-Diff zu v0.40.

## Bezug

- v0.41–v0.46.2 (alle nicht in `ARCHITECTURE.md` reflektiert)
- `feedback/HYGIENE_SPRINT.md`
