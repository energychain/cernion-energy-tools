# System activity queries (#700)

The governed OpenAI model uses the existing mapped-principal `workbench.query`
path for `system_activity_query`. The intent router delegates recognition and
presentation to `src/workbench-system-activity.js`. It does not create a case,
reserve a conversation, record a Coverage turn, append a journal entry, wake an
agent or call Knowledge, RAG, Personal-Agent or an LLM text-generation API.
Only this intent may request one question embedding through `src/llm-client.js`;
the existing facade applies scrubbing, tracing and quota accounting.

## Resolver interface for #701

```js
const { resolveFunctions } = require('../src/function-resolver');
const result = resolveFunctions(message, { model, maxCandidates: 25, minScoreGap: 0.25 });
// {status: 'none'|'resolved'|'ambiguous', totalMatches,
//  matches: [{functionId, label, confidence, score, matchedBy}]}
const { resolveFunctionsHybrid } = require('../src/function-resolver-hybrid');
const hybrid = await resolveFunctionsHybrid(message, { model, wordWeight: 0.7, vectorWeight: 0.3 });
// same result, plus metadata: {path: 'hybrid', provider, model, dimension}
// or {path: 'lexical', fallbackReason}
```

Words come only from labels, semantic aliases, domains, departments, keywords and
keywordTokens. IDs remain opaque and fn-* tokens are removed from both lexical
and embedding inputs. Shared Unicode/case/separator normalization tokenizes both
sides. Compounds additionally use pieces found in the model vocabulary; substring
and prefix matches require at least five characters and receive a squared length
ratio penalty. Each query token contributes its strongest match, weighted by
`log(1 + functionCount / documentFrequency)` and field weight (label/domain/department
4, alias/keyword 1). Repeated keywords cannot inflate scores. Confidence is relative
to the best lexical score, not a probability. Resolution requires a relative score
gap of at least 0.25; otherwise at most 25 ranked candidates are returned. The larger
candidate bound preserves broad-domain ambiguity rather than hiding plausible functions.

The offline generator averages compatible capability vectors and normalizes the
mean. Every function records provider, model, dimension and missing capabilities;
invalid/incompatible entries are gaps. Existing stale-cache reporting remains
unchanged. No provider is called by model generation.

The hybrid resolver checks the effective facade provider/model and the configured
`dimension` against cache identity, requests that exact model/dimension, and verifies
the returned vector. Default score is 0.7 normalized word score + 0.3 positive
cosine similarity; `wordWeight`, `vectorWeight`, `minScoreGap`, `minPrefixLength`,
`maxCandidates`, `dimension` and `timeoutMs` are configurable via
`workbench.settings.systemActivityResolver`. Embedding timeout defaults to 3000 ms;
retries are disabled (one attempt). Missing cache, incompatible identity/dimension
or embedding failure returns the full lexical result, logs a reason code without
question text, and includes `resolution.fallbackReason` in the Workbench response.
No Knowledge/RAG fallback exists. Other intents never request this embedding.

The resolver performs no correction or authorization; #701 must apply its own
existing authorization before publishing any correction. Stored references continue
to resolve through the source services' existing lineage handling.

## Sources and visibility

Single-function queries read `activation.explain`, `journal.digest`, `agents.list`
and, only for existing management roles, `function-coverage.byFunction`. Overview
queries first read `activation.list`, prefer active rows and show at most five
functions. Inventory queries select `attention.tier === inventory`. Source calls
use the mapped tenant/actor/roles unchanged; `systemActivityReadTimeoutMs` defaults
to 3000ms per read. Missing, denied, unavailable or mismatched sources never become
absence-of-responsibility evidence and never trigger a Knowledge/RAG fallback.
Partial sources produce a clear incomplete-state note; absent activation produces
`state_unavailable`.

Non-managers receive only observed human responsibility, without identities.
ROLE_TENANT_ADMIN / ROLE_ADMIN may receive Coverage's visible actor IDs;
ROLE_UTILITY_HQ retains Coverage's tenant-specific pseudonyms and cannot re-identify
them from activation or journal. Coverage is observed activity, not organizational
ownership, competence or permission. Missing Coverage is explicitly a source gap.
Journal reference policy stays authoritative. Responses contain scalar summaries,
timestamps and hidden-reference counts, never raw refs, prompts, private activation
history, agent mandates, database revisions or tool payloads. Each open-entry array
is capped at ten recent summaries; counts remain exact. Rendering shows at most
three summaries per category and translates lifecycle and tier values.

## Example dialogues (neutral data)

| Question | Observed answer |
| --- | --- |
| Was macht Function A gerade? | Function A: derzeit nicht aktiv, weil noch nicht berührt. |
| Was macht Function A gerade? | Function A: aktiv mit beobachteter menschlicher Verantwortung. Menschliche Abdeckung wurde beobachtet; Personenbezüge sind hier nicht sichtbar. |
| Was macht Function A gerade? | Function A: aktiv mit CET-Verantwortung. Aufmerksamkeit: vorübergehend; Relevanz 50 %; Rahmen 1 Einheiten. Agent-Zustand: aktiv. Offene Erwartungen: 1. Waiting for evidence. |
| Was macht Function A gerade? | Function A: schlafend; wartet auf Anstoß und einen ausreichenden Rahmen. |
| Was macht Function A gerade? | Function A: ruhend; wartet auf Anstoß. |
| Welche Agents laufen? | A bounded overview of the observed functions, translated agent states and journal summaries; zero observed active rows leave functions latent. |
| Was gehört zum Inventar? | Only functions with the inventory attention tier, or a clear empty-inventory statement. |
| Warum kümmerst du dich um Function A? | CET übernimmt ergänzend eine benachbarte Funktion, für die noch keine ausreichende menschliche Abdeckung beobachtet wurde. |
| Was macht shared phrase gerade? | Welche Funktion meinst du? Function A; Function B. |
| Was macht Function A gerade? (service unavailable) | Der CET-Systemzustand ist derzeit nicht erreichbar. Bitte versuche es später erneut. |
| Was ist Function A? | knowledge_query; the existing explanation path remains authoritative. |

These answers report state only. The positive follow-up is a request to clarify or
choose a visible expectation, never a command, permission or newly created task.
