# Areal Network Integration Offer Gate

Issue #269 is implemented first as the read-only `areal_network_integration_offer_gate`.

The slice exposes:

- `dashboard-api.arealNetworkIntegrationOfferGateStatus`
- `GET /api/dashboard/areal-network-integration-offer-gate`
- Capability Broker route `areal_network_integration_offer_gate`
- Evidence Registry key and Hydration Registry formatter for dossier consumption

The gate is a dossier-native decision card for Areal and Standortentwicklung before an offer is made. It records caller-supplied evidence over site or area reference, requested connection capacity, grid-capacity evidence, target-grid path, investment / CAPEX reference, regulatory-impact boundary, commercial offer assumptions, owner, next decision date, offer decision status and source references.

Out of scope:

- no offer calculation or binding offer generation
- no customer contract acceptance
- no grid-capacity reservation
- no target-grid or CAPEX optimizer
- no Asset-MDM mutation
- no billing, settlement, tariff, MaKo or device-control side effects
- no HITL or notification side effect
- no external connector call
- no Personal-Agent hardcoding

Missing evidence produces explicit gaps and positive follow-ups. Complete caller-supplied evidence reaches `ready_for_offer_gate_review`, but this is only a review-readiness status and not a commercial, regulatory or grid-capacity approval.
