# Steuerbarkeitscheck Data Alignment

## Purpose

`controllability_data_alignment` is a read-only evidence gate for recurring VNB Steuerbarkeitscheck and Redispatch checklist reconciliation.

The first slice turns supplied or anonymized checklist facts into a deterministic dossier view:

- external checklist reference
- asset, MaStR and internal master-data match status
- control technology status
- threshold classification
- testability or non-testability rationale
- exception or risk reason
- prior-year comparison
- owner and due date
- evidence package/export readiness

## Surfaces

- Dashboard action: `dashboard-api.controllabilityDataAlignmentStatus`
- REST: `GET /api/dashboard/controllability-data-alignment`
- Capability: `controllability_data_alignment`
- Evidence Registry key: `controllability_data_alignment`
- Hydration action: `dashboard-api.controllabilityDataAlignmentStatus`

## Safety Boundary

This use case is read-only and non-consequential. It does not import files, parse Excel, persist Asset-MDM data, call live MaStR/CLS/SMGW connectors, execute technical tests, create HITL tasks, trigger MaKo, billing, settlement, tariff or device-control actions, call external connectors, or hardcode Personal-Agent behavior.

The output is evidence readiness and gap guidance only. It is not a legal or regulatory certification.
