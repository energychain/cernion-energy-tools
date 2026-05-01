# §42c EnWG Energieteilen — Formale Produktionsabnahme

**Deadline: 01.07.2026**
**Version: 0.36.2**
**Status: OFFEN**

---

## Überblick

Dieses Dokument beschreibt die formale Abnahme-Checkliste für die §42c-EnWG-konforme
Produktivschaltung der Energieteilen-Funktion. Alle Prüfpunkte müssen bis zum **01.07.2026**
abgenommen sein. Die Abnahme erfolgt durch den Systemverantwortlichen und den Netzbetreiber.

---

## Sektion 1 — Regulatorische Grundlage

- [ ] §42c EnWG Zielerreichungsgrad geprüft (Gemeinschaft ≤ 1 Netzgebiet, 1 Umspannwerk)
- [ ] BDEW-Leitfaden „Energieteilen" (Fassung 2025-Q4) liegt vor
- [ ] BNetzA-Festlegung zu Messkonzepten für Energiegemeinschaften berücksichtigt
- [ ] Netzbetreiber-Zustimmung zum Bilanzierungskonzept liegt schriftlich vor
- [ ] Rechtsform der Gemeinschaft (GbR, Verein, Wohnanlage) geprüft

---

## Sektion 2 — Technische Infrastruktur

- [ ] `energy-sharing.service.js` deployed (v0.15.x+)
- [ ] `energy-sharing-allocation.service.js` deployed (v0.16.x+)
- [ ] `bilanzkreis.service.js` deployed, Typ `virtual_energy_sharing` unterstützt
- [ ] PouchDB-Persistenz für `data/energy-sharing/` vorhanden (doc-Prefix `es:`)
- [ ] PouchDB-Persistenz für `data/allocation-engine/` vorhanden
- [ ] `settlement.service.js` erreichbar für A96-Export
- [ ] EDM-Adapter (Lastgangdaten) für alle Verbraucher-MaLos konfiguriert
- [ ] MaStR-Zugang für Erzeuger-Stammdaten konfiguriert

---

## Sektion 3 — Validierungs-Pipeline (6-Stufen)

- [ ] **Stufe 1** — Gemeinschaftsstruktur-Prüfung: min. 1 Erzeuger, min. 1 Verbraucher
- [ ] **Stufe 2** — MaStR-Validierung: Erzeuger vorhanden, `InBetrieb`-Status (Code 35), Kapazität ≥ 1 kW
- [ ] **Stufe 3** — Direktvermarkter-Prüfung: `FernsteuerbarkeitDv` gesetzt, kein aktiver DV-Konflikt
- [ ] **Stufe 4** — MaLo-Validierung: Format `DE` + 31 Stellen für alle Verbraucher
- [ ] **Stufe 5** — Anteils-Konsistenzprüfung: Summe Erzeugeranteile = 100 %, Summe Verbraucheranteile = 100 %
- [ ] **Stufe 6** — VNB-Verifikation: Netzbetreiber per BDEW-Code oder MaStR-ID auflösbar
- [ ] Entscheidung `APPROVED` wird korrekt gesetzt (keine Findings)
- [ ] Entscheidung `APPROVED_WITH_CONDITIONS` bei weichen Findings
- [ ] Entscheidung `REJECTED_STRUCTURAL` bei harten Findings (z. B. MaLo ungültig, Anteile ≠ 100 %)
- [ ] Audit-Trail (`AUDIT_TRAIL_CREATED`) persistiert in PouchDB
- [ ] `GET /api/energy-sharing/:id` gibt persistiertes Ergebnis zurück

---

## Sektion 4 — Allokations-Engine

- [ ] `POST /api/allocations` akzeptiert Erzeuger + Verbraucher + Zeitraum
- [ ] Stufe A (Forecast): `mastr_generation_forecast` MCP-Tool erreichbar
- [ ] Stufe B (Inhouse): CSV-Upload über `datasource-cache` funktioniert
- [ ] 15-Minuten-Raster korrekt (96 Intervalle/Tag, daylight-saving-safe)
- [ ] Anteil-Zuteilung korrekt (Σ Verbraucheranteile = gesamte Nettoerzeugung)
- [ ] Redispatch-Abzug (`includeRedispatchDeduction`) korrekt angewendet
- [ ] `GET /api/allocations/:id/download` liefert valides CSV (Content-Type: text/csv)
- [ ] Soft-Delete setzt `_deleted: true` und `markedDeleted: true`
- [ ] `GET /api/allocations` listet nur nicht-gelöschte Allokationen

---

## Sektion 5 — Settlement-Readiness KPIs

- [ ] `GET /api/bilanzkreise/:id/readiness` gibt `ready`, `issues`, `dataQuality` zurück
- [ ] **`PARAGRAF_42C_KONFORM: true`** wenn Typ `virtual_energy_sharing` und keine `missing_data`-Issues
- [ ] **`PARAGRAF_42C_KONFORM: false`** wenn Typ `virtual_energy_sharing` und ≥ 1 `missing_data`-Issue
- [ ] **`A96_FAEHIG: true`** wenn kein `missing_data`, kein `low_data_quality`, kein `mscons_incomplete`
- [ ] **`A96_FAEHIG: false`** wenn `dataQuality < 0.95` oder Messwertreihe unvollständig
- [ ] Für Nicht-Energieteilen-Bilanzkreise: `PARAGRAF_42C_KONFORM` und `A96_FAEHIG` nicht vorhanden (undefined)
- [ ] `large_gaps`-Issues blockieren `ready`, aber nicht `PARAGRAF_42C_KONFORM` oder `A96_FAEHIG`

---

## Sektion 6 — A96-Feldspezifikation (BNetzA-Schnittstelle)

Die A96-Nachricht (MSCONS-Profil für Energieteilen) wird über `settlement.service.js`
(`POST /api/a96/prepare`) erzeugt. Die folgende Tabelle zeigt den Implementierungsstand.

| Feld | Status | Anmerkung |
|------|--------|-----------|
| MaLo-ID (Verbraucher) | ✅ vorhanden | `maloId` aus Allokationsergebnis |
| Zeitraum von (dateFrom) | ✅ vorhanden | ISO 8601, UTC |
| Zeitraum bis (dateTo) | ✅ vorhanden | ISO 8601, UTC |
| Energiemenge (kWh) | ✅ vorhanden | `totalKWh` je Verbraucher |
| Verbraucheranteil (%) | ✅ vorhanden | `sharePercent` je Verbraucher |
| Erzeuger-MaStR-Nummer | `[BNetzA-OFFEN]` | Mapping A96 ↔ Erzeuger-MaStR noch nicht final spezifiziert |
| Bilanzierungsmonat | `[BNetzA-OFFEN]` | Granularität (Monat vs. Zeitraum) noch offen |
| BDEW-Code des Netzbetreibers | `[BNetzA-OFFEN]` | Übertragungsweg in A96 noch nicht definiert |
| Qualitätskennzeichen (MSCONS) | `[BNetzA-OFFEN]` | Werteart E01/E02 noch zu klären |

> **`[BNetzA-OFFEN]`** — Diese Felder sind von der BNetzA noch nicht final spezifiziert.
> Implementierung erfolgt nach Veröffentlichung der Festlegung (erwartet Q3 2026).

---

## Sektion 7 — Sicherheit & Datenschutz

- [ ] Kein Klartext-Personenbezug in PouchDB (nur MaLo-IDs, MaStR-Nummern)
- [ ] `prompt-scrubber.js` aktiv vor jedem LLM-Call
- [ ] `token-manager` eingesetzt (`ck_`-Token, SHA-256-gespeichert)
- [ ] `read-only`-Scope kann keine Validierung starten
- [ ] Audit-Trail löschsicher (PouchDB-Revision, keine Hard-Deletes)

---

## Sektion 8 — Betrieb & Monitoring

- [ ] CHANGELOG.md auf v0.36.2 aktualisiert
- [ ] `npm run release:check` fehlerfrei (Tests + OpenAPI + Security)
- [ ] Alle E2E-Abnahmetests in `tests/energy-sharing-e2e-abnahme.test.js` bestanden (≥ 15)
- [ ] Swagger UI zeigt alle Energy-Sharing-Endpunkte unter `/api/docs`
- [ ] Lasttest: 10 parallele Validierungen ohne Timeout (< 30 s)
- [ ] Rollback-Plan dokumentiert (Moleculer-Service deaktivierbar via `NODE_DISABLE_SERVICES`)

---

## Abnahme-Protokoll

| Datum | Prüfer | Ergebnis | Kommentar |
|-------|--------|---------|-----------|
| — | Systemverantwortlicher | OFFEN | |
| — | Netzbetreiber-Vertreter | OFFEN | |
| — | Datenschutzbeauftragter | OFFEN | |

**Abnahmedatum:** _____________
**Unterschrift:** _____________
