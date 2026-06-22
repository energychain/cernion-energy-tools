# Technisch-Kaufmännisches Angebots-Cockpit

## Use Case & Contract

- **Rolle:** Read-only dossier-safe Technical & Commercial Offer Cockpit.
- **Key Principle:** Wiederverwendung und Dokumentation vor neuem Code. Das Technisch-Kaufmännische Angebots-Cockpit entsteht als status- und evidenzbasierte Sicht auf vorhandene Anschluss-, Kapazitäts-, fNAV-, Finanz- und Zielnetzplanungssignale ohne neue stateful Angebots- oder Pricing-Engines, Transaktionsdatenbanken oder Mutationsworkflows.

## Technical Contract

- **Capability Key:** `tech_commercial_offer_cockpit`
- **Evidence Registry Key:** `tech_commercial_offer_cockpit`
- **Read-Only Action:** `dashboard-api.techCommercialOfferCockpitStatus`
- **REST Path:** `GET /api/dashboard/tech-commercial-offer-cockpit`
- **Dossier Hydration:** Allowlisted with `safety.readOnly: true`

## Inputs (Scalar / Query-Safe)

- `connectionRequestId` (string, optional - identifies the request)
- `gridOperatorId` (string, optional - operator scope)
- `znpAlignment` (string, optional - ZNP alignment)
- `gridNode` (string, optional - specific grid node)
- `technicalRestriction` (string, optional - technical restriction)
- `requestedCapacityKW` (string/number, optional - requested capacity in kW)
- `technicalStatus` (string, optional - technical status)
- `capacityUtilization` (string, optional - capacity utilization)
- `fnavContractLogic` (string, optional - fNAV contract logic)
- `commercialAssumptions` (string, optional - pricing/CAPEX/OPEX inputs)
- `legalAgreementStatus` (string, optional - legal/agreement status)
- `legalBoundaries` (string, optional - legal boundaries)
- `sourceRef` (comma-separated or array, optional - documentation references)

## Outputs

Returns a deterministic status mapping (`gateStatus`), readiness score, normalized evidence items, missing evidence gaps, positive follow-ups, and strict `sourceActions.notCalled` side-effect guards.
