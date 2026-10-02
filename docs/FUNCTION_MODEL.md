# Generated function model (#694)

`npm run generate:function-model` writes `function-model.json` and
`function-model.report.md`. Commit both. `npm run check:function-model` compares
both files byte for byte and exits nonzero on drift, including missing outputs.
This is an independent check, analogous to the operation-capability index check.

## Sources and grouping

The generator reads `CURATED_CAPABILITIES`, the committed operation-capability
index, semantic domains and static service source. It never loads service modules,
starts a broker, calls an LLM, or modifies catalogs. Only resolvable
`preferredActions` contribute operations; candidate rankings are not execution
proof. Capabilities without resolvable actions remain assigned and are reported.

Domain identifiers use NFKD, combining-mark removal, lowercase and collapsed
non-alphanumeric separators. Thus punctuation variants form the same initial
group without an alias list. Missing domains fall back to the capability ID.

Initial groups merge at Jaccard feature similarity ≥ `mergeSimilarity` (0.85).
Features include operations, non-hub services, data sources, entities, write targets,
normalized domains and the department of a matching semantic domain. Complete-link
comparison against all original groups prevents transitive weak bridges. Canonical
UTF-16 ordering makes group selection deterministic. The function ID uses the
first normalized domain; labels are derived from the grouped domain identifiers.

No manual grouping or override file is introduced. `gaps.overrides` explicitly
reports that no overrides were applied. The optional override mechanism in the
issue is deferred until there is an evidenced catalog correction to represent.

## Neighbors and density

All parameters live in `function-model.parameters.json`, including hub references
and placeholder service names. The core has no scenario-specific literals.
Configured hubs contribute zero. Across ≥ 10 functions, features present in ≥ 35%
of functions are also suppressed and listed in the report.

A shared feature receives its configured weight times `ln(1 + N / df)`, where
`N` is the function count and `df` the number of functions with that feature.
Shared evidence contributions are divided by the sum of weighted features in the
pair's union (weighted Jaccard). Rare features therefore contribute more.

Directed emission → listener evidence adds 0.8 (using the existing Moleculer
`Utils.match` helper for wildcard subscriptions) and directed write target → data
source evidence adds 0.7. These causal contributions are stronger than weak shared
service evidence. Hub suppression also applies to write/read targets. The final
edge weight is the sum of its evidence contributions, capped at 1. Every positive
edge is stored, so callers can select a different `minWeight`. Evidence retains
uncapped individual contributions to explain saturated edges.

The reported default density is the number of directed edges with weight ≥ 0.2
divided by `N * (N - 1)`, excluding self-loops. Reciprocal edges count separately;
for symmetric graphs this is equivalent to undirected density. The historical
naive baseline of 0.49 used capability nodes, whereas this projection uses function
nodes; the report exposes its numerator and denominator rather than claiming an
identical graph comparison. The target is ≤ 0.15, tested against the real catalog.

## Static events and limitations

The build-time analyzer uses the already declared `@babel/core` development
dependency, without new packages. It extracts broker `emit`/`broadcast` string
literals, immutable local string constants with lexical scope and `events` object keys, and follows local
CommonJS imports, including split service modules and cycles. Comments and nested
handler bodies do not become listener names. This is service-level evidence, not
an action-level execution trace. Dynamic emissions and spread handlers are
reported rather than inferred. No events are emitted by the generator or loader.

Functions with no known events and functions with no listeners are reported
separately: an emission alone does not make a function directly wakeable.

## Artifact contract and reproducibility

Each function contains all fields specified by epic #693:
`functionId`, `label`, `sources`, `capabilities`, `operations`, `dataSources`,
`entityTypes`, `events`, `neighbors`, and `derivation`.
Additive metadata required for the projection comprises `writesTo`, `services`,
`domains`, `departments`, and the `consequenceLevels` histogram. The epic's fields
and event names are unchanged. Sources use `{kind, ref}`; edges use
`{functionId, weight, evidence}` with evidence `{kind, feature, ref, weight}`.

`sourceHash` is SHA-256 over canonically ordered source paths and file contents,
including the catalogs, all scanned local source modules, generator implementation,
canonical ordering utility and parameter file. It contains no absolute paths.
`derivation.generatedAt` is a configured reproducible timestamp (Unix epoch by
default), not the wall-clock time of each generator invocation. This preserves
the required ISO timestamp field while ensuring identical inputs yield identical
bytes across independent processes and machines. Changing parameters also changes
the source hash.

## Loader

```js
const {
  getFunctionModel,
  getFunction,
  getNeighbors,
  findFunctionsForCapability,
  findFunctionsForOperation,
} = require('../src/function-model');

const model = getFunctionModel(); // loads only the committed JSON, once
const options = { model }; // injected fixtures need no filesystem I/O
const fn = getFunction('fn-a', options); // null if absent
const neighbors = getNeighbors('fn-a', { model, minWeight: 0.2 });
const byCapability = findFunctionsForCapability('cap-a', options);
const byAction = findFunctionsForOperation('svc-a.read', options);
```

Treat returned catalog objects as read-only. Queries return functions or neighbor
edges, never permissions or executable recommendations. This additive module is
not wired into runtime routing, receipts, coverage, agents or authorization.
