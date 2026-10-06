# Workbench understand-first acceptance (#739)

## Contract and scope

The Workbench content path uses one `llm-client.generateStructured` facade invocation to understand the user turn, one `personal-agent.collectWorkbenchEvidence` retrieval round using the existing collectors, and at most one `llm-client.generateText` facade invocation for the grounded answer. Empty retrieval has a deterministic honest response. Workbench sets maxRetries=1 and structuredFallback=false in the shared facade, enforcing one provider request for understanding even on failure. Other facade callers retain their existing fallback behavior. Status and correction turns do not use an LLM.

The fixed schema has no specialist vocabulary. Source/domain/function associations live in `src/workbench-knowledge-sources.json`, replaceable using matching `workbenchKnowledgeSources` settings on the Workbench and Personal-Agent services. The default semantic score threshold is 0.65. Source-specific score scales prevent comparing Willi's provider score (e.g. 32) with unit-interval vector scores. Situation relevance additionally requires topical term overlap. Unrelated and duplicate hits are kept in retrieval trace, never used as answer evidence. This conservative overlap check can reject semantically related text with different wording; situation retrieval terms should include alternative expressions.

Willi/federated access uses enabled, persisted tenant/actor mapping records; hypothesis output never grants access. Tenant/user mapping, RBAC/HITL and no-call boundaries still apply. Only catalog-declared read operations may run through existing guards; no external-effect operation is executed. Cases store the understood concern/situation, identifiers and quoted deadline information. Unknown/invalid model output does not create a new case. `Kein Fall` marks a case discarded, unlinks its conversation and persists an immutable correction record. The conversation remembers that automatic case creation was declined.

Facade/MCP compatibility: existing action contracts and Blueprint plan paths remain unchanged. Shared knowledge collectors gain conservative relevance filtering, and Willi structure evidence gains bounded excerpt/URL/section deduplication. Legacy EDIFACT and planner signal gates remain for callers without a structured situation; Workbench bypasses those gates only after catalog selection and mapping checks. They do not automatically adopt background cases or new conversational understanding.

## Acceptance matrix

| AC    | Evidence / validation                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | `tests/workbench-conversation.test.js`: anonymous foreign mail, citations, <=3 questions, background F-n case containing identifiers/deadlines |
| AC-02 | Empty retrieval, explicit uncertainty, no fabricated number of days; no answer-model invocation                                                |
| AC-03 | Stable question keys and normalized question text; nonconsecutive follow-ups and persistence expiry/reopen                                     |
| AC-04 | Smalltalk/knowledge/status create no cases; status and `Kein Fall` use no model; discarded state, journal and conversation suppression         |
| AC-05 | External wish produces notice and explicit draft request produces internal case draft; external send spy untouched                             |
| AC-06 | Router/broker input is concern + situation; #730 corpus and foreign-document corpus measured with stubbed understanding                        |
| AC-07 | Fixed schema checked by domain-free-core; deterministic facade stubs with no LLM keys; anonymous production-style acceptance transcript below  |
| AC-08 | Shared-service harness <60s, authenticated HTTP-e2e and gateway negative cases; local stub latency reported separately from live latency       |

## Anonymous acceptance transcript review

Input: supplier mail addressed to an operator, overdue answer to registration, reference `99000000001`, claim that a deadline was exceeded, followed by “Kannst du mir helfen?”. This is the scenario supplied in #739, not a downloaded production conversation.

Expected reviewed behavior: understand the person is asking for help with someone else's message; retain the reference and the _claim_ of lateness without asserting an actual statutory deadline. Explain the relevant retrieved evidence, ask for the original reference/date/process version, create a background case, and offer `Kein Fall`. A subsequent “Antwort per Mail senden” must say CET cannot send. “Entwurf bitte” stores an internal draft. “Kein Fall” withdraws the case. The automated acceptance fixture exercises this sequence.

A manually reviewed run through the real central Gemini facade is recorded below. Knowledge-source integration against a real test instance still requires an explicitly identified endpoint and mapping. No live production retrieval-quality claim is made.

## Measured offline results

Generated with `node scripts/eval-workbench-understanding.js`; full rows and methodology are in `739-routing.json`. The facade stub is deterministic; these measurements verify the plumbing, not a real model's understanding quality.

| Corpus                                       |   N | Top-1 before → after | Top-3 before → after | Unknown before → after | Wrong domain before → after |
| -------------------------------------------- | --: | -------------------- | -------------------- | ---------------------- | --------------------------- |
| Frozen #730                                  | 413 | 268 → 271            | 280 → 282            | 153 → 153              | 219 → 219                   |
| Foreign-document wrappers, existing examples |  16 | 16 → 16              | 16 → 16              | 0 → 0                  | 3 → 3                       |

The retained domain errors are explicit limitations of the offline stub/router combination. This change does not claim to repair the entire earlier domain-classification corpus. Existing capability regression rows are still tested separately.

## Local validation

- Authenticated HTTP-e2e: 156 actual services, gateway negative cases, conversation/history flow, internal drafts and no external effects passed; total 15.69 s. Five initial content turns: median 201 ms, maximum 242 ms with stubbed providers.
- Shared-service CI harness: 86 tests, 26.64 s (<60 s).
- Final Personal-Agent/MCP/Sidecar/shared-LLM regression: 714 tests passed; earlier 42 suites passed; the old raw-identifier prompt assertion was corrected and its suite rerun. Final Workbench/retrieval/privacy/gateway/completed-turn suites: 6 suites, 530 tests passed. Generated-function-model/embedding/coverage-seam and Forecast dependency repairs: 4 suites, 62 tests passed.
- TDD matrix: 82 tests passed, 4 explicit blackbox skips; hard required-ID coverage 66/66 = 100%.
- Lint passed (one pre-existing unused-variable warning); domain-free-core passed with no findings. Generic vocabulary exemptions cover conversational and privacy terms, not source/domain associations.
- `check:llm`, build and `audit:openapi` passed (zero OpenAPI issues, existing warnings); OpenAPI and llm context regenerated using repository generators.
- Full unit CI: all 400 test files in 20 serial chunks passed; aggregate coverage statements 82.93%, branches 68.27%, functions 87.53%, lines 84.69%; all configured thresholds passed.
- `git diff --check` passed. Final staged GitNexus results are recorded in the PR.

Read-capability evidence delegates to existing `signals.observe` and its permission/mandate/no-call policy, bounds reads to two catalog operations, and requires a matching understood hypothesis. Opaque reference placeholders use the existing PII scrubber and a local reidentification map that is never sent to the facade. Shared PII filtering remains active. Discarded cases cannot be continued.

## Manual review with real LLM, stubbed source services

`LLM_MODEL=gemini-3.5-flash-lite node scripts/validate-workbench-739-live.js <env-file>` invokes the real `src/llm-client.js` facade, real Workbench/Router/store/Personal-Agent collectors and explicit local source stubs. The opt-in generator whitelists only LLM configuration from the supplied environment file; it never exports credentials. Full anonymous transcript: `739-live-model.json`.

| Turn                | Manual assessment                                                                                                                                                                           | Elapsed |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------: |
| Foreign mail + help | Relevant source-backed explanation; reference 99000000001 retained; “Frist überschritten” retained as quoted claim; no invented statutory interval; one specialist question; background F-1 | 4.022 s |
| Reply by mail       | Reuses situation and reference, no repeated question, clear no-dispatch notice, same case                                                                                                   | 3.308 s |
| Draft please        | Grounded next steps, internal draft stored with missing-field placeholders; no dispatch                                                                                                     | 4.529 s |
| Kein Fall           | Withdrawn case and persisted correction                                                                                                                                                     | 0.418 s |

Review result: the supplied production-derived anonymous scenario is a useful colleague conversation in this provider profile. Source material is stubbed and its real retrieval relevance remains unverified. The locally configured `gemini-3.1-pro-preview` exceeded the 4.5 s per-call budget and returned safe unavailability after its per-call deadline; the earlier diagnostic run took ~9 s with a facade fallback, which Workbench now disables to enforce the hard call budget; production needs a provider profile that fits the budget. The faster model was selected only for this validation process, without changing the application's environment. The obsolete Flash-Lite name was rejected by the API; its response named the current model used for the successful run.

The real-provider run found and resolved issues invisible to facade stubs: unsupported native schema metadata, missing schema in prompts for JSON-only adapters, optional unrequested draft fields, and preservation of opaque identifiers/deadline claims. Canonical domain IDs normalize punctuation for routing/source selection; catalog data associates mapped knowledge with the relevant workflow domains.
