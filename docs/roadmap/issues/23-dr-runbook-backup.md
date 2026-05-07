# Issue 23 — Disaster Recovery Runbook + Multi-Tenant-Backup

**Bereich:** Operations · **Priorität:** Mittel · **Ziel-Release:** v0.50

## Problem

`docs/DEPLOYMENT_RUNBOOK.md` deckt Standard-Deployment ab, aber für KRITIS-konformen Betrieb fehlt:

- **Backup-Strategie** für alle PouchDB-Stores (9 Stores plus `tenant:*`-Namespaces, plus `data/jobs/`, plus `data/observability/`, plus MQTT-Broker-State).
- **Restore-Test:** keine reproduzierbaren Wiederherstellungs-Szenarien.
- **DR-Failover:** keine Standby-Konfiguration, kein RTO/RPO-Ziel definiert.
- **Multi-Tenant-Granularität:** kein Per-Tenant-Backup für selektives Restore (z. B. wenn ein Tenant eine fehlerhafte Migration zurückrollen muss).

§42c (Issue 13) verlangt explizit „Daten-Snapshot vor Cutover, Restore-Test dokumentiert" — diese Anforderung ist heute nicht erfüllbar.

## Vorschlag

1. **Backup-Infrastruktur** in `scripts/backup/`:
   - `scripts/backup/full.sh` — komplett-Backup aller Stores, gzip + sha256, datierter Tarball
   - `scripts/backup/tenant.sh <tenantId>` — Per-Tenant-Slice (alle `tenant:{id}:*`-Dokumente)
   - `scripts/backup/restore.sh <tarball> [--tenant=<id>] [--dry-run]`
   - Verschlüsselte Backup-Option (`age`/`gpg`)
2. **Backup-Scheduler-Service** `services/backup-orchestrator.service.js`:
   - Cron-getriebene Vollbackups (täglich 02:00)
   - Per-Tenant-Inkrementalbackups (stündlich)
   - Konfigurierbares Retention (default 7 daily + 4 weekly + 12 monthly)
   - Webhook-Event `backup.completed` / `backup.failed`
   - Persistiert Backup-Manifest für Audits (`tenant:_admin:backup_manifest`)
3. **DR-Runbook** `docs/DR_RUNBOOK.md`:
   - **RTO-Ziel:** 2 h (Recovery Time Objective)
   - **RPO-Ziel:** 1 h (Recovery Point Objective)
   - Step-by-step Procedure für 5 Failure-Modes:
     1. PouchDB-Korruption (single-store)
     2. Komplett-Datenverlust (alle Stores)
     3. Per-Tenant-Rollback (logischer Fehler)
     4. Job-Store-Lease-Stuck (Cluster-Partition)
     5. MCP-Server unreachable (Upstream-Outage)
   - Quartalsweiser DR-Drill mit Sign-Off-Sheet.
4. **Tenant-Self-Service-Restore:**
   - `POST /api/tenants/:id/snapshot` (full-access) — manueller Snapshot
   - `POST /api/tenants/:id/restore/:snapshotId` (cross-tenant-admin) — mit Dry-Run
   - `GET /api/tenants/:id/snapshots` — Liste der eigenen Snapshots
5. **Replication-Optional:**
   - PouchDB-CouchDB-Replication-Sidecar als Opt-in für synchronen Standby (`REPLICATION_TARGET_URL`).
   - Documentet, **nicht** Pflicht (KRITIS-Air-Gap muss möglich bleiben).

## Akzeptanzkriterien

- Reproduzierbarer Restore aus 24-h-altem Backup → identische Audit-Reports/Datapoints.
- Per-Tenant-Restore: Tenant A wiederhergestellt, Tenant B unverändert.
- DR-Drill in CI als nightly job (`tests/dr-drill.e2e.test.js`).
- Backup-Manifest enthält alle Stores, Sizes, Hashes für nachvollziehbare Inventur.
- `docs/DR_RUNBOOK.md` mit konkreten Befehlen, getestet auf 1.7 GB Pilot-Tenant-Volumen.

## Bezug

- v0.20.0 — PouchDB Object Store
- v0.41.0 — Multi-Tenant Platform
- Issue 13 §42c (verlangt Snapshot-Restore-Test als Cutover-Sub-Track)
- `docs/DEPLOYMENT_RUNBOOK.md`
