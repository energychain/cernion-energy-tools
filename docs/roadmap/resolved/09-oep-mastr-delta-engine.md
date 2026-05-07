# Issue 09 — MaStR↔OEP Delta-Engine

**Bereich:** Daten / Open Science · **Priorität:** Mittel · **Ziel-Release:** v0.42

## Problem

`POST /api/oep/compare-mastr` (v0.38.x) liefert heute zuverlässig Daten aus beiden Quellen, der Schlüssel `delta` ist aber explizit `null` mit TODO-Kommentar in `services/oep.service.js:515`:

```js
delta: null, // TODO: semantische Verknüpfung via OEO-Klassen
```

Damit fehlt der eigentliche Mehrwert (Datenkonsistenz-Audit MaStR vs. OEP `supply.ego_dp_res_powerplant`). `installationType: 'all'` ist zusätzlich zwei Mal als TODO gekennzeichnet.

## Vorschlag

1. **`src/oep-delta-engine.js`** mit:
   - `joinByOeoClass(mastrInstallations, oepRows, oeoClass)`
   - `computeFieldDeltas(joinedPair, fieldMap)` → `[{ field, mastrValue, oepValue, deltaPct, severity }]`
   - `aggregateDeltas(deltas)` → `{ totalMatched, totalUnmatched, capacityDeltaMW, fields: {...} }`
2. **Output-Erweiterung** in `compareWithMastr`:
   ```json
   { "oep": {...}, "mastr": {...},
     "delta": {
       "matchedPairs": 421,
       "mastrOnly": 12,
       "oepOnly": 7,
       "fieldDeltas": { "capacityKw": { "mean": 1.4, "max": 220 } },
       "topMismatches": [...]
     },
     "oeoMappingNote": "...",
     "_evidence": [...]
   }
   ```
3. **`installationType: 'all'`** in `energy-market.installations` und `oep.compareWithMastr` ergänzen (Enum erweitern).
4. **Job-Pattern:** Bei Portfolios >5000 Anlagen async (HTTP 202).

## Akzeptanzkriterien

- Vergleich Höheinöd-VNB (≥3 OEP-Tabellen): nicht-trivialer Delta-Output mit korrekten Feldzuordnungen.
- Test-Suite mit synthetischen MaStR/OEP-Fixtures (matched/unmatched/field-delta).
- Mindestens eine semantische Mapping-Tabelle in `src/oep-tables.js` mit OEO-Properties pro Feld.
- `oep.available: false` bleibt graceful.

## Bezug

- v0.38.x OEP Connector Ausbau TRL5→6
- `services/oep.service.js:498,515` (TODOs)
- Hängt lose an Issue 01 (gemeinsame OEO-Klassen-Nutzung)
