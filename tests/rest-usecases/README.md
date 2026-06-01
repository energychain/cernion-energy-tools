# REST Usecase Evidence Harness

This directory contains V1.0 evidence tests for Cernion REST usecases.

The tests are blackbox checks against the public REST surface. They do not call
internal Moleculer services directly. A usecase is considered verifiable only if
the documented cURL-equivalent turns produce stable structured evidence:
routing, execution status, actions, findings, and facts.

Run against a local server:

```bash
npm start
REST_USECASE_BASE_URL=http://127.0.0.1:3000 npm run test:rest-usecases
```

The harness sends both `x-tenant-id` and `x-cernion-tenant` for compatibility
with existing examples and current gateway handling.

## Standard Usecase Shape

Every V1.0 REST evidence case should use the same structure:

```json
{
  "scenarioId": "REST-V1-...",
  "title": "...",
  "tenantId": "agentic-hackathon",
  "sessionId": "...",
  "baseline": {
    "version": "v0.58",
    "status": "simulation|missing|partial|manual",
    "gap": "What was not independently verifiable in v0.58"
  },
  "v1": {
    "status": "verified",
    "verifiedBy": "tests/rest-usecases/<file>.test.js",
    "command": "REST_USECASE_BASE_URL=http://127.0.0.1:3000 npm run test:rest-usecases"
  },
  "turns": []
}
```

Assertions should focus on stable evidence:

- REST status and `success`
- routing `primaryIntent`
- execution status
- executed action names
- structured finding codes
- persisted or returned facts
- absence of internal error leaks

Free prose may be checked for safety, but it should not be the primary proof.
If a usecase depends on exact wording, that wording must first be represented
as structured data or a deterministic template in the response payload.
