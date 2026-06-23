# Water Pricing / Net-Investment Alignment Gate

## Product Cut

Issue #259 is implemented first as the read-only `water_pricing_net_investment_alignment_gate`.

The capability answers whether a VNB/EVU has enough sourced evidence to align kalkulatorische Wasserpreis assumptions with net-investment, Anlagenbuchhaltung, Pachtnetz or concession references, regulatory-impact boundaries, ownership, review window, and committee decision state.

## In Scope

- `dashboard-api.waterPricingNetInvestmentAlignmentStatus`
- `GET /api/dashboard/water-pricing-net-investment-alignment`
- Capability Broker route `water_pricing_net_investment_alignment_gate`
- Evidence Registry key and Answer Dossier hydration formatter
- Missing-evidence to positive-follow-up mapping
- Read-only DevServer smoke through the dashboard endpoint

## Out Of Scope

- Water-price calculation engine
- `WATER_PRICING` rule execution beyond evidence/status projection
- Anlagenbuchhaltung persistence, SAP import, or Excel import
- Pachtnetz contract parsing
- Regulatory or legal approval claim
- Accounting, billing, settlement, tariff, MaKo, contract, or payment mutation
- HITL creation, notification dispatch, external connector calls, secret/key handling, Personal-Agent hardcoding, or broad cockpit UI

## Evidence Contract

Required evidence:

- Water-price assumption or calculation reference
- Net-investment or infrastructure-measure reference
- Asset-accounting / Anlagenbuchhaltung evidence reference
- Pachtnetz, concession, or lease-condition evidence reference
- Regulatory-impact or tariff-logic boundary reference
- Governance or committee owner
- Review period or target committee date
- Alignment decision state
- Source references

Complete evidence returns `committee_review_ready`. Missing evidence returns the first blocking status and positive follow-ups that describe what can be added to the dossier once the evidence arrives.
