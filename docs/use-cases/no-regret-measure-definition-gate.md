# No-Regret Massnahmen Definitionsgate

## Capability

- Capability key: `no_regret_measure_definition_gate`
- Dashboard action: `dashboard-api.noRegretMeasureDefinitionGateStatus`
- REST route: `GET /api/dashboard/no-regret-measure-definition-gate`
- Evidence key: `no_regret_measure_definition_gate`
- Safety: read-only, non-consequential

## Purpose

This gate checks whether a claimed No-Regret measure has a shared definition across transformation scenario, budget effect, regulatory fit, prioritisation, data quality, communication rule, and next review gate.

It is an evidence contract for dossiers and management review. It is not a measure approval workflow.

## Inputs

- `measureId`, `programmeId`, `measureName`
- `scenarioAssumption`, `transformationEffect`
- `budgetEffect`, `fundingOwner`
- `regulatoryFit`, `constraintHint`
- `prioritisationRule`, `nominationRight`
- `dataQualityStatus`, `sourceSnapshot`
- `communicationRule`, `stakeholderGroup`
- `nextReviewGate`, `dueDate`, `owner`
- `sourceDatapoints`, `sourceActions`

## Output

The response returns deterministic dossier-safe facts:

- status and readiness score
- missing evidence and positive follow-ups
- measure/programme identity
- definition evidence groups
- source datapoints/actions
- side-effect flags proving no approval, HITL, settlement, billing, tariff, device-control or external connector action occurred

## Out Of Scope

- no transformation-program backend or persistence
- no measure, budget, Treasury, finance or accounting approval
- no MaKo/A96, settlement, tariff, billing or device-control effect
- no HITL side effect
- no external connector
- no Personal-Agent hardcoding
- no broad cockpit UI
