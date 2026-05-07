# Cernion Roadmap — Überblick

> Stand: 2026-05-07
> Diese Roadmap ist der zentrale Einstieg für laufende und abgeschlossene Umsetzungstracks.

## 1) Struktur der Roadmap

- **Offene Arbeitspakete**: [issues/](issues/) (aktuell Issue 13–24)
- **Abgeschlossene Arbeitspakete**: [resolved/](resolved/) (Issue 01–12)

Jede Issue-Datei ist ein umsetzbarer Track mit Scope, Akzeptanzkriterien und Deliverables.

## 2) Status auf einen Blick

| Bereich | Anzahl |
|---|---:|
| Offene Issues (`issues/`) | 12 |
| Resolved Issues (`resolved/`) | 12 |
| Gesamt | 24 |

## 3) Aktive Roadmap (Issues 13–24)

| ID | Thema | Link |
|---|---|---|
| 13 | §42c Energieteilen: Sub-Track-Implementierung | [13-energy-sharing-42c-subtracks.md](issues/13-energy-sharing-42c-subtracks.md) |
| 14 | Async-Job-Cutover für Long-Running-Endpunkte | [14-async-job-cutover-rollout.md](issues/14-async-job-cutover-rollout.md) |
| 15 | Architektur-Dokumentation auf v0.46.2 aktualisieren | [15-architecture-doc-update.md](issues/15-architecture-doc-update.md) |
| 16 | Capability Broker v2 (extern, versioniert, multi-tenant) | [16-capability-broker-v2.md](issues/16-capability-broker-v2.md) |
| 17 | OIDC / SAML SSO-Adapter | [17-oidc-saml-sso.md](issues/17-oidc-saml-sso.md) |
| 18 | Rate Limiting + Tenant Quotas | [18-rate-limit-quota.md](issues/18-rate-limit-quota.md) |
| 19 | NOVA Decision Engine produktiv (TRL 5 → 7) | [19-nova-decision-engine.md](issues/19-nova-decision-engine.md) |
| 20 | ZNP Production-Readiness | [20-znp-production.md](issues/20-znp-production.md) |
| 21 | Flex §14a SMGW-Connector | [21-flex-smgw-connector.md](issues/21-flex-smgw-connector.md) |
| 22 | OEMetadata/FAIR Export für Audit-Reports | [22-oemetadata-audit-reports.md](issues/22-oemetadata-audit-reports.md) |
| 23 | Disaster Recovery Runbook + Multi-Tenant Backup | [23-dr-runbook-backup.md](issues/23-dr-runbook-backup.md) |
| 24 | Live-Streaming-Endpunkte (SSE / WebSocket) | [24-streaming-live-endpoints.md](issues/24-streaming-live-endpoints.md) |

## 4) Bereits umgesetzt (Resolved 01–12)

Die Basisplattform-Themen sind abgeschlossen und dokumentiert in [resolved/](resolved/):

- OEO Export produktiv
- Multi-Tenant Rollout
- LLM-Provider-Abstraktion
- Knowledge-RAG Ingestion
- Outbound Webhooks
- Observability Stack
- Cursor Pagination Framework
- Asset Overrides produktiv
- OEP↔MaStR Delta Engine
- §42c Production-Cutover Plan
- Job-Store Driver Interface
- HITL Workflow First-Class

Vollständige Nachweise: siehe einzelne Dateien in [resolved/](resolved/).

## 5) Empfohlene Lesereihenfolge

1. Regulatorik & Cutover: Issue 13, 21, 22, 23
2. Plattform & Betrieb: Issue 14, 17, 18, 24
3. Agentische Kernsysteme: Issue 16, 19, 20
4. Dokumentationshygiene: Issue 15

## 6) Governance für neue Roadmap-Issues

Neue Issue-Dateien sollten mindestens enthalten:

- **Zielbild / Problemstatement**
- **Scope in/out**
- **Akzeptanzkriterien**
- **Technische Deliverables (Services, src, tests, docs/ui-contracts)**
- **Rollout-/Migrationspfad und Risiken**

Wenn ein Issue abgeschlossen ist:

1. Datei von [issues/](issues/) nach [resolved/](resolved/) verschieben.
2. Relevante Umsetzung in [CHANGELOG.md](../../CHANGELOG.md) referenzieren.
3. Falls API-Vertrag betroffen: entsprechenden UI-Contract unter [docs/ui-contracts/](../ui-contracts/) aktualisieren.
