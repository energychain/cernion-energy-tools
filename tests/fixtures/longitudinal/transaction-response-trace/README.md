# Longitudinal benchmark fixture: transaction response trace

This fixture is fully synthetic and safe for a public repository. It contains no customer, tenant, person, market-partner, transaction or chat data from a real case.

## Purpose

`LON-A-TRANS-01` tests a 15-turn transactional case with:

- several similar references,
- a missing business response,
- an exact search result of `not found`,
- an OCR deviation (`0` versus `O`),
- a retroactive date correction,
- a tempting but unsafe inventory/status change,
- a late correction that invalidates an earlier hypothesis,
- a final park-and-handover artifact.

## Files

- `challenge.json` — clean execution input without expectations or hard-fail rules
- `scenario.json` — turns, per-turn expectations and hard failures
- `judge-instructions.md` — blind evaluation procedure and scoring contract
- `knowledge/` — four synthetic grounding sources
- `attachments/` — one synthetic PNG archive screenshot and one image-only synthetic PDF
- `manifest.json` — hashes and fixture metadata, generated during validation

## Execution rule

Run turns in order. At turn `Tnn`, the system under test may receive only:

1. the synthetic knowledge sources,
2. turns `T01..Tnn`,
3. attachments introduced no later than `Tnn`.

Do not expose `expected`, `hard_fail`, later turns or a reference transcript to the system under test.

## Reference separation

AgentOS reference transcripts are intentionally excluded from this public directory. They are evaluation references and must stay outside the repository.
