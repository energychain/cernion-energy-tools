# UI Contract: Finding Code Recommendations

> **Page ID:** `finding-code-recommendations`
> **Version:** 0.20.5
> **Last updated:** 2026-04-06
> **Status:** Draft — `recommendationDe` texts are proposals; final wording requires domain review.

---

## Purpose

This document lists all **37 error-severity finding codes** across the four deterministic agents.
Each code includes a proposed German recommendation (`recommendationDe`) for display in the
UI alongside the finding description. These recommendations will be added to
`FINDING_CODE_METADATA` in `src/validation-findings.js` in v0.21.

The `energy-sharing-allocation` engine does **not** produce findings (it is a calculation
engine, not an agent). Candidate ALLOC finding codes are documented as a stub in
`services/energy-sharing-allocation.service.js` — domain-specific thresholds are a gap
to fill in the next sprint.

---

## Data Source

`src/validation-findings.js` → `FINDING_CODE_METADATA`

---

## Error-Severity Finding Codes (37 total)

### Grid Connection (3 codes)

| Code | Step | `descriptionDe` | `recommendationDe` (proposed) |
|------|------|-----------------|-------------------------------|
| `CAPACITY_EXPANSION_NEEDED` | 3 | Netzkapazität nicht ausreichend — Ausbau erforderlich | Netzausbauplanung mit dem zuständigen VNB abstimmen. Kapazitätsengpass im Mittelspannungsnetz prüfen und ggf. Trafoverstärkung oder Strangerweiterung beantragen. |
| `NO_GO_EXPANSION` | 5 | Netzanschluss abgelehnt — Netzerweiterung erforderlich | Netzanschlussantrag zurückstellen. Netzbetreiber kontaktieren und konkreten Ausbauplan mit Zeitrahmen anfordern. Alternative Anschlusspunkte evaluieren. |
| `DATA_QUALITY_INSUFFICIENT` | 5 | Entscheidung zurückgestellt — MaStR-Datenqualität zu gering | MaStR-Daten der betroffenen Anlagen aktualisieren. Fehlende Felder (NAP, MeLo, Leistungswerte) ergänzen und Netzbetreiberprüfung erneut anstoßen. |

### Energy Sharing (18 codes)

| Code | Step | `descriptionDe` | `recommendationDe` (proposed) |
|------|------|-----------------|-------------------------------|
| `VNB_NOT_FOUND` | 1 | VNB-Identität konnte nicht aufgelöst werden | VNB-Identifikation manuell prüfen. BDEW-Code oder MaStR-SNB-ID korrekt eingeben. Bei Unsicherheit den zuständigen Netzbetreiber direkt kontaktieren. |
| `GENERATOR_NOT_FOUND` | 2 | Erzeuger-MaStR-Nummer nicht im MaStR gefunden | MaStR-Nummer des Erzeugers prüfen und korrigieren. Sicherstellen, dass die Anlage im Marktstammdatenregister registriert ist. |
| `GENERATOR_NOT_OPERATIONAL` | 2 | Erzeuger ist nicht im Status "InBetrieb" | Nur betriebsbereite Anlagen können an Energy Sharing teilnehmen. Anlagenstatus im MaStR auf „In Betrieb" setzen oder Erzeuger aus der Gemeinschaft entfernen. |
| `GENERATOR_WRONG_GRID_AREA` | 2 | Erzeuger gehört zu einem anderen Netzgebiet | Energy Sharing erfordert, dass alle Erzeuger im selben Netzgebiet liegen (§ 42c EnWG). Erzeuger entfernen oder korrekte Netzzuordnung im MaStR sicherstellen. |
| `GENERATOR_TYPE_INELIGIBLE` | 2 | Anlagentyp nicht für Energy Sharing (§42c EnWG) zulässig | Nur erneuerbare Erzeugungsanlagen (Solar, Wind, Biomasse, Wasser) sind zulässig. KWK- und konventionelle Anlagen können nicht teilnehmen. |
| `GENERATOR_CAPACITY_ZERO` | 2 | Erzeuger hat Bruttoleistung = 0 | Bruttoleistung im MaStR korrigieren. Eine Anlage mit 0 kW Leistung kann keine Energie einspeisen. |
| `GENERATOR_DUPLICATE` | 4 | Doppelter MaStR-Eintrag in der Erzeugerliste | Duplikat aus der Erzeugerliste entfernen. Jede Anlage darf nur einmal in einer Gemeinschaft aufgeführt werden. |
| `DV_MANDATORY_MISSING` | 3 | Direktvermarktung für ≥100 kW Pflicht, aber nicht registriert | Anlage ≥100 kW muss in Direktvermarktung sein (§ 21b EEG). Direktvermarktungsvertrag abschließen und im MaStR registrieren. |
| `SHARE_SUM_GENERATORS_INVALID` | 4 | Erzeuger-Anteile ergeben nicht 100% (±0,1%-Toleranz) | Anteilswerte der Erzeuger so anpassen, dass die Summe exakt 100% ergibt. |
| `SHARE_SUM_CONSUMERS_INVALID` | 4 | Verbraucher-Anteile ergeben nicht 100% (±0,1%-Toleranz) | Anteilswerte der Verbraucher so anpassen, dass die Summe exakt 100% ergibt. |
| `NO_GENERATORS` | 4 | Keine Erzeuger in der Energy-Sharing-Meldung angegeben | Mindestens einen Erzeuger mit gültiger MaStR-Nummer hinzufügen. |
| `NO_CONSUMERS` | 4 | Keine Verbraucher in der Energy-Sharing-Meldung angegeben | Mindestens einen Verbraucher mit gültiger MaLo-ID hinzufügen. |
| `MIXED_GRID_AREAS` | 4 | Erzeuger aus verschiedenen Netzgebieten in einer Gemeinschaft | Alle Erzeuger müssen demselben Netzgebiet angehören. Erzeuger aus fremden Netzgebieten entfernen. |
| `CONSUMER_MALO_INVALID` | 4 | MaLo-Format ungültig (erwartet: DE gefolgt von 31 Ziffern) | MaLo-ID im Format DE + 31 Ziffern korrigieren (Beispiel: DE00012345678901234567890123456789012). |
| `CONSUMER_MALO_DUPLICATE` | 4 | Doppelte MaLo-ID in der Verbraucherliste | Duplikat aus der Verbraucherliste entfernen. Jede MaLo darf nur einmal zugeordnet werden. |
| `REJECTED_STRUCTURAL` | 5 | Abgelehnt wegen struktureller §42c-Unzulässigkeit | Strukturelle Voraussetzungen der Energy-Sharing-Gemeinschaft grundlegend überarbeiten. Prüfpunkte: Netzgebietszugehörigkeit, Anlagentypen, Mindestanforderungen § 42c EnWG. |
| `REJECTED_GENERATOR_INVALID` | 5 | Abgelehnt wegen ungültiger Erzeugerdaten | Erzeugerdaten im MaStR korrigieren und Validierung erneut durchführen. Betroffene Erzeuger sind in den Findings aufgelistet. |
| `REJECTED_OTHER` | 5 | Abgelehnt aus sonstigen Gründen | Einzelbefunde prüfen und Ursache identifizieren. Bei Unklarheit den zuständigen Netzbetreiber kontaktieren. |

### MaStR Quality (10 codes)

| Code | Step | `descriptionDe` | `recommendationDe` (proposed) |
|------|------|-----------------|-------------------------------|
| `MQ_INVENTORY_EMPTY` | 2 | Keine Anlagen für diesen VNB im MaStR gefunden | VNB-Identifikation prüfen. BDEW-Code oder MaStR-SNB-ID korrekt eingeben. Falls korrekt, könnte es sich um einen neuen VNB ohne MaStR-Bestand handeln. |
| `MQ_ZERO_CAPACITY` | 4 | Bruttoleistung = 0 | Bruttoleistung im MaStR korrigieren. Wert von 0 kW weist auf unvollständige Registrierung hin. |
| `MQ_NEGATIVE_CAPACITY` | 4 | Leistungswert negativ — Datenfehler | Negativen Leistungswert im MaStR als Datenfehler melden und korrigieren lassen. |
| `MQ_NETTO_EXCEEDS_BRUTTO` | 4 | Nettonennleistung überschreitet Bruttoleistung — physikalisch unmöglich | Brutto- und Nettoleistung im MaStR-Eintrag prüfen und korrigieren. Nettoleistung darf Bruttoleistung nicht übersteigen. |
| `MQ_MISSING_NAP` | 5 | Anlage ohne Netzanschlusspunkt (NAP) | Netzanschlusspunkt (NAP) im MaStR nachtragen. Ohne NAP ist keine Zuordnung zum Netzgebiet möglich. |
| `MQ_MISSING_MELO` | 5 | Betriebsbereite Anlage ≥100 kW ohne Messlokation (MeLo) | Messlokation (MeLo) im MaStR nachtragen. Für Anlagen ≥100 kW ist die MeLo für Redispatch 2.0 erforderlich. |
| `MQ_NAP_VNB_MISMATCH` | 5 | NAP einem anderen Netzbetreiber zugeordnet | NAP-Zuordnung im MaStR prüfen. Falls die Anlage im eigenen Netzgebiet liegt, NAP-Korrektur bei BNetzA beantragen. |
| `MQ_REDISPATCH_NO_NAP` | 5 | Redispatch-relevante Anlage (≥100 kW) ohne NAP | NAP für Redispatch-relevante Anlage dringend nachtragen. Ohne NAP ist keine Redispatch-Abrechnung (A96) möglich. |
| `MQ_PROBABLE_DUPLICATE` | 6 | Wahrscheinliches Duplikat: alle 4 Kriterien erfüllt | Duplikat-Kandidaten manuell prüfen. Falls bestätigt: eine der beiden Anlagen im MaStR als Duplikat melden und stilllegen. |
| `MQ_GEO_MISASSIGNMENT` | 7 | Geo-Stichprobe fehlgeschlagen — Standort stimmt nicht mit Netzgebiet überein | Koordinaten und PLZ der Anlage im MaStR prüfen. Standort ggf. korrigieren oder Netzgebietszuordnung mit VNB klären. |

### Redispatch Ex-Post (6 codes)

| Code | Step | `descriptionDe` | `recommendationDe` (proposed) |
|------|------|-----------------|-------------------------------|
| `RD_PORTFOLIO_EMPTY` | 2 | Keine Redispatch-relevanten Anlagen (≥100 kW) gefunden | VNB-Identifikation prüfen. Falls korrekt, hat dieser VNB kein Redispatch-Portfolio. |
| `RD_MISSING_NAP` | 3 | Redispatch-relevante Anlage ohne NAP | NAP im MaStR für die betroffene Anlage nachtragen. Ohne NAP keine A96-Abrechnung möglich. |
| `RD_MISSING_MELO` | 3 | Redispatch-relevante Anlage ohne MeLo | MeLo im MaStR nachtragen. Für Redispatch 2.0 ist die Messlokation zwingend erforderlich. |
| `RD_NAP_VNB_MISMATCH` | 3 | NAP einem anderen Netzbetreiber zugeordnet als erwartet | NAP-Zuordnung prüfen. Falls Netzgebietswechsel vorliegt, MaStR-Eintrag aktualisieren. |
| `RD_SETTLEMENT_CRITICAL` | 5 | Kritische Abrechnungsbereitschaft (<80%) — Mehrheit der Anlagen blockiert | Sofortmaßnahme: NAP- und MeLo-Daten der blockierten Anlagen im MaStR ergänzen. A96-Abrechnung ist für diese Anlagen nicht möglich, bis die Datenqualität hergestellt ist. |
| `RD_RISK_HIGH` | 6 | Hohes finanzielles Risiko (>100.000 €) | Eskalation an Portfolio-Management. Blockierte Anlagen priorisiert aufarbeiten, um finanzielle Verluste durch nicht abrechnungsfähige Redispatch-Maßnahmen zu minimieren. |

---

## Allocation Engine — Future Finding Codes

The allocation engine (`energy-sharing-allocation`) is a **Berechnungsengine** and does not
currently produce findings. Candidate finding codes are documented as a stub in
[energy-sharing-allocation.service.js](../../services/energy-sharing-allocation.service.js):

- `ALLOC_ZERO_ALLOCATION_CONSUMER` — Consumer receives 0 kWh in >X% of intervals
- `ALLOC_CONCENTRATION_RISK` — Single generator >Y% of total allocation
- `ALLOC_HIGH_REDISPATCH_DEDUCTION` — Redispatch deduction >Z% of gross generation
- `ALLOC_RESULT_DRIFT` — Allocation differs >W% from previous run
- `ALLOC_IMBALANCE_PERIOD` — Extended zero-generation periods (Dunkelflaute)

**Gap:** Domain-specific thresholds (X, Y, Z, W, N) require business/regulatory grounding —
scheduled for a future sprint.

---

## Integration Notes

- **Frontend:** Render `recommendationDe` below the finding description in a distinct
  visual style (e.g., blue info box or collapsible "Next steps" section).
- **Backend:** Once finalised, recommendations will be added as `recommendation` (EN) and
  `recommendationDe` (DE) fields in `FINDING_CODE_METADATA` (target: v0.21).
- **Fallback:** If a code has no `recommendationDe`, display only `descriptionDe`.
