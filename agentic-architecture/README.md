# CET Agentic Architecture Shepherd

Status: generated from the independent Architecture Shepherd checkout.
Last material scan: 2026-10-29T12:30:38.077Z
Run: 20261029T122908Z
Fingerprint: afd0231c3eee8fcbd8b8c9bb6d4b4c6cac5c9ab343e88241d048f3cf02f6c4b1

This directory is the repo-local directive for CET's agentic development. It is generated from the Shepherd checkout and should guide Vibe-Coding agents toward a consistent target architecture.

## Purpose

CET is expected to become a self-aligning Stadtwerk/Energiversorger assistant: first use should help configure tenant/context/process boundaries in the background, while humans get a safe, evidence-aware assistant.

## Operating rule for coding agents

When changing chat, OpenWebUI, routing, capabilities, evidence, HITL, tools, services, or OpenAPI exposure, update or satisfy the canon in this directory. New fachliche behavior should be visible as a capability with evidence and process-state boundaries, not only as a service/action name.

## Files

- `ARCHITECTURE_CANON.md` — layer and target architecture.
- `AGENTIC_CORE_DIRECTIVE.md` — mandatory questions for agentic changes.
- `DOMAIN_ONTOLOGY.md` — stable fachliche primitives.
- `NAMING_CONVENTIONS.md` — naming and drift rules.
- `E2E_PROCESS_MAP.md` — user/process map skeleton.
- `OPENWEBUI_AGENTIC_ROUTING.md` — OpenWebUI routing target.
- `REFACTORING_BACKLOG.md` — small, reviewable cleanup queue.
- `domain/` — energy-domain abstraction, practice layer, natural workflows, and evidence-vs-practice guidance.
- `reports/latest/` — latest Shepherd artifacts.
