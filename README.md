# Cernion Energy Tools

> API-first Agentic Energy Operations Layer for Stadtwerke, DSOs and energy-service teams.
> Cernion combines deterministic energy-domain services, curated capability routing,
> evidence dossiers, VDMI role logic, HITL boundaries and read-only integration surfaces
> for REST, Sidecar, Microsoft Copilot, n8n, OpenWebUI and OpenClaw.

[![Maintenance CI](https://github.com/energychain/cernion-energy-tools/actions/workflows/maintenance-ci.yml/badge.svg?branch=main)](https://github.com/energychain/cernion-energy-tools/actions/workflows/maintenance-ci.yml)
[![CodeQL](https://github.com/energychain/cernion-energy-tools/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/energychain/cernion-energy-tools/actions/workflows/codeql.yml)
[![Release](https://github.com/energychain/cernion-energy-tools/actions/workflows/release.yml/badge.svg)](https://github.com/energychain/cernion-energy-tools/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/energychain/cernion-energy-tools/branch/main/graph/badge.svg)](https://codecov.io/gh/energychain/cernion-energy-tools)

## What This Repository Is

Cernion Energy Tools is the backend runtime behind [cernion.de](https://cernion.de/):
a Node.js/Moleculer service platform for energy-domain automation, decision support and
agentic process orchestration.

It is not just a chat frontend for energy APIs. The current platform contains:

- **137 Moleculer services** in `services/`
- **1003 OpenAPI paths** in `openapi-export.json`
- **297 JavaScript test files** under `tests/`
- **curated Copilot, Sidecar, OpenWebUI, n8n and OpenClaw integration surfaces** that expose only governed subsets of the backend
- **agentic runtime components** for routing, receipts, dossiers, HITL, evidence, revalidation and observability

Current package/OpenAPI version: **`0.67.8`**

### Public positioning

Cernion does not let the chat decide. The platform structures the objective, available
data, service chain, evidence, gaps, risk and the next safe gate. The result is not a
black-box answer, but a dossier-ready status or decision-readiness view for Stadtwerke,
distribution-system operators and energy-service teams.

Cernion Energy Tools is not an automatic contract decision, grid-connection commitment,
device-control system, MaKo execution system, billing/settlement system or tariff-mutation
machine. Suitable integration scopes are `ask`, `plan`, `evidence`, `capability lookup`
and `read-only status`. Write-like or consequential steps stay in `draft`, `prepare` or
`pending confirmation` states and require HITL.

The public website explains Cernion as an energy-intelligence and decision platform for
Stadtwerke: MaStR analysis, grid planning, §14a, Redispatch, Energy Sharing, customer-service
automation and Microsoft Copilot complementarity. This repository is the deeper technical
system underneath that product narrative.

### Public discovery links

- Product and topic hub: [Cernion Themencluster](https://cernion.de/themen)
- Capability overview: [Cernion Capability Hub](https://cernion.de/capabilities)
- API and agent integration: [MCP Tools & API](https://cernion.de/mcp-tools-api) and [REST API](https://cernion.de/rest-api)
- Operational search-intent pages:
  - [Verteilnetzbetreiber Software](https://cernion.de/verteilnetzbetreiber-software)
  - [Stadtwerke Prozessautomatisierung](https://cernion.de/stadtwerke-prozessautomatisierung)
  - [§14a EnWG Nachweisakte](https://cernion.de/14a-enwg-nachweisakte)
  - [Redispatch 2.0 Bewegungsdaten](https://cernion.de/redispatch-20-bewegungsdaten)
  - [KI für Stadtwerke und Netzbetreiber](https://cernion.de/ki-fuer-stadtwerke-netzbetreiber)

## Why Cernion Is Agentic

Cernion is API-first, but the API is only the integration layer. The agentic part is the
runtime behavior:

1. **Understand an energy-domain objective**
   Examples: validate a grid-connection scenario, build a VDMI responsibility matrix,
   assess BESS finance risk, identify Energy Sharing data conflicts.
2. **Select a governed capability path**
   The `capability-broker` maps intent to curated service chains instead of exposing the
   full tool catalogue to an LLM.
3. **Execute deterministic microservices**
   Energy-domain calculations and regulatory checks remain code-backed and reproducible.
4. **Maintain process state**
   Personal-agent sessions, receipts, dossiers, HITL items and object-store evidence allow
   work to continue beyond a single chat turn.
5. **Produce auditable artifacts**
   Outputs are not only natural-language answers; they include dossiers, evidence packages,
   decision frames, validation reports, receipts and traces.
6. **Govern revalidation**
   New facts can become control signals for agents: if a MaStR asset, datapoint or object-store
   evidence item changes, dependent decisions can be identified and rechecked.

This is the practical difference between a question-and-answer bot and an agentic
energy-operations platform.

## Core Architecture

```text
External systems / humans / agents
        |
        v
REST API, Copilot API, OpenClaw Sidecar, MCP-like tool surfaces
        |
        v
Personal Agent / Capability Broker / Agent Receipts / Blueprints
        |
        v
Governed Moleculer services
        |
        v
Datapoints, Object Store, Knowledge RAG, Dossiers, Jobs, Observability
```

### Runtime Layers

| Layer | Components | Purpose |
| --- | --- | --- |
| Service bus | Moleculer, REST gateway, async jobs | Deterministic service execution and API exposure |
| Data layer | Object Store, Datapoints, DataSources, Knowledge RAG | Internal data, external evidence, tenant memory and source material |
| Agentic routing | Personal Agent, Capability Broker, Blueprints, Agent Receipts | Intent resolution, tool-chain selection, durable execution |
| Governance | VDMI, HITL, Clarification Policy, Interface Placeholder, Evidence Revalidation | Responsibilities, missing evidence, human decisions, gap handling |
| Integration | Full OpenAPI, Copilot subset, OpenClaw Sidecar, Webhooks, MCP-style tools | Safe use by humans, copilots, agents and automation systems |
| Observability | Metrics, traces, audit records, job status | Operation, auditability and support |

## Main Domains

The platform covers several energy-industry work areas. The following list is representative;
the OpenAPI export is the source of truth.

| Domain | Examples |
| --- | --- |
| Grid connection and fNAV | Grid-connection validation, flexible network access, connection-rejection evidence |
| VDMI governance | Verantwortlich, Durchführend, Mitwirkend, Information per process step; findings, dossiers and evidence |
| Zielnetzplanung (ZNP) | Projects, assumptions, Layer 0/1/2 assets, portfolio analysis, NOVA decisions |
| Asset and data quality | MaStR quality, asset overrides, ghost-asset alerts, datasource classification |
| Energy Sharing and settlement | §42c-style allocation, settlement checks, Redispatch ex-post reconciliation |
| EDM and market communication | MSCONS import, EDM validation, virtual meters, messkonzept checks |
| Forecasting and flexibility | Forecast engine, residual load, §14a flex events, SLP profiles |
| Finance and investment | Finance agent, fNAV economics, BESS screening, capex prioritization |
| Reporting and BI | Reporting governance, dashboard API, VNB monitoring, EWK monitoring |
| Knowledge and evidence | Knowledge RAG, evidence routing, dossiers, object-store context |

## Agentic Components

### Personal Agent

`services/personal-agent.service.js` is the user-facing orchestration layer. It keeps
conversation state, routes intents, calls deterministic services and synthesizes results
without turning the whole backend into one prompt.

Key concepts:

- layered context management ("Zwiebelmodus")
- durable execution state and resumable sessions
- file and datapoint intake
- evidence-gap handling
- work-out-loud events
- presentation-aware final artifacts

### Capability Broker

`services/capability-broker.service.js` and `src/capability-catalog.js` provide curated
capability routing. This is the control point that prevents agents from seeing or choosing
the entire backend surface directly.

Examples of curated capabilities include:

- `vdmi_role_boundary_governance`
- `vdmi_asset_validation_governance`
- `vdmi_grid_connection_decision_governance`
- `netzfahrplan_fnav_assessment`
- `znp_portfolio_assessment`
- `settlement_a96_reconciliation`
- `financier_due_diligence_assessment`
- `reporting_governance`

### Agent Receipts

`services/agent-receipts.service.js` turns repeatable agent workflows into versioned,
testable recipes. Receipts describe matching conditions, required inputs, tool plans and
knowledge plans. They are the bridge from "the agent answered" to "the platform selected a
governed, inspectable workflow".

### Dossiers and Decision Frames

Cernion uses dossiers and decision frames for auditable outputs. A result can include:

- facts used
- hypotheses
- evidence gaps
- risks
- forbidden assumptions
- VDMI responsibilities
- next actions
- human-review requirements

### Agentic Governance and Revalidation

Two active architecture tracks are captured in GitHub issues:

- [#275 Agent Governance Runtime: Bestandsanalyse vor Umsetzungsplan](https://github.com/energychain/cernion-energy-tools/issues/275)
- [#276 Agentic Governance Layer: Faktenänderungen als Steuerungssignal für Agenten](https://github.com/energychain/cernion-energy-tools/issues/276)

The target direction is that a changed fact can become a control signal for agents:

```text
MaStR / datapoint / object-store change
        |
        v
Dependency and impact analysis
        |
        v
Revalidation queue
        |
        v
Agent receipt / capability flow rerun
        |
        v
Audit note, updated dossier, HITL item or exception case
```

This is how Cernion moves from one-time API analysis toward RPA+ for commodity energy
processes: standard cases are automated, exceptions are made explicit.

## Integration Surfaces

### Full REST API

The complete REST API is generated from Moleculer service metadata.

- Swagger UI: `GET /api/docs`
- OpenAPI JSON: `GET /api/openapi.json`
- Static export: `openapi-export.json`
- Public API recipes for developer and LLM discovery: [docs/public-api-recipes.md](docs/public-api-recipes.md)

The recipes use only synthetic examples, environment-variable based tokens and tenant-safe demo identifiers. They document consultation/read-only/pending-confirmation boundaries and are not approval, billing, tariff, device-control, contract or production-mutation demos.

Regenerate and audit:

```bash
npm run export:openapi
npm run audit:openapi
```

### Microsoft Copilot Bridge

Cernion does not expose all 600+ API paths to Microsoft Copilot. The Copilot bridge uses a
curated allowlist maintained in `config/copilot-operations.json`.

Relevant files:

- [docs/copilot-process-bridge.md](docs/copilot-process-bridge.md)
- [docs/copilot-agent.json](docs/copilot-agent.json)
- [docs/copilot-plugin.json](docs/copilot-plugin.json)
- `openapi-copilot.json`

Generate the Copilot subset:

```bash
npm run export:openapi:copilot
```

The Copilot-facing surface distinguishes:

- `read` operations with no side effects
- `draft` operations that prepare suggestions
- `prepare` operations requiring confirmation
- consequential operations that remain blocked until explicitly governed

### OpenClaw Sidecar

Cernion Energy Tools can be used from OpenClaw through the public
[ClawHub package @cernion/openclaw-energy-tools-sidecar](https://clawhub.ai/cernion/plugins/openclaw-energy-tools-sidecar).
Install it in OpenClaw with:

```bash
openclaw plugins install clawhub:@cernion/openclaw-energy-tools-sidecar
```

The companion repository
[SmartEnergySolutions/cernion-openclaw-sidecar](https://github.com/SmartEnergySolutions/cernion-openclaw-sidecar)
provides an OpenClaw plugin for generic Energy Sidecar providers, with Cernion as the first
provider.

The product boundary is intentionally split: OpenClaw is the agent runtime for conversation,
tool orchestration, memory and answer synthesis. Cernion Energy Tools is the energy-domain
evidence, policy, Knowledge RAG and read-only API layer behind answers about MaStR assets,
grid context, Redispatch, Zielnetzplanung, 14a/14d EnWG duties, process intake and operational
status.

The sidecar consumes the Cernion Sidecar contract:

- `GET /api/agent-sidecar/descriptor`
- `GET /api/agent-sidecar/mcp/tools`
- `POST /api/agent-sidecar/mcp/tools/:name/call`
- `POST /api/knowledge-rag/query`
- `POST /api/evidence-router/route`
- `POST /api/copilot-process/intents`
- `GET /api/_agent/capabilities[?domain=]`
- `GET /api/_agent/operations[?domain=]`

The boundary is deliberately strict:

- read-only Cernion evidence lookup uses a read-only token
- process intake uses a separate process token and creates only `pending_confirmation` receipts
- admin, token, HITL-resolve and production mutation paths are blocked
- domain routing remains inside Cernion, not inside the sidecar

### MCP-Style Tooling

Cernion also publishes AI-agent-friendly tool descriptions through `llm.txt`, capability
resolution endpoints and MCP/OpenClaw-style tool lists. The public documentation page
describes this as a set of ready-to-use energy tools for Stadtwerke.

## Quickstart

Prerequisite: **Node.js 22+**

```bash
git clone https://github.com/energychain/cernion-energy-tools.git
cd cernion-energy-tools
npm install
cp .env.example .env
npm start
```

Default local endpoints:

- API: `http://localhost:3000/api`
- Swagger UI: `http://localhost:3000/api/docs`
- Web app: `http://localhost:3000/app`

Full setup guide: [QUICKSTART.md](QUICKSTART.md)

## Configuration

Start with [.env.example](.env.example). Common variables:

| Variable | Purpose |
| --- | --- |
| `CERNION_TOKEN` | API token for authenticated access |
| `LLM_PROVIDER` | LLM provider (`gemini`, `openai-compat`, `ollama`) |
| `LLM_MODEL` | Model name for the selected provider |
| `LLM_API_KEY` / `GEMINI_API_KEY` | Provider credentials when needed |
| `API_URL` | Base URL used in generated OpenAPI servers and CLI share links |
| `PORT` | API gateway port, default `3000` |
| `TRACING_ENABLED` | Enable OpenTelemetry tracing |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP trace destination |
| `METRICS_PUBLIC` | Expose `/metrics` without a full-access token |

LLM health:

```text
GET /api/system/llm/health
```

Observability:

- `GET /metrics` returns Prometheus-compatible metrics
- Grafana examples: [docs/observability/grafana/README.md](docs/observability/grafana/README.md)

Auth guide: [BEARER_TOKEN_AUTHENTICATION.md](BEARER_TOKEN_AUTHENTICATION.md)

## Development

```bash
npm test
npm run test:unit:ci
npm run test:tdd-matrix
npm run test:rest-usecases
npm run lint
npm run audit:openapi
npm run check:llm
npm run release:check
```

Useful generation commands:

```bash
npm run export:openapi
npm run export:openapi:copilot
npm run generate:llm
npm run blueprint:export
```

Create a new Moleculer service:

```bash
npm run create
```

## Demonstrating Cernion

Good demos should show an **agentic run**, not only a chat answer.

Strong demo patterns:

- VDMI: generate a responsibility matrix per process step and detect role-boundary violations
- BESS: assess a site across grid connection, risks, revenue assumptions and financier evidence
- Energy Sharing: identify MaLo/MeLo, EDM and settlement conflicts that block the process
- MaStR/Revalidation: show how an external asset update can trigger rechecking of dependent decisions
- Copilot/Sidecar: show Cernion as the governed energy-domain backend behind a general-purpose agent

A useful agentic trace should make these visible:

```text
User objective
  -> intent and capability
  -> selected receipt / blueprint
  -> service chain
  -> evidence used
  -> gaps and risks
  -> HITL / policy decision
  -> dossier or decision artifact
  -> audit trace
```

## Documentation Map

| Document | Topic |
| --- | --- |
| [docs/copilot-process-bridge.md](docs/copilot-process-bridge.md) | Curated Microsoft Copilot API subset |
| [docs/v0.52-implementation-plans/personal-agent-v052-architecture-tdd.md](docs/v0.52-implementation-plans/personal-agent-v052-architecture-tdd.md) | Personal Agent architecture and TDD contract |
| [docs/v0.52-implementation-plans/v0.52.1-capability-broker.md](docs/v0.52-implementation-plans/v0.52.1-capability-broker.md) | Capability Broker implementation plan |
| [docs/observability/grafana/README.md](docs/observability/grafana/README.md) | Grafana dashboards |
| [docs/DSFA_TEMPLATE.md](docs/DSFA_TEMPLATE.md) | Data protection impact-assessment template |
| [docs/BACKEND_CONTEXT.md](docs/BACKEND_CONTEXT.md) | Backend context for UI/frontend work |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [MCP_TOOLS.md](MCP_TOOLS.md) | MCP/tool reference |
| [llm.txt](llm.txt) | Machine-readable service and capability context |
| [SECURITY.md](SECURITY.md) | Security policy |

## License and Operator Context

License: GPL-3.0. See [LICENSE](LICENSE).

Cernion is developed by [STROMDAO GmbH](https://stromdao.de/) in the context of the
[Cernion](https://cernion.de/) energy-intelligence platform.

Support and product feedback:

- [GitHub Issues](https://github.com/energychain/cernion-energy-tools/issues)
- `dev@stromdao.com`
