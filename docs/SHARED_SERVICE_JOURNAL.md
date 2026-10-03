# Shared Service Journal (#698)

The `journal` Moleculer service records generic shared-service activity in a
separate PouchDB database through `createPouchDbLifecycleMixin`. No LLM, UI,
external operation, learned authorization or domain-specific branch is involved.

## Actions and immutable entry contract

- `journal.append({functionId, kind, summary, refs?, agentId?, entryId?, at?})`
- `journal.byFunction({functionId, since?, kinds?})` returns an ordered entry array.
- `journal.byAgent({agentId, since?, kinds?})` returns an ordered entry array.
- `journal.digest({functionId})` returns the stable version 1 contract below.

All actions require the existing authenticated tenant/actor/role principal.
An optional `tenantId` must match authenticated identity; a request parameter or
`meta.tenantId` alone cannot establish identity. These are internal broker actions;
this issue introduces no REST routes. Existing gateway authorization remains in force.

Entries follow #693: `{entryId, tenantId, agentId?, functionId, kind, summary,
refs, at}`. Kinds are `observed`, `decided`, `proposed`, `awaiting`, `corrected`,
`woke`, `slept`, `created`, `retired`. Summary is plain, user-readable producer text,
1–280 characters; producers must not embed private object identifiers/content in
it. Automatic event summaries contain no object identifiers or payload content.
Dates normalize to UTC ISO strings. Entries order by `at`, then immutable per-tenant append position and canonical `entryId`
for equal timestamps. Duplicate IDs are rejected with 409, including after archival.
There is no update/delete action, and input/response objects cannot mutate stored
records. Public reads add `hiddenRefCount`, never storage metadata.

Stored IDs resolve through `resolveFunctionId()` on every read. Split predecessors
appear under each current successor; merged predecessors appear under the current
function. `byFunction` accepts old IDs. A digest requires an identity resolving to
exactly one function; ambiguous splits return 422 so callers choose a successor.
Lineage never grants permissions.

## Deterministic digest contract for #700

```json
{
  "schemaVersion": 1,
  "tenantId": "tenant-a",
  "functionId": "fn-a",
  "status": {
    "state": "active",
    "responsibility": { "humans": [], "cet": true },
    "agents": [{ "agentId": "agent-a", "lifecycle": "active" }]
  },
  "openExpectations": [],
  "lastDecisions": [],
  "openProposals": [],
  "entryCount": 1,
  "lastEntryAt": "2026-01-01T00:00:00.000Z"
}
```

Array elements are visibility-filtered JournalEntries. Status defaults to latent,
no humans/CET responsibility and no agents if there are no activation entries.
The latest activation sets state/responsibility; the latest lifecycle per agent
sets its lifecycle. Agents sort canonically by ID. `awaiting`/`proposed` entries
remain open until a later `decided`/`corrected` entry includes
`{kind: "journal", id: "entry-id"}` in refs. This is a generic settlement convention,
not an inferred decision or correction policy. Latest decisions are the last ten
`decided`/`corrected` entries in chronological order. Counts include archived
entries; `lastEntryAt` is null when empty. The digest depends only on entries and
current identity lineage, with reference presentation depending on the caller's
existing permissions. It never uses wall time or an LLM.

## Automatic event producers

Subscriptions accept the tenant-scoped in-process events defined in #693:

| Event                            | Journal representation                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `function.activation.changed.v1` | `decided`, private activation snapshot supplies digest state/responsibility; records active, dormant, latent and human handoff |
| `shared-agent.lifecycle.v1`      | proposed → created, active → woke, sleeping → slept, retired → retired; private lifecycle snapshot supplies digest agents      |
| `shared-service.correction.v1`   | `corrected`, original `ref` retained; records all four target kinds without applying learning                                  |

Events are trusted internal producer inputs; they do not require a user principal
and must carry their tenant ID. Broker producers must await emission to settle.
For correction association, `ref` may be a current/previous function ID or an agent
ID already recorded in that tenant. Opaque coverage/neighbor references require
`correction.functionId` (or additive top-level `functionId`). An unresolvable
association is rejected, rather than guessing or creating cross-tenant links.

#709 was still open when this implementation started. Its production activation
emitter/real adapter will be integrated when available on main. Fixture events
exercise the exact versioned contract now, without implementing activation (#696),
agents (#697), activity queries (#700) or learning (#701).

## Reference visibility

Opaque string refs and unknown types are stored but returned only as counts.
Structured refs use `{kind, id, caseId?}`. Policy comes from existing services,
never from claims embedded in a ref:

- `case`: Domain Router `loadCase` enforces actor, role, tenant and sensitivity.
- `event`: first authorize `caseId`, then load the actual event and verify its
  tenant/case association.
- `evidence`: first authorize `caseId`, then load the actual Workbench EvidenceRef
  and use `canViewEvidence` with the caller's clearance.
- `operation`: authorize `caseId` and call existing `workbench.tool-runs.get`
  for the actual ToolRun ID. Catalog operation names alone establish no access.
- `hitl`: existing `hitl.get` with authenticated tenant; verify returned tenant.
- `journal`: the referenced immutable entry must exist in the same tenant.

Denied/missing/unavailable objects are hidden. The count contains no hidden IDs,
URLs, type names or payloads. This applies to append responses, both read actions,
and all digest entry arrays. Retention does not freeze authorization: archived
references are checked again at read time.

## Retention and persistence

`SHARED_SERVICE_JOURNAL_DB_PATH` defaults to `./data/shared_service_journal`.
`SHARED_SERVICE_JOURNAL_RETENTION_MS` defaults to 30 days; zero immediately makes
past entries eligible. The service runs hourly retention sweeps. The interval and
`archiveBatchSize` (1–100, default 100) are configurable service settings.

One document holds one recent entry. Older entries are losslessly compacted into
compressed, immutable archives of at most 100 entries per tenant. This is a raw
storage retention threshold, **not deletion of the audit history**. Open
expectations, decisions, historical filters, byAgent and digest remain exact.
Archival writes the archive before removing originals; readers deduplicate IDs
if a crash interrupts deletion. Archive IDs are content hashes so retries are
safe. Writes and archival serialize in the single-process service. DB compaction
reclaims removed raw document bodies. No ever-growing tenant document is used.
Total history still grows with activity; reads currently scan the tenant's
journal documents. Pagination/indexed archival reads are future scale work.

## Harness

`tests/helpers/shared-service/real-adapter.js` instantiates the real journal and
injects an in-memory PouchDB double at the existing lifecycle seam. Its snapshot
returns the `journal` observation array with #693 fields and stored correction
refs, independently of activity-query responses. `close()` advances fake timers
while Moleculer stops. Upstream input types remain unimplemented until the relevant
services land. I-5 (#700) and I-7 (#701) remain todo. Journal-specific tests cover
AC-01–AC-05 now, including event emission and retention under fake time.
