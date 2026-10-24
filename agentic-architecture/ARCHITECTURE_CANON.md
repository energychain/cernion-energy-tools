# CET Architecture Canon

Status: bootstrap placeholder created by Shepherd scan on 2026-10-10T01:04:33.560Z.

CET target: a self-aligning Stadtwerk/Energiversorger assistant that maps human intents to domain cases, capabilities, evidence requirements, process states, and safe tool contracts.

## Layer boundaries

- Interface layer: API gateway, OpenWebUI/ChatGPT-compatible adapters, CLI and future UIs.
- Agentic core: intent/case interpretation, capability routing, planning, evidence/HITL policy, response contracts.
- Capability layer: Moleculer services with explicit action contracts.
- Evidence/data layer: RAG, OpenAPI, MCP, datasource registry/cache/connectors, receipts, object store.
- Operations layer: observability, tenant/quota/auth, jobs, webhooks, provisioning.
