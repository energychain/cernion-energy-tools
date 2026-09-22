# CET RC2 UI — Spec B Frontend Shared Functions / Framework

Status: Phase B fortgesetzt (lokal, Branch `feat/cet-release-rc2-ui`). Die UI-Struktur folgt jetzt dem geplanten Vite/React/TypeScript-Schnitt; Shared Functions, Prominence/Audit-Hooks und der Vite-Build sind verifiziert.

## Zweck

Phase B stellt eine gemeinsame Frontend-Bibliothek und App-Shell bereit. Seiten und Komponenten dürfen Fachregeln nicht direkt nachbauen, sondern nutzen Shared Functions für API-Zugriff, Contract-Validierung, Projektion, Rollen-/Tenant-Grenzen, Wording, Prominence, Audit und Evidenzverhalten.

## App-Framework-Struktur

### `apps/cet-ui/package.json`

Framework-Entscheidung:

- Vite als Build-Tool.
- React als UI-Schicht.
- TypeScript für App-Shell und kommende sichtbare Komponenten.
- `type: commonjs` bleibt bewusst erhalten, damit bestehende Node/Jest-CommonJS-Shared-Functions im CET-Repository weiter stabil laufen.

Skripte:

- `npm --prefix apps/cet-ui run check`
  - `tsc --noEmit`
  - Syntaxchecks für bestehende CommonJS Shared Modules
  - Strukturcheck der Vite/React/TypeScript-App-Shell
- `npm --prefix apps/cet-ui run build`
  - `check`
  - `vite build`
  - Build-Artefaktprüfung

### `apps/cet-ui/src/main.tsx`

Mountet die React-App deterministisch in `#root`. Es gibt keinen produktiven Legacy-`main.js`-Einstieg mehr.

### `apps/cet-ui/src/App.tsx`

Implementiert die RC2-App-Shell in React/TypeScript:

- Tagesfläche
- Vorgangsansicht
- Nachweisansicht
- Operationskonsole
- REST-only Client gegen `/api/ui/v0/...`
- Audit-Nutzung über `/api/ui/v0/audit-events`
- Nicht-projizierte Operationsantworten mit Badge `Nicht projiziert`, ohne Evidence-/Aggregatsemantik
- Schreibaktionen nur gegen CET-eigenen UI-Gateway-Zustand: Claim, Freeze, Freigabeanforderung

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
  - `recordAudit(payload)`

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
- Es gibt keine externen Fachsystem-Writes; Write-Aktionen bleiben CET-eigene Laufkarten-/Nachweis-/Freigabezustände.

## Tests

Phase B wird abgesichert durch:

- `tests/cet-ui-rc2.phase-b-shared-functions.test.js`
- `tests/cet-ui-rc2.phase-b-prominence-audit.test.js`
- `tests/cet-ui-rc2.vite-react-typescript.test.js`
- `tests/cet-ui-rc2.browser-smoke.test.js`
- bestehende View-Model-/Feinkonzept-Alignment-Tests:
  - `tests/cet-rc2-ui-view-model.test.js`
  - `tests/cet-ui-rc2.feinkonzept-alignment.test.js`

## Vite-App-Verifikation

`apps/cet-ui/scripts/verify-static-app.js` ist jetzt der Struktur- und Build-Artefaktcheck für die Vite/React/TypeScript-App-Shell. Der Check prüft:

- `index.html` mit React-Root und Modul-Einstieg `/src/main.tsx`
- `vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/App.tsx`
- Feinkonzept-Marker in der App-Shell
- nach `vite build`: `dist/index.html` und gebündelte Assets

Der browsernahe Smoke-Test prüft die REST-Gateway-Verdrahtung statisch gegen die React-App-Shell:

- Session-/Mandanten-/Rollenanzeige.
- Top-Level-Flächen `Heute`, `Vorgang`, `Nachweise`, `Konsole` über die App-Shell.
- Referenzfluss `claim → freeze → approval request → evidence`.
- Operationskonsole mit nicht-projiziertem JSON ohne Evidence-Semantik.

## Nächster Schritt nach Phase B-Fortsetzung

Phase B ist nach dem Wechsel auf Vite/React/TypeScript deutlich näher am Abschluss. Offen vor Phase-C/D-Abnahme:

- externer Review des Phase-B-Abschlusses gegen Feinkonzept.
- optionaler HTTP-Smoke gegen laufenden Gateway, falls lokal ein CET-Server in einem freigegebenen Workflow gestartet oder eine Dev-Instanz genutzt wird.
- weitere Accessibility-/Mobile-Prominence-Checks für die kommenden Display-Elemente aus Phase C.
