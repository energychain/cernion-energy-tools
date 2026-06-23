# Energy-Sharing Simulation Gate

Capability key: `energy_sharing_simulation_gate`

The first slice exposes `dashboard-api.energySharingSimulationGateStatus` via `GET /api/dashboard/energy-sharing-simulation-gate`. It is a read-only evidence gate for Energy-Sharing candidates before operational rollout.

The gate classifies supplied project context as `learning_pilot`, `simulation_ready`, `billing_near_ready`, or blocked by missing participant, MaLo/metering, market-role, settlement/A96, contract, economics, or owner evidence.

## Boundary

In scope:

- Community and grid-operator identity.
- Participant and MaLo/metering readiness references.
- Forecast versus inhouse/iMSys data basis.
- Market-role, settlement/A96, contract, economics, owner and source-artifact references.
- Slim dossier facts, missing evidence and positive follow-ups.

Out of scope:

- A second Energy-Sharing validation engine.
- A second allocation or simulation engine.
- Persistent Energy-Sharing project backend.
- Settlement/A96 export, MaKo dispatch, billing release, tariff mutation, HITL creation, customer communication, external connectors or Personal Agent shortcuts.

Forecast or synthetic data can support a learning pilot or simulation statement. It must not be treated as billing-ready without inhouse/iMSys, settlement and A96 evidence.
