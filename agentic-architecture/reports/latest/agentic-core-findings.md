# Agentic Core Findings

Generated: 2026-10-11T01:32:43.513Z

## Current measurable surface

- Agentic files: 258
- Routing/capability files: 88
- Evidence/HITL files: 74
- Operation capability index: present
- OpenAPI export: present
- llm.txt: present

## Domain term distribution

- `evidence`: 24338 hits in 726 files
- `tenant`: 14790 hits in 667 files
- `broker`: 10714 hits in 573 files
- `grid`: 9776 hits in 627 files
- `agent`: 8298 hits in 728 files
- `decision`: 6901 hits in 431 files
- `capability`: 5696 hits in 450 files
- `stadtwerk`: 5625 hits in 244 files
- `forecast`: 4547 hits in 321 files
- `vdmi`: 4528 hits in 293 files
- `redispatch`: 4092 hits in 301 files
- `market`: 3851 hits in 385 files
- `hitl`: 3668 hits in 438 files
- `regulator`: 2487 hits in 316 files
- `receipt`: 2403 hits in 153 files
- `edm`: 2383 hits in 332 files
- `mako`: 2232 hits in 280 files
- `routing`: 2103 hits in 322 files
- `personal-agent`: 2013 hits in 300 files
- `workflow`: 1584 hits in 234 files
- `willi`: 1449 hits in 101 files
- `sidecar`: 999 hits in 111 files
- `eog`: 758 hits in 93 files
- `utility`: 613 hits in 94 files
- `openwebui`: 517 hits in 67 files
- `chatgpt`: 400 hits in 39 files
- `open-webui`: 268 hits in 47 files

## Evidence and HITL files

- `agentic-architecture/domain/EVIDENCE_VS_PRACTICE.md`
- `agentic-architecture/reports/latest/domain-abstraction/EVIDENCE_VS_PRACTICE.md`
- `docs/architecture/consultation-mode-evidence-hydration.md`
- `docs/n8n-answer-dossier-test.md`
- `docs/roadmap/resolved/12-hitl-workflow.md`
- `docs/roadmap/resolved/25-runtime-receipts-v054-big-picture.md`
- `docs/roadmap/resolved/25-v0.54.0-receipt-foundation-plan-prompt.md`
- `docs/roadmap/resolved/25-v0.54.1-receipt-test-harness-plan-prompt.md`
- `docs/roadmap/resolved/25-v0.54.3-vnb-lookup-receipt-migration-plan-prompt.md`
- `docs/roadmap/resolved/25-v0.54.4-knowledge-aware-receipts-plan-prompt.md`
- `docs/roadmap/resolved/25-v0.54.5-learning-loop-draft-receipts-plan-prompt.md`
- `docs/ui-contracts/40-hitl.md`
- `docs/use-cases/anschlusskapazitaet-evidence-queue.md`
- `docs/use-cases/dr-readiness-evidence-gate.md`
- `docs/use-cases/evidence-freshness-guard.md`
- `docs/use-cases/evidence-grounding-confidence-audit.md`
- `docs/use-cases/monitoring-non-escalation-control-evidence.md`
- `docs/use-cases/owner-deadline-evidence-gate.md`
- `docs/use-cases/workflow-completion-evidence-review.md`
- `docs/use-cases/znp-production-readiness-evidence-gate.md`
- `docs/v0.58-architecture/EVIDENCE_CARRY_FORWARD_ORIGIN_SIGNAL_SCENARIO.md`
- `integrations/rundeck/jobs/cernion-revalidation-execute-dev.yaml`
- `scripts/spike-739-evidence.js`
- `services/agent-receipts.service.js`
- `services/connection-rejection-evidence.service.js`
- `services/dossier-hydration-management.service.js`
- `services/evidence-requirement.service.js`
- `services/evidence-revalidation.service.js`
- `services/evidence-router.service.js`
- `services/hitl.service.js`
- `services/vdmi-evidence.service.js`
- `src/agent-receipts-evaluation.js`
- `src/agent-receipts-matcher.js`
- `src/agent-receipts-registry.js`
- `src/agent-receipts-schema.js`
- `src/agent-receipts-seeds.js`
- `src/answer-dossier-builder.js`
- `src/answer-dossier-domain-routes.json`
- `src/answer-dossier-hydration-rules.json`
- `src/blueprints/v1-municipal-transformation-evidence-168.json`
- `src/blueprints/v1-regulatory-evidence-map-164.json`
- `src/blueprints/v1-vdmi-evidence-matrix-169.json`
- `src/decision-evidence-audit-trail.js`
- `src/dossier-hydration-registry.js`
- `src/evidence-endpoint-catalog.js`
- `src/evidence-planner.js`
- `src/evidence-registry.js`
- `src/evidence-router.js`
- `src/mako-evidence-parser.js`
- `src/receipt-grounded-presentation-contract.js`
- `src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-connection-deadline-evidence-queue-v1.json`
- `src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-cross-system-variance-evidence-matrix-v1.json`
- `src/vdmi-hitl-role-derivation.js`
- `src/workbench-answer-evidence.js`
- `src/workbench-evidence.js`
- `src/workbench-mail-evidence.js`
- `src/workbench-web-evidence.js`
- `tests/agent-receipts-seeds.test.js`
- `tests/agent-receipts.service.test.js`
- `tests/agent-receipts.vnb.test.js`
- `tests/answer-dossier.service.test.js`
- `tests/copilot-ask-cernion-agent-evidence.test.js`
- `tests/decision-evidence-audit-trail.test.js`
- `tests/dossier-hydration.test.js`
- `tests/evidence-planner.test.js`
- `tests/evidence-requirement-relay.integration.test.js`
- `tests/evidence-requirement.service.test.js`
- `tests/evidence-revalidation.service.test.js`
- `tests/evidence-router.test.js`
- `tests/hitl.service.test.js`
- `tests/mako-evidence-parser.test.js`
- `tests/personal-agent-auto-evidence-requirement.integration.test.js`
- `tests/personal-agent-willi-mako-evidence.test.js`
- `tests/personal-agent-work-out-loud-evidence-revalidation.integration.test.js`

## Shepherd interpretation

CET already contains many specialized service islands. The next architecture step is to turn these islands into a capability graph that a generic agent can reason over. Each capability should state: user intent, process state, allowed tools, evidence requirements, HITL boundary, and response contract.
