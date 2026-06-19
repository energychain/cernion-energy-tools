# Flexibilitaetsdirigent Rollenmodell

Issue: #245

This use case defines a dossier-native governance view for flexibility orchestration. It makes
decision rights, operational tasks, source systems, escalation paths and commercial ownership
visible before new automation is added.

## Boundary

Service: `flexibility-conductor-role-model`

The service is an evidence and role-model boundary, not a dispatch or control service.

- `POST /api/flexibility-conductor-role-model/evaluate`
  creates a non-consequential internal role-model evidence record from provided facts.
- `GET /api/flexibility-conductor-role-model/:processId/status`
  returns read-only dossier-safe status and slim evidence.
- `GET /api/flexibility-conductor-role-model/models`
  and `GET /api/flexibility-conductor-role-model/models/:roleModelId`
  expose tenant-scoped review data for operators.

## Source Actions

The model references existing platform capabilities instead of duplicating them:

- `flex.listDevices` / `flex.getDevice` for controllable asset scope.
- `grid-connection.fnavValidate` and grid operations for fNAV and operating context.
- `forecast-engine.forecast` and `residual-load.netResidualLoad` for forecast intake.
- `finance-agent.analyze` and `investment-planning.evaluate` for commercial value.
- `vdmi.create`, `hitl.create` and `presentation.generate` for governance, escalation and rendering.

These are source references. Dossier hydration does not execute them as control paths.

## Dossier Evidence

The slim evidence view includes:

- affected flex asset scope and low-voltage interface;
- accountable and responsible role coverage for forecast intake, fNAV boundary, control-command
  policy, software monitoring, commercial valuation and escalation handover;
- explicit control-command boundary and forbidden automatic actions;
- monitoring and commercial owners;
- escalation path and interface references;
- missing data points with positive follow-ups.

## Safety Classification

- Read-only: `getStatus`, `listModels`, `getModel` and the dossier formatter.
- Non-consequential: `evaluate`, which writes only internal evidence.
- Out of scope: control commands, device status updates, dispatch activation, HITL approval,
  MaKo writes, settlement writes and billing writes.

## #251 Consumption Contract

Capability Broker routes flexibility conductor / RACI / decision-right intents to
`flexibility-conductor-role-model.getStatus`. The Hydration Registry allowlists only this read-only
status action. Personal Agent hardcoding is not required.
