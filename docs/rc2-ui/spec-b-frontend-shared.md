# CET RC2 UI — Spec B Frontend Shared Functions / Framework

Status: Phase B begonnen (lokal, Branch `feat/cet-release-rc2-ui`).

## Zweck

Phase B stellt eine gemeinsame Frontend-Bibliothek bereit. Seiten und Komponenten dürfen Fachregeln nicht direkt nachbauen, sondern nutzen Shared Functions für API-Zugriff, Contract-Validierung, Projektion, Rollen-/Tenant-Grenzen, Wording und Evidenzverhalten.

## Implementierte Shared-Module

### `apps/cet-ui/src/shared/api-client.js`

Funktionen:

- `normalizeApiBaseUrl(baseUrl)`
- `classifyApiError(error)`
- `createApiClient(config)`
- Client-Methoden:
  - `getSessionContext()`
  - `getDailySurface()` / `getToday()`
  - `getCase(id)` / `getVorgang(id)`
  - `getEvidenceDossier(id)`
  - `claimCase(id, basisRev)` / Gateway-Claim
  - `freezeCase(id, payload)`
  - `requestApproval(id, payload)`
  - `listOperations()`
  - `runOperation(operationId, payload)` / Gateway-Prepare

### `apps/cet-ui/src/shared/contract-validators.js`

Funktionen:

- `validatePresentationContract(contract)`
- `validateStatement(statement)`
- `assertGranularitaet(statement)`
- `getRenderableStatements(contract)`
- `getBoundaryItems(element)`
- `getGrammarParts(contract)`

### `apps/cet-ui/src/shared/projection-helpers.js`

Funktionen:

- `isProjected(result)`
- `toProjectedRenderModel(result)`
- `toNotProjectedRenderModel(result)`
- `assertNoEvidenceSemanticsForRawJson(model)`

### `apps/cet-ui/src/shared/role-tenant-helpers.js`

Funktionen:

- `getActiveRole(session)`
- `listSwitchableRoles(session)`
- `canSwitchToRole(session, roleId)`
- `renderRoleActor(actor)`
- `isPlaceholderAgent(actor)`
- `filterActionsByRole(actions, activeRole)`

### `apps/cet-ui/src/shared/wording-helpers.js`

Funktionen:

- `labelAggregationState(state)`
- `labelSourceClass(sourceClass)`
- `labelProjectionStatus(status)`
- `formatApprovalStatus(status)`
- `formatVisibleNoAction(actor)`
- `checkForbiddenUserText(text)`

### `apps/cet-ui/src/shared/evidence-helpers.js`

Funktionen:

- `getEvidenceLevel(statement)`
- `formatSourceAge(source)`
- `getReproducibilityStatus(statement)`
- `shouldMaterializeStatement(statement)`

## Feinkonzept-Grenzen

- User-facing Wording nutzt `Vorgang`; technische Begriffe werden über `checkForbiddenUserText()` blockiert.
- Nicht-projiziertes JSON erhält kein `aggregationState` und keine EvidenceMarker-Semantik.
- Rollenwechsel basiert nur auf Rollen, die im aktiven Mandanten verfügbar sind.
- `einzeldatensatz` wird nicht materialisiert.
- API-Aufrufe laufen gegen `/api/ui/v0/...`, nicht direkt gegen Moleculer Actions.

## Tests

Phase B wird begonnen durch:

- `tests/cet-ui-rc2.phase-b-shared-functions.test.js`
- bestehende View-Model-/Feinkonzept-Alignment-Tests:
  - `tests/cet-rc2-ui-view-model.test.js`
  - `tests/cet-ui-rc2.feinkonzept-alignment.test.js`

## Nächster Schritt nach Phase B-Start

Phase B muss noch weiter ausgebaut werden, bevor Phase C/D als UAT-Oberfläche bewertet werden:

- `vite.config` / Build-Integration oder bewusste statische No-Build-Entscheidung finalisieren.
- Shared Functions in App-Shell verdrahten, nicht nur parallel bereitstellen.
- Weitere Tests für Fehlerzustände, mobile prominence und accessibility ergänzen.
