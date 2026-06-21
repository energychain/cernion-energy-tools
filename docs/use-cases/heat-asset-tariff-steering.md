# Fernwaerme Asset Tarif Steuerung

## Use Case & Contract

- **Rolle:** Read-only dossier-safe District Heating Asset & Tariff Steering Gate.
- **Key Principle:** Wiederverwendung und Dokumentation vor neuem Code. Die Fernwaerme Asset Tarif Steuerung entsteht als status- und evidenzbasierte Sicht auf vorhandene Fernwärme-, Asset-, Tarif-, Finanz- und Governance-Signale ohne neue stateful Heiznetzdatenbanken, Tarifberechnungsplattformen oder transaktionale Mutations- und Freigabeworkflows.

## Technical Contract

- **Capability Key:** `heat_asset_tariff_steering`
- **Evidence Registry Key:** `heat_asset_tariff_steering`
- **Read-Only Action:** `dashboard-api.heatAssetTariffSteeringStatus`
- **REST Path:** `GET /api/dashboard/heat-asset-tariff-steering`
- **Dossier Hydration:** Allowlisted with `safety.readOnly: true`

## Inputs (Scalar / Query-Safe)

- `heatPortfolioId` (string, optional)
- `division` (string, optional - e.g. Fernwärme)
- `technicalMeasures` (string, optional - e.g. planned, in_progress, completed)
- `tariffImpactStatus` (string, optional - e.g. calculated, pending, high_risk)
- `regulatoryUncertainty` (string, optional - e.g. low_risk, transient, high_risk)
- `fundingStatus` (string, optional - e.g. requested, approved, none)
- `customerImpact` (string, optional - e.g. positive, neutral, negative)
- `investmentPriority` (string, optional - e.g. high, medium, low)
- `owner` (string, optional - e.g. Assetmanagement Fernwärme)
- `nextDecisionGate` (string, optional - e.g. Investment Committee Window Q3)
- `blockedFollowUpAction` (string, optional - e.g. investment-planning.createPlan)
- `sourceRef` (comma-separated or array, optional)

## Outputs

Returns a deterministic status mapping (`gateStatus`), readiness score, normalized evidence items, missing evidence gaps, positive follow-ups, and strict `sourceActions.notCalled` side-effect guards.
