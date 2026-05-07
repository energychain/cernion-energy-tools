# Runbook — §42c Cutover & Rollback

**Version:** v0.47.0 · **Frist Cutover:** 01.07.2026
**Verknüpft:** Issue 23 (DR-Runbook), Issue 13 Sub-Track G

---

## 1. Voraussetzungen (Cutover-Freigabe)

Alle folgenden Punkte müssen vor dem Cutover erfüllt sein:

- [ ] Sub-Track A: A96-Validator grün, keine `[BNetzA-OFFEN]`-Felder ohne Default
- [ ] Sub-Track B: Pilot-Tenant `hoeheinoed` ≥ 21 Tage Schattenbetrieb, Diff < 0.5 %
- [ ] Sub-Track C: Settlement-Readiness Tests grün, `A96_FAEHIG=true` für `bk_hoeheinoed_es_001`
- [ ] Sub-Track D: Load-Test bestanden (365d × 96 Slots × 100 Consumer × 20 Generator, p95 < 30 s)
- [ ] Sub-Track E: HITL-Verschaltung aktiv, Runbook `docs/RUNBOOK_ES_INCIDENT.md` verifiziert
- [ ] Sub-Track F: Art.-12-Audit-Trail-Coverage ≥ 99 %, DSFA unterzeichnet, Legal-Sign-Off
- [ ] Sub-Track G: Rollback-Test erfolgreich (restore aus Pre-Cutover-Snapshot verifiziert)
- [ ] `A96_FAEHIG=true` für alle Bilanzkreise des Pilot-Tenants 14 Tage ohne `error`-Findings

---

## 2. Cutover-Ablauf (Schritt für Schritt)

### Phase 0: Pre-Cutover (T-24h)

```bash
# 1. Vollständigen Snapshot erstellen
POST /api/admin/backup/snapshot
{
  "label": "pre-cutover-hoeheinoed-{DATUM}",
  "tenantId": "hoeheinoed"
}
# → snapshotId merken!

# 2. Feature-Flag-Status prüfen (soll: enabled=true)
GET /api/bilanzkreis/bk_hoeheinoed_es_001/feature-flags

# 3. Settlement-Readiness prüfen
GET /api/bilanzkreis/bk_hoeheinoed_es_001/readiness?from=...&to=...
# → A96_FAEHIG muss true sein

# 4. HITL-Queue leeren (alle offenen Items resolved)
GET /api/hitl/items?kind=energy-sharing-validation-error&status=pending
```

### Phase 1: Cutover (T=0, 01.07.2026 00:00 UTC)

```bash
# 1. Produktiv-Modus aktivieren (Feature-Flag bestätigen)
GET /api/bilanzkreis/bk_hoeheinoed_es_001/feature-flags
# Soll: virtual_energy_sharing.enabled = true

# 2. Ersten produktiven Validierungslauf starten
POST /api/energy-sharing/validate
{
  "gridOperatorId": "...",
  "communityId": "bk_hoeheinoed_es_001",
  ...
}
# → decision muss APPROVED oder APPROVED_WITH_CONDITIONS sein

# 3. Monitoring aktivieren: HITL-SLA-Report täglich
GET /api/hitl/summary
```

### Phase 2: Post-Cutover (T+7d)

```bash
# 1. 7-Tage-Report: alle Validierungen ohne error
GET /api/energy-sharing/validations?communityId=bk_hoeheinoed_es_001&limit=200

# 2. A96-Export-Status prüfen
GET /api/bilanzkreis/bk_hoeheinoed_es_001/feature-flags

# 3. BNetzA-Meldung gem. § 42c EnWG erstellen (manuell)
```

---

## 3. Rollback-Prozess

### Schritt 1: Entscheidung zur Aktivierung

Rollback wird ausgelöst durch:
- Mehr als 3 `error`-Findings innerhalb von 24h
- `A96_FAEHIG=false` für den Pilot-Tenant
- Technischer Ausfall des Settlement-Stacks
- Regulatorische Anforderung (BNetzA / Rechtsabteilung)

### Schritt 2: A96-Export sperren (< 5 Minuten)

```bash
PATCH /api/bilanzkreis/bk_hoeheinoed_es_001/feature-flags
{
  "flags": { "virtual_energy_sharing.enabled": false }
}
```

### Schritt 3: Snapshot vor Rollback (< 2 Minuten)

```bash
POST /api/admin/backup/snapshot
{
  "label": "rollback-state-{DATUM}",
  "tenantId": "hoeheinoed"
}
```

### Schritt 4: Daten-Restore (wenn nötig)

```bash
# Snapshot-Liste prüfen
GET /api/admin/backup/snapshots

# Restore von Pre-Cutover-Snapshot
POST /api/admin/backup/restore
{
  "snapshotId": "snap-{PRE_CUTOVER_ID}",
  "confirm": true
}
# → Summary prüfen: restored-Zahlen müssen plausibel sein
```

### Schritt 5: Tenant-Daten umgekehrt migrieren

```bash
# Migrierte Tenant-Dokumente zurück auf Legacy-Prefix setzen (dry-run)
node scripts/migrate-tenant-energy-sharing.js --tenant hoeheinoed --dry-run

# Manuell: Tenant-Dokumente auf status=migrated_back setzen
# (kein automatisiertes Back-Migration-Skript in v0.47 — v0.51 geplant)
```

### Schritt 6: Kommunikation

- Generator-Betreiber: Energieteilen temporär ausgesetzt, manuelle Abrechnung
- Verbraucher: Keine Änderung in Abrechnung, Klärung läuft
- BNetzA: § 42c EnWG Meldepflicht prüfen (Legal-Abteilung)

### Schritt 7: Reaktivierung

Nach Klärung des Rollback-Grundes:
```bash
PATCH /api/bilanzkreis/bk_hoeheinoed_es_001/feature-flags
{
  "flags": { "virtual_energy_sharing.enabled": true }
}
```

---

## 4. DR-Restore-Test (Pflicht vor Cutover)

```bash
# 1. Snapshot aus Pre-Cutover erstellen
POST /api/admin/backup/snapshot { "label": "dr-test-{DATUM}" }

# 2. Test-Restore in Staging-Umgebung
POST /api/admin/backup/restore { "snapshotId": "...", "confirm": true }

# 3. Validierung nach Restore
GET /api/energy-sharing/validations  # Dokumente vorhanden?
GET /api/energy-sharing-allocation/allocations  # Dokumente vorhanden?
GET /api/hitl/items  # HITL-Queue intakt?

# 4. Feature-Flags nach Restore prüfen
GET /api/bilanzkreis/bk_hoeheinoed_es_001/feature-flags
```

---

## 5. Zugehörige Artefakte

- `services/backup-orchestrator.service.js` — Backup/Restore Admin-API
- `services/bilanzkreis.service.js` — Feature-Flag-API (`getFeatureFlags`, `updateFeatureFlags`)
- `scripts/migrate-tenant-energy-sharing.js` — Tenant-Migration-Skript
- `docs/RUNBOOK_ES_INCIDENT.md` — Incident-Response-Runbook
- `docs/ENERGY_SHARING_A96_DEFAULTS.md` — A96 Defensive Defaults
- `src/a96-validator.js` — A96 Drift-Validator
