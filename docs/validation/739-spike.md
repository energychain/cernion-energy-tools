# Phase 0: existing evidence pipeline

Baseline: origin/main `9d64e83b`; recorded in spike commit `951176d5`. Reproduce in a separate worktree at that commit with `node scripts/spike-739-evidence.js`.
At that commit the script invokes the actual, unmodified personal-agent `collectCopilot*` methods with anonymous stub sources. Running the script at the implementation HEAD exercises the corrected collectors instead. No LLM call.

| Source        | Called for foreign mail?               | Hits          | Relevance                            |
| ------------- | -------------------------------------- | ------------- | ------------------------------------ |
| knowledge-rag | yes                                    | 1, score 0.58 | unrelated rotor maintenance accepted |
| willi-mako    | no (skipped)                           | 0             | EDIFACT-only gate prevents lookup    |
| datapoints    | yes                                    | 0             | no relevant data in stub             |
| planner       | collector yes; downstream no (skipped) | 0             | no active analysis signals           |

EDIFACT control: two copies of one document survive; only title/URL survive even when the source contains an excerpt. Guardrail `No dispatch` survives. See `739-spike.json` for exact results. This confirms production findings (a), (b), (c), without asserting stub results are production retrieval quality measurements.

Live run: local CERNION_TOKEN exists, but no explicitly configured test instance or Willi-Mako test endpoint/mapping was found. A token alone does not identify a test instance. No production request was made. Live source relevance and live response latency remain unmeasured.

Phase 1 decision: select sources from structured hypotheses and catalog configuration; preserve bounded content and document/section identity; apply score and situation relevance filters with rejected hits in trace. Keep no-call boundaries and existing tenant identity checks.
