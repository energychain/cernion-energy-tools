# Investment Data Review Queue

`investment_data_review_queue` is a read-only evidence capability for investment data packages that need Assetmanagement review before they become committee or CAPEX decisions. It turns request-scoped facts into dossier-safe evidence: source/data package, asset or project reference, quality status, division, bottleneck reference, owner, committee window, blocked follow-up decision, review status and source references.

## Contract

- Capability key: `investment_data_review_queue`
- Evidence registry key: `investment_data_review_queue`
- Read-only action: `dashboard-api.investmentDataReviewQueueStatus`
- REST route: `GET /api/dashboard/investment-data-review-queue`

The route is a status projection only. It does not create HITL tickets, VDMI records, investment plans, finance decisions, budget releases, settlement/billing/tariff effects, external connector calls or Personal-Agent shortcuts.

## Existing Surfaces

- Datasource Registry / Cache: source package and data-quality provenance.
- Investment Planning: referenced as the later Strategy-to-Execution surface, not mutated by hydration.
- HITL: referenced as the real review queue surface, not created by this endpoint.
- VDMI / Evidence Registry: source grounding and explicit dossier gaps.

## Dossier Behavior

Incomplete inputs return explicit `missingEvidence` and `positiveFollowUps`; complete synthetic evidence returns `review_ready`. The slim dossier formatter exposes status, readiness, source/package, asset/project, quality, division, bottleneck, owner, committee window, blocked decision, review status and side-effect guards.
