# Next-turn notices (#723)

`notices` is a tenant-scoped, person-scoped pull queue. It does not initiate a
conversation, call an LLM, execute a proposal or alter authorization. Coverage of
a Function or its neighbors selects potential recipients; it grants no permission.
All Function labels come from the model. Presentation uses deterministic templates
and never displays the proposal's generated summary.

Recipient selection reads the persisted activation tenant's neighbor corrections
through the existing `getNeighbors` model resolver. Adding, removing or undoing an
edge therefore affects subsequent notice receipt within that tenant. This selects
recipients only; source visibility and recorded proposal addressing still authorize
each displayed notice independently. Previously queued notices remain subject to
their existing source-visibility checks.

## Sources and contract extension for #693

The agent emits the additive event after persisting a proposal and successfully
addressing at least one existing persona inbox:

```text
shared-agent.proposal.created.v1 {
  tenantId, agentId, functionId, proposalRef,
  summary: "Internal review requested.", createdAt
}
```

No existing event fields change. The proposal association remains in the real
agent document; recipient checks reuse `resolveProposal`'s tenant and recorded
recipient predicate. A resolved or inaccessible proposal is withheld. Notices do
not accept or reject proposals and never emit feedback themselves.

Activation events generate notices when CET takes/releases responsibility or the
attention tier enters `established`/`inventory`. Their display calls the existing
`activation.explain` under the recipient principal. A `signal.state.changed.v1`
subscription consumes the real Signals service's contract from #722:

```text
{ tenantId, signalId, functionIds[], context?: { kind, ref },
  fromState, toState, asOf, eventId }
```

Only transitions into `warn`/`breach` or back to `ok` qualify. Tests produce these
events through real `signals.observe` calls. Before display or reference resolution,
the Signals service's function/catalog association and retained tenant/context
state must match. Its existing `assertReadObservation` checks the recipient's
scope, mandate, policy, required parameters and backend roles without another
observation or operation charge. Case-context signals additionally use the
Journal's case-reference check; other context types are withheld. Standing signals
are visible when the same read checks pass. Missing services, evicted states and
revoked permissions withhold the notice.

## Actions for #701 and API callers

All actions require the existing authenticated principal, matching `tenantId` and
self `actorId`. Another person's queue is inaccessible even to a management role.
The public read/preference actions expose `/api/notices/` (GET) and
`/api/notices/preference` (POST). They retain the existing API authentication
metadata and enforce the same self/tenant principal checks; no authorization
exception is introduced.

- `notices.list({ tenantId, actorId })` returns the entire currently visible,
  preference-filtered queue as `{ items, preference, block }`; it does not deliver.
- `notices.setPreference({ tenantId, actorId, preference })` accepts `all`,
  `proposals_only`, `off`. This is the API seam for #701's later chat preference.
- `notices.resolveRef({ tenantId, actorId, ref })` returns a visible stored notice
  or `null`. Proposal notices contain `kind: proposal`, `objectRef: proposalRef`,
  `agentId`, `functionId`, `source` and their stable short `ref` (`V-1`, etc.).
  Signal refs use `S-`; responsibility/tier refs use `R-`. Counters are per person
  and tenant, never reset on restart. Both queued and recently delivered refs can
  be resolved; visibility is checked again, including revoked recipient access.
  Resolution confers no right to mutate the object: #701 must call its existing
  guarded action under the same principal.
- Protected `notices.completeTurn({ tenantId, actorId, turnRef, structured?,
  fullQueue? })` atomically persists the turn and delivery claim before returning
  `{items, remaining, block}`. It is for the shared completed-turn hook.

Current-model event identities are resolved through `resolveFunctionId()` and
stored with `modelSourceHash`. Reading re-resolves them; ambiguous splits are
withheld instead of assigning an object's notice to an arbitrary successor.

## Delivery, retention and limits

One PouchDB document per person retains queue, preference, coverage/latest
activation state, an aggregate sequence/own-turn counter, bounded delivery-ref
history and bounded event/turn deduplication keys. Writes are serialized per
instance; PouchDB revisions ensure only a successful writer can return a delivery.
A conflicting writer fails safely without returning the notice. There is no timer,
time-based expiration or refill of attention allowance.

| Setting | Default | Meaning |
| --- | ---: | --- |
| `maxQueue` | 50 | Oldest queued entries are dropped on overflow |
| `maxHistory` | 100 | Recently delivered refs retained for #701 |
| `dedupLimit` | 256 | Retained event and request keys, each |
| `expireAfterTurns` | 20 | Expiration after this person's completed turns |
| `maxPerResponse` | 3 | Maximum notices in an ordinary answer |
| `coverageThreshold` | 0.5 | Recipient selection only |

Turn expiration advances for successful turns even when preference is off or
output is structured. Other people's turns and wall-clock jumps do not advance
it. Event identity distinguishes source/function/reference; proposal retries keep
the same identity regardless of a changed timestamp. Notices of one function are
grouped into one presentation line while retaining every displayed short ref.
Deduplication guarantees apply within the retained replay horizon; arbitrary
ancient producer retries beyond bounded retention cannot be recognized. Delivered
refs beyond `maxHistory` intentionally return `null` for later chat reactions.

The persistence claim establishes at-most-once emission in completed responses,
not acknowledgement that a browser received them. A disconnected client may miss
a claimed notice. Retry idempotency requires the same request/correlation ID;
otherwise the existing broker request ID identifies a new turn.

## Existing turn integration

Workbench `chat`/`query` use the existing coverage before/after/error hooks. The
same after hook attaches notices after the answer is computed, then starts the
unchanged asynchronous coverage recording. State questions still produce no
Coverage observation or budget refill; they advance only the notice own-turn
counter. Mapped tenant/person metadata is reused without changing mapping policy.
Governance completions delegate once to Workbench, carry its deferred block and
prepend it after existing rendering. The SSE adapter moves that prefix into the
first role/content frame and leaves the remaining answer in the second frame.
Other SSE responses retain their existing frames.

Tool calls and requested structured outputs suppress delivery. Notice failures
are caught, logged with error class and counted in `notices.failures`; they never
prevent the original answer. A failed full-queue claim produces an unavailable
notice response rather than displaying unclaimed entries.

“Was gibt es Neues?”, “Gibt's was Neues?”, “Was ist passiert?”, “Irgendwelche
Hinweise für mich?” and “What's new?” enter the existing state-query module's
queue overview, without Function resolution, embeddings, Knowledge or RAG.
Ordinary responses link there when entries remain. An explicit queue request
claims the entire visible queue, including more than the ordinary per-answer cap.
Missing services yield an honest availability message. The lexical resolver also
filters committed #713 generic vocabulary plus centrally reviewed generic
exceptions from the existing allowlist (including German news presentation words
and the below-minimum-length English `new`); no separate stop-word list is added.

Example (neutral model labels):

```text
Hinweise für dich:
V-12: Neuer Vorschlag – Function A.
R-13: CET übernimmt Verantwortung – Function B.
Und 2 weitere – frag: „Was gibt es Neues?“

Die eigentliche Antwort bleibt hier unverändert.
```
