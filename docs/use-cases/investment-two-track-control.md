# Investment Two-Track Control

## Goal

`investment_two_track_control` separates short-term investment submission readiness from the longer-term Asset Management / ISO-55001 target-process track. The first slice is a read-only evidence capability for management, finance and owner follow-up.

## Non-goals

- No new investment workflow engine or persistence model.
- No SAP/PSP integration.
- No finance, billing, settlement, MaKo or tariff mutation.
- No HITL item creation in the read-only status path.
- No external connector, secret handling, broad cockpit UI or Personal-Agent shortcut.

## Data contract

`dashboard-api.investmentTwoTrackControlStatus` accepts status/evidence parameters such as:

- `submissionId`, `gridOperatorId`, `deadline`, `submissionFormat`
- `tacticalOwner`, `targetOwner`
- `budgetEnvelopeEur`, `measureCount`
- `financeReviewStatus`, `boardReadiness`
- `dataQualityStatus`, `approvalModel`, `handoverStatus`
- `sourceDatapoints`, `blockedDecisions`

The response contains:

- `status` and `readinessScore`
- separate `tacticalTrack` and `targetTrack`
- provided `evidenceItems`
- explicit `missingEvidence`
- `positiveFollowUps` phrased as dossier additions
- `blockedDecisions`
- `sourceActions` with referenced services and not-called guards
- slim `dossierEvidence` for Answer Dossier hydration

## Tracks

The tactical track covers submission contract, tactical owner, measures, budget envelope, finance review and board/committee format.

The target-process track covers data-quality plan, target-process owner, role/approval model and handover status.

Both tracks can be incomplete independently. Missing target-process evidence must not automatically block a tactical submission if the tactical evidence is sufficient.

## Source-action model

The capability may reference existing concepts from:

- `datasource-registry.get`
- `datapoint.health`
- `investment-planning.createPlan`
- `finance-agent.analyze`
- `vdmi.dossier`
- `interface-placeholder.requestEvidence`
- `presentation.generate`

The read-only status action does not call mutating actions. The response records explicit not-called guards for Investment Planning mutation, Finance mutation, settlement, billing, MaKo, SAP/PSP, HITL, VDMI mutation, external connectors and Personal-Agent execution.
