# Waermetransformation Linienasset Modell

## Use Case & Contract

- **Rolle:** Read-only dossier-safe Waermetransformation Line-Asset Evidence Gate.
- **Key Principle:** Reuse existing ZNP/datapoint/assets layers rather than creating new GIS databases, heat-network services, or automatic decommissioning engines.

## Technical Contract

- **Capability Key:** `heat_transformation_line_asset_model`
- **Evidence Registry Key:** `heat_transformation_line_asset_model`
- **Read-Only Action:** `dashboard-api.heatTransformationLineAssetModelStatus`
- **REST Path:** `GET /api/dashboard/heat-transformation-line-asset-model`
- **Dossier Hydration:** Allowlisted with `safety.readOnly: true`

## Inputs (Scalar / Query-Safe)

- `lineAssetId` (string, optional)
- `geometryRef` (string, optional)
- `connectedPointAssetIds` (string/array, optional)
- `division` (string, optional, defaults to 'Wärme')
- `networkCalculationRef` (string, optional)
- `dataQualityStatus` (string, optional)
- `transformationStatus` (string, optional)
- `futureOption` (string, optional)
- `investmentNeed` (number/string, optional)
- `owner` (string, optional)
- `nextDecision` (string, optional)
- `sourceRef` (comma-separated or array, optional)

## Outputs

Returns a deterministic status mapping, readiness score, normalized evidence items, missing evidence gaps, positive follow-ups, and strict `sourceActions.notCalled` side-effect guards.
