# Issue 13 — §42c Energieteilen Production-Cutover Sub-Track Implementierung

**Bereich:** Regulatorik · **Priorität:** **Kritisch** · **Frist:** 01.07.2026 · **Ziel-Release:** v0.47

## Problem

v0.45.0 schließt Issue #59 — aber **nur den Plan**, nicht die Implementierung. `docs/roadmap/issues/10-energy-sharing-42c-cutover.md` listet sieben Sub-Tracks; keiner ist abgehakt. Externe Risiken zugespitzt:

- **BNetzA A96-Feldspezifikation** wird laut v0.45.0-Notes **erst Q3 2026 final** erwartet — also **nach** der Cutover-Frist 01.07.2026. Fallback-Planung ist Pflicht.
- `docs/ENERGY_SHARING_ABNAHME.md` enthält noch `[BNetzA-OFFEN]`-Markierungen.
- `bk_es_test`-Bilanzkreis ist Fixture, kein Pilot-Tenant produktiv.

## Vorschlag

Pro Sub-Track ein eigener Implementierungs-Branch + Sub-Issue. Master-Acceptance: `A96_FAEHIG=true` für alle Bilanzkreise des Pilot-Tenants über 14 Tage ohne Error-Findings.

### Sub-Track A — A96-Feldspezifikation (mit BNetzA-Fallback)

- [ ] Alle `[BNetzA-OFFEN]`-Felder mit defensiven Defaults belegen, dokumentiert in `docs/ENERGY_SHARING_A96_DEFAULTS.md`.
- [ ] **Spec-Freeze 2026-06-15:** ab dann nur noch Bugfixes auf der eingefrorenen Spec; Q3-2026-Updates der BNetzA fließen in v0.51 ein.
- [ ] Validator `src/a96-validator.js` mit JSON-Schema, der jede Spec-Drift markiert.

### Sub-Track B — Pilot-Tenant Höheinöd produktiv

- [ ] Tenant `tenant:hoeheinoed` provisioniert, separate Token-Scope.
- [ ] Bilanzkreis `bk_hoeheinoed_es_001` (Typ `virtual_energy_sharing`) mit echten Beteiligten.
- [ ] 3-Wochen-Schattenbetrieb: parallel zu manueller Abrechnung, Diff <0.5 % je Slot.
- [ ] Tenant-Migration-Skript dokumentiert.

### Sub-Track C — Settlement-Readiness Härte-Test

- [ ] Property-basierte Tests gegen `src/settlement-readiness.js` (`fast-check` o. ä.) für Lücken, MSCONS-Inkomplettheit, Zeit-Drift.
- [ ] Threshold `low_data_quality` empirisch kalibriert mit ≥3 echten MSCONS-Datenpunkten.
- [ ] Bug-Bounty 1 Sprint mit ungeladenen Mutanten.

### Sub-Track D — Allokations-Engine Last-Test

- [ ] Lasttest 365 Tage × 96 Slots × 100 Consumer × 20 Generator → SLA <30 s `p95`.
- [ ] CSV-Export deterministisch (Byte-identisch bei Wiederholung) — Fixture-Test.
- [ ] Memory-Profile <1 GB peak.
- [ ] Worker-Pool-Konfiguration dokumentiert.

### Sub-Track E — Operative Runbooks

- [ ] `docs/RUNBOOK_ES_INCIDENT.md` — MSCONS-Lücke, Stufe-A/B-Reklamation, Direktvermarkter-Wechsel, Bilanzkreis-Korrektur.
- [ ] HITL-Queue-Verschaltung (`hitl.create` aus `energy-sharing.validate` bei `error`-Findings).
- [ ] Eskalationsstufen + Pager-Pattern.

### Sub-Track F — Compliance-Sign-Off

- [ ] EU-AI-Act-Art.-12-Audit-Trail-Coverage ≥99 %, automatischer Coverage-Report im CI.
- [ ] DSFA pro Pilot-Tenant (`docs/DSFA_TEMPLATE.md` als Vorlage).
- [ ] Externe rechtliche Review (Sign-Off-Datum dokumentiert).

### Sub-Track G — Rollback-Plan

- [ ] Feature-Flag `virtual_energy_sharing.enabled` pro Bilanzkreis.
- [ ] Snapshot vor Cutover, Restore-Test im DR-Runbook (verbunden mit Issue 23).
- [ ] Rollback-Procedure dokumentiert: Tenant-Daten umgekehrt migrieren, A96-Export-Sperre, Kommunikation an Beteiligte.

## Akzeptanzkriterien (Cutover-Freigabe)

- Alle 7 Sub-Tracks merged.
- Pilot-Tenant 14 Tage ohne `error`-Findings.
- `A96_FAEHIG=true` für alle Bilanzkreise des Pilot-Tenants.
- Externer Compliance-Sign-Off vorhanden.

## Bezug

- v0.45.0 — §42c Cutover-Plan
- `docs/ENERGY_SHARING_ABNAHME.md`
- v0.37.0 — Settlement-Readiness §42c-KPIs
- Hängt an Issue 23 (DR-Runbook)
