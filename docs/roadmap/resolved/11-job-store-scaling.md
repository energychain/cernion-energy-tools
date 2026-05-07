# Issue 11 — Job-Store-Driver-Interface (file → embedded → distributed)

**Bereich:** Skalierung · **Priorität:** Mittel · **Ziel-Release:** v0.44

## Problem

`src/job-store.js` ist file-backed (`data/jobs/`), single-process, ohne Locking-Garantie. Sobald eine zweite Cernion-Instanz hinter einem Load-Balancer läuft (HA, Wartungsfenster, Tenant-Isolation), zerbricht der Async-Job-Pattern. Auch die Jest-Open-Handles-Warnung (`fs.watch` in `datasource-watcher`) deutet auf Filesystem-Spannung.

## Vorschlag

1. **Driver-Interface `src/job-store/driver.js`:** `enqueue/get/update/list/cleanup`.
2. **Driver:**
   - `file` (default, bestehend, KRITIS-Air-Gap)
   - `pouchdb` (embedded, multi-process-fähig via Conflict-Resolution + Leader-Election)
   - `redis-compat` (für Stadtwerke mit interner Redis/Valkey-Infra; opt-in)
3. **Heartbeat & Lease:**
   - Worker hält Lease 30 s, Renewal 10 s; abgelaufene Leases → `queued`
   - `kill --9` einer Instanz → max. 30 s Stillstand, dann Re-Run
4. **Idempotenz-Anforderung:** Jobs müssen wiederholbar sein; `mastr-quality.audit` und `utility-report.generate` mit Re-Entry-Test.
5. **Migration:** `scripts/migrate-jobs.js` von `file` → `pouchdb`.

## Akzeptanzkriterien

- 2 parallele Cernion-Instanzen (Test) verarbeiten Jobs ohne Doppelarbeit.
- Driver-Wechsel via `JOB_STORE_DRIVER=…` ohne Code-Anpassung.
- Test-Suite gegen alle drei Driver (Redis hinter `JOB_STORE_INTEGRATION=true`).
- Open-Handles-Warning nicht mehr durch Job-Store getriggert.

## Bezug

- `docs/ARCHITECTURE.md` §6.3 Async-Job-Pattern
- `docs/ARCHITECTURE.md` Bekannte Einschränkungen — Jest Open Handles
- Hängt an Issue 07 (Listings über Jobs)
