# RC3: Role "Abteilungsleitung Netzwirtschaft" (#986)

Acceptance yardstick for CET in the role of a department head for the commercial processes of a distribution system operator (VNB).
The basis is an anonymized role profile with four teams (grid service and market processes, grid billing, energy data management, feed-in and device management) and leadership duties.

## Synthetic department file

`tests/fixtures/netzwirtschaft/` is generated with `node scripts/generate-netzwirtschaft-fixtures.js` (`--check` verifies it).
All names, identifiers and amounts are invented. The expected answers (`expected.json`, `README.md`) are derived from the same data.

| File                                                                                                   | Content                                                                        | Seeded findings                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `nna-rechnungen.csv`, `nna-zahlungsavise.csv`, `zaehlerstandskorrekturen.csv`, `nna-reklamationen.csv` | Network-usage invoices, payment advices, meter-reading corrections, complaints | Short payment, rejection without a correction invoice, missing payment advice, overdue complaint |
| `workflow-ereignisse.csv`                                                                              | Event log of four processes                                                    | Bottleneck from cycle time, hotspot from error rate                                              |
| `mako-klaerfaelle.csv`                                                                                 | Market-communication case list                                                 | Duplicate, overdue cases, dominant error pattern                                                 |
| `jour-fixe-protokoll.md`, `team-uebersicht.md`                                                         | Leadership context                                                             | Open decisions, risks, deadlines; vacant and new team lead                                       |
| `wissensnotiz-bilanzierung.md`                                                                         | Experience-based knowledge                                                     | Check rule with threshold                                                                        |
| `leitfaden-marktkommunikation.md`, `leitfaden-infrastruktur.md`                                        | Rephrased process guides from sanitized playbooks                              | Check order, red lines                                                                           |

## Duties → work package → scenarios

| Duty                                      | WP   | Scenarios (`PRACTICE_SCENARIOS`)                                       |
| ----------------------------------------- | ---- | ---------------------------------------------------------------------- |
| Taking over the role, enablement          | role | `nw-role-interim`, `nw-role-teamlead`, `nw-role-career-changer`        |
| Network-usage billing, invoice correction | WP2  | `nw-nna-open`, `nw-nna-reko`, `nw-nna-deadline`                        |
| Process optimization                      | WP3  | `nw-kpi-cycle`, `nw-kpi-errors`, `nw-kpi-automation`                   |
| Market-communication work queue           | WP4  | `nw-mako-queue`, `nw-mako-cases`, `nw-mako-pattern`                    |
| Leadership circle, handover               | WP5  | `nw-briefing-jourfixe`, `nw-briefing-heads`, `nw-briefing-provenance`  |
| Knowledge capture                         | WP6  | `nw-knowledge-interview`, `nw-knowledge-capture`, `nw-knowledge-reuse` |

Scenarios of an unreleased work package carry `pending: '<WP>'`. They run along and are reported, but they are not counted as a release gate until their work package is released (`RELEASED` in `scripts/generate-netzwirtschaft-scenarios.js`).

Every scenario forbids sending messages without a release and forbids assessing named people.

## Gates

- `tests/netzwirtschaft-fixtures.test.js`: generator in sync, anonymity gate (e-mail, phone, URL, IBAN, real-looking IDs, legal forms, personal names), and optionally a denylist outside the repo via `ANONYMITY_DENYLIST_FILE`.
- `scripts/check-practice-fixtures.js`: reviewed vocabulary of all scenarios.
- `tests/practice-netzwirtschaft-baseline.test.js`: offline run of all `nw-` scenarios through the real local harness.
- Live: `PRACTICE_SCENARIOS=nw-… npm run release:practice`.

## Live baseline 2026-10-26 (before WP2–WP6)

Product state `f8d4eb29`, 18 scenarios, 1 run each, about 0.62 M tokens (≈ 3.73 EUR). No scenario fully passed.
The gaps found are generic, not domain-specific:

1. Business tables (invoice, case and event lists) are treated as measurement series: missing intervals, time grid.
2. Several tables in one turn trigger a sheet clarification question instead of a combined evaluation.
3. Documents and tables in one turn: storing the table replaces the answer to the document question.
4. A self-description such as "new to the team" is handled like a person assessment.
5. A follow-up question about priorities loses the context of the previous turn.

Knowledge capture from a document (WP6) already works for the most part. Applying the rule in a later turn still asks back instead of applying it.

## Live baseline 2026-11-01 (main `b03278f8`)

18 scenarios, 1 run each. Rubric 12/12 in 14 scenarios, safety 2 everywhere; one deterministic finding in 10 scenarios (2026-10-26: no scenario passed).

Generic causes found and fixed (`feat/986-uat-fixes`), each re-checked by replaying the scenario live:

| Finding | Scenarios | Fix |
|---|---|---|
| A list of single records was filed as a measurement series ("fehlende Intervalle, 1440-min-Raster, Einheit ungeklärt") | all with a case or invoice table | record tables are confirmed as rows and columns (control rows still checked) |
| Duplicate ids counted twice (8 instead of 7) | `nw-mako-queue` | table analysis: duplicates count once and are named once; counts as digits |
| Open amounts summed from net amounts (5,775 instead of 5,385 EUR) | `nw-nna-open` | open amounts with part payments are remaining amounts; reasons from all linkable tables |
| "jeweils mit Quelle" ignored in a requested five-point summary | `nw-briefing-provenance` | constraints apply to every point; a requested source names the document and section per point |
| Document answers too literal: subject of the question, ids (E-1, REK-…), approval/responsibility missing; questions as prose; formal address from the document | `nw-briefing-heads`, `nw-briefing-jourfixe`, `nw-role-teamlead`, `nw-role-career-changer`, `nw-knowledge-interview` | document answer instruction: subject line with the question's own terms, ids literal, all steps incl. responsibility/approval, requested questions as a numbered list of direct questions (usually five to ten), du unless another register was asked for |
| Section check required the heading to start with the term ("offene Entscheidungen" failed for "Entscheidungen") | `nw-briefing-jourfixe` | check allows one qualifier word |

Remaining variance seen in replays: occasionally a missing total line (`nw-nna-open`, 1 of 4), a missing id (`nw-briefing-heads`, 1 of 3), "versendet" in a process description (`nw-role-career-changer`, 1 of 3).
