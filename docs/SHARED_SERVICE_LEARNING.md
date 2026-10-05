# Correction learning (#701)

The domain-free correction loop uses existing authenticated principals, function
resolution, activation/coverage services, the journal and the proposal feedback
path. Recognition is deterministic and requires no LLM or new dependency.

## Chat contract

`src/workbench-corrections.js` is called by Workbench chat; the intent router only
recognizes this mode. Function references go exclusively through
`src/function-resolver.js`. A preview names the resolved function and effect.
Ambiguous results show candidates; selecting a label creates another preview.
Only a separate affirmative turn applies it. An unrelated turn or cancellation
clears the pending correction. Unknown references never mutate state.

Pending previews and the latest reversible correction are saved using the existing
Workbench turn-memory store, keyed by tenant, authenticated actor, channel and
conversation. Client-supplied history or metadata cannot manufacture confirmation.
The OpenAI-compatible governance model reaches this same Workbench path.

Example (replace the label with one from the installed function model):

```text
Person: Kümmere dich nicht mehr um Alpha Review.
CET: Ich verstehe: CET soll sich nicht mehr um „Alpha Review“ kümmern – richtig?
Person: Ja.
CET: Bestätigt und übernommen.
Person: Mach das rückgängig.
CET: Ich verstehe: Korrektur für „Alpha Review“ rückgängig machen – richtig?
Person: Ja.
CET: Korrektur rückgängig gemacht.
```

Proposal example using an identifier supplied by the real Notices service (#723):

```text
Person: Nimm V-12 an.
CET: Ich verstehe: Vorschlag „<sichtbare Beschreibung>“ annehmen – richtig?
Person: Ja.
CET: Bestätigt und übernommen.
```

Descriptions also work: `Den Vorschlag zum <eindeutige Beschreibung> nehme ich an`.
Only open proposals addressed to the authenticated actor are considered, and the
existing `shared-service-agent.resolveProposal` remains authoritative. No second
feedback event is introduced. Rejection statistics suppress subsequent proposal
creation on a deterministic cycle cadence (every 1 + rejected cycles, capped at 11).
Open proposals are included in `workbench.inbox.tasks.list` with `proposalRef` and
safe summary. Proposal acceptance/rejection is a terminal decision in the existing
feedback contract; correction undo applies to the four structured correction types.

## Effects and reversal

| Target | Allowed fields | Effect |
| --- | --- | --- |
| coverage | functionId, score (0..1) | Actor coverage with origin corrected; authoritative initially, fourfold observed half-life and retention; slower blend toward observed evidence |
| activation | functionId, cet (boolean) | Persistent responsibility preference; assignment prioritizes eligible uncovered neighbors within the existing tenant budget |
| agent | functionId, kind, factor? | retain/unretain and pin/unpin through existing attention policy; factor bounded by existing maxRetainFactor |
| neighbor | functionId, neighborId, weight (0..1) | Symmetric tenant-local overlay applied before graph filtering/ranking; base model remains immutable |

Each apply and undo publishes `shared-service.correction.v1` with the Epic fields;
`correctionId` and `at` are additive. Undo adds `correction.undoRef`. Each event is
journaled for its function. Coverage/graph/responsibility reversal removes that
correction layer; attention reversal restores prior retain/inventory values.
Attention corrections must be undone newest-first for the same function; no
allowance, consumed units, scopes or mandates are restored or minted.

Corrections cannot create graph-ineligible responsibility, exceed the tenant
budget, finance cycles, grant permissions or authorize external effects. Unknown
correction fields are rejected. Retain/unretain permit any authenticated tenant
user; pin/unpin and their undo require ROLE_ADMIN or ROLE_TENANT_ADMIN. Other
actors' undo additionally requires admin. Coverage is never authorization.

## Admin and broker API

Admin actions require ROLE_ADMIN or ROLE_TENANT_ADMIN, except global aggregated
suggestions, which require ROLE_ADMIN. All routes are authenticated by the existing
gateway and actions recheck their principal.

| Action | REST route |
| --- | --- |
| shared-service-learning.apply | POST /api/shared-service-learning/corrections |
| shared-service-learning.undo | POST /api/shared-service-learning/corrections/:correctionId/undo |
| shared-service-learning.list | GET /api/shared-service-learning/corrections |
| shared-service-learning.overrideProposals | GET /api/shared-service-learning/corrections/override-proposals |

Apply input: `{ tenantId?, target, correction, correctionId? }`. Supplying a stable
correctionId makes retries idempotent; a conflicting payload is rejected.
`confirm`, `activation.correct` and `function-coverage.correct` are protected broker
actions, not REST routes. The learning service awaits the target consumer before
publishing the correction event. Pending publication can be retried with the same
ID. Audit records use PouchDB via createPouchDbLifecycleMixin and
SHARED_SERVICE_LEARNING_DB_PATH; no caller credentials are persisted. The per-tenant
audit is capped by maxRecordsPerTenant (default 2048); additional corrections are
refused rather than deleting reversal history.

Aggregated suggestions give one weight per tenant and pair, the contributing tenant
count, and their mean. They disclose no actor IDs and never write
`function-model.overrides.json`. Deployment review is required to adopt a suggestion.

## Notices integration (#723)

The correction dialog uses the real Notices service. Identifier lookup fails
closed if the service or a visible retained reference is absent; no V identifiers
are invented. Calls remain under the authenticated actor's principal:

- `notices.resolveRef({ tenantId, actorId, ref })`: returns a visible proposal notice
  `{ kind: 'proposal', objectRef, ref, ... }` or null.
- `notices.setPreference({ tenantId, actorId, preference })`: accepts off,
  proposals_only or all after chat confirmation. Absence cannot claim success.

This issue implements no notice rendering or signal processing.

Integration tests create a real queued proposal notice and use its assigned
reference for the confirmed reaction. Terminal proposals no longer resolve through
that reference. Preference tests verify the real person's persisted document before
and after confirmation instead of a contract stub.
Notice recipient selection also reads the persisted tenant neighbor overlay;
tests cover added/removed edges, undo and isolation from another tenant.

## Validation

`tests/shared-service-learning.test.js` covers the four effects, attention roles,
confirmation, ambiguity, conversation isolation, DE/EN wording, undo, forbidden
fields, proposal descriptions/identifiers, one feedback emission, inbox visibility,
notice preferences and replay. The persistence test uses real PouchDB across restart.
The real-service harness observes correction targets and authorization policies
before/after; I-7 and I-8 are active alongside I-3/I-5/I-10.

## Contextual gaps (#727)

See [SHARED_SERVICE_GAPS.md](SHARED_SERVICE_GAPS.md) for the additive gap state,
bounded lists, visible `L-n` notices and confirmed `gap_done`/`gap_ignore` reactions.
The existing attention feedback event and unchanged paid observation cycle are reused.
