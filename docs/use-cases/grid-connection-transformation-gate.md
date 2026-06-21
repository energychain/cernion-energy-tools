# Netzanschlusspunkt Transformations Gate

## Use Case & Contract

- **Rolle:** Read-only dossier-safe Netzanschlusspunkt Transformations Gate Evidence Gate.
- **Key Principle:** Wiederverwendung und Dokumentation vor neuem Code. Das Netzanschlusspunkt Transformations Gate entsteht als status- und evidenzbasierte Sicht auf vorhandene Netzanschluss-, NAP-, Asset-, ZNP- und Governance-Signale ohne neue stateful Netzanschlussdatenbanken, Mappingplattformen oder transaktionale Mutations- und Freigabeworkflows.

## Technical Contract

- **Capability Key:** `grid_connection_transformation_gate`
- **Evidence Registry Key:** `grid_connection_transformation_gate`
- **Read-Only Action:** `dashboard-api.gridConnectionTransformationGateStatus`
- **REST Path:** `GET /api/dashboard/grid-connection-transformation-gate`
- **Dossier Hydration:** Allowlisted with `safety.readOnly: true`

## Inputs (Scalar / Query-Safe)

- `meteringPointId` (string, optional)
- `division` (string, optional - e.g. Gas, Strom, Waerme)
- `transformationOption` (string, optional - e.g. h2_ready, electrification, hybrid, decommission)
- `dataQualityStatus` (string, optional - e.g. verified, incomplete, missing)
- `investmentPath` (string, optional - e.g. capex_approved, budget_needed)
- `decommissionPath` (string, optional - e.g. 2035_shut_down, repurpose)
- `owner` (string, optional - e.g. Netznutzung, Assetmanagement)
- `nextAction` (string, optional)
- `sourceRef` (comma-separated or array, optional)

## Outputs

Returns a deterministic status mapping (`gateStatus`), readiness score, normalized evidence items, missing evidence gaps, positive follow-ups, and strict `sourceActions.notCalled` side-effect guards.
