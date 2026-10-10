# Agentic Core Findings

Generated: 2026-10-10T02:12:05.722Z

## Current measurable surface

- Agentic files: 194
- Routing/capability files: 48
- Evidence/HITL files: 65
- Operation capability index: present
- OpenAPI export: present
- llm.txt: present

## Domain term distribution

- `evidence`: 19872 hits in 497 files
- `tenant`: 10786 hits in 449 files
- `broker`: 9192 hits in 417 files
- `grid`: 8719 hits in 539 files
- `agent`: 6412 hits in 563 files
- `decision`: 6007 hits in 338 files
- `stadtwerk`: 5087 hits in 210 files
- `capability`: 4352 hits in 302 files
- `vdmi`: 4123 hits in 251 files
- `redispatch`: 3553 hits in 264 files
- `hitl`: 3436 hits in 363 files
- `market`: 3267 hits in 297 files
- `forecast`: 2897 hits in 189 files
- `receipt`: 2140 hits in 94 files
- `regulator`: 2080 hits in 270 files
- `personal-agent`: 1903 hits in 251 files
- `edm`: 1826 hits in 230 files
- `routing`: 1558 hits in 233 files
- `workflow`: 1481 hits in 202 files
- `mako`: 1125 hits in 181 files
- `sidecar`: 887 hits in 86 files
- `eog`: 693 hits in 73 files
- `utility`: 554 hits in 63 files
- `chatgpt`: 384 hits in 29 files
- `willi`: 297 hits in 35 files
- `open-webui`: 52 hits in 11 files
- `openwebui`: 32 hits in 15 files

## Evidence and HITL files

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
- `src/receipt-grounded-presentation-contract.js`
- `src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-connection-deadline-evidence-queue-v1.json`
- `src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-cross-system-variance-evidence-matrix-v1.json`
- `src/vdmi-hitl-role-derivation.js`
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
- `tests/personal-agent-auto-evidence-requirement.integration.test.js`
- `tests/personal-agent-willi-mako-evidence.test.js`
- `tests/personal-agent-work-out-loud-evidence-revalidation.integration.test.js`

## Shepherd interpretation

CET already contains many specialized service islands. The next architecture step is to turn these islands into a capability graph that a generic agent can reason over. Each capability should state: user intent, process state, allowed tools, evidence requirements, HITL boundary, and response contract.
