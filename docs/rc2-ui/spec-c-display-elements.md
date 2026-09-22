# CET RC2 UI — Spec C Reusable Governance Display Elements

> **Status:** Phase C implementation basis on `feat/cet-release-rc2-ui`
>
> **Grounding:** `phase-b-governance-grounding-validation.md`, `phase-b-qdrant-grounding-validation.md`, UX/UI Feinkonzept and Spezifikationsschnitt.

## 1. Active conclusion

Phase C starts with reusable Governance display primitives, not with page-specific Tagesfläche or Vorgangsansicht code. Every visible action or status must carry role, tenant, evidence, readiness, boundary or no-call semantics.

No Phase-C primitive may encode a hidden Fachsystem write. No primitive may turn a raw Operationskonsole response into evidence.

## 2. Implemented component layer

Implementation file:

```text
apps/cet-ui/src/components/governance-display-elements.tsx
```

Implemented primitives:

- `StatusBadge`
- `RoleActor`
- `EvidenceMarker`
- `BoundaryBox`
- `NextContributionCard`
- `DecisionDistanceList`
- `ApprovalPanel`
- `TakeoverStatePanel`
- `GrammarSection`
- `RawJsonNotProjectedPanel`
- `SafeActionBar`
- `SinceLastAccessNotice`
- `ProvenanceDisclosure`

## 3. Component contracts

### StatusBadge

Displays working, proof, readiness, clarification, unchecked, not-projected, source-only and blocked states. It must not imply a recommendation.

### RoleActor

Displays role, person or placeholder agent and optional tenant label. Person and role remain separated. Placeholder agents are labelled as agents serving a role.

### EvidenceMarker

Displays evidence status for statements. `aggregat` can be shown as materialized evidence; `einzeldatensatz` is displayed as `nur mit Quelle reproduzierbar`.

### BoundaryBox

Displays exactly the element-specific `nichtHandlungen`. A missing list is an invalid display state; it must not silently render an empty UI and must not add a global deny-list.

### NextContributionCard

Displays type, activity, role and required-for target. It describes the required contribution, not an outcome.

### DecisionDistanceList

Displays pattern-provided criteria only. `nicht_anwendbar` criteria are collapsed. There is no global hard-coded criteria list.

### ApprovalPanel

Displays `offen`, `angefordert`, `erteilt`, and `verweigert`. Granted/refused states require actor/role/time when the data exists. The panel states that CET decides not.

### TakeoverStatePanel

Displays `unbeansprucht`, `von mir übernommen`, `In Bearbeitung durch <Name>`, `mir zugewiesen`, and `durch Agent <Name> übernommen`.

### GrammarSection

Provides the reusable frame for the five semantic parts: Vorgang, Quellen, Prüfung, Unsicherheit, Freigabe.

### RawJsonNotProjectedPanel

Displays raw JSON as `Nicht projiziert` and states that it has no aggregation state and no evidence markers.

### SafeActionBar

Labels actions as read, CET-internal write, external unavailable or HITL. This is the reusable no-call / safe-action surface.

### SinceLastAccessNotice

Displays interaction-relevant changes since last access, e.g. next contribution, role effect, deadline, approval status or findings.

### ProvenanceDisclosure

Displays view origin/version/source as a disclosure, while primary UI text avoids system vocabulary.

## 4. Phase D boundary

Phase D may now wire these elements into Tagesfläche, Vorgangsansicht, Nachweisansicht and Operationskonsole. Es gilt: keine Fachregel direkt in einer Seitenkomponente; fehlende Fachanzeige-Regeln werden zuerst in Phase C ergänzt.

Phase D must not implement a new role actor formatter, evidence marker, boundary renderer, approval status formatter, takeover state formatter, raw JSON panel or action safety wording in a page component. If a missing display rule appears, extend this Phase-C component layer first.

## 5. Acceptance checks

- Component source exports all Phase-C primitives.
- Component source contains explicit no-call and not-projected wording.
- Component source contains role/tenant/placeholder-agent, `granularitaet`, `nichtHandlungen`, and grammar-order semantics.
- TypeScript build succeeds.
- Phase-C test locks the display element layer before Phase D.
