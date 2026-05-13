# Cernion Energy Tools

> Moleculer-basierte Microservice-Plattform für deutsche Verteilnetzbetreiber und Stadtwerke — kombiniert MaStR, ENTSO-E und BNetzA-Daten mit internen Betriebsdaten zu regulatorisch prüffähigen Analysen und KI-gestützten Entscheidungshilfen.

[![Maintenance CI](https://github.com/energychain/cernion-energy-tools/actions/workflows/maintenance-ci.yml/badge.svg?branch=main)](https://github.com/energychain/cernion-energy-tools/actions/workflows/maintenance-ci.yml)
[![CodeQL](https://github.com/energychain/cernion-energy-tools/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/energychain/cernion-energy-tools/actions/workflows/codeql.yml)
[![Release](https://github.com/energychain/cernion-energy-tools/actions/workflows/release.yml/badge.svg)](https://github.com/energychain/cernion-energy-tools/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/energychain/cernion-energy-tools/branch/main/graph/badge.svg)](https://codecov.io/gh/energychain/cernion-energy-tools)

## Überblick

Cernion Energy Tools ist eine **Node.js/Moleculer-Plattform** mit 64 Core-Services
in `services/`, einer optionalen lokalen Erweiterung in `custom-services/`,
250+ OpenAPI-Pfaden / 260+ REST-Operationen und 1 782+ Tests. Sie richtet sich an VNBs und Stadtwerke,
die Netzanschlüsse prüfen, Redispatch-Pflichten verwalten, §42c-Energieteilung
umsetzen oder MaStR-Portfolios auditieren wollen. Die Plattform verbindet öffentliche
Energiedatenquellen (MaStR, ENTSO-E, BNetzA EWK) mit internen Betriebsdaten und
liefert reproduzierbare, auditierbare Ergebnisse — kein Blackbox-LLM für regulatorische
Entscheidungen. Aktueller Stand: **v0.51.1**, 64 Core-Services + 1 lokaler Custom-Service,
250+ OpenAPI-Pfade / 260+ REST-Operationen.

---

## Schnellstart

Voraussetzung: **Node.js 22+**

```bash
git clone https://github.com/energychain/cernion-energy-tools.git
cd cernion-energy-tools
npm install
cp .env.example .env          # CERNION_TOKEN + LLM_PROVIDER/LLM_MODEL konfigurieren
npm start
# API:        http://localhost:3000/api
# Swagger:    http://localhost:3000/api/docs
# Web App:    http://localhost:3000/app
```

Vollständige Einrichtung: [QUICKSTART.md](QUICKSTART.md)

---

## Architektur-Überblick

| Schicht | Komponenten | Zweck |
|---|---|---|
| Plattform | Moleculer, PouchDB/Object Store, Job-Store, Tenant Context | Service-Bus, Persistenz, Isolation, Async Runtime |
| Externe Daten | MaStR (lokal), ENTSO-E, BNetzA EWK, OEP | Anlagendaten, Netzkapazität, Marktpreise |
| Interne Daten | Datasource Layer (CSV/REST/GeoJSON/XLSX), Datapoints | Eigene VNB-Datensätze, Scheduling, Provenance |
| KI / Agenten | Agent, CYA, Finance Agent, 4 deterministische Audit-/Validation-Agents | Analyse, Narrative, Compliance-Prüfung |
| Governance | HITL, Webhooks, Observability, Pagination, Asset Overrides | Operative Freigaben, Eventing, Telemetrie, API-Härtung |
| API | REST (250+ Pfade / 260+ Operationen), MCP, OpenAPI, SSE | Integration in UI, Power Automate, BI-Tools |

Vollständige Architektur: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Methodischer Ansatz

- **Deterministische Regulatorik** — Regulatorische Regeln sind Code, kein LLM-Schluss.
  Identische Eingaben liefern identische Befunde. Prüfbar, reproduzierbar, EU AI Act
  Art. 12/13 konform.
- **TRL-gesteuerter Entwicklungsprozess** — Jede Komponente hat einen expliziten
  TRL-Status (1–8). Neue Features starten bei TRL 3/4, Produktions-Features erfordern TRL 7+.
- **Zwiebelmodus (Onion Model)** — Kontextualisierung von außen nach innen: vom
  VNB-Portfolio zur einzelnen Anlage. Der `CyaContextManager` hält den Zoom-Zustand
  persistent über Sessions.
- **Agent-to-Agent-Protokoll (A²MDM)** — Mehrere Personas verhandeln Konflikte
  strukturiert. Kein Blackbox-LLM-Output für regulatorische Entscheidungen.
- **Open Science Ready** — OEP-Connector, ~150 OEO-Mappings,
  [CONTRIBUTING_SCIENCE.md](CONTRIBUTING_SCIENCE.md) für akademische Anschlüsse.

---

## API-Zugang

**Start hier:**
- Swagger UI: `GET /api/docs`
- OpenAPI JSON: `GET /api/openapi.json`

### API-Schnellnavigation (repräsentative Endpunkte je Domäne)

| Domäne | Beispiele (Auszug) |
|---|---|
| VDMI Governance | `PATCH /api/vdmi/tenants/:tenantId/matrices/:matrixId`, `GET /api/vdmi/tenants/:tenantId/findings`, `POST /api/vdmi/tenants/:tenantId/tasks/:taskId/evidence` |
| CYA Agent | `POST /api/cya/profile`, `POST /api/cya/compare-perspectives`, `GET /api/cya/sessions/:session_id/export/pdf` |
| ZNP + NOVA Decisions | `GET /api/znp/projects`, `POST /api/znp/projects/:projectId/layer0`, `GET /api/znp/projects/:projectId/nova/decisions` |
| EDM & Messkonzepte | `POST /api/edm/validate`, `POST /api/edm/messkonzepte`, `POST /api/edm/validate/:validationId/fill-gaps` |
| Forecast / Settlement / Flex | `POST /api/forecast/load`, `POST /api/settlement/redispatch/calculate`, `POST /api/flex/events/plan` |
| Assets / Grid Validation | `POST /api/assets/:assetId/override`, `GET /api/assets/:assetId/effective`, `POST /api/grid-connection/validate` |
| Datapoints & Snapshots | `POST /api/datapoints/promote`, `POST /api/datapoints/snapshot`, `POST /api/datapoints/snapshot/:id/validate` |
| MaStR Monitor & Qualität | `POST /api/mastr-monitor/watches`, `GET /api/mastr-monitor/confirm/:token`, `POST /api/mastr-quality/audit` |
| OEP / OSM Geo / Knowledge | `GET /api/oep/schemas`, `POST /api/osm-geo/substation-finder`, `POST /api/knowledge-rag/query` |
| Finance Agent | `POST /api/finance-agent/analyze`, `GET /api/finance-agent/analyses`, `GET /api/finance-agent/prompts` |

> Hinweis: Die Tabelle ist ein **Onboarding-Auszug**. Die vollständige API mit allen Pfaden, Parametern und Schemas steht in Swagger unter `/api/docs`.

```bash
# Token erstellen
POST /api/tokens/create
{ "name": "mein-token", "scope": "read-only" }

# Netzanschlussprüfung starten
POST /api/grid-connection/validate
{ "gridOperator": "SNB900...", "location": "Musterstadt", "installationType": "solar", "capacityKW": 250 }

# MaStR-Portfolioqualität prüfen
POST /api/mastr-quality/audit
{ "gridOperatorId": "SNB900..." }

# Vollständige API-Dokumentation
GET /api/openapi.json
GET /api/docs   ← Swagger UI
```

Auth-Leitfaden: [BEARER_TOKEN_AUTHENTICATION.md](BEARER_TOKEN_AUTHENTICATION.md)

---

## Konfiguration

| Variable | Beschreibung | Pflicht |
|---|---|---|
| `CERNION_TOKEN` | API-Token für MCP-Verbindung | Ja |
| `LLM_PROVIDER` | LLM-Provider (`gemini`, `openai-compat`, `ollama`) | Ja |
| `LLM_MODEL` | Modellname für den gewählten Provider | Ja |
| `LLM_API_KEY` | Generischer API-Key (falls Provider ihn benötigt) | Nein |
| `GEMINI_API_KEY` | Gemini-Key (Backwards Compatibility, wenn `LLM_PROVIDER=gemini`) | Nein |
| `MCP_SERVER_URL` | Cernion MCP Server URL | Ja |
| `PORT` | API Gateway Port (Standard: 3000) | Nein |
| `METRICS_PUBLIC` | Macht `GET /metrics` öffentlich, sonst full-access `ck_`-Token nötig | Nein |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP Ziel für Traces | Nein |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | E-Mail-Benachrichtigungen (MaStR Monitor) | Nein |

LLM-Health-Probe: `GET /api/system/llm/health` (Text + Embeddings Check, `ok|degraded|unhealthy`).

Observability:
- `GET /metrics` liefert Prometheus-kompatible Metriken.
- HTTP-, Action-, LLM-, MCP- und Utility-Report-Spans können via `TRACING_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT` exportiert werden.
- Grafana-Beispiele liegen unter [docs/observability/grafana/README.md](docs/observability/grafana/README.md).

Alle Variablen: [.env.example](.env.example)

---

## Entwicklung

```bash
npm test                          # Alle Tests (~1 782+, 128+ Suites)
npm run audit:openapi             # OpenAPI-Vollständigkeit prüfen
npm run lint                      # ESLint
npm run release:check             # Release-Gate (Tests + OpenAPI + Security)
npm run dev                       # Hot-Reload-Modus
```

Neue Services anlegen: `npm run create` (interaktiv aus `templates/`)

---

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Vollständige Architektur-Dokumentation |
| [docs/BACKEND_CONTEXT.md](docs/BACKEND_CONTEXT.md) | Architektur-Kontext für Frontend-Entwickler |
| [docs/ui-contracts/](docs/ui-contracts/) | 33 API-Contracts (UI-Team) |
| [docs/CYA_ARCHITECTURE.md](docs/CYA_ARCHITECTURE.md) | CYA-Agent-Pipeline (4-Phasen-Kontrakt) |
| [docs/RELEASE_SUMMARY_v0.46.md](docs/RELEASE_SUMMARY_v0.46.md) | Komponenten-Diff v0.40 → v0.46.2 |
| [docs/ENERGY_SHARING_ABNAHME.md](docs/ENERGY_SHARING_ABNAHME.md) | §42c Produktionsabnahme |
| [CHANGELOG.md](CHANGELOG.md) | Release-Verlauf |
| [MCP_TOOLS.md](MCP_TOOLS.md) | MCP-Tool-Referenz |
| [BEARER_TOKEN_AUTHENTICATION.md](BEARER_TOKEN_AUTHENTICATION.md) | Auth-Leitfaden |
| [CONTRIBUTING_SCIENCE.md](CONTRIBUTING_SCIENCE.md) | Open Science / OEP-Integration |
| [llm.txt](llm.txt) | Maschinenlesbare Service-Übersicht (LLM-Kontext) |
| [SECURITY.md](SECURITY.md) | Sicherheitsrichtlinie und Disclosure |

---

## Lizenz & Kontext

GPL-3.0 — siehe [LICENSE](LICENSE).

Betrieben von [STROMDAO GmbH](https://stromdao.de/) im Kontext des
[Cernion](https://cernion.de/) Energiedaten-Backends.
Support: [GitHub Issues](https://github.com/energychain/cernion-energy-tools/issues)
· dev@stromdao.com
