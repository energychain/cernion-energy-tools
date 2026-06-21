# Metering Rollout Process Indicator

`metering_rollout_process_indicator` is a read-only Wave-2 evidence capability for spartenuebergreifende Zaehl-/Rolloutkennzahlen. It turns supplied monthly KPI facts into dossier-safe process evidence: division, source type, Soll/Ist, backlog, data-quality status, contractor load, CAPEX/OPEX indication, owner, next steering step, blocked follow-up and source references.

## Contract

- Capability key: `metering_rollout_process_indicator`
- Evidence registry key: `metering_rollout_process_indicator`
- Read-only action: `dashboard-api.meteringRolloutProcessIndicatorStatus`
- REST path: `GET /api/dashboard/metering-rollout-process-indicator`
- Dossier hydration: allowlisted through `dashboard-api.meteringRolloutProcessIndicatorStatus`

## In Scope

- Normalize caller-provided metering/rollout facts into a deterministic status.
- Derive `backlogCount` and `backlogRate` when Soll/Ist values are supplied.
- Expose missing evidence and positive follow-ups for Answer Dossier.
- Route Zaehlwechsel, Rollout, Messstellenbetrieb, Soll/Ist, Rueckstand, Datenqualitaet and Dienstleisterlast prompts through Capability Broker.

## Out Of Scope

- No new metering KPI engine or persistence.
- No datasource refresh/query execution from dossier hydration.
- No EDM import, HITL creation, finance/CAPEX mutation, billing, settlement, tariff or device-control effect.
- No external connector and no Personal-Agent hardcoding.
