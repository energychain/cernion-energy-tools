# Workbench understand-first acceptance (#739)

## Contract and scope

The Workbench content path uses one `llm-client.generateStructured` facade invocation to understand the user turn, one `personal-agent.collectWorkbenchEvidence` retrieval round using the existing collectors, and at most one `llm-client.generateText` facade invocation for the grounded answer. Empty retrieval has a deterministic honest response. Provider retries/fallbacks remain inside the shared facade. Status and correction turns do not use an LLM.

The fixed schema has no specialist vocabulary. Source/domain/function associations live in `src/workbench-knowledge-sources.json`, replaceable using matching `workbenchKnowledgeSources` settings on the Workbench and Personal-Agent services. The default semantic score threshold is 0.65. Source-specific score scales prevent comparing Willi's provider score (e.g. 32) with unit-interval vector scores. Situation relevance additionally requires topical term overlap. Unrelated and duplicate hits are kept in retrieval trace, never used as answer evidence. This conservative overlap check can reject semantically related text with different wording; situation retrieval terms should include alternative expressions.

Willi/federated access uses enabled, persisted tenant/actor mapping records; hypothesis output never grants access. Tenant/user mapping, RBAC/HITL and no-call boundaries still apply. No external operation is executed. Cases store the understood concern/situation, identifiers and quoted deadline information. Unknown/invalid model output does not create a new case. `Kein Fall` marks a case discarded, unlinks its conversation and persists an immutable correction record. The conversation remembers that automatic case creation was declined.

Facade/MCP compatibility: existing action contracts and Blueprint plan paths remain unchanged. Shared knowledge collectors gain conservative relevance filtering, and Willi structure evidence gains bounded excerpt/URL/section deduplication. Their legacy EDIFACT gate remains for callers without a structured situation; Workbench bypasses it only after catalog selection and mapping checks. They do not automatically adopt background cases or new conversational understanding.

## Acceptance matrix

| AC | Evidence / validation |
| --- | --- |
| AC-01 | `tests/workbench-conversation.test.js`: anonymous foreign mail, citations, <=3 questions, background F-n case containing identifiers/deadlines |
| AC-02 | Empty retrieval, explicit uncertainty, no fabricated number of days; no answer-model invocation |
| AC-03 | Stable question keys and normalized question text; nonconsecutive follow-ups and persistence expiry/reopen |
| AC-04 | Smalltalk/knowledge/status create no cases; status and `Kein Fall` use no model; discarded state, journal and conversation suppression |
| AC-05 | External wish produces notice and explicit draft request produces internal case draft; external send spy untouched |
| AC-06 | Router/broker input is concern + situation; #730 corpus and foreign-document corpus measured with stubbed understanding |
| AC-07 | Fixed schema checked by domain-free-core; deterministic facade stubs with no LLM keys; anonymous production-style acceptance transcript below |
| AC-08 | Shared-service harness <60s, authenticated HTTP-e2e and gateway negative cases; local stub latency reported separately from live latency |

## Anonymous acceptance transcript review

Input: supplier mail addressed to an operator, overdue answer to registration, reference `99000000001`, claim that a deadline was exceeded, followed by “Kannst du mir helfen?”. This is the scenario supplied in #739, not a downloaded production conversation.

Expected reviewed behavior: understand the person is asking for help with someone else's message; retain the reference and the *claim* of lateness without asserting an actual statutory deadline. Explain the relevant retrieved evidence, ask for the original reference/date/process version, create a background case, and offer `Kein Fall`. A subsequent “Antwort per Mail senden” must say CET cannot send. “Entwurf bitte” stores an internal draft. “Kein Fall” withdraws the case. The automated acceptance fixture exercises this sequence.

Live manual assessment of an actual test-instance answer and provider latency requires an explicitly identified test instance and mapping. No live production quality or latency claim is made from CI stubs.


## Measured offline results

Generated with `node scripts/eval-workbench-understanding.js`; full rows and methodology are in `739-routing.json`. The facade stub is deterministic; these measurements verify the plumbing, not a real model's understanding quality.

| Corpus | N | Top-1 before → after | Top-3 before → after | Unknown before → after | Wrong domain before → after |
| --- | ---: | --- | --- | --- | --- |
| Frozen #730 | 413 | 268 → 271 | 280 → 282 | 153 → 153 | 219 → 219 |
| Foreign-document wrappers, existing examples | 16 | 16 → 16 | 16 → 16 | 0 → 0 | 3 → 3 |

The retained domain errors are explicit limitations of the offline stub/router combination. This change does not claim to repair the entire earlier domain-classification corpus. Existing capability regression rows are still tested separately.

## Local validation

- Authenticated HTTP-e2e: 156 actual services, gateway negative cases, conversation/history flow, internal drafts and no external effects passed; total 18.30 s. Five initial content turns: median 210 ms, maximum 297 ms with stubbed providers.
- Shared-service CI harness: 86 tests, 33.62 s (<60 s).
- Personal-Agent/MCP/Sidecar/gateway/Workbench regression: 42 suites passed; the only failing suite was a prompt assertion that expected the raw identifier. After correcting it to expect the reversible placeholder, the Workbench suites passed (494 tests), plus retrieval/privacy/question-budget tests (444 tests including the conversation corpus).
- TDD matrix: 82 tests passed, 4 explicit blackbox skips; hard required-ID coverage 66/66 = 100%.
- Lint passed (one pre-existing unused-variable warning); domain-free-core passed with no findings. Generic vocabulary exemptions cover conversational and privacy terms, not source/domain associations.
- `check:llm`, build and `audit:openapi` passed (zero OpenAPI issues, existing warnings); OpenAPI and llm context regenerated using repository generators.
- `git diff --check` passed. Full unit CI and final staged GitNexus results are recorded in the PR after completion.

Read-capability evidence delegates to existing `signals.observe` and its permission/mandate/no-call policy, bounds reads to two catalog operations, and requires a matching understood hypothesis. Opaque reference placeholders use the existing PII scrubber and a local reidentification map that is never sent to the facade. Shared PII filtering remains active. Discarded cases cannot be continued.
