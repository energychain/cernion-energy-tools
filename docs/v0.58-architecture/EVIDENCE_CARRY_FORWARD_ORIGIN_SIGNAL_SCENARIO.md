# Evidence Carry-Forward: Origin Session Signal Scenario

Status: scenario implemented end-to-end — transport proof (notification
dispatch type `evidence_revalidated`) plus the persistence/correlation layer
(`evidence-revalidation` service, see Implementation below)

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
- Work-Out-Loud emits a scoped fact signal.

Dialog 3: Evidence revalidation correlates the new fact to the old requirement.

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
2. Dialog 2 learns `gridOperatorBdew` and (via the scoped-fact-learned path)
   triggers `evidence-revalidation.correlateFact` with
   `{ requestedFact: 'gridOperatorBdew' }`, scoped to `tenant-a` — the fact
   *value* and the later session id are deliberately not part of this call.
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
