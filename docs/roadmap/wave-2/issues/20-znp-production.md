# Issue 20 — ZNP Production-Readiness (Layer 1+2 + G-Factor-Validierung)

**Bereich:** Domäne · **Priorität:** Mittel · **Ziel-Release:** v0.49

## Problem

`znp.service.js` steht laut TRL-Tabelle bei **TRL 4**: G-Factor-Scoring konzeptionell, Feldvalidierung ausstehend. `services/api.service.js:358` markiert Layer 1 (OSM buildings) und Layer 2 (transformer loads) explizit als **stub** in der OpenAPI-Beschreibung. v0.46.2 hat zwar Planning-Assist hinzugefügt, das konsolidiert aber nur den LLM-Kontext — die eigentliche Engine bleibt unbestätigt.

## Vorschlag

### Layer 1 — OSM-Buildings-Clustering

- [ ] `src/znp-layer1-buildings.js` mit echtem Overpass-API-Workflow:
  - Bounding-Box-Query mit Caching
  - Building-Footprint-Aggregation pro NAP/Substation
  - Cluster-Algorithmus (DBSCAN / Voronoi-Diagramm um Substationen)
- [ ] Output-Schema standardisiert (kompatibel mit `osm-geo`-Service)
- [ ] Async-Job-Pattern (Issue 14)

### Layer 2 — Transformer-Load-Profile

- [ ] `src/znp-layer2-pdf-extractor.js` aus dem Stub auf echte Extraktion bringen:
  - Validation gegen 3 verschiedene VNB-PDF-Layouts (z. B. Stadtwerke Waiblingen, Pfalzwerke, Mainova)
  - Tabellen-Erkennung mit `pdf-table-extractor` o. ä.
  - cosPhi-Anwendung (`_applyCosPhi`-Funktion gibt es schon im Modul)
- [ ] Alternative: CSV-Importpfad für VNBs ohne PDF-Reports.

### G-Factor-Validierung

- [ ] **Reference-Datasets** sammeln: ≥5 Netzgebiete mit gemessenen Gleichzeitigkeitsfaktoren (z. B. aus Stadtwerk-Studien, BDEW-VDE-Veröffentlichungen).
- [ ] **Backtest** des Theoretical-Layer-0 G-Factor gegen gemessenes Layer-2:
  - Zielmetrik: MAPE < 15 % über alle Reference-Datasets.
- [ ] **Kalibrierungsparameter** offenlegen (Modell-Konstanten pro Asset-Typ, Spannungsebene, Klima-Zone).
- [ ] **Explainability-Output:** pro Faktor-Wert die Top-3-treibenden Asset-Klassen.

### NOVA-Integration

- [ ] ZNP-Layer-2-Events `znp.layer2.peakLoad.exceeded` werden zu NOVA-Decisions (Issue 19).
- [ ] Strategic-Prompts (existieren) erzeugen explizite NOVA-Vorschläge `kind: znp_capex_alternative` (z. B. rONT statt Kabelausbau).

### Acceptance Reference: Höheinöd

- [ ] Höheinöd-Fixture (PLZ 66989) mit Layer 0 + Layer 1 + Layer 2 vollständig befüllbar.
- [ ] Reproducible Backtest in `tests/znp.acceptance.e2e.test.js`.

## Akzeptanzkriterien

- TRL-Update auf 6 in `ARCHITECTURE.md` (Issue 15).
- G-Factor-MAPE <15 % auf Reference-Set.
- Layer 1 + Layer 2 ohne `stub`-Marker in OpenAPI.
- ≥40 Tests inkl. PDF-Layout-Varianten.
- Cookbook-Recipe `znp-full-territory-readiness` ergänzt.

## Bezug

- v0.20.5 — ZNP-Service-Einführung
- v0.46.2 — Planning-Assist Rollout (vorgelagerte Investition)
- Hängt an Issue 14 (Async-Job-Cutover für Layer 1+2) und Issue 19 (NOVA-Bridge)
