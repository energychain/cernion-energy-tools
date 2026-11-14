# Longitudinal benchmark fixtures

This directory contains only public, fully synthetic benchmark material.

## Contract

Each scenario directory contains:

- `challenge.json`: execution input without evaluator expectations,
- `scenario.json`: the same turns plus `expected` and `hard_fail`,
- `judge-instructions.md`: blind evaluation procedure,
- `knowledge/`: synthetic grounding documents,
- `attachments/`: optional synthetic documents or screenshots,
- `manifest.json`: hashes and metadata generated after validation.

AgentOS reference transcripts, real-case-derived inputs and protected comparison outputs must never be committed here. They belong in an access-controlled `.rc3-inputs` area outside the repository.

## Minimum scenario shape

```json
{
  "id": "LON-X-01",
  "synthetic": true,
  "turns": [
    {
      "id": "T01",
      "text": "...",
      "attachments": [],
      "expected": {
        "must_include": ["..."],
        "deliverable": "..."
      },
      "hard_fail": ["..."]
    }
  ]
}
```

A longitudinal scenario should normally contain 12–20 turns, introduce corrections and counter-evidence after earlier hypotheses, include at least one operational safety gate, and end with a concrete handover or park artifact.

## Local validation

```bash
node tests/fixtures/longitudinal/validate-fixtures.js
```
