# iMSys TAF2 Compliance Status

## Use Case & Contract

- **Rolle:** Read-only dossier-safe iMSys TAF2 Compliance Evidence Gate.
- **Key Principle:** Reuse existing EDM/datapoint/validation/finance layers rather than creating new SMGW/meter databases, hardware control services, or automatic billing engines.

## Technical Contract

- **Capability Key:** `imsys_taf2_compliance_status`
- **Evidence Registry Key:** `imsys_taf2_compliance_status`
- **Read-Only Action:** `dashboard-api.imsysTaf2ComplianceStatus`
- **REST Path:** `GET /api/dashboard/imsys-taf2-compliance`
- **Dossier Hydration:** Allowlisted with `safety.readOnly: true`

## Inputs (Scalar / Query-Safe)

- `meteringPointId` (string, required)
- `taf2Obligation` (boolean, optional)
- `targetDeadline` (string, optional)
- `tariffModel` (string, optional)
- `implementationStatus` (string, optional)
- `measuredValueAccess` (string, optional)
- `owner` (string, optional)
- `nextAction` (string, optional)
- `sourceRef` (comma-separated or array, optional)

## Outputs

Returns a deterministic status mapping, readiness score, normalized evidence items, missing evidence gaps, positive follow-ups, and strict `sourceActions.notCalled` side-effect guards.
