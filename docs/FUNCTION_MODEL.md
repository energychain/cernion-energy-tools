# Generated function model (#694)

`npm run generate:function-model` writes the committed `function-model.json` and
`function-model.report.md`. `npm run check:function-model` compares both files
byte for byte, without writing, and exits nonzero on missing or stale outputs.

## Sources

Inputs are curated capabilities, the committed operation-capability index, semantic
domains and static service declarations. The generator never executes services,
starts a broker, calls an LLM or changes catalogs. Only resolvable `preferredActions`
contribute to `operations` and its data/entity/effect metadata.

Static action declarations also distinguish catalog references that exist but are
missing an `action` in the index from references not found in source. Local
CommonJS action spreads and explicit OpenAPI operation IDs are resolved statically.
Source actions with no matching index entry are a separate category; version-qualified
references that differ from a matching index action are reported separately too. They
are **not** fabricated as resolved operations. Existing, source-verified preferred
Action references can contribute structural evidence as `declaredActions`.

No manual grouping or override file is introduced. `gaps.overrides` reports that
none were applied. All algorithmic parameters, feature weights and infrastructure
references are data in `function-model.parameters.json`.

## Capability-first grouping

Start with one group per capability, independently of its domain. Domain identifiers
use NFKD, combining-mark removal, lowercase and collapsed separators. Normalization
remains a feature; it does not force same-domain capabilities into a group.

Build feature sets from operations, source-verified preferred actions, services,
data sources, entity types, write targets, normalized domains, matching semantic
departments, keywords and input names. Keyword tokenization reuses the existing
operation-index helper; the configurable minimum token length is 4.

For a feature occurring in `df` of `N` capabilities, normalized rarity is
`ln(1 + N / df) / ln(1 + N)`. Configured hubs and features occurring in at least
25% of capabilities (for populations ≥ 10) contribute zero. Action references to
configured placeholder services also contribute zero. There is no event-name list.

Similarity is weighted overlap: shared weighted mass divided by the **smaller**
feature mass. A small signature contained in a larger one is therefore not penalized
by the larger signature's additional features. At least two distinct non-domain,
non-department references must support a merge. Data sources, entities and write
targets have grouping weights 3, 2 and 2; operation identifiers and verified Action
references each have weight 0.3. Keywords/inputs contribute only 0.01 each, so names
cannot overwhelm shared operational structure. Other weights are in the parameters.

Agglomeration repeatedly merges the pair of groups with the highest complete-link
score: **every** cross-group capability pair must have overlap ≥ 0.6. Stop when
none qualify. Scores and rarity are computed once over the initial capability
population, preventing shifting frequencies during clustering. Complete linkage
prevents an overlap chain from combining disjoint endpoints. Canonical UTF-16
capability ordering breaks ties deterministically.

IDs use the first canonical capability identifier, not the domain name. Labels
come from that capability's label or identifier. Thus multiple functions may have
the same domain and a function may contain multiple domains.

This intentionally refines the original AC-03 interpretation according to the
PR #703 review: spelling variants with the same functional signature merge, while
a shared normalized domain alone cannot override disjoint operational evidence.

## Evidence and infrastructure suppression

After grouping, recompute rarity over functions. For events, `df` counts the union
of functions that emit **or** listen. For resources, it counts the union of writers
and readers. Both have the same automatic hub rule as other features. Wildcard
listeners use the existing Moleculer matcher, and their own rarity can only reduce
the contribution. Frequent event subscriptions therefore cannot bypass suppression.

A contribution is `maxEvidenceContribution * min(1, strength) * rarity`.
The configured maximum is **0.18**, strictly below standard `minWeight=0.2`;
incompatible parameter values fail validation. Shared strength depends on the
feature weight. Directed events and write/read relationships have higher configured
strengths than weak shared services or domains, but cannot exceed the single-feature
cap. An event or a resource with several representations contributes only once:
evidence is deduplicated by reference, with the strongest relationship retained.
No individual reference can create a default-threshold edge.

Keyword phrases and their catalog-derived tokens provide weak corroborating
features; common tokens are automatically suppressed rather than filtered through
a handwritten vocabulary. Pair weights sum the independent contributions and are
capped at 1. All retained edges expose their contributing references and weights.

## Sparse neighborhood selection

After scoring, select a mutual strongest-neighbor graph. At populations ≥ 10,
each endpoint ranks candidate peers by the larger of the two directed pair weights,
then canonical ID. Each can retain at most `floor(0.25 * N)` peers. An above-threshold
edge is retained only if both endpoints select the pair. Direction and evidence
weights remain unchanged; reverse edges are never invented. This bounds outgoing,
incoming and distinct-peer degrees while retaining strong local relationships.
Below-threshold evidence remains available for callers choosing a lower threshold.
Small fixtures below the configurable population minimum skip the peer budget.

The report exposes **candidate** degree statistics before this selection, the number
of pruned directed edges and the resulting degree statistics. The budget is not used
as a substitute for event/resource hub suppression. Current selection removes 34
above-threshold directed edges and does not increase isolation; raw maximum degree
42 becomes 30. No index or runtime permission is modified by this selection.

Reported density is directed edge count at standard threshold divided by
`N * (N - 1)`, excluding self-loops. The historical naive baseline 0.49 used
capability nodes; comparisons expose numerators and denominators because the node
sets differ. Reports include capabilities-per-function distribution, singleton
fraction, cross-domain function count and minimum/median/maximum outgoing degree.
Every function with zero default-threshold outgoing edges has a reason in the gaps.

## Static events and limitations

The analyzer uses the already declared `@babel/core` development dependency. It
extracts broker `emit`/`broadcast` literals, immutable local string constants with
lexical scope, and actual `events` handlers. OpenAPI event-field schemas are ignored.
Local imports, split modules and cycles are followed without execution. Dynamic
emissions and spread handlers are reported, not guessed. Source-verified actions
are likewise static declaration evidence, not proof of runtime availability.

Events are service-level evidence, not action-level execution traces. Functions
without events and functions without listeners are reported separately; emission
alone does not make a function wakeable. No events are emitted by this module.

## Contract and reproducibility

Every function retains the required #693 fields: `functionId`, `label`, `sources`,
`capabilities`, `operations`, `dataSources`, `entityTypes`, `events`, `neighbors`
and `derivation`. `writesTo`, `services`, `domains`, `departments`,
`consequenceLevels`, `declaredActions`, `keywords`, `keywordTokens` and `inputs`
are additive projection metadata. Sources use `{kind, ref}`; edges use
`{functionId, weight, evidence}`. No epic event names are changed.

`sourceHash` covers canonically ordered source paths and contents, catalogs,
scanned modules, generator implementation and parameters. It contains no absolute
paths. `derivation.generatedAt` is a configured reproducible ISO timestamp (Unix
epoch by default), not the wall-clock time of each run. The derivation version is
now 2; capability-based IDs and grouping membership differ from the first draft.
No runtime consumer of this PR's graph existed, so no migration is introduced.

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
const byCapability = findFunctionsForCapability('a', options);
const byAction = findFunctionsForOperation('svc-a.read', options);
```

Treat returned objects as read-only. Queries never authorize execution. The module
is not wired into routing, receipts, coverage, agents or authorization.
