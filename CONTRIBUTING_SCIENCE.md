# Contributing to Cernion — For Researchers & Ontology Developers

> **TL;DR:** We have real-world energy grid data, cleaned and topology-resolved.
> We now export it as OEO-aligned JSON-LD and welcome ontology-focused extensions,
> stricter mappings and research integrations.

---

## What we have

Cernion Energy Tools is an open-source platform for German distribution grid
operators (Verteilnetzbetreiber). Since v0.32.0, the platform maintains a live
**[Graphology](https://graphology.github.io/)**-based asset graph built from
real MaStR (Marktstammdatenregister) data:

| Node Type    | Real-world entity                        | Count (typical VNB) |
|--------------|------------------------------------------|---------------------|
| INSTALLATION | Power plant, PV system, storage, BHKW    | 500–5.000           |
| NAP          | Grid connection point (Netzanschlusspunkt)| 500–5.000          |
| SUBSTATION   | Transformer station (from OSM)           | 10–200              |
| VNB          | Distribution grid operator               | 1–5                 |
| REGION       | Postal code cluster                      | 1–50                |

Edges encode real topological relationships:
`INSTALLATION → NAP → SUBSTATION → VNB`, `INSTALLATION → REGION`.

**The data is:**
- Cleaned (MaStR quality-audited, gap-detected, deduplication-checked)
- Topology-resolved (110 kV voltage cascade via OSM substation lookup)
- EU AI Act Art. 12/13 compliant (data provenance tracked per node)

---

## What is available now

Since `v0.42.0`, Cernion ships a productive OEO export path:

- `GET /api/cya/graph/export/oeo` — productive JSON-LD export
- `GET /api/cya/graph/export/oeo-stub` — deprecated compatibility alias until `2026-11-05`
- `src/oeo-context.js` — central JSON-LD `@context`
- `src/oeo-exporter-stub.js` — production transformer and mapping logic

The exporter now:

- maps Graphology node/edge types to OEO-aligned JSON-LD
- pins the ontology release to `OEO 2.11.0`
- exposes both `warnings[]` and `validationSummary`
- supports SHACL-based regression validation in the test suite

### The task

Map our Graphology node/edge types to
**[Open Energy Ontology (OEO)](https://github.com/OpenEnergyPlatform/ontology)**
classes and object properties, and return valid JSON-LD.

Current mapping surface:

```
INSTALLATION  → oeo:PowerPlant (+ subclasses by EnergieTraeger)
NAP           → oeo:GridConnectionPoint
SUBSTATION    → oeo:Substation
VNB           → oeo:GridOperator
REGION        → oeo:GeographicRegion

VERBUNDEN_MIT  → oeo:connectedTo
LIEGT_IN       → oeo:locatedIn
BETRIEBEN_VON  → oeo:operatedBy
ZUSTAENDIG_FUER→ oeo:responsibleFor
```

Unknown node/edge types do not fail the export. They are downgraded to warnings
and surfaced in both `warnings[]` and `validationSummary`.

### How to test your implementation

```bash
# 1. Clone and install
git clone https://github.com/energychain/cernion-energy-tools
cd cernion-energy-tools
npm install

# 2. Run the productive OEO endpoint
npm start &
curl 'http://localhost:3000/api/cya/graph/export/oeo?operator=Pfalzwerke%20Netz%20AG' | jq .

# 3. Run the focused exporter + endpoint + SHACL regression tests
NODE_OPTIONS=--experimental-vm-modules npx jest \
  tests/oeo-exporter-stub.test.js \
  tests/cya.oeo-export.test.js \
  tests/oeo-exporter-shacl.test.js \
  --runInBand

# 4. Open a Pull Request with mapping/shape improvements
```

---

## Why this matters

Cernion operates on **real operational data** from German VNBs —
the kind of ground-truth data that simulation frameworks rarely have access to.

If you are working with:
- **[ASSUME](https://github.com/assume-framework/assume)** — Agent-based electricity market simulation
- **[oeplatform](https://github.com/OpenEnergyPlatform/oeplatform)** — Open Energy Platform tools
- **[OEO](https://github.com/OpenEnergyPlatform/ontology)** — Open Energy Ontology development

...then the productive `transformToOEO()` implementation allows your models to
consume real grid topology and installed capacity data directly from an
operational platform — bridging the gap between simulation and reality.

---

## Contribution guidelines

- **Scope:** Only `src/oeo-exporter-stub.js` needs to change for the core mapping.
  Context/version changes belong in `src/oeo-context.js`; regression tests live in
  `tests/oeo-exporter-stub.test.js`, `tests/cya.oeo-export.test.js` and
  `tests/oeo-exporter-shacl.test.js`.
- **No breaking changes:** Do not modify `src/cya-ontology-graph.js` graph structure.
- **OEO version:** `v0.42.0` pins the exporter to `OEO 2.11.0`.
- **Version policy:** If you change the pin, update `src/oeo-context.js`, tests and release notes together.
- **JSON-LD framing:** Keep the central `@context` in `src/oeo-context.js`.
- **Tests:** Preserve SHACL validation for the Höheinöd fixture and keep `warnings[]`
  plus `validationSummary` behavior stable.

---

## Contact & Discussion

Open an Issue tagged `[science]` for questions about the graph structure,
available MaStR fields, or OEO mapping decisions.

**Target ontology:** https://github.com/OpenEnergyPlatform/ontology
**This repository:** https://github.com/energychain/cernion-energy-tools
