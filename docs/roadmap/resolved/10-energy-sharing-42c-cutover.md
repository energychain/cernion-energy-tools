# Issue 10 — §42c Energieteilen Production-Cutover (Frist 01.07.2026)

**Bereich:** Regulatorik · **Priorität:** Hoch · **Ziel-Release:** v0.45

## Problem

`docs/ENERGY_SHARING_ABNAHME.md` enthält die Abnahme-Checkliste für §42c-Produktivschaltung mit harter Frist **01.07.2026**. Die A96-Feldspezifikation enthält explizite `[BNetzA-OFFEN]`-Markierungen, einzelne Settlement-Readiness-KPIs (`PARAGRAF_42C_KONFORM`, `A96_FAEHIG`) sind erst seit v0.37.0 berechnet. Es gibt keinen formalen Cutover-Plan, der Risiken, Pilot-Kunden, Rollback und BNetzA-Klärungen verfolgt — der Sprint-Track läuft heute implizit über Versionsnummern.

## Vorschlag

Tracking-Issue mit Sub-Tracks:

1. **A96-Feldspezifikation finalisieren**
   - [ ] Alle `[BNetzA-OFFEN]`-Markierungen aus `docs/ENERGY_SHARING_ABNAHME.md` prüfen, BNetzA-Antwort-Status pro Feld
   - [ ] Spec einfrieren bis 2026-06-15
2. **Pilot-Tenant-Onboarding (Höheinöd)**
   - [ ] Bilanzkreis `bk_es_test` produktiv, nicht nur Fixture
   - [ ] 3-Wochen-Schattenbetrieb mit Original-MSCONS-Importen
3. **Settlement-Readiness Härte-Test**
   - [ ] Property-basierte Tests gegen `calculateSettlementReadiness` mit gefakten Lücken/MSCONS-Inkomplettheit
   - [ ] `low_data_quality`-Schwelle empirisch kalibrieren
4. **Allokations-Engine Last-Test**
   - [ ] 365 Tage × 96 Slots × 100 Consumer × 20 Generator → SLA <30 s
   - [ ] CSV-Export deterministisch (byte-identisch bei Wiederholung)
5. **Operative Runbooks**
   - [ ] `docs/RUNBOOK_ES_INCIDENT.md`: MSCONS-Lücke, Stufe-A/B-Reklamation, Direktvermarkter-Wechsel
   - [ ] HITL-Queue (Issue 12) integriert
6. **Compliance-Sign-Off**
   - [ ] EU-AI-Act-Art.-12-Audit-Trail Coverage >99 %
   - [ ] Datenschutz-Folgenabschätzung (DSFA) pro Pilot
7. **Rollback-Plan**
   - [ ] Feature-Flag pro Bilanzkreis (`virtual_energy_sharing.enabled`)
   - [ ] Daten-Snapshot vor Cutover, Restore-Test dokumentiert

## Akzeptanzkriterien Cutover-Freigabe

- Alle Sub-Tracks erledigt + Pilot-Tenant 14 Tage ohne `error`-Findings.
- `A96_FAEHIG=true` über alle Bilanzkreise des Pilot-Tenants.
- BNetzA-Klärungspunkte 0 offen.

## Bezug

- v0.37.0 Settlement-Readiness §42c-KPIs
- v0.16, v0.15 Allokations-Engine + Validation
- `docs/ENERGY_SHARING_ABNAHME.md`
