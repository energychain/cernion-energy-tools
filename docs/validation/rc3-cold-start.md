# RC3: Cold start – live acceptance (#997)

`scripts/validate-cold-start-live.js` runs a fresh synthetic tenant with two people through the local harness with the real model: six normal work statements by person A and B, then B asks what CET knows about the organisation. The check reads the knowledge-need register after a settling time, because recognition runs off the answer path.

## Result 2026-10-28 (synthetic data)

| Check | Result |
|---|---|
| ≥ 5 needs answered after ≤ 10 normal turns, without a questionnaire | 7 answered (grid-operator id, divisions, bidding zone, grid area, grid area id, market-partner code, balance group) |
| Every answer with provenance (fact, person) | yes |
| Person B's self-report names facts given by person A | yes: known values plus the most important open needs |
| At most one context question per turn | yes |

Variance and fixes found on the way:
- A statement turn sometimes kept no tenant-memory fact (one LLM yes/no). Second path: the message itself is checked against open needs; clear matches become ordinary tenant-memory statements with literal basis and anchor.
- One value was assigned to several similar needs (an id of one register to an id of another register). Fixes: each stated value answers only its best-fitting need, and a fact already used as an answer is not reused by the backfill.
- "Wir sind <X>" was taken as the speaker's personal role. A first-person plural subject now marks an organisation, not a role.
- A shorter settling time read the register before recognition had finished (4 answered); 60 s is the default now.

Open: a responsibility statement ("team X is responsible for …") is stored and appears in the self-report, but is not yet linked to a responsibility need, because these needs carry function labels that are hard to relate. Follow-up as catalog data (more readable labels).

Run: `WORKBENCH_ENV_FILE=<.env> node scripts/validate-cold-start-live.js` (`COLD_START_DIAGNOSE=1` lists the stored statements).
