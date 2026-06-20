# Off-Balancing Metering Pruefmatrix

## Product Cut

`off_balancing_metering_pruefmatrix` is a read-only evidence gate for VNB teams that need to decide whether an external metering financing or off-balancing option is actually committee-ready.

The first slice is not a financing engine, accounting opinion, legal authority, SAP workflow, settlement release or cockpit UI. It produces dossier-safe status evidence over:

- metering scope and financing model
- CAPEX/OPEX baseline
- EOG or regulatory-effect evidence
- cost-recognition assumption
- financier conditions
- data-quality and interface-risk status
- proof that apparent budget relief creates usable electricity-grid investment headroom

## Capability Contract

- Service action: `dashboard-api.offBalancingMeteringPruefmatrixStatus`
- REST route: `GET /api/dashboard/off-balancing-metering-pruefmatrix`
- Capability key: `off_balancing_metering_pruefmatrix`
- Safety: `read_only`
- Hydration: allowlisted through the dossier hydration registry with a slim evidence formatter

## Decision Semantics

The status remains blocked when the option only shows apparent budget relief. A dossier may say that the option is committee-ready only when the grid-investment-space proof is present and does not mark the headroom as blocked, unproven or not usable.

Missing evidence is expressed as positive follow-ups. For example, missing financier conditions enable covenant and exit-condition assessment; missing EOG evidence enables regulatory-effect plausibility; missing grid-investment proof enables a usable-headroom verdict.

## Out Of Scope

- new `off-balancing.service.js`
- automatic balance-sheet, accounting or legal decision
- Finance, SAP, Investment, Settlement, Billing or MaKo mutation
- HITL creation from the read-only path
- external connector or secret/key handling
- Personal-Agent hardcoding
