# Agentic Core Findings

Generated: 2026-10-21T16:15:55.773Z

## Current measurable surface

- Agentic files: 274
- Routing/capability files: 117
- Evidence/HITL files: 100
- Operation capability index: present
- OpenAPI export: present
- llm.txt: present

## Domain term distribution

- `evidence`: 25996 hits in 860 files
- `tenant`: 19022 hits in 884 files
- `broker`: 11548 hits in 678 files
- `grid`: 9862 hits in 654 files
- `agent`: 8423 hits in 775 files
- `decision`: 6980 hits in 454 files
- `capability`: 6025 hits in 535 files
- `stadtwerk`: 5635 hits in 248 files
- `forecast`: 4595 hits in 329 files
- `vdmi`: 4528 hits in 293 files
- `redispatch`: 4127 hits in 310 files
- `market`: 3966 hits in 403 files
- `hitl`: 3707 hits in 447 files
- `edm`: 2946 hits in 368 files
- `regulator`: 2701 hits in 343 files
- `mako`: 2493 hits in 307 files
- `receipt`: 2459 hits in 171 files
- `routing`: 2382 hits in 388 files
- `personal-agent`: 2034 hits in 313 files
- `workflow`: 1611 hits in 250 files
- `willi`: 1536 hits in 113 files
- `sidecar`: 1002 hits in 111 files
- `eog`: 792 hits in 101 files
- `utility`: 613 hits in 94 files
- `openwebui`: 601 hits in 98 files
- `open-webui`: 414 hits in 72 files
- `chatgpt`: 402 hits in 38 files

## Evidence and HITL files

- `agentic-architecture/domain/EVIDENCE_VS_PRACTICE.md`
- `agentic-architecture/reports/latest/domain-abstraction/EVIDENCE_VS_PRACTICE.md`
- `docs/architecture/consultation-mode-evidence-hydration.md`
- `docs/n8n-answer-dossier-test.md`
- `docs/roadmap/issues/660-workbench-evidence-toolrun-inspector-product-cut.md`
- `docs/roadmap/resolved/12-hitl-workflow.md`
- `docs/roadmap/resolved/25-runtime-receipts-v054-big-picture.md`
- `docs/roadmap/resolved/25-v0.54.0-receipt-foundation-plan-prompt.md`
- `docs/roadmap/resolved/25-v0.54.1-receipt-test-harness-plan-prompt.md`
- `docs/roadmap/resolved/25-v0.54.3-vnb-lookup-receipt-migration-plan-prompt.md`
- `docs/roadmap/resolved/25-v0.54.4-knowledge-aware-receipts-plan-prompt.md`
- `docs/roadmap/resolved/25-v0.54.5-learning-loop-draft-receipts-plan-prompt.md`
- `docs/TENANT_EVIDENCE.md`
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
- `scripts/generate-session-evidence-fixtures.js`
- `scripts/generate-tenant-evidence-fixtures.js`
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
- `src/dataset-evidence.js`
- `src/decision-evidence-audit-trail.js`
- `src/dossier-hydration-registry.js`
- `src/evidence-endpoint-catalog.js`
- `src/evidence-planner.js`
- `src/evidence-registry.js`
- `src/evidence-router.js`
- `src/mako-evidence-parser.js`
- `src/project-manifest-dossier.js`
- `src/project-manifest-evidence.js`
- `src/receipt-grounded-presentation-contract.js`
- `src/tenant-evidence-anchors.js`
- `src/tenant-evidence-background.js`
- `src/tenant-evidence-comparison.js`
- `src/tenant-evidence-descriptor.js`
- `src/tenant-evidence-question.js`
- `src/tenant-evidence-read.js`
- `src/tenant-evidence-sessions.js`
- `src/tenant-evidence-sources.js`
- `src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-connection-deadline-evidence-queue-v1.json`
- `src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-cross-system-variance-evidence-matrix-v1.json`
- `src/vdmi-hitl-role-derivation.js`
- `src/workbench-answer-evidence.js`
- `src/workbench-evidence.js`
- `src/workbench-mail-evidence.js`
- `src/workbench-tenant-evidence.js`
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
- `tests/helpers/session-evidence-stub.js`
- `tests/hitl.service.test.js`
- `tests/mako-evidence-parser.test.js`
- `tests/personal-agent-auto-evidence-requirement.integration.test.js`
- `tests/personal-agent-willi-mako-evidence.test.js`
- `tests/personal-agent-work-out-loud-evidence-revalidation.integration.test.js`
- `tests/practice-session-evidence-replay.test.js`
- `tests/practice-tenant-evidence-replay.test.js`
- `tests/project-manifest-evidence.test.js`
- `tests/tenant-evidence-background.test.js`
- `tests/tenant-evidence-comparison.test.js`
- `tests/tenant-evidence-descriptor.test.js`
- `tests/tenant-evidence-question.test.js`
- `tests/tenant-evidence-sessions.test.js`
- `tests/tenant-evidence-workbench.test.js`

## Shepherd interpretation

CET already contains many specialized service islands. The next architecture step is to turn these islands into a capability graph that a generic agent can reason over. Each capability should state: user intent, process state, allowed tools, evidence requirements, HITL boundary, and response contract.
