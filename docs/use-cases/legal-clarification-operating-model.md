# Legal Clarification Operating Model

## Purpose

The `legal_clarification_operating_model` capability keeps VNB operational preparation moving while an external legal clarification is still pending. It separates the legal question from no-regret data collection, ownership, scenario preparation, red lines and implementation readiness.

## Product Cut

The first slice is a read-only dashboard/API status projection:

- `dashboard-api.legalClarificationOperatingModelStatus`
- `GET /api/dashboard/legal-clarification-operating-model`
- Capability Broker route: `legal_clarification_operating_model`
- Hydration Registry action: read-only allowlisted formatter for Slim Answer Dossier

The status is derived from request input and existing platform evidence concepts. It does not create a legal workflow or persist legal answers.

## Safety Boundary

`legalStatus: pending` is always treated as an execution blocker, not as approval.

The capability must not call or trigger:

- legal interpretation or approval
- contract release
- dispatch, grid-control or device-control execution
- billing, settlement, tariff or MaKo mutation
- HITL creation
- external connectors
- Personal-Agent special routing

## Dossier Evidence

The slim evidence view exposes:

- clarification point and affected decision
- legal status and decision readiness
- no-regret data needs and available evidence
- owner/contact gaps
- scenario options and red lines
- implementation status
- positive follow-ups for every missing input
- explicit `sourceActions.notCalled` side-effect guards
