# AgentOps Receipt — OpenAI Build Week Developer Tool

AgentOps Receipt is the Build Week extension that turns Cernion's existing governed Sidecar and Agent Receipt primitives into a one-command QA smoke harness for tool-using agents.

It is intentionally small and judge-testable: no live customer data, no production tokens, no consequential actions. The harness checks whether an agent-facing tool surface is bounded, read-only, schema-aligned, evidence-aware, and safe when something goes wrong.

## Quick start

From the repository root:

```bash
node tools/agentops-receipt/smoke.js
```

The command prints a PASS/FAIL summary and writes:

```text
reports/agentops-receipt-smoke.md
reports/agentops-receipt-smoke.json
```

For a custom output directory:

```bash
node tools/agentops-receipt/smoke.js --output-dir /tmp/agentops-receipt-report
```

To run the focused tests:

```bash
node --test tests/agentops-receipt-smoke.test.js
```

## What it verifies

The smoke harness runs synthetic, offline checks that demonstrate the Developer Tools value proposition:

| Check | What it proves |
| --- | --- |
| `manifest.readOnlyTools` | The curated Sidecar tool manifest is bounded and read-only. |
| `sidecar.unknownToolBlocked` | Unknown/direct HITL-style tools fail closed. |
| `sidecar.forbiddenTargetBlocked` | Write/admin/HITL target actions are detected before execution. |
| `receipt.schemaRegistryCheck` | A receipt maps context into the expected live action schema. |
| `receipt.evidenceRequirements` | A tool plan exposes evidence fields needed for auditability. |
| `receipt.safeMissingInput` | Downstream operator-scoped steps are blocked until required evidence exists. |
| `receipt.missingActionBlocked` | A missing/non-live action is reported as a safe failure. |

## Build Week delta

Cernion already had deep platform primitives before Build Week: Moleculer services, OpenAPI surfaces, Sidecar policy metadata, Agent Receipts, Evidence Dossiers and UAT tests.

The Build Week extension is the **AgentOps Receipt QA harness**:

- `tools/agentops-receipt/smoke.js` packages those primitives into a single judge-friendly command.
- `tests/agentops-receipt-smoke.test.js` proves the harness output and report rendering.
- This document explains how to run and position the extension for the OpenAI Build Week Developer Tools track.

The submission should therefore be framed as:

> Cernion is the complex real-world reference system. AgentOps Receipt is the new Build Week Developer Tool that turns governed agent-tool usage into reproducible QA receipts.

## Why this belongs in Developer Tools

Developers building agents with OpenAPI, MCP, Sidecar or plugin-style tools face the same release question:

> Before I let an agent touch production tools, can I prove which tool it planned to use, whether the schema matched, whether policy boundaries were respected, and what evidence is missing?

AgentOps Receipt answers that with deterministic checks and report artifacts instead of asking judges or operators to trust a chat transcript.

## Safety boundaries

- The default harness uses synthetic fixtures only.
- It does not require production credentials.
- It does not call live customer systems.
- It does not execute, approve, reject, delete, publish, bill, settle, control devices or resolve HITL decisions.
- Unsafe actions appear only as blocked fixtures to prove fail-closed behavior.

## Codex/GPT-5.6 collaboration notes

For Devpost, fill this section with the final `/feedback` Codex Session ID and commit range.

Suggested wording:

> Codex/GPT-5.6 was used as a pair developer to cut the scope from a broad Cernion platform into a focused Developer Tools artifact, inspect existing Sidecar/Receipt primitives, write the TDD tests, implement the smoke harness, and shape the judge-facing README/report narrative. Human decisions focused on product positioning, safety boundaries, and what not to include.

## Demo video structure under 3 minutes

1. **0:00–0:20:** Problem — agents can call tools, but production tool access needs proof.
2. **0:20–0:45:** Show the Cernion Sidecar/Receipt primitives as the real system under test.
3. **0:45–1:35:** Run `node tools/agentops-receipt/smoke.js` and show PASS/FAIL output.
4. **1:35–2:15:** Open the generated Markdown/JSON report: right tool, right schema, evidence and safe failure.
5. **2:15–2:45:** Explain Codex/GPT-5.6 collaboration and Build Week delta.
6. **2:45–3:00:** Close — CI-style QA receipts for governed tool-using agents.
