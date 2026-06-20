# Energy Tax Information Packages

`energy_tax_information_package` is a read-only evidence contract for tax and finance data handovers. It does not calculate tax, approve a package, copy raw data, book finance values, or call external systems.

The first slice exposes `dashboard-api.energyTaxInformationPackageStatus` and `GET /api/dashboard/energy-tax-information-package` so Answer Dossier can reason over one package context through the standard Capability Broker and Hydration Registry path.

## Package Contract

Required evidence:

- `packageId` and `dataSourceId`
- `dictionaryVersion`
- `period` or `periodStart` / `periodEnd`
- `aggregationLogic`
- `validationStatus`
- `responsibleOwner`
- `contactRole`
- `sla`
- `auditReference`
- `handoverDecision`

Optional context:

- `evidenceStatus`
- `dataQualityStatus`
- `sourceRefs`

## Status Model

- `needs_dictionary`
- `needs_period`
- `needs_aggregation_logic`
- `needs_validation`
- `needs_owner_sla`
- `needs_audit_reference`
- `needs_handover_decision`
- `blocked_by_validation`
- `blocked_by_handover_decision`
- `ready_for_handover`

Every missing input is returned as a positive follow-up that states which dossier addition becomes possible once the input is provided.

## Safety Guards

The read-only path reports `sourceActions.notCalled` for tax calculation, authority submission, package release, raw-data copy, finance mutation, settlement, billing, MaKo, SAP, HITL, external connector, and Personal-Agent execution. These actions are not called by this capability and must not be added to the Hydration Registry rule.
