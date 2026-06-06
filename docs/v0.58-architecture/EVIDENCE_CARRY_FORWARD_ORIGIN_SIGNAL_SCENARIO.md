# Evidence Carry-Forward: Origin Session Signal Scenario

Status: scenario implemented end-to-end and wired to fire automatically —
transport proof (notification dispatch type `evidence_revalidated`), the
persistence/correlation layer (`evidence-revalidation` service, see
Implementation below), and the automatic Work-Out-Loud trigger (see
Automatic Trigger below) that calls the correlation layer as soon as a later
turn learns the missing fact — no manual
`POST /api/evidence-revalidation/correlateFact` call required.

## Goal

When a later dialog provides a fact that resolves an evidence gap from an earlier
dialog, Cernion should be able to notify the original chat session that the
evidence status changed. The original answer remains a historical snapshot; the
new signal only says that a revalidation is available.

## Scenario

Tenant: `tenant-a`

Dialog 1: Mayor asks for a strategic storage and flexibility precheck.

- Persona: `tenant-a/mayor`
- Session: `pa-origin-mayor-sinsheim`
- Result: answer is partial because the grid operator evidence is missing.
- Persisted evidence requirement:
  - `requirementId`: `evreq-sinsheim-grid-operator`
  - `originSessionId`: `pa-origin-mayor-sinsheim`
  - `requestedFact`: `gridOperatorBdew`
  - `scope`: `tenant_candidate`

Dialog 2: Grid planning employee provides the missing operator fact.

- Persona: `tenant-a/grid-planning`
- Session: `pa-grid-planning-followup`
- Fact learned: `gridOperatorBdew=9907473000008`
- Work-Out-Loud emits a `scoped_fact_learned` signal with
  `evidence.contextField: 'gridOperatorBdew'` (never the learned value).
- `services/personal-agent-work-out-loud-listener.service.js` validates the
  event and — because it is a fact-learning signal with a safe
  `contextField` — automatically calls `evidence-revalidation.correlateFact`
  (see Automatic Trigger below). No further action by Dialog 2 is required.

Dialog 3: Evidence revalidation correlates the new fact to the old requirement.

- Triggered automatically by the Work-Out-Loud listener from Dialog 2 — there
  is no manual `POST /api/evidence-revalidation/correlateFact` step.
- Revalidation status changes from `missing` to `updated`.
- Cernion dispatches a safe proactive message to the original persona/session:
  - `dispatchType`: `evidence_revalidated`
  - `evidenceRequirementId`: `evreq-sinsheim-grid-operator`
  - `originSessionId`: `pa-origin-mayor-sinsheim`
  - no raw prompt text
  - no tenant-external data

## Acceptance Criteria

- The dispatch can be created without a `hitlItemId`.
- The persona inbox item is typed as `evidence-revalidated`.
- The inbox item is assigned to the original session, not the later dialog.
- The message title and summary are generic and do not contain raw user text.
- Dispatch idempotency prevents duplicate origin-session signals for the same
  requirement and recipient.
- Existing HITL notification behavior remains unchanged.

## No-Code Extension Point

Notification dispatch semantics are declared in `src/notification-dispatch-types.json`.
New signal types should be added there before adding code branches. The registry
defines:

- required structured keys, such as `hitlItemId` or `evidenceRequirementId`
- the Persona Inbox message type
- the session targeting strategy
- safe title and summary templates

The service should remain an interpreter of this registry. Domain-specific
revalidation logic belongs in a separate evidence correlation layer —
implemented as `services/evidence-revalidation.service.js` (see Implementation
below).

## Implementation: `evidence-revalidation` Service

A small, additive service that owns exactly two things: the persisted
evidence-requirement model, and the decision of when a later structured fact
resolves an earlier gap. It never decides *what* the origin session sees —
that remains declared in `src/notification-dispatch-types.json` and rendered
by `notification.service.js`.

### Persisted model (`evr:<tenantId>:<evidenceRequirementId>`, PouchDB)

Only structured, tenant-isolated identifiers are stored — never prompt text,
answer text, or chat transcripts:

| Field | Meaning |
|-------|---------|
| `tenantId` | tenant isolation (PouchDB doc id is tenant-prefixed) |
| `evidenceRequirementId` | natural key, e.g. `evreq-sinsheim-grid-operator` |
| `originSessionId` | session to signal once revalidated |
| `originPersonaId` / `responsibleRole` | recipient of the origin-session signal — at least one is required |
| `requestedFact` | name of the structured fact the requirement is waiting on, e.g. `gridOperatorBdew` |
| `scope` | scope the fact must hold at, e.g. `tenant_candidate` |
| `status` | `missing` → `updated` |
| `createdAt` / `updatedAt` / `revalidatedAt` | timestamps |
| `lastDispatchId` | id of the `notification.dispatch` record that signalled the origin session |

### Actions

- **`evidence-revalidation.recordRequirement`** — idempotently persists a
  structured requirement from an earlier (partial) answer
  (`status: 'missing'` initially). Re-recording the same
  `(tenantId, evidenceRequirementId)` returns the existing, current record
  (`deduplicated: true`) rather than overwriting it — which doubles as a safe
  read path for inspecting persisted/correlated state.
- **`evidence-revalidation.correlateFact`** — the correlation entry point.
  Accepts the *name* of a later structured fact (`requestedFact`) plus tenant
  context (never the learned value, never the later session id), and:
  1. finds open (`status: 'missing'`) requirements in the **same tenant**
     whose `requestedFact` matches;
  2. for each match, calls `notification.dispatch` with
     `dispatchType: 'evidence_revalidated'`, `evidenceRequirementId`,
     `originSessionId`, `revalidationStatus: 'updated'`,
     `personaId: originPersonaId`, `responsibleRole`,
     `sourceService: 'evidence-revalidation'`, `sourceAction: 'fact-linked'`;
  3. marks the requirement `status: 'updated'` with `revalidatedAt` and the
     resulting `lastDispatchId`.

  Once a requirement is `updated` it is no longer a correlation candidate, so
  repeated correlation of the same fact is idempotent at this layer too — on
  top of the dispatch-level idempotency `notification.dispatch` already
  provides (same `evidenceRequirementId` + recipient → same dispatch record,
  same Persona Inbox message).

### Flow (matches the scenario above)

1. Dialog 1 calls `evidence-revalidation.recordRequirement` for
   `evreq-sinsheim-grid-operator` (`requestedFact: gridOperatorBdew`,
   `scope: tenant_candidate`, `status: missing`, recipient
   `tenant-a/mayor` / origin session `pa-origin-mayor-sinsheim`).
2. Dialog 2 learns `gridOperatorBdew`. Personal Agent emits a
   `personal-agent.work-out-loud` event with signal type
   `scoped_fact_learned` and `evidence.contextField: 'gridOperatorBdew'`.
   `personal-agent-work-out-loud-listener` validates it and automatically
   calls `evidence-revalidation.correlateFact` with
   `{ tenantId: 'tenant-a', requestedFact: 'gridOperatorBdew' }` (see
   Automatic Trigger below) — the fact *value* and the later session id are
   deliberately not part of this call.
3. The matching requirement is found, `notification.dispatch` fires
   (`evidence_revalidated`), and the requirement flips to `status: updated`.
4. The origin persona receives a generic `evidence-revalidated` Persona Inbox
   message in `pa-origin-mayor-sinsheim` — titled and summarised purely from
   the declarative registry, with no raw data.

### Tests

`tests/evidence-revalidation.service.test.js` covers: same-tenant requirement
correlation, cross-tenant non-correlation, absence of raw-prompt/chat-text
leakage in the persisted record (and downstream dispatch/inbox), the
`originPersonaId`-or-`responsibleRole` recipient requirement, and dispatch
idempotency on repeated fact correlation.

## Automatic Trigger: `personal-agent-work-out-loud-listener`

`services/personal-agent-work-out-loud-listener.service.js` subscribes to
`personal-agent.work-out-loud` (see `src/personal-agent-work-out-loud.js`)
purely to validate signal/evidence payloads. It now additionally closes the
loop end-to-end: a later turn that *learns* a safe structured fact
automatically triggers correlation against open evidence requirements — the
manual `POST /api/evidence-revalidation/correlateFact` step described in
earlier iterations of this scenario is no longer needed.

### Trigger conditions

After the existing strict validation (`validateWorkOutLoudPayload` — rejects
any payload with raw, additional, or unexpected fields exactly as before),
the listener calls `evidence-revalidation.correlateFact` only when **all** of
the following hold:

1. **Signal type is fact-learning.** Only `scoped_fact_learned` and
   `onboarding_fact_learned` represent a newly learned structured fact that
   could resolve an evidence gap; `bootstrap_context_updated` (an
   organization-level classification signal, not a learned fact) never
   triggers correlation.
2. **`evidence.contextField` is present and safe.** It must be one of the
   declared `SAFE_CONTEXT_FIELDS` (already enforced by
   `validateWorkOutLoudPayload`/`sanitizeEvidence` — e.g. `gridOperatorBdew`,
   `roleId`, `postalCode`).

### What is forwarded — and what never is

```js
ctx.call(
  'evidence-revalidation.correlateFact',
  { tenantId, requestedFact },             // requestedFact = payload.evidence.contextField
  { meta: { tenantId, $gateway: false } }  // same-tenant only, internal call
)
```

- `requestedFact` is the safe structured **field name**
  (`payload.evidence.contextField`, e.g. `'gridOperatorBdew'`) — never
  `payload.signal.value` (the learned value itself, e.g. `'9907473000008'`),
  and never prompt text, answer text, or session text.
- `tenantId` is the **validated event tenantId** — the same tenant the
  Work-Out-Loud payload was validated for. The call is always scoped to that
  tenant (`meta: { tenantId, $gateway: false }`); cross-tenant correlation is
  impossible by construction (and additionally guarded inside
  `evidence-revalidation.correlateFact` itself, see Implementation above).

### Fail-open

The correlation call is a side channel — it must never affect the original
chat turn. If `evidence-revalidation` is unavailable (`SERVICE_NOT_FOUND` /
`SERVICE_NOT_AVAILABLE` / 404) or the call otherwise fails, the listener logs
a warning (`this.logger.warn(...)`) and continues; it never throws out of the
event handler. Work-Out-Loud event handling and validation behave exactly as
before regardless of whether correlation succeeds, fails, or is unavailable.

### Tests

- `tests/personal-agent-work-out-loud-listener.service.test.js` —
  `describe('evidence revalidation auto-trigger', ...)` covers: triggering
  `correlateFact` for a valid `scoped_fact_learned` event with a safe
  `contextField`; *not* triggering it for `bootstrap_context_updated`;
  deriving `requestedFact` from `evidence.contextField` and never forwarding
  `signal.value`; preserving strict rejection (and no trigger) for
  raw/additional fields; fail-open behaviour (logged warning, no throw) when
  correlation fails; and that the forwarded `tenantId` is the validated event
  `tenantId`.
- `tests/personal-agent-work-out-loud-evidence-revalidation.integration.test.js`
  — end-to-end proof: records an evidence requirement, emits a real
  `personal-agent.work-out-loud` `scoped_fact_learned` event with a matching
  `contextField` through the actual listener/`evidence-revalidation`/
  `notification`/persona-inbox chain, and asserts the origin-session inbox
  message appears — with no raw learned-fact value anywhere in the chain —
  without any manual `correlateFact` call.

## Auto Evidence Requirement + Root KnownContext Knowledge Scope

Two additional subsystems were added in the follow-on iteration (Task 2) to
remove remaining manual steps from the standard scenario.

### Part A — Root `knownContext` → `knowledgeScopeDataPoints`

`resolveScopedKnowledgeState` in `services/personal-agent.service.js` now
promotes safe scalar `knownContext` fields directly to scoped knowledge
datapoints without any explicit `knowledgeScopeDataPoints` payload. Fields
added to `KNOWN_CONTEXT_ALLOWLIST`:

| Field | Scope |
|-------|-------|
| `gridOperatorBdew` | `tenant_candidate` |
| `gridOperatorId` | `tenant_candidate` |
| `gridOperatorName` | `tenant_candidate` |
| `bdew` | `tenant_candidate` |
| `vnbName` | `tenant_candidate` |
| `postalCode` | `session` |
| `city` | `session` |
| `voltageLevel` | `session` |

These fields are already in `SAFE_CONTEXT_FIELDS` / `SAFE_CONTEXT_FIELD_SET`
(see `src/personal-agent-work-out-loud.js`). Promoting them to
`KNOWN_CONTEXT_ALLOWLIST` means: once a later chat turn supplies, for example,
`knownContext.gridOperatorBdew = '9907473000008'`, `resolveScopedKnowledgeState`
derives a `tenant_candidate`-scoped datapoint, and
`emitScopedKnowledgeWorkOutLoud` automatically emits a `scoped_fact_learned`
Work-Out-Loud signal with `evidence.contextField: 'gridOperatorBdew'` — the
same signal that `personal-agent-work-out-loud-listener` uses to call
`evidence-revalidation.correlateFact`. No explicit `knowledgeScopeDataPoints`
entry is required.

Tests (in `tests/personal-agent.service.test.js`,
`describe('v0.57.2 — knowledgeScope summary baseline', ...)`):
- derives `gridOperatorBdew` from root `knownContext` as a `tenant_candidate`
  scoped datapoint;
- emits a `scoped_fact_learned` Work-Out-Loud signal with
  `evidence.contextField = 'gridOperatorBdew'` from root `knownContext`;
- derives all eight newly added fields with expected scopes (4 ×
  `tenant_candidate`, 3 × `session`);
- no raw fact value leaks into the reply; no raw prompt text leaks into the
  WoL payload.

### Part B — Auto Evidence Requirement Registration from Structured Missing Evidence

`personal-agent.chat` now calls
`evidence-revalidation.recordRequirement` when two conditions hold:

1. The structured `missingEvidence` array (from `buildResponsePolicyContract`)
   contains an entry with a recognised grid-operator ID
   (`vnb_lookup_required`, `gridOperatorBdew`, `bdew`, `bdewCode`,
   `operatorEvidence`), OR `execution.stopPoint.missingParams` includes a
   grid-operator parameter, OR an `evidencePlan.gap` matches.
2. Either `knownContext.personaId` or `knownContext.responsibleRole` is
   present — providing the recipient for the eventual revalidation signal.

The mapping is narrow and deterministic: only the structured `id` field of
`missingEvidence` entries is inspected — never the message text. If neither
recipient field is set, `buildEvidenceRequirementsForRevalidation` returns an
empty list and no recording happens (logged at debug level). The call is
fire-and-forget and fail-open: failure or unavailability of
`evidence-revalidation` never affects the chat response.

Evidence requirement IDs are deterministic: `evreq:{sessionId}:{requestedFact}`,
making the registration idempotent across turns.

Tests (in `tests/personal-agent.service.test.js`,
`describe('Part B — auto evidence requirement registration...', ...)`):
- does not fail chat when `evidence-revalidation` is unavailable (fail-open);
- does not call `recordRequirement` when neither `personaId` nor
  `responsibleRole` is present in `knownContext`;
- calls `recordRequirement` with correct `originSessionId`, `requestedFact`,
  `scope`, `responsibleRole`, and `$gateway: false` when structured
  `vnb_lookup_required` evidence is present;
- no raw prompt text or answer text in any recorded requirement field.

### Part C — Full End-to-End Chain (Integration Test)

`tests/personal-agent-auto-evidence-requirement.integration.test.js` proves
the complete chain without any manual `recordRequirement` or `correlateFact`
call:

1. `personal-agent.chat` (Turn 1) auto-registers a `gridOperatorBdew`
   evidence requirement because `consultationPayload.missingEvidence` contains
   `vnb_lookup_required` and `knownContext.responsibleRole` is set.
2. A later `personal-agent.chat` (Turn 2, different session) supplies
   `knownContext.gridOperatorBdew`.
3. `resolveScopedKnowledgeState` derives a new `tenant_candidate` scoped
   datapoint for `gridOperatorBdew`.
4. `emitScopedKnowledgeWorkOutLoud` emits a `scoped_fact_learned` WoL event
   with `evidence.contextField: 'gridOperatorBdew'`.
5. `personal-agent-work-out-loud-listener` calls
   `evidence-revalidation.correlateFact`.
6. The origin session receives an `evidence_revalidated` proactive persona-inbox
   message with no raw fact values or prompt text in the chain.
