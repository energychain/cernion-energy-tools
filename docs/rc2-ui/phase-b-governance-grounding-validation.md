# CET RC2 UI — Phase B Governance-/Prozesswissen-Grounding

> **Status:** current grounding validation before Phase C
>
> **Branch:** `feat/cet-release-rc2-ui`
>
> **Date:** 2026-09-22
>
> **Scope:** Validate the implemented Phase B frontend framework against the process and Governance Architecture knowledge base before specifying reusable Phase C display elements.

## 1. Sources used

### OpenClaw/Qdrant recall

- OpenClaw Knowledge recall route: `llm_wiki_qdrant`, `openclaw_agent_memory`, `hermes_sessions`, `openclaw_state`, `workspace_files`, `qdrant_rhajaina`.
- Query: `CET RC2 UI Governance Architektur Prozesswissen Phase B Phase C Präsentationsvertrag Rollen Mandant Evidence Freigabe Operationskonsole`.
- Relevant Qdrant-backed result opened: `okr_ae7f02dbbc58f628` (`entities/cernion-energy-tools.md`).
- The Qdrant entity is a medium-confidence curated index node, not the canonical spec by itself. It points to the relevant RC2 Nextcloud sources under `groupfolders/11/Cernion/Governance-Decision-Architecture/Release-Change/RC2/...`.

### Authoritative working artifacts opened from Nextcloud

- `03 Projekte/Cernion/Governance-Decision-Architecture/Release-Change/RC2/cet-rc2-ux-ui-feinkonzept.md`
- `03 Projekte/Cernion/Governance-Decision-Architecture/Release-Change/RC2/cet-rc2-ux-ui-spezifikationsschnitt.md`
- `03 Projekte/Cernion/Governance-Decision-Architecture/Release-Change/RC2/cet-rc2-detailplanung-vor-umsetzung.md`

### Current repository artifacts checked

- `docs/rc2-ui/spec-b-frontend-shared.md`
- `apps/cet-ui/src/App.tsx`
- `apps/cet-ui/src/shared/*.js`
- `src/cet-ui-rc2/*`
- `services/cet-ui.service.js`
- `tests/cet-ui-rc2.phase-b-shared-functions.test.js`
- `tests/cet-ui-rc2.feinkonzept-alignment.test.js`
- `tests/cet-ui-rc2.http-smoke.test.js`

## 2. Grounding baseline extracted from process/governance architecture

Phase C must build display elements on these active rules:

1. **REST-gateway boundary:** UI speaks only `/api/ui/v0/...`; no direct Moleculer calls from the browser.
2. **Deterministic renderer:** no pattern generation and no hidden Fachsystem execution in RC2.
3. **Tenant/role boundary:** all UI reads and CET-internal writes carry tenant, authenticated user/agent, active role and logging context.
4. **Role model:** a user can hold multiple tenant roles; placeholder agents may serve unstaffed roles under the same tenant/role/logging constraints.
5. **User-facing vocabulary:** primary UI uses `Vorgang`; system words such as `Laufkarte`, `Präsentationsvertrag`, `Schnittplan`, `Situationsschlüssel`, `Vertragsdeklaration`, `Render-Gate`, `zur Kenntnis genommen` and `Next Best Action` must not leak into primary UI copy.
6. **Five grammar parts:** `Vorgang`, `Quellen`, `Prüfung`, `Unsicherheit`, `Freigabe` must be present and semantically ordered in the Vorgangsansicht.
7. **Freigabe semantics:** statuses are `offen`, `angefordert`, `erteilt`, `verweigert`; approval/refusal must remain attributable to a human or role-serving agent, not CET as decision-maker.
8. **Evidence/freeze semantics:** every statement requires `granularitaet`. `aggregat` may materialize in proof; `einzeldatensatz` is hash/ref-only and “nur mit Quelle reproduzierbar”. Missing `granularitaet` blocks proof/freeze.
9. **Boundaries:** `nichtHandlungen` are element-specific; no global standard deny-list.
10. **Operations console:** generic renderer, role-/tenant-filtered execution. `not_projected` raw JSON must be marked as not projected and must not receive aggregation/evidence-marker semantics. Console use is logged as a demand signal.
11. **Tagesfläche:** it is an attention/work surface, not a KPI dashboard. Grouping is allowed only when attention reason and contribution type match; `nicht_anwendbar` criteria may be collapsed.
12. **Phase C sequencing:** reusable display elements must be specified before D-level page/component details so fachliche rules are not re-invented in React components.

## 3. Phase B validation matrix

### REST-gateway boundary

**Status:** aligned.

Evidence:

- `apps/cet-ui/src/App.tsx` calls `/api/ui/v0/...` only through the browser API client.
- `tests/cet-ui-rc2.api-gateway.test.js` asserts explicit UI route aliases and excludes direct RC1/governanceArchitecture paths.
- `tests/cet-ui-rc2.http-smoke.test.js` walks the reference flow through HTTP only.

### Vite/React/TypeScript framework

**Status:** aligned.

Evidence:

- `apps/cet-ui/vite.config.ts`, `tsconfig.json`, `src/main.tsx`, `src/App.tsx` exist.
- `npm --prefix apps/cet-ui run build` runs `tsc --noEmit`, `vite build`, and Vite artifact verification.
- `tests/cet-ui-rc2.vite-react-typescript.test.js` locks the framework structure.

### Shared functions before components

**Status:** aligned enough for Phase C start.

Evidence:

- Shared functions exist for API client, contract validation, projection, role/tenant, wording, evidence, prominence and audit.
- `tests/cet-ui-rc2.phase-b-shared-functions.test.js` covers base URL normalization, tenant/auth headers, `granularitaet`, grammar parts, `nichtHandlungen`, projection semantics, role switch boundaries, placeholder-agent formatting, forbidden user text, and evidence materialization boundaries.

Residual Phase C requirement:

- Phase C components must consume these shared functions; they must not duplicate these rules inside component code.

### Tenant/role/placeholder-agent grounding

**Status:** aligned for Phase B; needs richer display components in Phase C.

Evidence:

- `services/cet-ui.service.js` requires authenticated tenant and user context.
- Active role is restricted to roles from authenticated metadata.
- `src/cet-ui-rc2/fixtures/reference-tenant.js` and gateway/session context expose role candidates and placeholder-agent flags.
- `App.tsx` renders placeholder-agent availability in the role selector.

Phase C implication:

- Implement `RoleActor` / `RolePill` as a reusable display element that separates person, role, tenant and placeholder-agent identity. Do not encode this only as `<select>` option text.

### Presentation contract and grammar parts

**Status:** aligned at shared-function/test level; display specialization still belongs to Phase C.

Evidence:

- Contract validators enforce five grammar parts and `granularitaet`.
- Feinkonzept alignment test asserts the five semantic sections.
- `App.tsx` renders grammar sections in semantic order.

Phase C implication:

- Implement `GrammarSection` as a reusable component for the five parts before D-level page work.

### Evidence/freeze/governance proof semantics

**Status:** materially aligned for Phase B.

Evidence:

- `src/cet-ui-rc2/evidence-dossier.js` materializes `aggregat` statements and converts `einzeldatensatz` to hash/ref-only notices.
- `tests/cet-ui-rc2.http-smoke.test.js` verifies evidence before freeze has no `frozenAt`, then claim → freeze → approval request → evidence yields frozen proof plus approval request.
- `apps/cet-ui/src/shared/evidence-helpers.js` encodes `einzeldatensatz` as non-materialized.

Phase C implication:

- Implement `EvidenceMarker`, `SourceChip/SourceList`, and `HashRefOnlyNotice` semantics as reusable display elements. Raw rows must not appear as materialized proof.

### Operations console and non-projected JSON

**Status:** aligned.

Evidence:

- Operation prepare returns `projectionStatus: nicht_projiziert` / unprojected raw payload.
- `App.tsx` labels the raw response as `Nicht projiziert` and shows explanatory text.
- Shared projection helper tests assert no aggregation state and no evidence markers for raw JSON.
- Audit hooks and `POST /api/ui/v0/audit-events` exist.

Phase C implication:

- Implement `RawJsonNotProjectedPanel` and `ActionButton/SafeActionBar` before expanding operation forms.

### Wording and visible no-action state

**Status:** aligned in helpers; partial in current shell.

Evidence:

- `wording-helpers.js` formats “In Bearbeitung durch …” and blocks forbidden system terms.
- The tests reject `Zur Kenntnis genommen`.

Phase C implication:

- Implement `TakeoverStatePanel` so states `unbeansprucht`, `von mir übernommen`, `In Bearbeitung durch <Name>`, `mir zugewiesen`, and `durch Agent übernommen` are centrally formatted.

### Boundaries / `nichtHandlungen`

**Status:** aligned as contract validation; display needs Phase C component.

Evidence:

- Contract validators reject renderable elements with empty `nichtHandlungen`.
- `App.tsx` renders `Grenzen dieser Ansicht` from the current presentation contract.

Phase C implication:

- Implement `BoundaryBox` that renders the element-specific list only; do not add a generic global restriction list.

## 4. Identified gaps before Phase C implementation

These are not blockers for the Phase B framework, but they are binding inputs for Phase C:

1. **Display element layer missing:** `StatusBadge`, `RoleActor`, `EvidenceMarker`, `BoundaryBox`, `NextContributionCard`, `DecisionDistanceList`, `ApprovalPanel`, `TakeoverStatePanel`, `GrammarSection`, `RawJsonNotProjectedPanel`, `SafeActionBar`, `SinceLastAccessNotice`, `ProvenanceDisclosure` are not yet reusable components.
2. **Mobile prominence not yet validated:** Phase B has shared prominence helpers, but not a browser/layout test proving mobile minimum visibility (`Vorgang`, next contribution, Freigabesatz).
3. **ApprovalPanel attribution needs component contract:** Approval/refusal semantics exist, but Phase C must force actor/role/time visibility for `erteilt` and `verweigert`.
4. **DecisionDistanceList must stay pattern-driven:** Phase C must not hard-code a global criteria list.
5. **Source/Proof display needs explicit hash/ref component:** Evidence logic exists, but the UI element must distinguish `vollständig reproduzierbar` vs. `nur mit Quelle reproduzierbar`.

## 5. Phase C entry decision

**Decision:** Phase B is sufficiently grounded to start Phase C specification work, provided Phase C starts with reusable display elements and not with page-specific React implementation.

**Do not proceed directly to D-level Tagesfläche/Vorgangsansicht implementation.**

The correct next work package is:

1. Specify and test reusable Phase C display element contracts.
2. Implement minimal reusable components that consume Phase B shared helpers.
3. Add component-level tests for the Governance Architecture invariants above.
4. Only then wire these components into D-level surfaces.

## 6. Recommended immediate Phase C test-first slices

1. `StatusBadge` + `RawJsonNotProjectedPanel`
   - proves `not_projected` has no evidence/aggregation semantics.
2. `RoleActor` + `TakeoverStatePanel`
   - proves person/role/tenant/placeholder-agent separation and visible no-action wording.
3. `EvidenceMarker` + `SourceChip`
   - proves `aggregat` vs. `einzeldatensatz` proof display.
4. `BoundaryBox`
   - proves element-specific `nichtHandlungen` only.
5. `ApprovalPanel`
   - proves `offen`, `angefordert`, `erteilt`, `verweigert` with actor/role/time and “CET entscheidet nicht”.
6. `GrammarSection`
   - proves all five grammar parts remain visible/one-step reachable.

## 7. Verification commands already green for the current Phase B basis

- `npm --prefix apps/cet-ui run build`
- focused RC2 suite: 12 suites / 56 tests
- `npm run audit:openapi`
- `npm run check:llm`
- `npm run check:operation-capability-index`
- ESLint on touched files
- `git diff --check`

## 8. Boundary note

This validation uses internal Governance Architecture working artifacts and Qdrant/OpenClaw recall as internal grounding. It is not a public documentation artifact and must not be published without separate public-web review.
