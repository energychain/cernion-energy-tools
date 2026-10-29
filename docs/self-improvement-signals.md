# Self-improvement: failure signals (#1010, step 1)

CET records situations where it probably failed. Step 1 only **observes**: no case is bundled, classified or fixed, and no prompt, issue or PR is created.

## Sources

| Kind | Source | Basis |
|---|---|---|
| `unanswered` | Workbench turn | answer status `fallback`/`error`/`unavailable`, degraded understanding or answer; expected outcomes such as quota or explicit opt-out are excluded |
| `source_timeout` | Workbench turn | retrieval trace entries with status `timeout` |
| `repeated_question` | conversation trail | 2 consecutive unanswered turns in the same conversation |
| `clarification_loop` | conversation trail | 3 consecutive turns with open questions (without the optional cold-start context question) |
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

Next step: levels A/B at runtime with replay proof.
