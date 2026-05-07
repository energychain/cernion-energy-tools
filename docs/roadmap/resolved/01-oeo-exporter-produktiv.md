# Issue 01 — OEO-Exporter produktiv (Stub → JSON-LD)

**Bereich:** Open Science / EU AI Act Art. 12 · **Priorität:** Hoch · **Ziel-Release:** v0.42

## Problem

`src/oeo-exporter-stub.js` und `GET /api/cya/graph/export/oeo-stub` sind seit v0.32 als bewusster *Contributor Hook* angelegt. `transformToOEO()` wirft heute weiterhin `OEO_NOT_IMPLEMENTED`, die Mappings `NODE_TYPE_TO_OEO_CLASS` / `EDGE_TYPE_TO_OEO_PROPERTY` sind TODO-annotierte Stubs.

Der zentrale Open-Science-/EU-AI-Act-Art.-12-Auslass ist damit funktional blockiert: Cernion-Graphen lassen sich weder in [oeplatform](https://openenergyplatform.org/) noch in OEO-konforme Forschungspipelines (ASSUME, TYNDP-Vergleichsstudien) einspeisen.

## Vorschlag

1. **OEO-Class-Mapping** (`NODE_TYPE_TO_OEO_CLASS`):
   - `INSTALLATION` → `oeo:PowerPlant` mit Subklassen je `EnergieTraeger`
   - `NAP` → `oeo:GridConnectionPoint`
   - `SUBSTATION` → `oeo:Substation`
   - `VNB` → `oeo:GridOperator`
   - `REGION` → `oeo:GeographicRegion`
2. **Edge-Property-Mapping** (`EDGE_TYPE_TO_OEO_PROPERTY`) für `VERBUNDEN_MIT`, `LIEGT_IN`, `BETRIEBEN_VON`, `ZUSTAENDIG_FUER`.
3. **JSON-LD-Framing** mit `@context` aus zentralem `src/oeo-context.js`, `oeo:`-Namespace.
4. **Versions-Pinning** der OEO-Release (Argument `oeoVersion`, default = aktuelle stabile).
5. `transformToOEO()` liefert validiertes JSON-LD; Fehler nur noch bei explizit unbekannten Knoten/Kanten.
6. **Round-Trip-Test:** Höheinöd-Fixture → OEO-JSON-LD → SHACL-Validation gegen die OEO-Schemas.
7. `CONTRIBUTING_SCIENCE.md` auf produktiven Stand.

## Akzeptanzkriterien

- `GET /api/cya/graph/export/oeo?operator=...` liefert valides JSON-LD ohne `oeoError`.
- SHACL-Validation gegen OpenEnergyOntology bestanden.
- ≥15 Tests (Klassen-/Property-Mapping, JSON-LD-Frame, SHACL-Pass, Versionsfeld, leerer Graph, unbekannter Knotentyp = Warning).
- Endpoint umbenannt `…/export/oeo` (alter `…/oeo-stub` als Deprecated-Alias 6 Monate).

## Bezug

- v0.32.0 — Stub-Einführung
- `CONTRIBUTING_SCIENCE.md`, `tests/oeo-exporter-stub.test.js`
- TRL-Ziel: 4 → 6
