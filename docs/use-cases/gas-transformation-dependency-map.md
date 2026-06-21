# Gas- und Waermetransformation Abhaengigkeitslandkarte

## Use Case & Contract

- **Rolle:** Read-only dossier-safe Gas- und Waermetransformation Abhaengigkeitslandkarte Evidence Gate.
- **Key Principle:** Wiederverwendung und Dokumentation vor neuem Code. Die Gasnetztransformation-Abhaengigkeitslandkarte entsteht als Graph-/Recipe-Sicht auf vorhandene Transformations-, Asset-, Evidenz- und Governance-Bausteine ohne neue stateful Transformationsplattformen, Datenbanken, oder operational/transactional Mutationsworkflows.

## Technical Contract

- **Capability Key:** `gas_transformation_dependency_map`
- **Evidence Registry Key:** `gas_transformation_dependency_map`
- **Read-Only Action:** `dashboard-api.gasTransformationDependencyMapStatus`
- **REST Path:** `GET /api/dashboard/gas-transformation-dependency-map`
- **Dossier Hydration:** Allowlisted with `safety.readOnly: true`

## Inputs (Scalar / Query-Safe)

- `projectId` (string, optional)
- `division` (string, optional)
- `nodes` (comma-separated or array, optional)
- `dependencies` (comma-separated or array, optional)
- `dataQualityGaps` (comma-separated or array, optional)
- `investmentPaths` (comma-separated or array, optional)
- `decommissionRepurposePaths` (comma-separated or array, optional)
- `customerGroups` (comma-separated or array, optional)
- `owner` (string, optional)
- `nextAction` (string, optional)
- `sourceRef` (comma-separated or array, optional)

## Outputs

Returns a deterministic status mapping, readiness score, normalized evidence items, missing evidence gaps, positive follow-ups, and strict `sourceActions.notCalled` side-effect guards.
