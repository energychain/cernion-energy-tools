# Batteriespeicher Redispatch Sondergate

Issue: #244

## Purpose

The battery Redispatch special gate makes storage cases reviewable before
settlement, clearing or operational Redispatch decisions. It joins the storage
MaLo/MeLo role decision, metering concept, injection and withdrawal direction,
positive and negative Redispatch eligibility, controllability direction,
test-call proof, production proof, settlement readiness, clearing decision and
billing decision into one dossier-safe gate result.

This is not a new storage-control, settlement, billing, MaKo or Redispatch
execution system. It is a non-consequential evidence gate for repeated VNB
review.

## Source Systems

- `bess-screening.screen`: storage asset, VNB, grid area, voltage level, NAP and
  bottleneck context.
- `edm-messkonzept.*` and `edm-validation.*`: MaLo/MeLo, OBIS/time-series and
  metering-concept evidence.
- `flex.getDevice` / `flex.listEvents`: controllability direction, device
  status and proof references.
- `redispatch-expost.audit`: Redispatch master-data, curtailment, settlement
  and risk patterns.
- `settlement.*` and `bilanzkreis.*`: settlement readiness, clearing and
  billing consequences.
- `vdmi.*` / `hitl.*`: manual acceptance, forbidden assumptions, evidence
  requirements and follow-up ownership.

The gate stores references in `sourceActions`; it does not duplicate those
systems as new sources of truth.

## Data Contract

`batteryRedispatchSpecialGate` contains:

- `assetId`
- `bessScreeningId`
- `maloDecision`
- `meloRefs`
- `meteringConceptId`
- `injectionDirection`
- `withdrawalDirection`
- `positiveRedispatchEligible`
- `negativeRedispatchEligible`
- `controllabilityDirection`
- `testCallLimitKw`
- `testCallProofRef`
- `productionProofConfirmed`
- `settlementReadiness`
- `clearingDecision`
- `billingDecision`
- `evidenceStatus`
- `blockingFindings`
- `missingDataPoints`
- `positiveFollowUps`
- `sourceActions`
- `recommendedNextDecision`

## API Boundary

- `POST /api/battery-redispatch-special-gate/evaluate`
  creates a tenant-scoped, non-consequential audit-write gate assessment.
- `GET /api/battery-redispatch-special-gate/:gateId/status`
  returns dossier-safe read-only evidence for Answer Dossier and n8n rendering.
- `GET /api/battery-redispatch-special-gate/gates`
  and `GET /api/battery-redispatch-special-gate/gates/:gateId`
  are read-only inspection helpers.

Only `getStatus` is allowlisted for Hydration Registry use.

## Dossier Follow-Ups

Missing inputs are phrased as additive dossier improvements:

- `maloDecision` adds MaLo/MeLo role separation and billing-path evidence.
- `meteringConceptId` adds metering-concept evidence for storage injection and
  withdrawal roles.
- `injectionDirection` and `withdrawalDirection` add positive/negative
  Redispatch eligibility reasoning.
- `controllabilityDirection` adds Steuerbarkeitsrichtung and operating-risk
  assessment.
- `testCallProofRef` adds productive test-call evidence and proof chain.
- `productionProofConfirmed` adds production-readiness statement.
- `settlementReadiness`, `clearingDecision` and `billingDecision` add commercial
  consequence and exception-routing evidence.

## Safety

The gate must not execute device control, MaKo writes, billing or settlement
writes, clearing approvals, HITL approvals or productive Redispatch triggers.
Personal Agent consumption goes through Capability Broker metadata, Hydration
Registry and slim dossier evidence; no Personal Agent hardcoding is required.
