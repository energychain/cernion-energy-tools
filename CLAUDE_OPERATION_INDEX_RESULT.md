# Operation Capability Index Result

Issue: https://github.com/energychain/cernion-energy-tools/issues/416

## Summary

Implemented a generated Operation Capability Index that covers every deduplicated OpenAPI operation and exposes deterministic ranking helpers for agent-facing routing.

The slice keeps write/process/admin operations visible. It classifies consequence, scope and recommended execution mode instead of blanket-hiding endpoints.

## Coverage

- Raw OpenAPI operations: 1099
- Deduplicated indexed operations: 847
- Agentable operations: 845
- Non-agentable operations: 2, each with `nonAgentableReason`

Operation kinds:

- `data_read`: 379
- `dashboard_read`: 121
- `advisory_plan`: 39
- `draft_write`: 10
- `object_store_write`: 221
- `process_start`: 38
- `process_step`: 20
- `admin`: 8
- `external_effect`: 4
- `internal`: 7

## Changed Files

- `operation-capability-index.json`
- `scripts/generate-operation-capability-index.js`
- `src/operation-capability-classifier.js`
- `src/operation-capability-index.js`
- `services/capability-broker.service.js`
- `services/chatgpt-sidecar.service.js`
- `docs/OPERATION_CAPABILITY_INDEX.md`
- `tests/generate-operation-capability-index.test.js`
- `tests/operation-capability-classifier.test.js`
- `tests/operation-capability-index.test.js`
- `tests/capability-broker.service.test.js`
- `package.json`

## Follow-up Integration Completed by DevOps

After recovering the Claude Code work, DevOps narrowed the diff and added the
central Sidecar integration:

- `capability-broker.recommend` now includes `operationCandidates` from the
  generated Operation Capability Index.
- `capability-broker.queryOperationIndex` remains available as an explicit
  agent/debug action for ranking the full API surface.
- `services/chatgpt-sidecar.service.js` now selects OpenAPI fallback
  operations through `capability-broker.queryOperationIndex`; the previous
  local heuristic is retained only as a technical fallback if the central
  broker action is unavailable.
- The ranker now requires a real lexical query signal before returning a
  candidate, so capability bias alone cannot route unrelated questions.

## Verification

Passed:

- `node --check src/operation-capability-classifier.js`
- `node --check src/operation-capability-index.js`
- `node --check scripts/generate-operation-capability-index.js`
- `npm run generate:operation-capability-index`
- `NODE_OPTIONS=--experimental-vm-modules npx jest tests/operation-capability-classifier.test.js tests/operation-capability-index.test.js tests/generate-operation-capability-index.test.js --runInBand`
- `NODE_OPTIONS=--experimental-vm-modules npx jest tests/capability-broker.service.test.js --runInBand`
- `npm run check:operation-capability-index`
- `npm run generate:llm`
- `npm run check:llm`
- `git diff --check`
- `node --check services/capability-broker.service.js`
- `node --check services/chatgpt-sidecar.service.js`
- `NODE_OPTIONS=--experimental-vm-modules npx jest --coverage=false --runInBand tests/operation-capability-index.test.js tests/operation-capability-classifier.test.js tests/generate-operation-capability-index.test.js tests/capability-broker.service.test.js tests/chatgpt-sidecar.service.test.js`

Release check:

- `npm run release:check` was attempted.
- It failed in the pre-existing full unit suite before reaching the new operation-index check sequence.
- Observed failure clusters included:
  - `tests/llm-manifest.test.js` agent-relevant section budget: expected <= 14000 chars, received 14447.
  - `tests/tenant-context.test.js` token-manager mock path: `this._doCreateToken is not a function`.
  - `tests/mcp-client.test.js` custom token preference expectation.
  - Multiple LevelDB `LOCK: No such file or directory` failures in blueprint, decision-frame and CYA profile tests.
- The run was stopped with Ctrl-C after the release check had already failed and continued through additional unrelated baseline failures.

## Release Status

No release was published from this run because `npm run release:check` did not pass. Required next action before release:

```bash
npm run release:check
```

must pass on a clean baseline or the unrelated baseline failures above must be triaged separately.
