# Contributing to Cernion — For Researchers & Ontology Developers

> **TL;DR:** We have real-world energy grid data, cleaned and topology-resolved.
> We need OEO experts to map it. One file. Pull Request welcome.

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

## What we need

**One Pull Request. One file.**

`src/oeo-exporter-stub.js` contains a `transformToOEO()` function that currently
throws `NOT_IMPLEMENTED`. We need you to implement it.

### The task

Map our Graphology node/edge types to
**[Open Energy Ontology (OEO)](https://github.com/OpenEnergyPlatform/ontology)**
classes and object properties, and return valid JSON-LD.

Suggested mappings (verify against current OEO):

```
INSTALLATION  → oeo:PowerPlant (+ subclasses: oeo:PhotovoltaicPlant, oeo:WindTurbine ...)
NAP           → oeo:GridConnectionPoint
SUBSTATION    → oeo:Substation
VNB           → oeo:ElectricityGridOperator
REGION        → oeo:Region
```

### How to test your implementation

```bash
# 1. Clone and install
git clone https://github.com/energychain/cernion-energy-tools
cd cernion-energy-tools
npm install

# 2. Run the OEO stub endpoint
npm start &
curl http://localhost:3000/api/cya/graph/export/oeo-stub | jq .

# 3. Implement transformToOEO() in src/oeo-exporter-stub.js
#    Set NOT_IMPLEMENTED = false and implement the mapping

# 4. Run the test suite
npx jest tests/oeo-exporter-stub.test.js --runInBand

# 5. Open a Pull Request
```

---

## Why this matters

Cernion operates on **real operational data** from German VNBs —
the kind of ground-truth data that simulation frameworks rarely have access to.

If you are working with:
- **[ASSUME](https://github.com/assume-framework/assume)** — Agent-based electricity market simulation
- **[oeplatform](https://github.com/OpenEnergyPlatform/oeplatform)** — Open Energy Platform tools
- **[OEO](https://github.com/OpenEnergyPlatform/ontology)** — Open Energy Ontology development

...then a working `transformToOEO()` implementation would allow your models to
consume real grid topology and installed capacity data directly from an
operational platform — bridging the gap between simulation and reality.

---

## Contribution guidelines

- **Scope:** Only `src/oeo-exporter-stub.js` needs to change for the core mapping.
  You may add a test file `tests/oeo-exporter-stub.test.js`.
- **No breaking changes:** Do not modify `src/cya-ontology-graph.js` graph structure.
- **OEO version:** Please state which OEO release your mapping targets in the PR description.
- **JSON-LD framing:** If you add a JSON-LD `@frame`, place it in `src/oeo-frame.jsonld`.
- **Tests:** At least one test that calls `transformToOEO()` with the Höheinöd fixture
  and validates the `@type` of a node.

---

## Contact & Discussion

Open an Issue tagged `[science]` for questions about the graph structure,
available MaStR fields, or OEO mapping decisions.

**Target ontology:** https://github.com/OpenEnergyPlatform/ontology
**This repository:** https://github.com/energychain/cernion-energy-tools
