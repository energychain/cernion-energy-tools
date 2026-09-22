# CET RC2 Phase B — QDrant Grounding Validation

**Branch:** `feat/cet-release-rc2-ui`  
**Validated HEAD:** `ecf726c40e4b6db36a55ba35a2238c128b85c82c`  
**Purpose:** Validate the Phase-B UI framework before Phase C against the currently indexed process knowledge and governance architecture in QDrant.

## Discovery method

Semantic search through the local QDrant skill failed because the embedding runtime is not installed in the active environment (`sentence_transformers` missing). To avoid inventing grounding, this validation used a deterministic QDrant scroll and keyword-relevance fallback across the current governance/process collections.

Collections checked:

- `agentos_cet_current_state_mapping_v1`
- `agentos_cet_governance_release_change_readiness_v1`
- `agentos_stadtwerk_digital_laufkarten_atlas_v1`
- `agentos_stadtwerk_governance_adr_v1`
- `agentos_stadtwerk_governance_ip_model_v1`
- `agentos_stadtwerk_operational_glossary_v1`
- `agentos_stadtwerk_broad_control_objects_v1`
- `agentos_stadtwerk_broad_governance_v1`
- `agentos_stadtwerk_cet_gap_analysis_v1`

Keywords used for deterministic fallback included: `laufkarte`, `vorgang`, `control point`, `governance`, `evidence`, `nachweis`, `hitl`, `no-call`, `freigabe`, `rolle`, `raci`, `mandant`, `tenant`, `uat`, `readiness`, `decision`, `operations`, `audit`, `m2c`, `marktkommunikation`, `mako`.

This is a reference-only validation. It uses collection/point references and synthesized rules, not copied source context.

## Key grounding references

### Digital Laufkarten as context chains

**Reference:** `agentos_stadtwerk_governance_adr_v1` / point `720256930405773421` and duplicate/index variant `84470406275810369`  
**Rule:** Digital Laufkarten are explicit chains of nodes, edges, handoffs, evidence requirements, role projections, readiness transitions and No-Call guards. They are not isolated signals.

**Phase-B status:** aligned. The UI shell uses the user-facing term `Vorgang`, keeps the system-level run-card concept behind the presentation contract, and exposes daily/case/evidence/operations surfaces without introducing signal-only shortcuts.

**Phase-C implication:** visible UI components must show chain context, not just cards. Reusable components should include at least: `VorgangHeader`, `EvidenceRequirementList`, `RoleProjectionBadge`, `ReadinessStateBadge`, `NoCallGuardNotice`.

### VDMI/RACI as role projection, not replacement

**Reference:** `agentos_stadtwerk_governance_adr_v1` / points `803906896928412936`, `511536086344349039`, `378026531471902084`  
**Rule:** VDMI/RACI remains the projection mechanism for roles and influence; governance adds control-point and evidence layers.

**Phase-B status:** aligned. Phase B carries tenant/role constraints and role-visible UI, but does not replace the existing role model. It restricts role switching and active role projection to authenticated context.

**Phase-C implication:** role UI must display why a role can act, contribute, inspect or only observe. Components should distinguish `Informationsrecht`, `Beitragsrecht`, `Prüfrecht`, `Entscheidungsrecht` where the presentation contract/gateway provides them.

### Evidence Receipts and Nachweis before decisions

**References:**

- `agentos_stadtwerk_governance_ip_model_v1` / point `686912771658330844`
- `agentos_stadtwerk_digital_laufkarten_atlas_v1` / point `520982295869836336`
- `agentos_stadtwerk_operational_glossary_v1` / point `947484487368176579`

**Rule:** Governance decisions require evidence receipts, auditability and clear current working state. Missing evidence must be visible and must not be silently treated as readiness.

**Phase-B status:** aligned. Phase B separates `Nachweisansicht`, materialized statements, hash-ref-only notices, and not-projected raw JSON. It does not convert raw operation responses into evidence semantics.

**Phase-C implication:** build visible components for evidence status and source state before richer action components. Required components: `EvidenceReceiptCard`, `HashRefOnlyNotice`, `SourceStateLine`, `MissingEvidenceCallout`.

### Decision Readiness and No-Call/HITL gates

**References:**

- `agentos_stadtwerk_governance_adr_v1` / points `403261085754335569`, `1146621187163569788`, `723957774120575771`
- `agentos_stadtwerk_governance_adr_v1` / point `12803226448249958`
- `agentos_stadtwerk_digital_laufkarten_atlas_v1` / point `657939853075275928`

**Rule:** A case progresses only when readiness thresholds and evidence allow it; otherwise it is returned, enriched or escalated. UAT evidence is required before release gates advance. No-Call/HITL regression must remain explicit.

**Phase-B status:** partially aligned for framework stage. Phase B has claim/freeze/approval request flows, audit hooks, HTTP smoke, and no external Fachsystem writes. It does not yet render a full Decision-Readiness component set, which belongs in Phase C.

**Phase-C implication:** the first reusable component batch should include a readiness/gate surface before adding richer workflow interactions. Suggested components: `DecisionReadinessPanel`, `AllowedBlockedActionsList`, `HitlGatePanel`, `ApprovalRequestCard`.

### Advisory/read-only start and rollback discipline

**References:**

- `agentos_stadtwerk_governance_adr_v1` / points `781072970488621579`, `967253360756019776`
- `agentos_cet_governance_release_change_readiness_v1` / point `18159212929944589`

**Rule:** Release changes for Big Trace/Laufkarten logic start advisory/read-only or CET-internal, guarded by rollback paths. High-risk automation is not introduced without UAT evidence and local validation.

**Phase-B status:** aligned with the corrected implementation scope. The UI performs CET-internal writes only: claim, freeze, approval request and audit. It does not execute external Fachsystem actions. Gateway writes are authenticated/protected and tested.

**Phase-C implication:** reusable action components must label whether they are `CET-internal`, `HITL`, `blocked`, or `external/not connected`. No Phase-C component may visually imply productive external execution.

### Operations console as demand signal, not evidence claim

**References:**

- `agentos_stadtwerk_digital_laufkarten_atlas_v1` / atlas meta point `834515043738096790`
- `agentos_stadtwerk_cet_gap_analysis_v1` / point `461390665371854806`

**Rule:** Operations/capability access can support context and demand discovery, but unprojected raw outputs must not appear as final evidence or decision objects.

**Phase-B status:** aligned. Operations console output is explicitly `Nicht projiziert`, raw JSON stays under unprojected/raw handling, and audit tracks console usage as a need signal.

**Phase-C implication:** add a reusable `NotProjectedResultPanel` and keep it visually separate from evidence cards and decision-state components.

## Alignment matrix

**Phase-B element:** Vite/React/TypeScript app shell  
**Grounding result:** aligned. Provides the planned deterministic UI basis for role-, evidence- and readiness-projected components.

**Phase-B element:** Tagesfläche  
**Grounding result:** aligned, but Phase C must add chain/context and readiness markers so daily items are not isolated task cards.

**Phase-B element:** Vorgangsansicht  
**Grounding result:** aligned. Needs Phase-C components for role projection, evidence requirements and allowed/blocked actions.

**Phase-B element:** Nachweisansicht  
**Grounding result:** aligned. Must remain the primary place for materialized statements and hash/source-only notices.

**Phase-B element:** Operationskonsole  
**Grounding result:** aligned. Must remain visibly non-projected unless a later presentation contract maps the output.

**Phase-B element:** Claim/freeze/approval/audit writes  
**Grounding result:** aligned as CET-internal state writes. External Fachsystem execution remains excluded.

**Phase-B element:** Browser auth bootstrap  
**Grounding result:** acceptable for Phase B. It documents how the SPA forwards a token/tenant/active role into the protected UI gateway without hardcoding secrets.

## Phase-C starting basis

Phase C should not start with generic cards/buttons only. It should start with reusable visible governance elements in this order:

1. `RoleProjectionBadge` / `RoleActorLine`
2. `EvidenceReceiptCard` / `MissingEvidenceCallout`
3. `DecisionReadinessPanel`
4. `AllowedBlockedActionsList`
5. `HitlGatePanel` / `ApprovalRequestCard`
6. `NotProjectedResultPanel`
7. `VorgangCard` and `TagesflaecheGroup` using the above primitives

## Validation verdict

**Verdict:** Phase B is grounded enough to close and to start Phase C.

**Condition for Phase C:** implement visible components as governance primitives first, not as generic UI decoration. Every action-oriented component must carry role/evidence/readiness/no-call semantics or explicitly state that the semantics are not yet projected.

## Open grounding note

The QDrant semantic search path should be repaired separately by installing/configuring the correct embedding runtime for the relevant collections. This validation is still useful because it used direct QDrant scroll over the named current governance/process collections, but it should be treated as deterministic reference grounding rather than semantic-nearest-neighbor coverage.
