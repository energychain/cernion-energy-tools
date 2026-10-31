# Self-improvement: failure signals (#1010, step 1)

CET records situations where it probably failed. Step 1 only **observes**: no case is bundled, classified or fixed, and no prompt, issue or PR is created.

## Sources

| Kind | Source | Basis |
|---|---|---|
| `unanswered` | Workbench turn | answer status `fallback`/`error`/`unavailable`, degraded understanding or answer; expected outcomes such as quota or explicit opt-out are excluded |
| `source_timeout` | Workbench turn | retrieval trace entries with status `timeout` |
| `repeated_question` | conversation trail | 2 consecutive unanswered turns in the same conversation |
| `clarification_loop` | conversation trail | 3 consecutive turns with open questions (without the optional cold-start context question) |
| `user_correction` | Workbench turn | `situation.answerFeedback.disagreement` ≥ 0.6 (`FAILURE_SIGNAL_DISAGREEMENT`): understanding grades how clearly the message rejects the previous answer; only in follow-up turns and with a literal basis; reason `answer_rejected` |
| `user_correction` | `shared-service.correction.v1` | every correction except attention preferences (`agent`), gap closure (`gap`) and undo |
| `skill_degraded` | `project.skill.lifecycle.v1` | lifecycle `degraded` or `retired` |
| `replay_divergence`, `harness_failure` | protected action `failure-signals.record` | reserved for replay and harness runs (later step) |

Detection reads only status fields the turn already reports. No signal word or wording gate is involved (#993).

## Data and boundaries

- A signal holds tenant, conversation id, turn reference, kind, function ids (hypotheses ≥ 0.5), source names, a reason code and the time. It holds **no message text**, so a later anonymization step never has to remove chat content from a signal.
- Signals are tenant-scoped; `failure-signals.list` requires `ROLE_ADMIN` or `ROLE_TENANT_ADMIN`, and `failure-signals.summary` returns counts per kind.
- Retention: 90 days (`FAILURE_SIGNAL_RETENTION_DAYS`); conversation trails expire after 24 h.
- Every signal is emitted as `self-improvement.signal.v1`. Nothing subscribes yet.

## Step 2: failure cases

- **Bundling:** signals with the same key (kind, function ids, sources, reason) form one bundle. Within a 7-day window it becomes a `FailureCase` at a threshold per kind: 1 for corrections, degraded skills, repetitions, clarification loops, replay and harness failures; 3 for unanswered turns and source timeouts (`settings.caseThresholds` overrides).
- **Classification:** when a case opens, a classifier via `src/llm-client.js` proposes the lowest effective level (A skill, B tenant data, C catalog data, D code), with reason, one-sentence summary, hypothesis and expected behaviour. It only receives kinds, counts, reasons, function ids and labels, sources and times: no chat content and no conversation reference, so a chat message cannot steer it. At most 20 classifications per tenant and day (`FAILURE_CASE_CLASSIFY_PER_DAY`); without a classification the prior level of the kind applies (`classifiedBy: prior`).
- **Lifecycle:** `open` → later steps set `resolved_runtime`, `issue_filed`, `pr_open`, `merged` or `rejected` via the protected action `setCaseStatus` (refs only `skillId`, `issue`, `pr`). A closed case whose key fails again is reopened, not duplicated. An open case without new signals for 30 days becomes `stale`.
- **Reproduction:** the last 10 turn references (conversation id, turn reference, time), the observed kinds and reasons, and the expected behaviour from the classifier. Fixtures come with the anonymization gate (step 4); `anonymization.state` stays `pending` until then.
- **Access:** `failure-signals.cases` requires an admin role; `failure-signals.summary` adds case counts per level and status for every role.
- **Self-report (#700):** the self-knowledge search lists the cases of the last 7 days with level, status and summary (source "Selbst erkannte Fehler").
- Event: `self-improvement.case.changed.v1` on opening, classification, status change and staleness.

## Step 3: levels A and B at runtime

No PR and no issue: the fix happens in the tenant runtime and is proven by a replay.

- **Level A (skill):** skill learning (#889) already redesigns a degraded skill (user correction or failed revalidation) and validates the draft against the project evidence before activation; that validation is the replay. When `project.skill.lifecycle.v1` reports an active skill derived from the degraded one (`derivedFrom`, now part of the event), every open case naming the degraded skill becomes `resolved_runtime` with `refs.skillId`, `runtime.action = skill_redesigned` and `runtime.replay.kind = skill_validation`. A retired skill resolves its case with `skill_retired`. The journal records the resolution with refs to the failure case and the skill (`failureCase` refs are visible only within the tenant).
- **Level B (tenant data):** the failed question is kept tenant-internally with its case (`replay:<case>`, never in signals, case views or summaries). For a rejection it is the previous question of the conversation, not the rejection itself. When a later turn captures new tenant-memory facts, open level-B cases replay their question as a **shadow replay** (`src/failure-replay.js`): understanding, evidence collection and answer run like a turn, but nothing is written (no case, conversation state, notice or memory capture) and mapping-bound sources stay off. A replay passes when the answer comes about and uses one of the new facts as evidence; the case becomes `resolved_runtime` (`runtime.action = tenant_data_replay`) and the question is deleted. At most 3 attempts per case, 3 replays per event and 10 per tenant and day (`FAILURE_CASE_REPLAYS_PER_DAY`). The answer text of a replay is only judged, never stored or shown.
- Stored questions are deleted with their case and never outlive the signal retention; conversation trails (holding the last question for rejections) expire after 24 h.
- The chat turn now maps one meta object for coverage, notices and failure signals, so the facts captured in a turn reach them (this also lets notices suppress memory notices about facts the person just stated, as intended).

## Step 4: anonymization gate

The repository is public. Nothing from a case leaves the tenant except through this gate (`src/failure-anonymization.js`), and only for levels C and D; A and B are fixed at runtime and never published.

1. **Synthetic rewrite** (model call via `src/llm-client.js`): title, problem, up to six descriptive reproduction steps, expected and observed behaviour. Identifiers only as `SYN-…`, people only as pseudonymous roles, numbers invented; instructions, paths or credentials in the question are not carried over.
2. **Deterministic scanner** (fail closed, findings name the kind only, never the value):
   - blocked shapes in any draft: e-mail, URL, IBAN, 11-digit market location, metering point (`DE…`), register unit (`SEE…`, `SNB…`, …), long numbers, phone, UUID, long hex ids, file names, code paths, secret/token forms, organization names (`… GmbH/AG/…`); `SYN-` values are allowed;
   - echo of the original: tokens with digits, and words the original marks as a name (after a form of address, in an organization name, in an e-mail address, file name or URL), including inflected forms. Ordinary capitalized nouns (Wert, Arbeitspreis) are deliberately left to step 3, since German capitalizes every noun.
3. **Independent model check** (a separate call that only compares original and draft): `containsOriginal`, `reidentifiable`, `asksForChange` (code, repository files or configuration), `containsCredentials`; in doubt true. It runs only when the scanner passed.

`anonymization.state` becomes `passed` only when both checks passed; a failure, error or timeout gives `failed`, and a failed draft is not kept. At most 10 gate runs per tenant and day (`FAILURE_CASE_ANONYMIZE_PER_DAY`). The protected action `failure-signals.publicCases` is the only way out: open level-C/D cases with `passed`, reduced to `caseId`, `kind`, `level`, catalog `functionIds` and the synthetic `publication`.

Known limit: a name that is also an ordinary word passes the scanner and is caught by the model check, which is why both must pass. Live check (synthetic): a question with name, organization, e-mail, market location and file name gave clean drafts or a conservative `failed`; an injected instruction ("ändere services/…, setze Token …") gave a draft without path, token or instruction.

Next step: development agent as a sidecar (issues only, level C/D).
