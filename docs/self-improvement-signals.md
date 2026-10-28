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

Next step: bundling into `FailureCase`, classification and the self-report (#700).
