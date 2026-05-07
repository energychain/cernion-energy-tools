# Issue 02 — Multi-Tenant über alle Services (PoC → Produktion)

**Bereich:** Plattform · **Priorität:** Hoch · **Ziel-Release:** v0.41

## Problem

In v0.38.0 wurde `src/tenant-context.js` als rückwärtskompatibles Multi-Tenant-Fundament eingeführt — bisher nur als **Proof-of-Concept im CYA-Service** (`createProfile`, `getProfile`, `listProfiles`). Alle anderen schreibenden Services nutzen weiterhin hardcoded Namespaces. Token-Manager kennt zwar `tenantId`, der Wert wird außerhalb des CYA-PoC nicht ausgewertet.

Die Plattform ist damit nicht echt SaaS-fähig: ein zweiter Stadtwerk-Tenant würde sich Object-Store-, Datapoint-, Job- und Audit-Records mit dem ersten teilen.

## Scope

Tenant-Awareness für:

- [ ] `mastr-quality.audit` Reports
- [ ] `redispatch-expost.audit` Reports
- [ ] `grid-connection.validate` Reports
- [ ] `energy-sharing.validate` + `energy-sharing-allocation.allocate`
- [ ] `datapoint.*` (Snapshots, Health, OEMetadata)
- [ ] `mastr-monitor.watches` + Subscriptions
- [ ] `vnb-monitor` Thresholds
- [ ] `nbp-monitor` Parameters
- [ ] `bilanzkreis` + `settlement`
- [ ] `cya.session.*` (`compareProfiles`, `refine`)
- [ ] `finance-agent.*` (analyses, memory)
- [ ] `knowledge-rag` Collection-Whitelisting pro Tenant
- [ ] `job-store` (`data/jobs/{tenant}/...`)

## Vorgehen

1. **Pattern**: Alle `object-store.put|get|query` und PouchDB-Schreibzugriffe konsequent durch `tenantNamespace(NS, getTenantId(ctx))` ersetzen.
2. **Default-Tenant-Migration** via `scripts/migrate-default-tenant.js` (idempotent, dry-run-Modus).
3. **Tenant-Admin-API**: `GET /api/tenants/:id/storage-stats`, `DELETE /api/tenants/:id/data` (full-access only).
4. **RBAC pro Tenant**: Token-Scope wird zu `(tenantId, scope)` Tupel; `requiresFullAccess` blockiert tenant-übergreifende Operationen.
5. **Cross-Tenant-Audit**: Logger flagt `ctx.meta.tenantId !== record.tenantId` als WARN, persistiert in `tenant_violations`.

## Akzeptanzkriterien

- 2 parallele Tenants schreiben/lesen identische Endpoints, sehen exklusiv ihre eigenen Daten.
- E2E-Test (`tests/multi-tenant-isolation.e2e.test.js`) deckt alle Schreib-Services ab.
- Default-Tenant-Verhalten unverändert.
- Migration dokumentiert in `docs/MIGRATION_v0.41.md`.

## Bezug

- v0.38.0 Multi-Tenant-Fundament
- v0.38.5 Object-Store NS_PATTERN erweitert (CR-TENANT-001)
- `feedback/CR-TENANT-001.md`
