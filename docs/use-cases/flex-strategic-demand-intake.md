# Flex Strategic Demand Intake

`flex_strategic_demand_intake` is a read-only evidence capability for strategic Flexibilisierung and Fahrplanmanagement demand registration. It turns a technical idea into dossier-safe management facts: demand topic, affected process, risk of inaction, commercial question, resource conflict, stop-doing option, owner, next decision gate, blocked follow-up and source references.

## Contract

- Capability key: `flex_strategic_demand_intake`
- Evidence registry key: `flex_strategic_demand_intake`
- Read-only action: `dashboard-api.flexStrategicDemandIntakeStatus`
- REST route: `GET /api/dashboard/flex-strategic-demand-intake`
- Dossier hydration: allowlisted through `dashboard-api.flexStrategicDemandIntakeStatus`

## Inputs

- `demandId` or `caseId`
- `topic` or `demandTopic`
- `affectedProcess`
- `riskOfInaction`
- `commercialQuestion`
- `resourceConflict`
- `stopDoingOption`
- `owner`
- `nextDecisionGate`
- `blockedFollowUp`
- `sourceRef`
- optional context labels: `flexContext`, `znpContext`, `novaContext`, `financeContext`, `vdmiContext`

## Safety

The capability is an evidence/status contract only. It does not create VDMI cards, HITL tickets, NOVA decisions, finance records, tariffs, settlement records, device-control actions, external connector calls or Personal-Agent execution state.

Flex, ZNP, NOVA, Finance and VDMI are referenced as evidence/context sources. They are not mutated by dossier hydration.

