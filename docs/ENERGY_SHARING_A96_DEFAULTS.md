# A96 Feldspezifikation — Defensive Defaults (v0.47)

**Status:** Spec-Freeze 2026-06-15 — danach nur Bugfixes auf dieser Version.
**Q3-2026-Updates der BNetzA** fließen in v0.51 ein.
**Erstellt:** 2026-05-07 · **Gültig ab:** v0.47.0

---

## Hintergrund

Die BNetzA-A96-Feldspezifikation ist **[Stand 2026-05-07] noch nicht final** (Q3 2026 erwartet).
Alle mit `[BNetzA-OFFEN]` markierten Felder erhalten defensive Defaults, die:
- keine regulatorischen Anforderungen verletzen,
- bei späterer Klärung ohne Migration ersetzt werden können,
- von `src/a96-validator.js` auf Spec-Drift geprüft werden.

---

## Offene Felder und defensive Defaults

| Feldname (A96) | Status | Defensiver Default (v0.47) | Begründung | BNetzA-Klärung erwartet |
|---|---|---|---|---|
| `ErzeugerMastrNummer` | `[BNetzA-OFFEN]` | MaStR-Nummer aus Validierungsreport (`generators[].mastrNummer`) | Eindeutige technische ID verfügbar; Formatmapping final noch offen | Q3 2026 |
| `Bilanzierungsmonat` | `[BNetzA-OFFEN]` | ISO-8601-Monat des Allokationszeitraums (`YYYY-MM`) | Granularität Monat vs. Zeitraum offen; Monat ist konservativster Ansatz | Q3 2026 |
| `BdewCodeNetzbetreiber` | `[BNetzA-OFFEN]` | BDEW-Code aus VNB-Identity (`gridOperator.bdew`) | Übertragungsweg in A96 noch nicht definiert; Wert immer vorhanden | Q3 2026 |
| `QualitaetskennzeichenMscons` | `[BNetzA-OFFEN]` | `E01` (Messwert, geprüft) | Konservativster MSCONS-Werteart; `E02` (Ersatzwert) als Fallback wenn `msconsMissing > 0` | Q3 2026 |

---

## Drift-Erkennung

`src/a96-validator.js` prüft bei jeder A96-Nachricht gegen dieses Schema.
Abweichungen werden als `ES_A96_FIELD_DRIFT` finding mit severity `warning` gemeldet.

```json
{
  "finding": "ES_A96_FIELD_DRIFT",
  "severity": "warning",
  "fields": ["ErzeugerMastrNummer"],
  "message": "A96 field uses defensive default — awaiting BNetzA final spec"
}
```

---

## Spec-Freeze-Prozess

```
2026-06-15  SPEC FREEZE — keine neuen [BNetzA-OFFEN]-Felder ab hier
2026-07-01  Cutover-Deadline §42c Energieteilen
2026-Q3     BNetzA A96 finalisiert
v0.51       Integration der finalen BNetzA-Feldspezifikation
```

Nach dem Freeze werden Q3-Updates der BNetzA in einem separaten Branch gesammelt
und erst in v0.51 integriert. Bugfixes auf eingefrorener Spec sind weiterhin möglich.

---

## Zugehörige Artefakte

- `src/a96-validator.js` — JSON-Schema-Validator mit Drift-Markierung
- `services/bilanzkreis.service.js` — A96-Export-Endpoint
- `docs/ENERGY_SHARING_ABNAHME.md` — Abnahme-Checkliste (Sektion 6)
- `docs/ui-contracts/22-settlement.md` — UI-Contract mit [OFFEN-3]-Status
