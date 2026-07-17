# OpenAI Build Week Devpost Package — AgentOps Receipt

## Recommended submission identity

- **Track:** Developer Tools
- **Title:** AgentOps Receipt
- **Subtitle:** QA receipts for governed tool-using agents
- **Short tagline:** Prove that an AI agent used the right tool, matched the schema, respected policy, gathered evidence, and failed safely.

## One-sentence pitch

AgentOps Receipt is a Codex-built Developer Tools harness that turns governed OpenAPI/MCP/Sidecar agent workflows into reproducible QA reports before agents receive production tool access.

## Problem

AI agents can now call real tools, but developers still need an operational answer to four release questions:

1. Did the agent choose the right tool?
2. Did its planned parameters match the live schema?
3. Did the tool surface respect permissions, tenant boundaries and side-effect limits?
4. Can the agent produce evidence — or fail safely when evidence is missing?

Chat transcripts are not enough for regulated or high-stakes workflows. Developers need deterministic, auditable artifacts that can be run locally or in CI.

## Solution

AgentOps Receipt packages Cernion's governed Sidecar and Agent Receipt primitives into a small judge-testable smoke harness:

```bash
node tools/agentops-receipt/smoke.js
```

The command verifies:

- curated read-only Sidecar tools,
- unknown/unsafe tool blocking,
- forbidden write/admin/HITL target detection,
- receipt-to-action schema alignment,
- evidence field requirements,
- safe missing-input and missing-action failures,
- Markdown/JSON reports that humans can inspect.

Cernion Energy Tools is the complex real-world reference system. AgentOps Receipt is the Build Week Developer Tool that makes agent-tool governance runnable and visible.

## How Codex/GPT-5.6 was used

Fill final values before submission:

- `/feedback` Codex Session ID: `TODO`
- Build Week branch/commit range: `TODO`
- Human decisions: scope cut to Developer Tools, safety boundaries, synthetic-fixture default, no live credentials, no consequential actions.

Suggested wording:

> Codex/GPT-5.6 acted as a pair developer. It helped inspect existing Cernion Sidecar and Agent Receipt primitives, compare Build Week judging criteria, design the smallest judge-testable artifact, write failing tests first, implement the smoke harness, and refine the README/report narrative. Human judgment set the product scope, rejected overly broad platform claims, and enforced safe-by-default boundaries.

## README / repository instructions

Point judges to:

- `docs/build-week-agentops-receipt.md`
- `tools/agentops-receipt/smoke.js`
- `tests/agentops-receipt-smoke.test.js`

Minimum judge commands:

```bash
node --test tests/agentops-receipt-smoke.test.js
node tools/agentops-receipt/smoke.js
```

Expected output includes:

```text
PASS manifest.readOnlyTools
PASS sidecar.unknownToolBlocked
PASS sidecar.forbiddenTargetBlocked
PASS receipt.schemaRegistryCheck
PASS receipt.evidenceRequirements
PASS receipt.safeMissingInput
PASS receipt.missingActionBlocked

Verdict: PASS (7/7 passed)
```

## Demo video script under 3 minutes

### 0:00–0:20 — Hook

"Agents can call tools now. But before giving them production access, developers need proof: right tool, right schema, right policy, enough evidence — and safe failure when something is wrong."

### 0:20–0:45 — Context

Show the repo and explain that Cernion is a real governed tool platform with Sidecar tools and Agent Receipts. The Build Week artifact is not the whole platform; it is the QA harness that makes this governance testable.

### 0:45–1:35 — Live run

Run:

```bash
node tools/agentops-receipt/smoke.js
```

Narrate the checks as they pass: read-only manifest, unknown tool blocked, forbidden target blocked, receipt maps to schema, evidence requirements emitted, missing scope/missing action fail safely.

### 1:35–2:15 — Report artifact

Open `reports/agentops-receipt-smoke.md` and show the generated JSON details. Emphasize that this is a CI/release artifact, not an LLM self-assessment.

### 2:15–2:40 — Codex/GPT-5.6 use

Explain TDD, scope cutting, code navigation, README/report generation, and `/feedback` session ID.

### 2:40–3:00 — Close

"AgentOps Receipt turns agent governance into something developers can run, inspect and extend. This is how we move from agentic answers you must trust to agentic workflows you can audit."

## Judging argument

### Technological implementation

- Uses real Cernion Sidecar and Receipt modules rather than a prompt-only mock.
- Combines deterministic schema/policy checks, receipt evaluation and report generation.
- TDD coverage verifies both machine-readable and human-readable outputs.

### Design

- One command for judges.
- Synthetic fixtures and no credentials by default.
- Clear Markdown/JSON report artifacts.

### Potential impact

- Agent builders need CI-style gates before tool access.
- The pattern applies beyond energy: finance, health, govtech, industrial operations and any OpenAPI/MCP tool surface.

### Quality of idea

- Differentiates from static agent linters by evaluating an operational tool plan.
- Differentiates from context-packing receipts by focusing on right-tool/right-schema/policy/evidence checks.
- Makes human approval and enforcement boundaries visible.

## Open placeholders before Devpost submission

- [ ] Final public repo/branch URL.
- [ ] `/feedback` Codex Session ID.
- [ ] YouTube demo URL, public, under 3 minutes.
- [ ] Build Week delta commit range.
- [ ] Representative / team details.
