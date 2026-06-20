# Legacy Control Technology Transition

Issue #175 is implemented as a read-only evidence gate for legacy Rundsteuertechnik and Gruppensignal transition logic.

The first slice does not model or execute a Steuerbox, CLS, SMGW or device-control path. It separates the evidence needed for an audit-ready transition decision:

- `assetGroupId` / `assetId`
- `powerClass`
- `controlTechnology`
- `feedbackCapability`
- `switchingRisk`
- `testFeasibility`
- `testStatus`
- `nonExecutionReason`
- `targetTechnology`
- `migrationRoadmap`
- `owner`
- `nextAction`
- `sourceEvidenceRefs`

The API surface is `GET /api/dashboard/legacy-control-technology-transition`, backed by `dashboard-api.legacyControlTechnologyTransitionStatus`.

The response is dossier-native and includes `controlReadiness`, `transitionStatus`, missing evidence, positive follow-ups and `sourceActions.notCalled` guards. Missing feedback capability or missing testability never becomes a blanket Steuerbarkeit claim; it remains an explicit gap or roadmap-only state.

Out of scope: grid-control execution, CLS/SMGW/device actions, HITL creation, settlement, MaKo, billing, external connectors, new Asset-MDM persistence, Personal-Agent shortcuts and broad cockpit UI.
