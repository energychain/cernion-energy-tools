# Issue 14 — Async-Job-Cutover Rollout (alle Long-Running-Endpunkte)

**Bereich:** Skalierung · **Priorität:** Hoch · **Ziel-Release:** v0.47

## Problem

v0.45.1 hat das Driver-Interface (`file/pouchdb/redis-compat`) eingeführt, aber laut Changelog wurde **nur `mastr-quality.audit`** auf das generische Async-Job-Pattern migriert. Andere Long-Runner laufen weiterhin unter dem alten file-backed Pfad oder synchron — Multi-Instanz-Setup nicht möglich.

## Scope

Auf das v0.45.1-Driver-Interface migrieren:

- [ ] `utility-report.generate` (Phase-1–4-Pipeline, derzeit fragilster Long-Runner)
- [ ] `oep.compareWithMastr` (HTTP 202 für `limit > 5000` schon eingeführt — aber Driver-Interface nicht durchgereicht)
- [ ] `redispatch-expost.audit`
- [ ] `grid-connection.validate`
- [ ] `energy-sharing.validate`
- [ ] `energy-sharing-allocation.allocate`
- [ ] `knowledge-rag.ingest` und `…/reindex` (laufen schon async, aber Driver-Pluggable noch nicht garantiert)
- [ ] `cya.generate` (Multi-Agent-Pipeline)

## Vorgehen

1. **Generischer Wrapper** `src/async-job-runner.js`:
   - `runAsync(ctx, { actionName, params, jobKind, idempotencyKey, progress })`
   - automatischer Lease-Heartbeat (`leaseSeconds`, `heartbeatSeconds`)
   - Failover-Wiederaufnahme gegen abgelaufene Leases
2. **Idempotenz-Pflicht** für alle migrierten Aktionen:
   - Eingabe-Hash → existierenden Job zurückgeben statt neu starten
   - Re-Entry-Tests pro Service
3. **Progress-API** vereinheitlicht:
   - `progress: { step, totalSteps, message, payload? }`
   - `GET /api/jobs/:id/progress` (SSE-Stream optional, sonst Polling)
4. **OpenAPI-Update** überall: `202 Accepted` als alternative Response.
5. **Backward-Compat:** interner Service-zu-Service-Aufruf bleibt synchron (wie schon bei `mastr-quality.audit`).
6. **Migration-Skript** `scripts/migrate-jobs.js` um nicht-`mastr-quality`-Jobs erweitern.

## Akzeptanzkriterien

- Alle oben gelisteten Aktionen unterstützen `JOB_STORE_DRIVER=pouchdb` → Multi-Instanz-Setup mit zwei Cernion-Replicas verarbeitet jeden Job genau einmal.
- Lasttest: parallel 50 `utility-report.generate`-Anforderungen → keine Doppelarbeit, korrekte Lease-Migration bei `kill -9`.
- E2E-Test pro Service unter `tests/<service>.async.e2e.test.js`.
- OpenAPI-Audit: alle migrierten Endpunkte dokumentieren `202`-Pfad.

## Bezug

- v0.45.1 — Driver-Interface-Foundation
- `docs/ARCHITECTURE.md` §6.3 Async-Job-Pattern
- v0.37.1 — Phase-3-Heartbeats (zeigt manuellen Workaround)
