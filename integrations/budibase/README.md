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
- selected-case action rows from `GET /api/dashboard/stadtwerk-mauer-case-actions?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`
- role workbench catalog/open-target rows from `GET /api/dashboard/stadtwerk-mauer-role-workbench-catalog?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench`
- Vertrieb/Key Account briefing rows from `GET /api/dashboard/stadtwerk-mauer-sales-workbench-briefing?tenantId=stadtwerk-mauer&caseId=smm-budibase-workbench&audience=vertrieb`
- a scope-protected action query for `POST /api/operations-runbook/stadtwerk-mauer/e2e-smoke`

The action query is intentionally still guarded by Cernion scopes. A Budibase button may be
wired to it later, but the successful UI rendering path does not bypass Cernion authorization.
The case-detail query is read-only and returns evidence, trace, artifact, Blueprint, role and
next-gate summaries; it does not write Budibase tables or execute Rundeck jobs.
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
The role workbench catalog query is read-only: it returns scalar role/open-target rows for
Administrator, Zielnetzplanung, Vertrieb, Key Account and VDMI governance/reviewer targets.
It does not implement role-specific calculations, authorization changes, role assignments or
Budibase-owned workflow state.
The Vertrieb briefing query is read-only: it returns scalar briefing, claim, evidence, gap and
follow-up rows for a presenter-safe sales or Key Account view. Claims are deterministic from
Cernion evidence and explicitly marked evidence-backed, assumption-backed or not-yet-claimable;
CRM/customer master data, offer creation, arbitrary LLM claims, Budibase writes and production
actions stay out of scope.
The Workbench landing query is read-only: it returns scalar first-screen status, section readiness
and presenter walkthrough rows so the app opens as a demo surface instead of an internal build
surface. It does not perform setup, reset, provisioning, Budibase table writes, runbook execution
or production mutations.
The selected-target query is read-only: it maps a supported Hub or role target to scalar selected,
focus and helper rows so Budibase can visibly focus a section without owning persistent state or
mutating Cernion tenant data.

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
