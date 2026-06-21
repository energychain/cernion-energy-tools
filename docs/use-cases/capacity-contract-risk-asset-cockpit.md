# Capacity & Contract Risk Asset Cockpit

## Use Case & Contract

- **Rolle:** Read-only dossier-safe Capacity and Contract Risk Asset Cockpit.
- **Key Principle:** Reuse existing technical capacity checks, network calculation, financial analysis, asset context, and VDMI governance layers rather than implementing a new risk/contract database or automatic approvals.

## Technical Contract

- **Capability Key:** `capacity_contract_risk_asset_cockpit`
- **Evidence Registry Key:** `capacity_contract_risk_asset_cockpit`
- **Read-Only Action:** `dashboard-api.capacityContractRiskAssetCockpitStatus`
- **REST Path:** `GET /api/dashboard/capacity-contract-risk-asset-cockpit`
- **Dossier Hydration:** Allowlisted with `safety.readOnly: true`

## Inputs (Scalar / Query-Safe)

- `gridOperatorId` (string, required)
- `utilization` (number, optional)
- `bottleneck` (string, optional)
- `firmCapacityKW` (number, optional)
- `flexibleCapacityKW` (number, optional)
- `contractStatus` (string, optional)
- `legalStatus` (string, optional)
- `altvereinbarung` (boolean, optional)
- `capex` (number, optional)
- `opex` (number, optional)
- `priority` (string, optional)
- `owner` (string, optional)
- `nextAction` (string, optional)
- `forecast` (boolean, optional)
- `date` (string, optional)
- `sourceRef` (comma-separated or array, optional)

## Outputs

Returns a deterministic status mapping, readiness score, normalized evidence items, missing evidence gaps, positive follow-ups, and strict `sourceActions.notCalled` side-effect guards.
