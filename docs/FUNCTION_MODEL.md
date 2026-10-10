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

Initial IDs use the first canonical capability identifier. Subsequent generations
match capability membership to the committed model and retain identities (see below). Labels
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
now 2. ID lineage adds metadata without changing the accepted grouping algorithm.

## Stable IDs and lineage

The generator reads `HEAD:function-model.json`, the last committed model, rather than
trusting a possibly edited working artifact. A missing committed model bootstraps IDs;
malformed committed JSON fails generation. Repeated generation before or after committing
outputs is byte-stable. `sourceHash` covers the implementation and catalogs, while
`statistics.idChanges.previousSourceHash` identifies the lineage baseline.

An old ID goes to its largest overlapping successor when more than half of its previous
capabilities survive there. For a split, the largest part keeps the old ID even if no
part has an absolute majority. Ties use canonical capability membership. In a merge,
the largest qualifying predecessor supplies the ID, with canonical ID tie-breaking.
New IDs use the original naming rule plus deterministic numeric suffixes when necessary.
Every previously assigned ID stays reserved; `gaps.retiredFunctionIds` accumulates IDs
that cease to be active. Retired IDs are never reassigned, even when names normalize alike.

Each function has `derivation.lineage: [{previousId, relation, overlap}]`. Relations
are `same`, `merged` or `split`, with `split` taking priority when an ancestor has
multiple successors. `overlap` is the intersecting capability count divided by that
ancestor's recorded capability count (range 0–1). Additive root `lineageHistory` stores
the capability union ever assigned to each ID, including retired IDs. This permits
precise resolution across multiple committed generations: an old alias resolves only
to descendants sharing its recorded capabilities, while later additions to a retained
ID remain resolvable too. Nested historical aliases can therefore retain `merged`
relations even after the immediately preceding group splits.

The report's **ID-Änderungen gegenüber Vorversion** section counts previous active IDs
by their immediate membership transition (`same`, `merged`, `split`), IDs retired in
that transition and newly allocated IDs. Retired counts can overlap merged counts.
No-op generations preserve the last transition's counters and lineage rather than
erasing the recorded transition when its output becomes the next committed baseline.

These additive fields extend the #693 data contract for durable ID resolution; required
fields and event names stay unchanged. Lineage is identity metadata, never authorization.

## Loader

```js
const {
  getFunctionModel,
  getFunction,
  getNeighbors,
  resolveFunctionId,
  findFunctionsForCapability,
  findFunctionsForOperation,
} = require('../src/function-model');

const model = getFunctionModel(); // loads only the committed JSON, once
const options = { model }; // injected fixtures need no filesystem I/O
const successors = resolveFunctionId('fn-a', options);
// [{ functionId, relation: 'same' | 'merged' | 'split', overlap }]
const fn = getFunction('fn-a', options); // exact current ID only; null if absent
const neighbors = getNeighbors('fn-a', { model, minWeight: 0.2 });
const byCapability = findFunctionsForCapability('a', options);
const byAction = findFunctionsForOperation('svc-a.read', options);
```

Treat returned objects as read-only. Queries never authorize execution. The module
is not wired into routing, receipts, coverage, agents or authorization.

Consumers of stored `functionId` values must call `resolveFunctionId(id, options)`
before looking up current functions. A split can return multiple successors, including
the larger part retaining the queried ID. Unknown IDs and retired IDs without any
surviving capabilities return `[]`. Consumers must explicitly handle multiple/empty
results when migrating their own state; this loader performs no persistence or automatic
copying of coverage, activation, agents or journal entries.

## Semantic evidence (#708)

`npm run generate:function-model-embeddings` is the only online step. It loads the
existing `.env` and calls `src/llm-client.js.embeddings()`; `embeddingConfiguration()`
returns the effective provider/model from its adapter, including local Ollama.
`LLM_EMBEDDING_MODEL` and provider-specific fallbacks retain their existing meaning.

### Corpus-derived text, version 2

Text is a compact JSON array: text version followed by canonically ordered, unique
filtered fragments. Fragments originate exclusively from tokenized capability IDs,
keywords, all string values in requiredInputs, risksAndNotes, resolved-operation
summaries and descriptions of matching semantic domains. Input object keys are
canonically traversed; metadata keys themselves do not become embedding text.
**abstractionLevel and routingPattern are excluded** because they describe form.

Camel case and `_ . / -` separators are split; NFKD removes combining marks and
case is folded. Sentence boundaries use terminal punctuation followed by whitespace
and line breaks. Sentence keys are normalized Unicode word sequences, so case and
punctuation variants count together. Document frequency counts a token or sentence
at most once per capability, across every field, including notes and summaries.

A token or sentence recurring in more than `embeddingBoilerplateMaxFraction=0.2`
of all capabilities is removed before embedding. A value occurring in only one
capability is never recurring boilerplate, including small fixture catalogs. Whole
frequent sentences are removed first, then frequent tokens from remaining fragments;
empty fragments disappear. Completely empty results are reported as `empty` gaps
and never embedded as a shared placeholder. There is no domain vocabulary or manually chosen stoplist.
Changing corpus membership can change filtered text for otherwise untouched entries;
only resulting textHash changes cause a refresh. SHA-256 covers the complete text,
including version 2. Permuting capabilities, operations or input fields is irrelevant.

### Cache and dimensionality

The committed cache remains valid JSON but has **one capability entry per line**,
with a compact vector array. Each entry records textHash, provider, model, actual
`dimension`, requested `outputDimensionality` and the rounded vector. Precision is
`embeddingDecimals=4`; requested dimensionality is `outputDimensionality=768`.
Set the latter to null to request the provider's native dimension.

The facade forwards the optional hint: Gemini uses outputDimensionality
([API reference](https://ai.google.dev/api/embeddings)); OpenAI-compatible providers
use dimensions. Existing calls with no hint retain their payload. Ollama retains
its native output; providers that do not implement the hint are never simulated by
slicing a vector. Requested and actual dimensions remain separately visible.
The actual configured Gemini response was verified to contain 768 values. A change
of provider, model, requested dimension or filtered text refreshes affected entries.
The cache is written only after every request succeeds. No real-catalog vectors
are invented, and cached vectors are never truncated locally.

Both model commands remain offline: they read the cache without importing the LLM
facade or adapters. Missing, stale and invalid entries are reported in
`gaps.embeddingCacheEntries` without aborting. Cache bytes and the text-builder
implementation enter sourceHash. Different providers, models or actual dimensions
are incomparable and supply no semantic evidence.

### Complete linkage and bounded semantic groups

Cosine must meet semanticSimilarityThreshold=0.85. Pair grouping scores add
semanticGroupingWeight × cosine to structural overlap, capped at 1. Weight 0.72
permits semantic-only merges (0.72 × 0.85 > mergeSimilarity=0.6).

For each candidate group union, all cross-pair weighted scores must qualify.
If **every pair in the entire union** also qualifies on structural overlap alone,
the existing structural rules apply. Otherwise **every pair in the entire union**
must have comparable embeddings and cosine at least the semantic threshold, and
its total size must not exceed maxSemanticGroupSize=5. This includes intra-group
pairs, preventing structural subgroups or similarity chains from bypassing the
semantic complete-link rule. The size cap conservatively covers every grouping
that needs semantic support, not just grouping with no structural references.

Neighborhoods contribute at most one semantic signal per function pair, using the
highest comparable cross-capability cosine. Contribution remains
maxEvidenceContribution × min(1, semanticNeighborWeight × cosine); a single signal
cannot reach default minWeight. Existing mutual selection still bounds both endpoints.
Vectors are used only by the offline generator, never runtime routing/classification.

### Coherence and review

Every function records meanSimilarity, minimumSimilarity, comparedPairs and
possiblePairs over **all** unordered capability pairs, including below-threshold
cosines. Singleton and unavailable comparisons are null/N/A, not artificially 1.
The report lists every function and separately the 10 lowest measurable minima.
Global coherence reports the smallest pair cosine and median of per-function
minima (also median of means), excluding singletons and incomplete comparisons.
Structural groups may have minima below the semantic threshold; this is visible
rather than silently removed or mislabeled as semantic evidence.

**Zusammenführungen ohne strukturelle Evidenz** lists every cross-capability pair
joined without an unsuppressed shared operation, declared action, service, data
source, entity or write target, preserving IDs and cosines for review. Kinds remain
configured in structuralEvidenceKinds. Cumulative lineage protects saved main IDs;
the generated lineage report lists historical IDs and successors. The reviewed
regeneration uses the model on the merged main revision as its identity baseline;
subsequent no-op generations retain that transition's provenance.

After each merge of main regenerate function-model.json, both reports and llm.txt;
never resolve generated conflicts by hand. Refresh changed cache texts separately
through the explicit online command. Normal generation/checking needs no provider.

### Offline function vectors for activity resolution (#700)

The generator adds `Function.embedding` from compatible capability vectors in
`function-model.embeddings.json`: `{ provider, model, dimension, vector,
missingCapabilities, staleCapabilities }`. `vector` is the normalized arithmetic
mean, rounded deterministically to ten decimals; missing/incompatible entries are
reported without stopping generation. If no usable entries exist, identity fields
and vector are null. Cache text validity continues to use the existing #708 check;
stale entries are excluded and remain listed in the gap report. Function grouping,
lineage and neighbors do not use this new field and remain unchanged.

Activity resolution may embed a question through the LLM facade, using the same
provider/model/dimension, then combine positive cosine similarity with normalized
lexical overlap. See `WORKBENCH_SYSTEM_ACTIVITY.md` for the configuration, fallback
metadata and bounded clarification contract. No embedding provider is called by
the model generator.
