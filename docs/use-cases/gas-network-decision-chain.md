# Gas Network Decision Chain

## Purpose

`gas_network_decision_chain` is a read-only, dossier-native management evidence projection for gas network decisions. It joins caller-supplied references for capacity assumptions, decommissioning or reuse path, KANU/EOG/regulatory impact, asset/book-value provenance, Fotojahr window, owner, blocked follow-up decision and next evidence step into one reviewable Answer Dossier slice.

The first implementation is intentionally not a second gas-network service. It reuses existing Cernion context surfaces such as `gasnetz-waermeplanung`, `decision-frame`, `assets.effective`, EOG/KANU references and VDMI dossiers as evidence references.

## API

- Moleculer action: `dashboard-api.gasNetworkDecisionChainStatus`
- REST route: `GET /api/dashboard/gas-network-decision-chain`
- Capability key: `gas_network_decision_chain`
- Safety: `read_only`

Important query fields:

- `chainId`, `gridOperatorId`, `reconciliationId`, `segmentId`
- `capacityAssumption`, `capacityEvidenceRef`
- `decommissioningPath`, `decommissioningEvidenceRef`
- `regulatoryImpactRef`, `eogRef`, `kanuRef`
- `assetRef`, `bookValueRef`
- `photoYear`, `decisionDeadline`
- `ownerRole`, `owner`
- `blockedFollowUpDecision`, `nextEvidenceStep`, `sourceRefs`

## Output Contract

The action returns deterministic management evidence:

- normalized chain scope
- status and readiness score
- present evidence groups
- missing evidence and positive follow-ups
- source references and source-action guards
- slim dossier evidence for Hydration Registry consumption

## Out Of Scope

This capability does not calculate gas-flow, thermodynamic, KANU, EOG, asset valuation or Fotojahr outcomes. It does not persist gas strategy chains, create book-value records, execute capacity booking, stilllegung, investment approval, Asset-MDM override, HITL, notification, billing, settlement, tariff, MaKo, contract, device-control, external connector or Personal-Agent actions.

Consequential decisions remain outside this read-only evidence projection.
