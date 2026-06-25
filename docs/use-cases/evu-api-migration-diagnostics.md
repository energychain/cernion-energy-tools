# EVU API Migration Diagnostics

## Purpose

`evu_api_migration_diagnostics` is a read-only evidence/gate slice for EVU and VNB API migrations. It turns operator-supplied observations into dossier-ready facts about the affected business process, endpoint, method, auth scope, data context, request shape, validation error, response code, completion criterion, owner and next step.

## Boundary

The first slice is exposed through:

- `dashboard-api.evuApiMigrationDiagnosticsStatus`
- `GET /api/dashboard/evu-api-migration-diagnostics`
- Capability Broker key `evu_api_migration_diagnostics`
- Answer Dossier hydration action `dashboard-api.evuApiMigrationDiagnosticsStatus`

## Safety

The safety classification is `read_only_diagnostics`. The slice does not call external endpoints, run OAuth flows, read secrets, execute JSON Patch, retry requests, close migration tasks, create HITL items, or trigger MaKo, billing, settlement or tariff actions.

## Dossier Facts

The dossier evidence summarizes status, evidence completeness, business process, endpoint/method, auth scope, data context, completion criterion, owner, next 90-day step, missing evidence and explicit side-effect guards.
