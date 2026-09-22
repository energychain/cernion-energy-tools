# CET RC2 UI — Spec C Reusable Visible UI Elements

Status: Phase C implemented locally on branch `feat/cet-release-rc2-ui`.

## Grounding

Phase C follows `docs/rc2-ui/phase-b-qdrant-grounding-validation.md`: reusable elements are governance primitives first, not generic decoration. Components make role projection, evidence, decision readiness, No-Call/HITL and not-projected state visible before surface-specific Phase-D layouts consume them.

## Component groups

### Identity

Files:

- `apps/cet-ui/src/components/identity/TenantBadge.tsx`
- `apps/cet-ui/src/components/identity/ActiveRoleBadge.tsx`
- `apps/cet-ui/src/components/identity/RoleSelector.tsx`
- `apps/cet-ui/src/components/identity/ActorBadge.tsx`

Purpose:

- Show tenant context.
- Show active role projection.
- Restrict selector display to allowed roles.
- Distinguish placeholder agents from human users.

### Status and marker elements

Files:

- `apps/cet-ui/src/components/status/AttentionReasonBadge.tsx`
- `apps/cet-ui/src/components/status/DeadlineIndicator.tsx`
- `apps/cet-ui/src/components/status/AggregateStateBadge.tsx`
- `apps/cet-ui/src/components/status/SafetyMarker.tsx`
- `apps/cet-ui/src/components/status/GranularityBadge.tsx`
- `apps/cet-ui/src/components/status/NotProjectedBadge.tsx`
- `apps/cet-ui/src/components/status/ApprovalStatusBadge.tsx`
- `apps/cet-ui/src/components/status/HandlingStatusBadge.tsx`

Purpose:

- Render Feinkonzept-safe wording through shared wording helpers where applicable.
- Keep `Nicht projiziert`, granularity and approval/handling states consistent.

### Structure and grammar elements

Files:

- `apps/cet-ui/src/components/structure/GrammarPart.tsx`
- `apps/cet-ui/src/components/structure/CollapsibleSection.tsx`
- `apps/cet-ui/src/components/structure/SourceList.tsx`
- `apps/cet-ui/src/components/structure/BoundaryPanel.tsx`
- `apps/cet-ui/src/components/structure/HistoryExcerpt.tsx`
- `apps/cet-ui/src/components/structure/SinceLastAccessNotice.tsx`

Purpose:

- Make the fixed Vorgangsansicht grammar reusable.
- Keep boundaries and source context visible.
- Provide labelled collapsible sections.

### Action elements

Files:

- `apps/cet-ui/src/components/actions/NextContributionPanel.tsx`
- `apps/cet-ui/src/components/actions/BasisRevActionButton.tsx`
- `apps/cet-ui/src/components/actions/ClaimCaseButton.tsx`
- `apps/cet-ui/src/components/actions/FreezeCaseButton.tsx`
- `apps/cet-ui/src/components/actions/RequestApprovalButton.tsx`
- `apps/cet-ui/src/components/actions/ReadinessCheckAction.tsx`

Purpose:

- Gate CET-internal writes on `basisRev`.
- Label action intent, not promised result.
- Avoid any implication of external Fachsystem execution.

### Evidence elements

Files:

- `apps/cet-ui/src/components/evidence/EvidenceReceiptLink.tsx`
- `apps/cet-ui/src/components/evidence/HashReferencePanel.tsx`
- `apps/cet-ui/src/components/evidence/SourceClassLabel.tsx`
- `apps/cet-ui/src/components/evidence/SourceStandLabel.tsx`
- `apps/cet-ui/src/components/evidence/ReproducibilityNotice.tsx`

Purpose:

- Keep evidence receipts and source state visible.
- Treat `einzeldatensatz` as hash/ref-only.
- Show reproducibility notices without raw record rendering.

### Operations elements

Files:

- `apps/cet-ui/src/components/operations/OperationSearch.tsx`
- `apps/cet-ui/src/components/operations/CapabilityCard.tsx`
- `apps/cet-ui/src/components/operations/OperationForm.tsx`
- `apps/cet-ui/src/components/operations/OperationPermissionPanel.tsx`
- `apps/cet-ui/src/components/operations/RiskClassBadge.tsx`
- `apps/cet-ui/src/components/operations/ProjectedResultView.tsx`
- `apps/cet-ui/src/components/operations/UnprojectedRawJsonView.tsx`

Purpose:

- Support filtered operation catalog rendering.
- Keep risk class and permission boundary visible.
- Display unprojected raw JSON as `Nicht projiziert`, separate from evidence.

### Governance primitives from QDrant grounding

Files:

- `apps/cet-ui/src/components/governance/DecisionReadinessPanel.tsx`
- `apps/cet-ui/src/components/governance/AllowedBlockedActionsList.tsx`
- `apps/cet-ui/src/components/governance/HitlGatePanel.tsx`
- `apps/cet-ui/src/components/governance/ApprovalRequestCard.tsx`

Purpose:

- Make decision readiness, allowed/blocked actions and HITL state available before Phase-D surface layouts.

### Surface seeds for Phase D

Files:

- `apps/cet-ui/src/components/surfaces/VorgangCard.tsx`
- `apps/cet-ui/src/components/surfaces/TagesflaecheGroup.tsx`

Purpose:

- Provide the smallest reusable cards/groups using governance primitives, so Phase D does not start from generic task cards.

## Exports

All components are exported from:

- `apps/cet-ui/src/components/index.ts`

## Tests

Phase C is covered by:

- `tests/cet-ui-rc2.phase-c-visible-components.test.js`

Assertions cover:

- identity/placeholder-agent behaviour by source contract,
- shared wording helper usage,
- labelled collapsible/grammar primitives,
- `basisRev` requirement on write buttons,
- hash/ref-only evidence behaviour,
- not-projected operations separation from evidence,
- QDrant-grounded primitives for Phase D.

## Boundary

Phase C creates reusable visible elements. It does not yet replace the App shell surface implementation; wiring those primitives into full Tagesfläche, Vorgangsansicht, Nachweisansicht and Operationskonsole layouts is Phase D.
