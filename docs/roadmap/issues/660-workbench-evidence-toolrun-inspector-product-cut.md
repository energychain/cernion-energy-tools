# Product Cut: Selected Workbench Case EvidenceRef and ToolRun Inspector (#660)

## Decision

Implement the first RC3 slice as a read-only presentation contract over existing Workbench APIs. Do not add a new case store, EvidenceRef store, ToolRun store, Budibase table, connector action, inbox mutation or Domain Router event poll in this slice.

The panel is an internal operator inspector for one already-selected, authorized CET Workbench case. It is not a public demo matrix and does not create a `demoProcessMatrix`.

## In-scope repo files for the implementation PR

Expected follow-up implementation files:

- `integrations/budibase/manifests/stadtwerk-mauer-workbench.json` — additive selected-case inspector sections and scalar query definitions.
- `tests/budibase-workbench.test.js` — scalar projection and no-mutation regression tests.
- `docs/use-cases/workbench-evidence-toolrun-inspector.md` — operator-facing read-only product note, if a narrative doc is needed.
- `CHANGELOG.md` / `llm.txt` — only if the implementation changes user-visible docs or generated context.

No service/action file is required for the first slice unless the scalar-safety tests prove the existing Workbench read models cannot supply bounded rows.

## Existing APIs to compose

The implementation must use only existing tenant-/actor-authorized reads:

- `GET /api/dashboard/stadtwerk-mauer-workbench-selected-target`
- `GET /api/dashboard/stadtwerk-mauer-case-actions`
- `GET /api/dashboard/stadtwerk-mauer-role-workbench-catalog`
- `GET /api/workbench/cases/:caseId?includeEvidence=true`
- `GET /api/workbench/cases/:caseId/tool-runs`
- optional `GET /api/workbench/cases/:caseId/tool-runs/:toolRunId`

Do not use `GET /api/workbench/cases` for selection and do not use `GET /api/workbench/inbox/tasks` as a dependency for this slice. Do not call `GET /api/domain-router/events`, because event delivery state is not part of this read-only inspector contract.

## Stable selected-case binding

The selected target brick is the binding source. It must supply or map to exactly one `cetCaseId` / Workbench `caseId` for the current tenant/operator view.

The Budibase presentation must treat the selected case as explicit input:

- `tenantId`
- `actorId` or current Workbench user context
- `roleFamily`, default `ROLE_PROCESS_OWNER` unless tenant-parametrized
- `caseId` / `cetCaseId`
- `sensitivityClearance`
- `allowedCommandScope = read_only_refresh`

If no selected case is available, render a bounded `no_selected_case` row instead of listing all cases.

## Visible panel sections and fields

### 1. Selected case header rows

Maximum rows: 6.

Fields:

- `rowType`
- `caseId`
- `caseTitle`
- `primaryDomain`
- `readinessState`
- `caseStateVersion`
- `selectedTargetSource`
- `safeDisplayText`

### 2. EvidenceRef rows

Maximum rows: 20.

Each row must be scalar and bounded:

- `rowType = evidence_ref`
- `evidenceId`
- `label` max 160 chars
- `evidenceType`
- `sourceType`
- `sensitivityLevel`
- `redactionState` (`visible`, `redacted`, `hidden`)
- `provenanceSystem`
- `hashStatus`
- `sourceFingerprintDisplay` max 80 chars
- `retrievalState`
- `readinessReviewRequired`
- `safeSummary` max 240 chars

Never render raw evidence payload, raw mail body, raw web HTML, raw PDF text, raw MaKo XML, credentials, tokens, cookies, API keys or nested sourceRef objects.

### 3. ToolRun rows

Maximum rows: 20.

Each row must be scalar and bounded:

- `rowType = tool_run`
- `toolRunId`
- `toolId`
- `toolClass`
- `sideEffectClass`
- `status`
- `governanceDecision`
- `startedAt`
- `finishedAt`
- `evidenceRefsDisplay` max 120 chars
- `receiptRefsDisplay` max 120 chars
- `failureSummary` max 240 chars
- `blockedReason` max 240 chars

Never render raw connector responses, request headers, secrets, credentials or nested ToolRun output payloads.

### 4. Selected ToolRun detail rows

Maximum rows: 12.

Only allowed for a ToolRun returned by the selected case ToolRun list. The detail projection may show bounded scalar diagnostics and EvidenceRef/ReceiptRef pointers. It must not render raw output payloads.

### 5. Missing evidence / clarification / risk / no-call rows

Maximum rows: 12.

Fields:

- `rowType`
- `gapType`
- `ownerRole`
- `safeDisplayText`
- `nextSafeGate`
- `noCallBoundary`

These rows are composed from the Workbench case summary plus the existing case-actions and role-catalog bricks. Missing evidence always renders as a positive clarification/review gate, never as automatic rejection or approval.

### 6. Safe action rows

First cut action set:

- `refresh_selected_case`
- `refresh_tool_runs`
- `inspect_selected_toolrun`

All other actions must render as disabled guard rows:

- evidence attach
- tool execution
- inbox assign/resolve/dismiss
- event acknowledgement
- case continue
- workflow/HITL/task creation
- connector invocation
- Rundeck/operations runbook execution

## Authorization and redaction assertions

The panel must rely on Workbench API authorization and redaction. Budibase must not reimplement tenant isolation or sensitivity clearance.

Tests must prove:

1. A foreign/hidden selected case renders no EvidenceRef or ToolRun rows.
2. Restricted EvidenceRefs are absent or redacted according to the Workbench response.
3. ToolRun rows remain bounded and do not include raw connector outputs.
4. Repeated GET/projection calls do not mutate case state, event delivery state, EvidenceRefs, ToolRuns, inbox tasks or Domain Router state.
5. `[object Object]`, raw nested JSON and unbounded arrays do not appear in rendered rows.

## Test plan for the implementation PR

Add/extend `tests/budibase-workbench.test.js` with at least these cases:

- selected-case header renders scalar case identity and state rows;
- EvidenceRef rows render only the fields listed above and truncate long labels/summaries;
- ToolRun rows render status/governance/evidence/receipt pointers and safe failure summaries;
- selected ToolRun detail only renders for a ToolRun belonging to the selected case;
- policy-denied/foreign case returns no panel data;
- restricted evidence remains hidden/redacted;
- pure panel refresh does not call mutating endpoints and does not change event/task state;
- disabled no-call rows are visible for attach/run/ack/continue/workflow actions.

## #572 visible-demo gate

A visible Budibase apply/presentation remains blocked until #572 or an equivalent existing-target preflight proves:

1. target workspace/application exists;
2. apply is executed with `--require-existing` or equivalent;
3. presentation smoke confirms the panel is visible without creating a new Budibase target;
4. no production connector or write path is invoked.

Until that gate is satisfied, this product cut only authorizes repository-side manifest/test/doc work.

## Non-goals

- No new backend endpoint.
- No new Workbench case/evidence/tool-run database.
- No event polling/acknowledgement.
- No tool execution.
- No evidence attach.
- No inbox task mutation.
- No Budibase table writes.
- No public demo matrix.
- No production deployment or live Budibase apply.
