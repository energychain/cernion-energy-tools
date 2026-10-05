# Contextual gap lists (#727)

Missing information in an existing observation becomes `gap` only when that
operation was actually called with context. The technical rule is
`contextMissingState: "gap"` in `signal-projection.rules.json`. Without context,
missing-status tokens and nonempty `missing*` arrays remain `needs_context`.
Native `needs_context` stays authoritative; native `gap` without context is
normalized to `needs_context`. Neither state is an agent finding. Independent
warning/breach findings retain their existing review path.

The agent collects the signals returned by its existing selected operations and
updates a single open list per `(tenantId, functionId, context.kind, context.ref)`
once per cycle. It performs no extra observation, directory lookup, inbox write or
LLM call for gaps. Labels come from the response and are deduplicated and sorted
with canonical ordering. Text and presentation are deterministic. The existing
technical principal, mandate, policy, scopes and backend guards are unchanged.

## Additive contract extension for #693

```text
Signal.state: ok|warn|breach|gap|needs_context|unknown

GapList {
  ref, context: { kind, ref }, contextKey,
  state: open|completed, labels[], parts[], contentHash,
  recipients[], delivered, used, completionRequested, ignoredHash?
}

shared-agent.gaps.changed.v1 {
  tenantId, agentId, functionId, gapRef, contentHash, eventId
}

Notice.kind: proposal|signal|responsibility|tier|gap
Notice (gap): { ref: "L-n", objectRef: gapRef, agentId, functionId,
                contentHash, source, labels[], context }

shared-service.correction.v1 {
  tenantId, actorId, target: "gap", ref, correctionId, at,
  correction: { functionId, gapRef, contentHash, kind: gap_done|gap_ignore }
}
```

GapLists are nested in the existing SharedAgent document. No new database or
dependency is introduced. The change event contains opaque identities, not
response labels. Notices select people with coverage of the function or its
current tenant neighbors, and require the agent's recorded recipient association.
Every constituent source also passes the existing Signals read policy and case
visibility check before labels are shown or a reference is resolved. Coverage is
never authorization. Unknown context types remain withheld, as in #723.

`contentHash` is a versioned content token: identical observations and array
reordering preserve it; a semantic change advances it, including A → B → A.
Queued obsolete versions are replaced. Already displayed versions are not
redisplayed; a changed version receives a new `L-n` reference. Old short refs and
stale confirmation previews fail closed. `proposals_only` and `off` exclude gaps.
Signal transitions from `gap` do not create a second individual signal notice.

## Confirmation and verification

```text
Hinweise für dich:
L-4: Lücken: Field A; Field B (case-a) – Function B.

Person: L-4 erledigt
CET: Ich verstehe: Lückenliste „Field A; Field B“ bei der nächsten Beobachtung
     auf Erledigung prüfen – richtig? Bitte antworte mit Ja oder Nein.
Person: Ja
CET: Bestätigt und übernommen.
```

This sets only `completionRequested`. A repeated incomplete observation leaves
the list open. Only an actual subsequent observation can close it: all previously
gap-bearing operations must now explicitly report `ok` for their aggregate source
fields. An omitted operation, unavailable response, disappeared output or native
`needs_context` does not prove closure. The completion request does not initiate
an operation. Gap portions from unobserved operations are preserved.

`L-4 ignorieren` uses the same confirmation path. It suppresses the list for its
current content until an actual observation changes it. Descriptions such as
`Lückenliste Field A erledigt` are supported when unique; function descriptions
use only `src/function-resolver.js`. Ambiguous lists require a short reference.
Recognition and confirmation stay in `src/workbench-corrections.js`; the protected
learning `confirm` action validates and journals the additive correction target.
Gap reactions do not introduce an undo outcome; a completion request is not a
terminal decision, and an ignored version can become relevant through new data.

After actual closure of a list that was displayed, the agent emits the existing
`shared-agent.feedback.v1` with `outcome: "used"` and `ref: gapRef` once for that
list. Ignoring emits `rejected` with a version-scoped reference: it refreshes
attention without a positive reactivation count or new allowance. Merely asking
for completion, observing unknown data or closing an undisplayed list emits no
positive feedback. New recurring gaps after completion receive a new list identity.

## Persistence, costs and delivery boundaries

The existing lifecycle mixin owns persistence. `maxGapLists` defaults to 20 per
agent and `maxGapLabels` to 20 per list/operation portion; recipients use the
existing bounded coverage limit. Source associations are limited by the function's
selected catalog operations. Completed records are compacted to admit new work;
open lists are never evicted. At capacity new context lists are withheld until
existing work closes. Raw responses, credentials, histories and timestamps are
not retained in the lists. Public agent overview reads omit gap labels entirely.

One pending notice and one pending feedback phase per list are persisted.
Notice publication retries use the same event identity. Feedback publication is
persisted separately from its journal delivery so a journal retry or ordinary
restart does not republish the event. As with the existing broker contract, no
distributed atomic transaction spans PouchDB and broker delivery; consumers retain
their existing reference deduplication. Notices claim a display before marking
the list delivered; structured output, hidden notices and preference suppression
cannot mark it as used. A disconnected client has the same delivery boundary as
#723. No event, correction or elapsed time finances an extra operation.

Acceptance evidence: `tests/shared-service-gaps.test.js`, the real PouchDB restart
test, and I-11's contextual-gap adapter observation and independent negative
self-tests. All I-1 through I-12 remain active.
