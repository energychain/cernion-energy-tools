# ChatGPT Sidecar OEO Trust Boundary

Issue: energychain/cernion-energy-tools#388
Signal: Repository-Hygiene-Signalmonitor 2026-07-05T08:28Z
Status: Product/architecture gate, not an implementation slice

## Purpose

The ChatGPT Sidecar may use ChatGPT.com or a Custom GPT as the familiar user interface, but Cernion remains the authority for tenant context, capability selection, evidence, policy, writes, metering and energy-domain semantics.

The OEO / energy-domain ontology layer is not a generic extra data source. It is the semantic Cernion frame for energy-sector concepts, roles, assets, market processes and process boundaries. ChatGPT must not invent Cernion/OEO terms, silently downgrade them to generic language, or use ontology language to bypass provider, tenant or policy boundaries.

## Product Cut Required Before Implementation

A later implementation ticket must first define a minimal session capability profile contract:

- `capabilityProfile` can include an explicit ontology capability family, for example `ontology-guardrail` or `oeo-context`.
- `manifest` declares whether ontology/OEO support is enabled, which ontology version or mapping surface is in scope, and which downstream flows may consume it.
- `ask`, `plan`, `execute`, `datapoints` and `dossier` may use ontology/OEO only through existing Cernion services and curated mappings.
- `promptText` instructs ChatGPT to respect Cernion/OEO terminology, separate assumptions from Cernion evidence, and avoid unsupported sector concepts.
- `metering` records ontology/OEO guardrail usage as a capability family without exposing raw provider internals, credentials, tenant IDs or unrestricted endpoints.

## Trust Boundary

Server-side session state remains the policy source. The prompt and manifest are not authority for writes, tenant identity, user identity, provider credentials or internal route topology.

Required server-side state additions for ontology-enabled sessions:

- ontology capability enabled/disabled
- ontology mapping/version identifier, if pinned
- allowed ontology-backed flows
- uncertainty behavior for unsupported terms
- metering family for ontology guardrail use
- policy outcome for ontology-backed plan or write attempts

The sidecar must continue to expose logical session endpoints only:

- `GET /api/chatgpt-sidecar/s/:ticket/manifest`
- `POST /api/chatgpt-sidecar/s/:ticket/ask`
- `POST /api/chatgpt-sidecar/s/:ticket/plan`
- `POST /api/chatgpt-sidecar/s/:ticket/execute`
- `POST /api/chatgpt-sidecar/s/:ticket/datapoints`
- `POST /api/chatgpt-sidecar/s/:ticket/dossier`
- `GET /api/chatgpt-sidecar/s/:ticket/metering`

It must not expose raw OEO stores, downstream provider APIs, tenant identifiers, unrestricted Capability Broker internals or broad Cernion OpenAPI access.

## Routing Semantics

When ontology support is enabled and a request involves energy-sector roles, assets, processes, market communication, grid boundaries, metering, Redispatch, MaStR, VNB context, EDM/MaKo or dossier classification, the sidecar should route through ontology-backed Cernion context before final answer or execution planning.

The route should be:

```text
session ticket
  -> sidecar policy/session gate
  -> manifest capability allowlist
  -> ontology/OEO context where enabled and available
  -> Capability Broker / Blueprint / Knowledge RAG / evidence flow
  -> policy decision
  -> answer, plan, governed execution, datapoint or dossier output
```

Ontology/OEO context may inform routing and classification, but it must not become a policy bypass or an execution authority.

## Uncertainty Behavior

If no ontology/OEO evidence exists for a claim, the sidecar should make that explicit. It should prefer one of these outcomes over a generic confident assertion:

- return an unsupported ontology claim warning
- mark the concept as user-supplied or assumption-only
- request a narrower Cernion concept, asset, role or process boundary
- continue with non-ontology evidence while declaring the ontology gap
- block writes or classifications that require ontology-backed support

Prompt text must tell ChatGPT to avoid inventing unsupported Cernion/OEO concepts and to label uncertainty when the manifest or evidence does not support a term.

## Datapoints And Dossiers

Datapoints created through the sidecar must preserve tenant/user/session provenance from server-side state. For ontology-enabled flows, datapoint and dossier outputs should carry ontology-aligned classifications where feasible:

- ontology capability family used
- mapped Cernion concept or OEO IRI when available
- mapping source/version when available
- unsupported or assumption-only classification when no mapping exists
- policy result and write scope

These annotations must not leak credential material, raw provider request details or internal topology.

## Metering

Meter ontology/OEO guardrail usage from day one as a pricing and audit family. At minimum, record:

- ontology capability declared in manifest
- ontology-backed routing attempted
- ontology-backed routing used
- unsupported ontology claim returned
- ontology-aligned datapoint or dossier classification emitted
- ontology-related write blocked or downgraded
- mapping/version identifier when available

Metering summaries may aggregate these events, but internal events must remain detailed enough for audit and future pricing.

## Negative Tests Required Later

A future implementation slice should include tests for:

- manifest surfaces ontology capability only when enabled
- `ask`/`plan` routes sector concepts through ontology-backed context when available
- unsupported ontology claims are marked uncertain instead of asserted
- prompt text forbids invented Cernion/OEO terms
- datapoint/dossier outputs include ontology classifications only with evidence or an explicit unsupported marker
- ontology guardrail use increments metering
- writes requiring ontology support are blocked or downgraded when no ontology evidence exists
- no raw provider endpoint, credential, tenant ID or user ID leaks through prompt, manifest, outputs or metering

## Gate Decision

#388 is blocked for automatic coding-agent implementation until a Product Cut and threat/trust-boundary review approve a narrower slice. The issue currently spans session tickets, datasource-backed capabilities, writes, metering, tenant/user context and now ontology/OEO semantic guardrails. That combination changes policy and architecture boundaries and must not be treated as a direct Claude Code implementation handoff.
