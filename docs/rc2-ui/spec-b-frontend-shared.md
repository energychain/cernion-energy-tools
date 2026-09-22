# CET RC2 UI — Spec B Frontend Shared Functions / Framework

Status: Phase B fortgesetzt (lokal, Branch `feat/cet-release-rc2-ui`). Shared Functions sind implementiert, Static-App-Build ist verifiziert, und ein browsernaher Smoke-Test deckt den Referenzfluss ab.

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

### `apps/cet-ui/src/shared/prominence-helpers.js`

Funktionen:

- `resolveProminence(item)`
- `sortAttentionItems(items)`
- `groupAttentionItems(items)`
- `canCollapseCriterion(criterion)`
- `explainBundle(group)`

Feinkonzept-Regeln:

- Fristkritische Vorgänge erhalten höhere Prominence.
- Bündelung erfolgt nur bei identischem Aufmerksamkeitsgrund und identischem Beitragstyp.
- Kriterien mit `nicht_anwendbar` dürfen eingeklappt werden; offene/erfüllte Kriterien nicht.

### `apps/cet-ui/src/shared/audit-hooks.js`

Funktionen:

- `recordViewOpened(apiClient, context)`
- `recordOperationConsoleUse(apiClient, context)`
- `recordContractRenderError(apiClient, context)`
- `recordBoundaryShown(apiClient, context)`

Regel: Audit-Hooks nutzen `apiClient.recordAudit()` und damit UI-Gateway-Transport, keine externe Telemetrie.

## Feinkonzept-Grenzen

- User-facing Wording nutzt `Vorgang`; technische Begriffe werden über `checkForbiddenUserText()` blockiert.
- Nicht-projiziertes JSON erhält kein `aggregationState` und keine EvidenceMarker-Semantik.
- Rollenwechsel basiert nur auf Rollen, die im aktiven Mandanten verfügbar sind.
- `einzeldatensatz` wird nicht materialisiert.
- API-Aufrufe laufen gegen `/api/ui/v0/...`, nicht direkt gegen Moleculer Actions.

## Tests

Phase B wird abgesichert durch:

- `tests/cet-ui-rc2.phase-b-shared-functions.test.js`
- `tests/cet-ui-rc2.phase-b-prominence-audit.test.js`
- `tests/cet-ui-rc2.browser-smoke.test.js`
- bestehende View-Model-/Feinkonzept-Alignment-Tests:
  - `tests/cet-rc2-ui-view-model.test.js`
  - `tests/cet-ui-rc2.feinkonzept-alignment.test.js`

## Static-App-Verifikation

`apps/cet-ui/scripts/verify-static-app.js` ist der bewusste Phase-B-Ersatz für eine schwere Frontend-Bundler-Integration. Der Check prüft die statisch ausgelieferte App-Shell, JavaScript-/CSS-Assets und erzeugt `apps/cet-ui/dist` als verifizierten lokalen Bundle-Ausgabepfad.

Der browsernahe Smoke-Test lädt `apps/cet-ui/src/main.js` in einem isolierten Fake-Browser-Kontext mit echten Gateway-Referenzantworten und prüft:

- Session-/Mandanten-/Rollenanzeige.
- Top-Level-Flächen `Heute`, `Vorgang`, `Nachweise`, `Konsole` über die App-Shell.
- Referenzfluss `claim → freeze → approval request → evidence`.
- Operationskonsole mit nicht-projiziertem JSON ohne Evidence-Semantik.

## Nächster Schritt nach Phase B-Fortsetzung

Phase B ist deutlich näher am Abschluss, bleibt aber vor Phase-C/D-Abnahme noch offen für:

- optionalen echten HTTP-Smoke gegen laufenden Gateway, falls lokal ein CET-Server in einem freigegebenen Workflow gestartet oder eine Dev-Instanz genutzt wird.
- Entscheidung, ob die Phase-B App-Shell weiterhin bewusst statisch/no-bundler bleibt oder vor Phase C/D auf Vite gehoben wird.
- weitere Accessibility-/Mobile-Prominence-Checks für die kommenden Display-Elemente aus Phase C.
