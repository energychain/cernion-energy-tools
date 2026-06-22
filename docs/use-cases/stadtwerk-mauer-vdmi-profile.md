# Stadtwerk Mauer VDMI Profile

## Purpose

`stadtwerk_mauer_vdmi_profile` is the Phase-1 foundation slice for the agentic
Stadtwerk Mauer MVP from issue #262. It exposes a read-only, dossier-native
profile for the municipality Mauer, postcode `69256`, and the sparten Strom,
Gas, Wasser, and Waerme.

The capability freezes the organizational and evidence map that later Eve or
sidecar agent directories can consume. It does not implement an Eve runtime,
agent execution, tenant provisioning, or a new role-to-capability registry.

## Scope

- Tenant/profile: `stadtwerk-mauer`.
- Region: Mauer, `69256`, Germany.
- Sparten: Strom, Gas, Wasser, Waerme.
- Market and internal roles: VNB, MSB, LF, BKV/Bilanzkreismanagement,
  ESA/Einsatz-/Steuerungsverantwortung, EDM, MaKo, Billing, Asset Management,
  Regulierung, Management, Beschaffung, Erzeugungsplanung, Netzplanung, and
  Netzbetrieb.
- VDMI view: responsibility, involvement, decision boundary, evidence needs,
  evidence gaps, and positive follow-ups.

## API

Read-only dashboard action:

```text
dashboard-api.stadtwerkMauerVdmiProfileStatus
```

REST route:

```text
GET /api/dashboard/stadtwerk-mauer-vdmi-profile
```

Optional query parameters:

- `tenantId`
- `includeRoles`
- `includeEvidenceGaps`
- `focusSparte`
- `demoQuestion`

## Out Of Scope

- No Eve runtime, scheduler, channels, approvals, subagents, or generated agent
  execution.
- No tenant, user, or token creation.
- No file-system agent directory deployment.
- No task, workflow, notification, HITL, NOVA, or VDMI mutation.
- No external connector, productive write action, or Personal-Agent hardcoding.
- No broad UI or cockpit.

## Dossier Behavior

The endpoint answers even with partial evidence. Missing facts are surfaced as
positive follow-ups, for example:

- missing sparte-specific asset facts -> add a more precise asset and
  network-risk section
- missing MaKo / EDM evidence -> add market-communication and data-quality risk
  assessment
- missing Billing / BKV evidence -> add settlement, procurement, and balancing
  impact assessment
- missing role owner confirmation -> add accountable VDMI owner and escalation
  boundary
- missing capability projection -> enable the Phase-2 Eve-compatible capability
  projection

## Demo Question

```text
Welche Transformations- und Netzrisiken hat Stadtwerk Mauer fuer Strom, Gas,
Wasser und Waerme, und welche Rollen muessen als naechstes Evidenz liefern?
```

The Phase-1 answer is intentionally a profile and evidence map, not an executed
multi-agent run.
