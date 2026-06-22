# ZNP Production-Readiness Evidence Gate

## Scope

`znp_production_readiness_evidence_gate` is a read-only dossier capability for deciding whether a supplied ZNP project context is ready for a production-readiness review.

The first slice intentionally does not implement the original roadmap breadth. It does not call Overpass, parse production PDFs, create async jobs, mutate ZNP projects or graphs, apply NOVA decisions, remove ZNP stub markers, claim a TRL uplift, or run an acceptance backtest.

## Readiness Signals

The gate classifies supplied facts into stable statuses:

- `needs_project_context`
- `needs_layer1_evidence`
- `needs_layer2_evidence`
- `needs_gfactor_validation`
- `needs_acceptance_reference`
- `needs_nova_handoff_readiness`
- `ready_for_znp_readiness_review`

Inputs are advisory evidence hints such as `layer1Evidence`, `layer2Evidence`, `gfactorValidation`, `acceptanceReference`, and `novaHandoff`.

## Consumption Path

The capability follows the #251 contract:

`Capability Broker -> znp.productionReadinessStatus -> Hydration Registry -> Slim Answer Dossier`

Missing evidence becomes positive follow-up text that explains which dossier section can be added once the evidence is supplied.

## Safety

The endpoint is read-only. Source-action guards explicitly show that no Overpass call, PDF import, async job, project mutation, graph mutation, NOVA/HITL/workflow execution, notification, external connector, or Personal-Agent shortcut was called.
