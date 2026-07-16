# Coordination Meaning Preservation Profile

## Purpose

The `coordination_meaning_preservation_profile` slice turns a cross-domain handover into a
read-only dossier profile. It shows whether a Fachbereich transition still carries the
meaning needed for a decision: regulatory reference, commercial effect, network constraint,
evidence proof, owner, deadline, next decision and operational risk.

## First Slice

- Action: `dashboard-api.coordinationMeaningPreservationProfile`
- REST: `GET /api/dashboard/coordination-meaning-preservation-profile`
- Evidence key: `coordination_meaning_preservation_profile`
- Safety: read-only, dossier-safe, non-consequential
- Consumers: Capability Broker -> Dashboard API -> Hydration Registry -> Slim Answer Dossier

## Out Of Scope

This slice does not replace GIS, EDM, billing, planning, regulation, asset or management
systems. It does not call external connectors, create HITL items, write Fachsystem state,
mutate Budibase, release billing or settlement, create MaKo messages, change tariffs or
execute device-control actions.

## Acceptance

The endpoint returns deterministic profiles for partial and complete handover snapshots,
including preserved dimensions, missing dimensions, positive follow-ups and no-call guards.
Hydration consumes only the read-only action and formats slim answer-ready evidence.
