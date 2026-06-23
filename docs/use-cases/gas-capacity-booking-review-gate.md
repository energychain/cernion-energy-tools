# Gas Capacity Booking Review Gate

## Purpose

`gas_capacity_booking_review_gate` is a read-only evidence gate for annual gas
capacity booking reviews. It makes capacity assumptions, cold-year stress
evidence, RLM rebound evidence, congestion-history grounding, VDMI ownership,
decision-frame traceability, commercial review status, risk scenarios and source
references visible to the dossier path before a Stadtwerk/VNB submits or
internally approves anything.

## Standard path

- Capability Broker: routes explicit gas capacity booking / Kaltjahr /
  RLM-Rebound / Engpasshistorie / VDMI-Abnahme wording.
- Dashboard API: `dashboard-api.gasCapacityBookingReviewGateStatus`.
- REST: `GET /api/dashboard/gas-capacity-booking-review-gate`.
- Evidence Registry: `gas_capacity_booking_review_gate`.
- Answer Dossier Hydration: slim formatter for the read-only status action.

## Inputs

- `reviewId`
- `bookingYear`
- `networkArea`
- `capacityAssumption` or `capacityAssumptionSource`
- `coldYearEvidence`
- `rlmReboundEvidence`
- `congestionHistoryEvidence`
- `vdmiOwner`
- `decisionFrameRef`
- `commercialSignoff`
- `riskScenarios`
- `sourceRefs`

Missing inputs become positive follow-ups. `commercialSignoff` is a review
status only; the gate does not claim approval from missing or hypothetical
evidence.

## Out Of Scope

- No gas-flow, thermodynamic, Kaltjahr, RLM or congestion simulation engine.
- No upstream capacity booking submission.
- No external connector.
- No VDMI/HITL workflow mutation, notification dispatch or persistence backend.
- No billing, settlement, tariff, MaKo, contract or device-control mutation.
- No legal/compliance approval claim.
- No Personal-Agent hardcoding and no one-off n8n branch.
