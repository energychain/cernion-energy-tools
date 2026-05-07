# DSFA-Vorlage — Datenschutz-Folgenabschätzung (DSFA)
# §42c Energieteilen · Pilot-Tenant-Betrieb

**Version:** v0.47.0 · **Erstellt:** 2026-05-07
**Basis:** DSGVO Art. 35, BDSG § 67
**Status:** VORLAGE — pro Pilot-Tenant auszufüllen und vom Datenschutzbeauftragten zu unterzeichnen.

---

## 1. Identifikation der Verarbeitung

| Feld | Wert |
|---|---|
| Pilot-Tenant | `tenant:____________` |
| Verantwortlicher | ____________ (Name, Organisation) |
| Datenschutzbeauftragter | ____________ |
| Datum der Abnahme | ____________ |
| DSFA-Version | v0.47.0 |

---

## 2. Beschreibung der Verarbeitung

### 2.1 Zweck der Verarbeitung

- Abrechnung von §42c-Energieteilen-Gemeinschaften
- Zuordnung von erzeugter Energie zu Verbrauchern
- Export von A96-Abrechnungsnachrichten an Netzbetreiber

### 2.2 Verarbeitete Daten

| Datenkategorie | Beschreibung | Rechtsbasis |
|---|---|---|
| Marktlokations-IDs (MaLo) | 33-stellige DE-Kennzeichner | § 42c EnWG, Art. 6 Abs. 1 lit. c DSGVO |
| MaStR-Nummern (Generator) | Öffentlich registrierte Anlagenkennzeichner | § 42c EnWG |
| Energiemengen (Zählerdaten) | kWh-Werte je 15-Minuten-Slot | § 42c EnWG, Art. 6 Abs. 1 lit. c DSGVO |
| Bilanzkreis-Zugehörigkeit | Community-Mitgliedschaft | § 42c EnWG |
| Direktvermarkter-Identität | Firmenname, MaStR-Nummer | § 21 Abs. 2 EEG |

### 2.3 Betroffene Personen

- Eigentümer von Erzeugungsanlagen (MaStR-registriert)
- Verbraucher in der Energieteilen-Gemeinschaft (MaLo-Inhaber)
- Direktvermarkter (juristische Personen, kein personenbezogenes Datum i. S. d. DSGVO)

### 2.4 Empfänger

- Netzbetreiber (A96-Meldung via EDI/MSCONS)
- Bundesnetzagentur (regulatorische Meldepflicht § 42c EnWG)
- Pilot-Tenant-Administrator (interne Abrechnung)

---

## 3. Notwendigkeit und Verhältnismäßigkeit

- Verarbeitung auf Minimum beschränkt (KRITIS: Rohdaten werden nicht persistiert, nur Metadaten)
- EU AI Act Art. 12 Audit-Trail: Vollständige Nachvollziehbarkeit aller automatisierten Entscheidungen
- Provenance Hash für jede Allokation dokumentiert (`provenanceHash` in PouchDB)
- Datenminimierung: keine Personenidentifikation über MaLo/MaStR hinaus

---

## 4. Risikoanalyse

| Risiko | Wahrscheinlichkeit | Schwere | Minderungsmaßnahme |
|---|---|---|---|
| Unbefugter Zugriff auf Abrechnungsdaten | Mittel | Hoch | Token-Authentifizierung (`ck_`-Prefix, SHA-256-Hash), Scope-Kontrolle |
| Fehlzuordnung von Energiemengen | Niedrig | Hoch | Deterministischer Pipeline-Validator, HITL-Eskalation bei `error`-Findings |
| Datenverlust (Systemausfall) | Niedrig | Mittel | Backup-Orchestrator v0.47 (Full-Restore), `docs/RUNBOOK_CUTOVER_ROLLBACK.md` |
| Spec-Drift (BNetzA A96 ändern) | Mittel | Mittel | `src/a96-validator.js` Drift-Erkennung, Spec-Freeze 2026-06-15 |
| Verletzung Auskunftspflicht (Art. 15 DSGVO) | Niedrig | Mittel | MaLo/MaStR-Lookup über öffentliche Register möglich |

---

## 5. Maßnahmen zum Schutz der Rechte

- **Auskunft (Art. 15 DSGVO):** MaLo-Inhaber können zugeteilte Energiemengen via `GET /api/energy-sharing-allocation/allocations` abrufen
- **Berichtigung (Art. 16 DSGVO):** Allokation kann neu berechnet werden nach Datenpflege (→ Incident I-3)
- **Löschung (Art. 17 DSGVO):** `DELETE /api/energy-sharing-allocation/allocations/{id}` (Soft-Delete); vollständige Löschung auf Antrag
- **Widerspruch (Art. 21 DSGVO):** Bilanzkreis-Austritt jederzeit möglich (Feature-Flag deaktivieren)

---

## 6. Unterzeichnung

| Funktion | Name | Datum | Unterschrift |
|---|---|---|---|
| Verantwortlicher | ____________ | ____________ | ____________ |
| Datenschutzbeauftragter | ____________ | ____________ | ____________ |
| Legal Review (extern) | ____________ | ____________ | ____________ |
| Compliance Sign-Off | ____________ | ____________ | ____________ |

---

## 7. Zugehörige Artefakte

- `docs/ENERGY_SHARING_ABNAHME.md` — Technische Abnahme-Checkliste
- `docs/ENERGY_SHARING_A96_DEFAULTS.md` — A96 Defensive Defaults
- `src/a96-validator.js` — Drift-Validator
- `services/backup-orchestrator.service.js` — Datensicherung
- `docs/RUNBOOK_CUTOVER_ROLLBACK.md` — Rollback-Prozess
