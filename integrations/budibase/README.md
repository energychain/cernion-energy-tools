# Cernion Budibase Integration

This integration evaluates Budibase as a render shell for Cernion-generated case workbenches.

Budibase is not the system of record. Cernion owns tenant boundaries, scopes, command gates,
idempotency, audit traces and domain rules. Budibase may render case state and call curated
Cernion APIs, but it must not encode Stadtwerk-specific domain rules or mutate arbitrary
Cernion tables directly.

## Stadtwerk Mauer Workbench

The first generated workbench is:

- Budibase app: `Cernion Stadtwerk Mauer Workbench`
- screen: `Stadtwerk Mauer Workbench`
- route: `/stadtwerk-mauer`
- Cernion tenant: `stadtwerk-mauer`
- demo path: `pv_registration_electrician_missing_nap`

The workbench renders:

- Presenter-ready landing/status rows from `GET /api/dashboard/stadtwerk-mauer-workbench-landing`
- Workbench Hub target readiness from `GET /api/dashboard/stadtwerk-mauer-workbench-hub`
- selected Hub target/focus rows from `GET /api/dashboard/stadtwerk-mauer-workbench-selected-target?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench&targetId=hub`
- Administrator inventory rows from `GET /api/dashboard/stadtwerk-mauer-administrator-inventory`
- Tenant Databrowser category/item/trace/detail/source rows from `GET /api/dashboard/stadtwerk-mauer-tenant-databrowser`
- MaStR overlay status from `GET /api/dashboard/stadtwerk-mauer-mastr-data-overlay`
- E2E demo status from `GET /api/dashboard/stadtwerk-mauer-e2e-process-demo`
- selectable case detail from `GET /api/dashboard/stadtwerk-mauer-case-detail?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`
- sandbox annotation command/readback rows from `POST /api/dashboard/stadtwerk-mauer-case-annotations` and `GET /api/dashboard/stadtwerk-mauer-case-detail?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`
- selected-case action rows from `GET /api/dashboard/stadtwerk-mauer-case-actions?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`
- curated action-button contract rows from `GET /api/dashboard/stadtwerk-mauer-case-actions?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`, backed by `integrations/budibase/manifests/workbench-action-manifest-stadtwerk-mauer.json`
- safe-action catalog rows from `GET /api/dashboard/stadtwerk-mauer-case-actions?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`, annotated with committed Operation Capability Index operation ids and scalar operation-boundary metadata
- demo process-panel rows, last-result rows, required evidence rows and runbook-boundary rows from `GET /api/dashboard/stadtwerk-mauer-case-actions?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`
- role workbench catalog/open-target rows from `GET /api/dashboard/stadtwerk-mauer-role-workbench-catalog?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`
- selected Zielnetzplanung item detail, context, evidence-gap, next-gate and safe-follow-up rows from `GET /api/dashboard/stadtwerk-mauer-grid-planning-selected-item-detail?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench&queueItemId=grid-planning:missing-nap-clarification`
- Vertrieb/Key Account briefing rows from `GET /api/dashboard/stadtwerk-mauer-sales-workbench-briefing?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench&audience=vertrieb`
- MaStR public-context revalidation rows, affected case, next evidence gate, safe verify actions and no-call boundaries from `GET /api/dashboard/stadtwerk-mauer-mastr-data-overlay?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`
- selected-case meaning-preservation rows for `ROLE_NETZPLANUNG` from `GET /api/dashboard/coordination-meaning-preservation-profile`, showing preserved dimensions, missing/weak context, owner/deadline/decision gaps, positive follow-ups, transfer parameters and no-call guards
- municipal value peer-corridor evidence rows for `Mauer`, `Sandhausen` and `Wiesloch` from `GET /api/dashboard/municipal-energy-value-analysis`
- VDMI profile, role model, evidence-gap, capability-projection and synthetic event preview rows from the existing read-only dashboard bricks: `GET /api/dashboard/stadtwerk-mauer-vdmi-profile`, `GET /api/dashboard/stadtwerk-mauer-capability-projection` and `GET /api/dashboard/stadtwerk-mauer-event-replay-preview`
- VNB delta signal queue rows from existing read-only dashboard bricks: `GET /api/dashboard/cross-channel-vnb-signal-queue`, `POST /api/dashboard/vnb-delta-signal-classifier/classify`, `GET /api/dashboard/owner-deadline-evidence-gate` and `GET /api/dashboard/leadership-delta-cockpit`
- Evidence Freshness rows for the selected synthetic VNB signal from `GET /api/dashboard/evidence-freshness-guard`
- Blueprint-Pack verify and Demo-Raum matrix-sync rows for `stadtwerk-mauer-substation-load-assessment-v1` from `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify`, backed by the existing operations-runbook verify contract
- Blueprint seed selector, #382 matrix/evidence/sync rows and read-only cross-system variance linkout for `stadtwerk-mauer-cross-system-variance-evidence-matrix-v1`, composed from `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify`, `GET /api/dashboard/stadtwerk-mauer-transfer-readiness` and `GET /api/dashboard/cross-system-variance-matrix`
- Grid connection transformation selector/panel rows for `stadtwerk-mauer-grid-connection-transformation-gate-v1`, composed from `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify`, `GET /api/dashboard/stadtwerk-mauer-transfer-readiness` and `GET /api/dashboard/grid-connection-transformation-gate`
- Cross-System Variance Landing-Registry Draft Sync rows for `stadtwerk-mauer-cross-system-variance-evidence-matrix-v1`, composed from existing read-only dashboard bricks: `GET /api/dashboard/stadtwerk-mauer-landing-registry-draft`, `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify`, `GET /api/dashboard/stadtwerk-mauer-transfer-readiness` and `GET /api/dashboard/cross-system-variance-matrix`
- Portfolio Market Value Readiness rows for `stadtwerk-mauer-portfolio-market-value-readiness-v1`, composed from `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify` plus a synthetic `POST /api/energy-market/portfolio-backtest` query
- Monitoring Non-Escalation rows for `stadtwerk-mauer-monitoring-non-escalation-status-v1`, composed from `GET /api/dashboard/monitoring-non-escalation` plus Blueprint-Pack verify rows
- Cost Review Committee Readiness rows for `stadtwerk-mauer-cost-review-committee-readiness-v1`, composed from `GET /api/dashboard/cost-review-committee-status` plus Blueprint-Pack verify rows
- Gas Transformation Dataroom Review rows for `stadtwerk-mauer-gas-transformation-dataroom-review-v1`, composed from `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify`, `GET /api/dashboard/gas-transformation-dataroom` and `GET /api/dashboard/stadtwerk-mauer-transfer-readiness`
- Anschlussfristen Evidence Queue rows for `stadtwerk-mauer-connection-deadline-evidence-queue-v1`, composed from `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify`, `GET /api/dashboard/connection-deadline-evidence-queue` and `GET /api/dashboard/stadtwerk-mauer-transfer-readiness`
- Investment Owner-Frist-Budget Gate rows for `stadtwerk-mauer-investment-owner-deadline-budget-gate-v1`, composed from `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify`, `GET /api/dashboard/investment-owner-deadline-budget-gate` and `GET /api/dashboard/stadtwerk-mauer-transfer-readiness`
- Direct Marketer Demo-Raum Sync-Proof rows for `stadtwerk-mauer-direct-marketer-risk-gate-v1`, composed from `GET /api/dashboard/stadtwerk-mauer-landing-registry-draft`, `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify`, `GET /api/dashboard/stadtwerk-mauer-transfer-readiness` and `GET /api/dashboard/direct-marketer-risk-gate`
- Koppelpunkt Freigabeakte rows for `ROLE_MARKTKOMMUNIKATION`, composed from the existing read-only `GET /api/dashboard/interconnection-release-file` brick with explicit synthetic default parameters from the #419 smoke
- A2MDM decision-object rows for `ROLE_GOVERNANCE_OWNER`, composed from the existing read-only `GET /api/dashboard/a2mdm-decision-object` projection with deterministic #423 synthetic defaults and selected-case binding shown only as a context hint until #422 visible-demo apply is unblocked
- Selected-case context binding rows for `ROLE_NETZPLANUNG`, defaulting to `tenantId=stadtwerk-mauer`, `caseId=smm-budibase-workbench`, `target=selected-case-detail` and `seedId=stadtwerk-mauer-pv-missing-nap-v1`, composed from existing selected-target, Hub, case-detail, case-actions, Blueprint-Pack verify and transfer-readiness read models
- Flexible Grid-Connection Release File selector/sync rows for `stadtwerk-mauer-flexible-grid-connection-release-file-v1`, composed from `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify`, `GET /api/dashboard/stadtwerk-mauer-transfer-readiness` and `GET /api/dashboard/anschlusskapazitaet-evidence-queue`
- Model Viability Management Review candidate/matrix/transfer rows for `stadtwerk-mauer-model-viability-management-review-v1`, composed from `GET /api/dashboard/model-viability-evidence-gate` (fixed synthetic single-candidate defaults), `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify` and `GET /api/dashboard/stadtwerk-mauer-transfer-readiness`
- Tabular Decision-Input Readiness selection/verify/matrix/evidence/transfer rows for `stadtwerk-mauer-tabular-decision-input-readiness-v1`, composed only from `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify` and `GET /api/dashboard/stadtwerk-mauer-transfer-readiness`; the `profile`, `quality-report`, `query-plan` and `execute-plan` Tabular Intelligence operations are rendered as curated `source_hint_only` / `not_called` operation-boundary metadata only and are never invoked
- Transfer Readiness rows from `GET /api/dashboard/stadtwerk-mauer-transfer-readiness`, separating public context, synthetic seed data, sandbox runtime artifacts, tenant parameters, reusable Blueprint/Workbench elements and blocked production boundaries
- Municipality Public-Context Scope Readiness selector/classification/boundary/verify/matrix/evidence/transfer/no-call rows for `stadtwerk-mauer-municipality-public-context-readiness-v1`, composed only from `GET /api/dashboard/municipal-energy-value-analysis`, `GET /api/dashboard/stadtwerk-mauer-mastr-data-overlay`, `GET /api/dashboard/quality-summary`, `GET /api/dashboard/observability-mini`, `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify` and `GET /api/dashboard/stadtwerk-mauer-transfer-readiness`; `GET /api/municipality/lookup`, `POST /api/osm-geo/landuse-areas` and `GET /api/grid-operations/market-actor-directory` are rendered only as curated `source_hint_only` / `not_called` no-call guard rows and are never invoked
- Netzanschluss Transparenz Readiness Matrix case/capacity/technical/deadline/offer/communication/verify/matrix/evidence/transfer/no-call rows for the reused `stadtwerk-mauer-grid-connection-transformation-gate-v1` Blueprint-Pack seed and synthetic case `smm-netzanschluss-transparenz-review-001`, composed only from `GET /api/dashboard/grossspeicher-anschluss-readiness-gate`, `GET /api/dashboard/anschlusskapazitaet-evidence-queue`, `GET /api/dashboard/grid-connection-transformation-gate`, `GET /api/dashboard/fnav-fast-track-contract-gate`, `GET /api/dashboard/areal-network-integration-offer-gate`, `GET /api/dashboard/cross-domain-special-topics-queue`, `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify` and `GET /api/dashboard/stadtwerk-mauer-transfer-readiness`
- a scope-protected action query for `POST /api/operations-runbook/stadtwerk-mauer/e2e-smoke`

The action query is intentionally still guarded by Cernion scopes. A Budibase button may be
wired to it later, but the successful UI rendering path does not bypass Cernion authorization.
The case-detail query is read-only and returns evidence, trace, artifact, Blueprint, role and
next-gate summaries plus scalar sandbox annotation/audit readback rows; it does not write
Budibase tables or execute Rundeck jobs.
The sandbox annotation command is the only write-like Workbench binding in this slice. It calls a
curated Cernion command for the synthetic `stadtwerk-mauer` case only, records a bounded
`sandbox_runtime_artifact` with audit metadata and idempotency, and rejects unsupported tenants,
cases, statuses, overlong notes or missing audit metadata safely. Budibase must not use arbitrary
table writes or own case state.
The Hub query is also read-only: it lists generated launcher targets and readiness metadata for
Administrator Workbench (#307), selected case detail (#304), selected-case actions (#305),
Zielnetzplanung, Vertrieb/Key Account and role-workbench catalog (#308). It is a navigation and
readiness model only; role-specific workbenches and Administrator inventory stay separate slices.
The Administrator inventory query is read-only and returns scalar category/item rows that separate
public context, synthetic tenant seed, sandbox runtime artifacts, generated workbench targets and
read/verify runbook surfaces for Budibase tables.
The Tenant Databrowser query is read-only and bounded: it renders scalar inspection rows over
curated tenant categories, selected items, trace hints, detail rows and source rows, but it is not
an unrestricted tenant export, trace replay path or Budibase-owned data store.
The selected-case action query is read-only / verify-only: it returns scalar button metadata for
refreshing the selected case, verifying the Blueprint seed and validating evidence completeness.
Budibase may use these rows for UI-near query refreshes, but setup/reset/provisioning, arbitrary
table writes, Rundeck execution and production mutations stay out of Budibase.
The curated action-button contract is the first reusable Workbench button manifest. It targets
`ROLE_NETZPLANUNG` and synthetic case `smm-budibase-workbench`; only `refresh_read_model`,
`verify_blueprint_seed` and `validate_evidence_completeness` are enabled. Sandbox annotation is
shown only as guarded/disabled in this slice, and consequential classes such as direct Rundeck,
Budibase table writes, provisioning, settlement, HITL, device-control, external connectors and
Personal-Agent execution remain forbidden no-call guards.
The Safe-Action Catalog explains those rows with Operation Capability Index metadata. It maps the
first curated actions to scalar `operationId`, `operationKind`, `consequenceLevel`,
`recommendedExecutionMode`, scope, tenant-boundary, missing-parameter, enabled/disabled,
next-gate and no-call fields. Disabled consequential placeholders stay visible for governance
review, but Budibase does not execute Rundeck, operations-runbook jobs, sandbox commands,
external connectors, HITL/workflow, MaKo, billing, settlement, tariff or device-control actions.
The demo process panel uses the same read-only endpoint to render scalar process actions,
last known results, required evidence and Budibase/Cernion/Rundeck boundary rows. Unsafe
operational actions are visible as disabled rows only; Budibase does not execute Rundeck jobs
or become the process system of record.
The role workbench catalog query is read-only: it returns scalar role/open-target rows for
Administrator, Zielnetzplanung, Vertrieb, Key Account and VDMI governance/reviewer targets.
It does not implement role-specific calculations, authorization changes, role assignments or
Budibase-owned workflow state.
The selected Zielnetzplanung item detail query is read-only: it decomposes one generated role
queue item into scalar summary, context, evidence-gap, next-gate and safe-follow-up rows.
It is advisory planning evidence only; it does not approve grid capacity, mutate public context,
persist Budibase selection state or execute planning/operations actions.
The Vertrieb briefing query is read-only: it returns scalar briefing, claim, evidence, gap and
follow-up rows for a presenter-safe sales or Key Account view. Claims are deterministic from
Cernion evidence and explicitly marked evidence-backed, assumption-backed or not-yet-claimable;
CRM/customer master data, offer creation, arbitrary LLM claims, Budibase writes and production
actions stay out of scope.
The Workbench landing query is read-only: it returns scalar first-screen status, section readiness
and presenter walkthrough rows so the app opens as a demo surface instead of an internal build
surface. It does not perform setup, reset, provisioning, Budibase table writes, runbook execution
or production mutations.
The Blueprint seed selector is read-only manifest/query state. It lists the canonical
Stadtwerk-Mauer seeds, defaults the selected seed to the #404 grid connection transformation
gate, renders V/D/M/I/Nachweise cells as scalar columns, and keeps Landing-Registry /
productive Demo-Raum sync blocked until explicit sync proof exists. The grid transformation
panel composes existing read-only verify, transfer-readiness and grid-connection transformation
dashboard bricks into scalar NAP/MaLo, division, transformation option, data-quality,
investment/decommission path, owner, next-action, evidence-gap and no-call rows.
The Cross-System Variance Landing-Registry Draft Sync panel is a generated read-only render slice.
It composes existing Landing-Registry draft, Blueprint-Pack verify, transfer-readiness and
cross-system variance read models into scalar summary, draft-preview, matrix-sync, publication
blocker, positive-follow-up and no-call guard rows. It does not write the Landing Registry,
publish `cernion.de`, execute Rundeck, call external connectors, write Budibase or Cernion
tables, mutate production tenants or add Personal-Agent shortcuts.
The Portfolio Market Value Readiness panel is a generated read-only render slice. It combines
Blueprint-Pack seed/matrix guard rows for the canonical portfolio seed with synthetic
portfolio-backtest plausibility rows (`specificYieldKwhPerKw`, `orientationYieldKwhPerKw`,
`yieldRatio`, `generationCoverage`), evidence gaps, safe next gates and non-advice/no-call
boundaries. Budibase may render and refresh these rows, but it must not persist portfolios,
trade, publish investment advice, call external connectors, write arbitrary tables, mutate
production tenants, or perform MaKo, billing, settlement, tariff, device-control or Personal-Agent
actions.
The Monitoring Non-Escalation panel is a generated read-only render slice. It combines the
existing `monitoring-non-escalation` evidence card with Blueprint-Pack seed/matrix guard rows
for the canonical monitoring seed. Budibase renders scalar selected-signal status, rationale,
source freshness, absent-blocker evidence, owner, next-check, positive follow-up and no-call
rows only. It must not read mail, Teams, SharePoint or Outlook; create tickets, HITL tasks,
webhooks, escalations or workflow runs; write Object Store/RAG/public context; call external
connectors; or turn synthetic signal identifiers into real VNB/customer/meter/device-control
state.
The Cost Review Committee Readiness panel is a generated read-only render slice. It combines
the existing `cost-review-committee-status` evidence card with Blueprint-Pack seed/matrix guard
rows for the canonical cost-review seed. Budibase renders scalar owner, source, asset/value
relevance, readiness, threshold, next-gate, evidence-gap, positive-follow-up and no-call rows
only. It must not write ERP/SAP/accounting records, approve budgets, execute committee
decisions, create workflow/HITL/mail actions, call external connectors, publish Demo-Raum or
Landing Registry state, execute Rundeck, write arbitrary Budibase tables, mutate production
tenants or use Personal-Agent shortcuts.
The Gas Transformation Dataroom panel is a generated read-only render slice. It combines
Blueprint-Pack seed/matrix guard rows for the canonical gas dataroom seed with the existing
`gas-transformation-dataroom` and transfer-readiness read models. Budibase renders scalar room
boundary, transformation path, scenario-reference, EOG/KANU/no-legal-decision, evidence-register,
decision-log, roadmap, owner, next-action, Demo-Raum sync and no-call rows only. It must not write
Datenraum state, execute decommissioning, create legal/regulatory decisions, publish Demo-Raum or
Landing Registry state, call external connectors, execute Rundeck, write arbitrary Budibase tables,
mutate production tenants or use Personal-Agent shortcuts.
The Anschlussfristen Evidence Queue panel is a generated read-only render slice. It combines
Blueprint-Pack seed/matrix guard rows for the canonical connection-deadline seed with the existing
`connection-deadline-evidence-queue` and transfer-readiness read models. Budibase renders scalar
synthetic Anschlussfall, deadline-risk, owner/contributor, missing-evidence, next-gate,
non-sending communication-note draft, Demo-Raum sync and no-call rows only. It must not send
customer communication, write CRM/customer portal records, reserve capacity, approve/reject
connections, calculate legally binding deadlines, execute MaKo/billing/settlement/tariff or
device-control actions, call external connectors, write arbitrary Budibase tables, mutate
production tenants or use Personal-Agent shortcuts.
The Investment Owner-Frist-Budget Gate panel is a generated read-only render slice. It combines
Blueprint-Pack seed/matrix guard rows for the canonical investment owner/deadline/budget seed with
the existing `investment-owner-deadline-budget-gate` and transfer-readiness read models. Budibase
renders scalar measure identity, accountable owner, deadline, budget effect, approval/source
evidence, blocked decision, next escalation gate, Demo-Raum sync and no-call rows only. It must not
write ERP/SAP/accounting records, approve or reserve budget, execute committee decisions, transfer
treasury funds, create workflow/HITL/mail/webhook actions, call external connectors, write arbitrary
Budibase tables, mutate production tenants, publish Demo-Raum or use Personal-Agent shortcuts.
The Direct Marketer Demo-Raum Sync-Proof panel is a generated read-only render slice. It composes
the existing Landing-Registry draft, Blueprint-Pack verify, transfer-readiness and
direct-marketer risk-gate read models for the fixed canonical seed
`stadtwerk-mauer-direct-marketer-risk-gate-v1`. Budibase renders scalar Blueprint-Pack validity,
matrix row count, `M = Mitwirkend`, Landing-Registry derivability, draft preview, publication
blocker, positive-follow-up, safe-next-inspection and no-call rows only. It must not write the
Landing Registry, publish `cernion.de`, submit schedules, transfer balancing groups, approve
offers/contracts, contact customers, call external direct-marketer connectors, execute MaKo,
billing, settlement, tariff, SMGW/CLS or device-control actions, execute Rundeck, write arbitrary
Budibase tables, mutate production tenants or use Personal-Agent shortcuts.
The Koppelpunkt Freigabeakte panel is a generated read-only render slice. It composes the existing
`interconnection-release-file` read model with fixed synthetic demo parameters
(`KP-SYN-MAUER-01`, `MP-SYN-MAUER-01`, `TS-SYN-MAUER-01`, `mappingVersion=v1`) for
`ROLE_MARKTKOMMUNIKATION`. Budibase renders scalar summary, mapping subject, evidence
source/version, approval owner/status, affected downstream process, missing-evidence,
safe-next-gate and no-call rows only. It must not write A2MDM or mapping state, execute a
Freigabe workflow, submit MaKo messages, run billing/settlement/tariff/device-control actions,
call external connectors, write arbitrary Budibase tables, mutate production tenants or use
Personal-Agent shortcuts.
The A2MDM Decision Object panel is a generated read-only render slice. It composes the existing
`a2mdm-decision-object` projection with deterministic #423 synthetic defaults for
`ROLE_GOVERNANCE_OWNER`; selected-case binding is only a context hint until #422 visible-demo
apply is unblocked. Budibase renders scalar summary, subject, business intent, technical
constraint, regulatory reference, evidence source, owner role, risk level, decision threshold,
next gate, missing-input, positive-follow-up and no-call rows only. It must not write A2MDM
source-of-truth state, create workflows/HITL, call external connectors, perform MaKo, billing,
settlement, tariff, device-control, SMGW/CLS, Landing-Registry or production publication actions,
write arbitrary Budibase tables, mutate production tenants or use Personal-Agent shortcuts.
The Selected-Case Context Binding panel is generated Budibase manifest composition, not a new
Cernion service. It binds the synthetic default Stadtwerk Mauer case to existing read-only
dashboard bricks and renders scalar context, bound read-model, evidence/trace/artifact,
next-gate/action and no-call guard rows. Because this slice introduces no new backend capability,
it does not add a Capability Broker route or Hydration Registry rule. Budibase may refresh the
existing read queries, but it must not persist selection state, import/reset seeds, write
Landing-Registry or Cernion tables, execute Rundeck, create HITL/workflow actions, call external
connectors, mutate production tenants or use Personal-Agent shortcuts.
The Flexible Grid-Connection Release File panel is generated manifest composition, not a new
Cernion endpoint. It selects the canonical Blueprint-Pack seed and renders scalar verification,
V/D/M/I matrix-sync, connection/NVP/capacity, restriction/flexibility, reservation/release and
contract-review boundary, owner/deadline, missing-evidence, transfer-readiness, next-gate and
no-call rows for the synthetic `stadtwerk-mauer` case. Blueprint-Pack remains the canonical matrix
source; Landing Registry and productive Demo-Raum publication remain blocked downstream steps.
Budibase may refresh existing read-only rows or verify the seed, but it must not reserve capacity,
approve or reject a connection, create a contract, execute Rundeck, perform MaKo, billing,
settlement, tariff or device-control operations, create HITL/workflow actions, call external
connectors, write arbitrary tables, mutate production, publish Landing Registry state, handle
secrets or use Personal-Agent shortcuts.
The Model Viability Management Review panel is generated manifest composition, not a new Cernion
endpoint. It calls the merged single-candidate `model-viability-evidence-gate` brick with a fixed,
clearly synthetic candidate (`section_42c_community`), and renders scalar candidate/readiness,
per-dimension evidence-vs-assumption-vs-missing, missing-evidence, positive-follow-up and
decision-boundary rows alongside the canonical `stadtwerk-mauer-model-viability-management-review-v1`
Blueprint-Pack four-row V/D/M/I matrix and transfer-readiness state. Blueprint-Pack remains the
canonical matrix source; Landing Registry and productive Demo-Raum publication remain blocked
downstream steps. Budibase may refresh these existing read-only rows, but it must not rank or score
candidates, select a winner, calculate economics/NPV, make a legal/regulatory/market-entry/go-live
determination, mutate a tariff/contract, execute billing/settlement/MaKo/A96, book finance, run
procurement/market-communication/dispatch/Redispatch/device-control, create HITL/workflow actions,
call external connectors, write arbitrary tables, mutate production, publish Landing Registry state,
handle secrets or use Personal-Agent shortcuts.
The Tabular Decision-Input Readiness panel (#478) is generated manifest composition, not a new
Cernion endpoint. It composes only the existing `stadtwerk-mauer-blueprint-pack-verify` and
`stadtwerk-mauer-transfer-readiness` read models for the canonical
`stadtwerk-mauer-tabular-decision-input-readiness-v1` Blueprint-Pack seed and synthetic case
`smm-tabular-decision-input-review-001`. Budibase renders scalar selected table/case and role
question, Blueprint verification, the canonical four-row V/D/M/I matrix with
`roleLegend.M = Mitwirkend`, scope/privacy/profile-hash evidence,
schema/missing-value/duplicate/interval-quality/outlier evidence, executed-plan/source-row/
result-row/hash/warning evidence state, owner/readiness/next-safe-gate evidence,
transfer-readiness/data-class boundaries, and the visible
`Blueprint-Pack/Cernion-Energy-Tools -> Landing-Registry -> Produktivseite` sync chain with
Landing-Registry and Produktivseite kept explicitly pending. The `profile`, `quality-report`,
`query-plan` and `execute-plan` Tabular Intelligence operations are rendered only as curated
`source_hint_only` / `not_called` operation-boundary metadata rows; Budibase must not call
`/api/tabular/profile`, `/api/tabular/quality-report`, `/api/tabular/query-plan` or
`/api/tabular/execute-plan`, import or mutate source rows, execute arbitrary SQL/expressions/
callbacks, export raw rows, write Budibase or Cernion tables, publish the Landing Registry or
`cernion.de`, run MaKo/A96/billing/settlement/tariff/Redispatch/device-control actions, handle
secrets, or use Personal-Agent shortcuts.
The selected-target query is read-only: it maps a supported Hub or role target to scalar selected,
focus and helper rows so Budibase can visibly focus a section without owning persistent state or
mutating Cernion tenant data.
The MaStR public-context revalidation rows are read-only: they separate MaStR/OSM public context,
synthetic Stadtwerk-Mauer tenant seed and synthetic revalidation drill/runtime rows. Budibase may
render refresh/verify hints, but it must not mutate MaStR, write arbitrary Cernion tables, execute
production tenant actions or turn synthetic case evidence into official public-context changes.
The selected-case meaning-preservation panel is read-only: it reuses the existing
`coordination-meaning-preservation-profile` read model for the synthetic Stadtwerk-Mauer
selected case and renders scalar preserved, missing, weak, owner/deadline/decision,
transfer-parameter and no-call rows. Budibase must not persist handover state, create actions,
write tables, call connectors, mutate production data or use Personal-Agent shortcuts.
The municipal value peer-corridor rows are read-only: they reuse the existing municipal energy
value dashboard model and render scalar presenter evidence for municipal budget effect,
operator/private value, derived-load status, peer-corridor position, no-autarky guardrails and
missing evidence gates. Budibase may refresh these queries, but it must not write public context,
make household-equivalent/autarky/supply claims, create legal opinions, or become the consulting
or municipal-value system of record.
The VDMI profile and synthetic event preview panel is read-only: it renders scalar rows over the
existing synthetic Stadtwerk Mauer profile, role model, capability projection, event templates,
deterministic replay preview, evidence gaps and no-call boundaries. Budibase may refresh these
queries and open existing rendered targets, but it must not inject events, persist replay state,
schedule jobs, execute Rundeck, create HITL/NOVA/VDMI tasks, call external connectors, mutate
public context, or imply that synthetic event IDs are real customer, meter, consent, MaKo or
device-control data.
The VNB Delta / Signal Queue panel is read-only: it renders scalar summary, classifier,
owner/deadline/evidence, safe-next-action, leadership-delta and no-call/source-boundary rows
for caller-supplied synthetic signals. Budibase may refresh these existing read models, but it
must not read mail, Outlook/Gmail, Teams, calendar or task connectors; create notifications,
tickets, HITL/NOVA/VDMI tasks or Rundeck jobs; persist raw private content; mutate public context;
or perform MaKo, billing, settlement, tariff, webhook, device-control or Personal-Agent actions.
The Evidence Freshness panel is read-only: it renders scalar freshness, delta, owner/deadline,
blocked-decision, evidence-gap, positive-follow-up and no-call rows for the selected synthetic
Stadtwerk Mauer signal by calling the existing `evidence-freshness-guard` read model. Budibase
does not ingest connectors, store selected-case state, mutate public context, create workflow
items, execute Rundeck or treat synthetic signal identifiers as real customer, meter, consent,
MaKo or device-control data.
The Blueprint Verify panel is read-only: it renders scalar seed-validity, Demo-Raum matrix-sync,
data-class, required-evidence, role-relation, warning/next-gate and forbidden-action rows from a
dashboard facade backed by the existing operations-runbook verify contract. Budibase may refresh
the verify query, but it must not execute Rundeck directly, run setup/reset/provisioning, import
seeds, write public context, mutate Budibase-owned Cernion state, or treat synthetic Blueprint
evidence as real customer, meter, consent, MaKo, billing, settlement, tariff or device-control data.

## Case View Manifest Contract

Reusable role/persona case views are described by Cernion-owned Case View Manifests before they
become renderer-specific Budibase panels. The first static contract is
`integrations/budibase/manifests/case-view-manifest-stadtwerk-mauer-pv-missing-nap.json` for
`selected_case_evidence_trace_artifact_review`, `ROLE_NETZPLANUNG` and the synthetic
`stadtwerk-mauer` PV missing-NAP case.

The manifest is a read-only renderer contract, not a new runtime endpoint. It declares section ids,
route targets, source dashboard endpoints, query parameters, scalar row bindings, column schemas,
evidence/risk/next-gate semantics, data-class labels, safe action classes, forbidden actions,
positive follow-ups and transfer parameters. The matching helper
`integrations/budibase/manifests/case-view-manifest.js` validates that rows stay scalar and that
Budibase cannot become the system of record.

Budibase may consume these manifests as generated rendering metadata. Cernion still owns tenant
boundaries, case state, evidence, traces, artifacts, command gates and audit trails. A manifest must
not add arbitrary Budibase writes, broad cockpit behavior, Personal-Agent shortcuts, direct Rundeck
execution, MaKo, billing, settlement, tariff, device-control or production mutations.

## Apply Locally

For the local Docker spike, Budibase may need `SELF_HOSTED=1` and an empty `BLACKLIST_IPS` so
it can call the Docker host Cernion DevServer URL.

Example:

```bash
BUDIBASE_BASE_URL=http://localhost:10000 \
BUDIBASE_EMAIL=admin@cernion.local \
BUDIBASE_PASSWORD='...' \
CERNION_BASE_URL=http://172.17.0.1:3900 \
node integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js
```

If the local Budibase login endpoint is temporarily rate-limited during testing, reuse a curl
cookie jar instead:

```bash
BUDIBASE_BASE_URL=http://localhost:10000 \
BUDIBASE_COOKIE_FILE=/path/to/budibase.cookies \
CERNION_BASE_URL=http://172.17.0.1:3900 \
node integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js
```

The script is idempotent for the local spike:

1. finds or creates the Budibase app,
2. finds or creates the workspace app,
3. upserts the Cernion REST datasource,
4. upserts the REST queries with explicit schemas,
5. upserts the generated screen with query-backed table blocks.

## Dev Loop Apply Gate

For Budibase workbench issues, repo changes alone are not enough for a visible demo update.
After a Budibase-related implementation has been committed, pushed, deployed to the Cernion
DevServer when needed, and verified by focused tests, the DevOps issue loop should run a
controlled Budibase apply/smoke step against the development Budibase instance.

Use this only for generated Budibase artifacts in `integrations/budibase/`; do not hand-edit the
Budibase app as the source of truth.

Recommended development gate:

```bash
BUDIBASE_BASE_URL=http://localhost:10000 \
BUDIBASE_COOKIE_FILE=/mnt/backup/openclaw/.openclaw/workspace/devops/data/budibase-local.cookies \
CERNION_BASE_URL=http://172.17.0.1:3900 \
node integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js
```

If the cookie is expired or the Budibase container is unavailable, stop and report the Budibase
apply as a visible-demo blocker instead of silently closing the issue as fully visible. The issue
may still close as a code/API slice only when the closeout explicitly says that no live Budibase
apply was completed.

## Reverse-Engineering Notes

Two Budibase details are important for generated query-backed screens:

- Query `dataSource` objects must contain both `datasourceId` and `_id` with the query ID.
  Without `_id`, Budibase renders the component but never executes `/api/v2/queries`.
- REST/OpenAPI-imported queries need explicit `schema` fields. With `schema: {}`, Budibase
  fetches query definitions and executes the query, but table blocks do not render rows.

These details should be hidden behind a future Cernion Case View Manifest renderer instead of
leaking into product-level workbench definitions.

### Redispatch E2E Evidence Chain panel (#465)

The Redispatch E2E Evidence Chain panel (#465) is a read-only, renderer-only composition for the synthetic `stadtwerk-mauer-redispatch-participation-readiness-v1` validation chain. It joins the existing dashboard reads for metering/masterdata readiness, Redispatch call quality, Redispatch participation readiness, project-controlling/KPI, owner/deadline, Blueprint verify and transfer-readiness, while reusing the canonical Redispatch Participation matrix/evidence/guard/no-call rows instead of cloning them.

The panel answers for `ROLE_GRID_OPERATIONS_LEAD` whether the synthetic Redispatch validation chain is ready for the next review and, if not, which scope, data-quality, test, exception, owner/deadline or final-gate evidence blocks it. It renders scalar rows only and remains explicitly non-executable: no Redispatch steering engine, endpoint, case type, second Blueprint seed, Budibase write, authorization/provisioning, dispatch/device control, MaKo/billing/settlement/tariff/contract, workflow/HITL/CRM/mail/webhook/connector call, production mutation, secret exposure or Personal-Agent shortcut is introduced.

### Municipality Public-Context Scope Readiness panel (#555)

The Municipality Public-Context Scope Readiness panel (#555) is a generated read-only render slice over #554's canonical `stadtwerk-mauer-municipality-public-context-readiness-v1` Blueprint-Pack seed and synthetic case `smm-municipality-public-context-review-001`. It composes only the six read models named in the accepted plan: `GET /api/dashboard/municipal-energy-value-analysis` for municipality identity, AGS and the complete `postalCodes[]` scope (not just the first PLZ); `GET /api/dashboard/stadtwerk-mauer-mastr-data-overlay` for MaStR/OSM public-context classification and revalidation state, kept on a separate data class from synthetic rows; `GET /api/dashboard/quality-summary` and `GET /api/dashboard/observability-mini` for bounded platform-quality/service-availability context that is explicitly labeled as never being municipality-specific completeness; and `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify` / `GET /api/dashboard/stadtwerk-mauer-transfer-readiness` for the seed verification, the canonical four-row V/D/M/I matrix (`roleLegend.M = Mitwirkend`) and the public-context/synthetic-seed/sandbox-artifact transfer-readiness rows.

The panel answers for `ROLE_DATA_GOVERNANCE`, `ROLE_NETZPLANUNG` and `ROLE_MUNICIPAL_STRATEGY` whether the selected municipality scope is unambiguous, which context is public versus derived/heuristic, which evidence is missing, who owns clarification, and what safe review gate follows, for one bounded demo municipality selected from `Mauer`, `Sandhausen` or `Wiesloch` (a transfer parameter, not a hardcoded product constant). A timeout or degraded source response renders as `missing-evidence`/`clarification`, never a negative fact, and the Blueprint-Pack/Cernion-Energy-Tools -> Landing-Registry -> Produktivseite sync chain stays honest with Landing-Registry and Produktivseite explicitly pending. `GET /api/municipality/lookup`, `POST /api/osm-geo/landuse-areas` and `GET /api/grid-operations/market-actor-directory` are rendered only as curated `source_hint_only` / `not_called` no-call guard rows; Budibase never calls them ad hoc, and a market-actor directory hit is never rendered as proof of municipal service or VNB assignment. No new endpoint, service action, Capability Broker route, Hydration Registry rule, formatter, Personal-Agent hardcoding, external connector call, production action, Landing Registry write or secret/key work is introduced.

### Netzanschluss Transparenz Readiness Matrix panel (#530)

The Netzanschluss Transparenz Readiness Matrix panel (#530) is a generated, dedicated `netzanschluss_transparenz_*` section group and read-only render slice over existing Netzanschluss-, Kapazitaets- and Governance-read models. It composes only the eight read models named in the accepted plan: `GET /api/dashboard/grossspeicher-anschluss-readiness-gate` for the selected Anschlussfall, NAP/MaStR evidence, fNAV contract boundary, Steuerbarkeit and Kontrollraum-Uebergabe; `GET /api/dashboard/anschlusskapazitaet-evidence-queue` for Kapazitaetsauskunft evidence; `GET /api/dashboard/grid-connection-transformation-gate` for technische Pruefung and data-quality evidence; `GET /api/dashboard/fnav-fast-track-contract-gate` for Fristen and fNAV-Rechtssicherheit; `GET /api/dashboard/areal-network-integration-offer-gate` for Zielnetzpfad, CAPEX/Invest and Entscheidungsfenster; `GET /api/dashboard/cross-domain-special-topics-queue` for Kommunikationsbausteine; and `GET /api/dashboard/stadtwerk-mauer-blueprint-pack-verify` / `GET /api/dashboard/stadtwerk-mauer-transfer-readiness` for the reused `stadtwerk-mauer-grid-connection-transformation-gate-v1` Blueprint-Pack seed verification, the canonical four-row V/D/M/I matrix (`roleLegend.M = Mitwirkend`) and the owner/audit transfer-readiness rows. No new Blueprint-Pack seed and no second `demoProcessMatrix` are introduced.

The panel answers for `ROLE_NETZPLANUNG` and `ROLE_ANSCHLUSSWESEN`, for one synthetic connection case `smm-netzanschluss-transparenz-review-001`, which capacity, technical, deadline and communication evidence is present or missing, who owns clarification, and what safe read-only refresh/verify gate follows next. The valid fNAV route is `GET /api/dashboard/fnav-fast-track-contract-gate`; the earlier `/fnav-fast-track-vertragsgate` spelling is not the public REST contract and is never used. The Blueprint-Pack/Cernion-Energy-Tools -> Landing-Registry -> Produktivseite sync chain stays honest with Landing-Registry and Produktivseite explicitly pending. No capacity reservation, connection approval/rejection, external communication, GIS/ERP/MDM/MaStR/ZNP write, MaKo, billing, settlement, tariff, dispatch, device control, workflow/HITL, Rundeck execution, arbitrary Budibase table write, new endpoint, Capability Broker route, Hydration Registry rule, formatter or Personal-Agent shortcut is introduced.
