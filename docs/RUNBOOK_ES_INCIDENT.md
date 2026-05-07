# Runbook — §42c Energy Sharing Incident Response

**Version:** v0.47.0 · **Frist:** 01.07.2026 Cutover  
**Zuständig:** VNB Operations · **Eskalation:** Siehe Stufe A/B unten

---

## 1. Übersicht

Dieses Runbook beschreibt Vorgehen bei operativen Störungen im §42c Energieteilen-Betrieb.
Es deckt die häufigsten Incident-Typen ab:

| # | Incident-Typ | Prio | HITL-Kind |
|---|---|---|---|
| I-1 | MSCONS-Lücke (fehlende Messdaten) | HIGH | `energy-sharing-validation-error` |
| I-2 | Stufe-A-Reklamation (Generator-Betreiber) | HIGH | `energy-sharing-validation-error` |
| I-3 | Stufe-B-Reklamation (Verbraucher) | MEDIUM | `energy-sharing-validation-error` |
| I-4 | Direktvermarkter-Wechsel | MEDIUM | manuell |
| I-5 | Bilanzkreis-Korrektur | HIGH | manuell |
| I-6 | A96-Export-Blockierung (Rollback-Gate) | CRITICAL | manuell |

---

## 2. Incident I-1 — MSCONS-Lücke

**Symptom:** Allocation-Engine gibt `ALLOC_WINDOW_EXCEEDS_RECOMMENDED` Warning; Settlement-Readiness `A96_FAEHIG = false`.

**Schritte:**
1. HITL-Queue prüfen: `GET /api/hitl/items?kind=energy-sharing-validation-error`
2. Fehlende Messdaten identifizieren: `GET /api/bilanzkreis/{id}/readiness?from=...&to=...`
3. Lücke klassifizieren: technisch (Zähler) vs. übertragungsbedingt (MSCONS-Empfangsfehler)
4. Ersatzwerteinfügung (§ 12 StromNZV): Inhouse-Datei via Upload hochladen → `POST /api/datasource-cache/{sourceId}` mit `dataSource=inhouse`
5. Allocation neu berechnen: `POST /api/energy-sharing-allocation/allocate` mit `dataSource=inhouse`
6. HITL-Item approven: `POST /api/hitl/items/{id}/approve`

**Deadline:** Lücken müssen innerhalb von 48 h nach Feststellung geschlossen sein (§ 20b EnWG Interimsprozess).

---

## 3. Incident I-2 — Stufe-A-Reklamation (Generator-Betreiber)

**Symptom:** Generator-Betreiber reklamiert zugeteilte Energiemenge.

**Schritte:**
1. Validierungsreport abrufen: `GET /api/energy-sharing/validations/{id}`
2. Generator-Findings prüfen: `findings[]` mit `step = "generators"`
3. MaStR-Daten prüfen: `GET /api/mastr/installations/{mastrNummer}`
4. Bei Datenabweichung: Direktvermarkter-Kontakt aufnehmen (→ I-4 falls DV-Wechsel)
5. Allokation mit korrigierten Daten wiederholen
6. Reklamation dokumentieren: HITL-Item erstellen mit Typ `energy-sharing-validation-error`

---

## 4. Incident I-3 — Stufe-B-Reklamation (Verbraucher)

**Symptom:** Verbraucher reklamiert zugeteilte Energiemenge / Abrechnung.

**Schritte:**
1. Allokation für betroffenen Monat abrufen: `GET /api/energy-sharing-allocation/allocations/{id}`
2. Verbraucher-Anteil prüfen: `consumers[].sharePercent`
3. Bei Fehler in Anteil: Bilanzkreis korrigieren (→ I-5)
4. Neuberechnung anstoßen und Verbraucher informieren

---

## 5. Incident I-4 — Direktvermarkter-Wechsel

**Symptom:** Generator wechselt Direktvermarkter; `DV_MASTR_MISMATCH` finding.

**Schritte:**
1. Neuen DV in Validierungsrequest eintragen (`generators[].direktvermarkter`)
2. MaStR-Nummer prüfen: `GET /api/mastr/installations/{mastrNummer}`
3. Neuen Validierungslauf starten: `POST /api/energy-sharing/validate`
4. Bei `DV_VALID`: kein weiterer Handlungsbedarf
5. Bei `DV_MANDATORY_MISSING`: Energieteilen-Betrieb für diesen Generator bis Klärung aussetzen

---

## 6. Incident I-5 — Bilanzkreis-Korrektur

**Symptom:** Falsche Anteilsverteilung, falscher Bilanzkreis-Typ, fehlender Teilnehmer.

**Schritte:**
1. Bilanzkreis-Daten prüfen: `GET /api/bilanzkreis/{id}`
2. Bilanzkreis löschen und neu anlegen mit korrekten Parametern:
   - `DELETE /api/bilanzkreis/{id}`
   - `POST /api/bilanzkreis` mit korrekten Parametern
3. Alle betroffenen Allokationen für den Zeitraum neu berechnen
4. Vor Löschung: Snapshot erstellen: `POST /api/admin/backup/snapshot` mit `label=pre-correction-{id}`

---

## 7. Incident I-6 — A96-Export-Blockierung (Rollback-Gate)

**Symptom:** Feature-Flag `virtual_energy_sharing.enabled` soll für einen Bilanzkreis deaktiviert werden (Rollback-Szenario).

**Schritte:**
1. Feature-Flag deaktivieren: `PATCH /api/bilanzkreis/{id}/feature-flags` mit `{"flags": {"virtual_energy_sharing.enabled": false}}`
2. Snapshot vor Rollback erstellen: `POST /api/admin/backup/snapshot` mit `label=pre-rollback-{id}`
3. Beteiligte informieren (Generator-Betreiber, Direktvermarkter, Verbraucher)
4. BNetzA-Meldung prüfen (§ 42c EnWG Meldepflicht)
5. Nach Klärung: Flag wieder aktivieren und Allokation für ausgefallene Perioden nachholen

---

## 8. Eskalationsstufen

| Stufe | Trigger | Aktion | Kontakt |
|---|---|---|---|
| L1 | HITL-Item created, `severity=warning` | Operations-Team prüft innerhalb 4h | hitl-queue@stadtwerk.example |
| L2 | HITL-Item `severity=error`, nicht resolved nach 4h | Senior Operations + VNB-Ansprechpartner | ops-escalation@stadtwerk.example |
| L3 | Incident betrifft >10 Verbraucher oder A96-Export-Blockierung | Geschäftsleitung + externer Datenschutzbeauftragter | management@stadtwerk.example |
| L4 | BNetzA-Meldepflicht ausgelöst (§ 42c EnWG) | Legal-Review, Externe Kommunikation | legal@stadtwerk.example |

---

## 9. Pager-Pattern

```
HITL severity=error → L1 Alert (PagerDuty / On-Call)
  → Keine Aktion nach 4h → L2 Eskalation
  → Keine Aktion nach 8h → L3 Eskalation

Täglich 09:00 UTC: Automatischer HITL-SLA-Report (GET /api/hitl/summary)
Kritische Findings (A96_FAEHIG=false) im HITL-Dashboard überwachen
```

---

## 10. Zugehörige Artefakte

- `docs/RUNBOOK_CUTOVER_ROLLBACK.md` — Cutover- und Rollback-Prozess
- `services/backup-orchestrator.service.js` — Backup/Restore Admin-API
- `services/hitl.service.js` — HITL-Queue
- `services/energy-sharing.service.js` — Automatische HITL-Eskalation bei `error`-Findings (Sub-Track E)
- `src/a96-validator.js` — A96 Drift-Erkennung
