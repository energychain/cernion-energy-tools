# Issue 22 — OEMetadata-FAIR-Export für Audit-Reports

**Bereich:** Open Science / Compliance · **Priorität:** Mittel · **Ziel-Release:** v0.50

## Problem

Heute hat nur das **Datapoint Layer** den Endpunkt `GET /api/datapoints/:name/oemetadata` für FAIR-Data-Metadaten (EU AI Act Art. 12). Audit-Reports der Agent-Pipelines (`mastr-quality`, `redispatch-expost`, `grid-connection`, `energy-sharing`, `finance-agent`) sind genauso EU-AI-Act-Art.-12-relevant — aber kein OEMetadata-Endpunkt liefert sie als FAIR-Datensatz aus.

Das verhindert:
- Open-Science-Anschluss der Agent-Befunde an [oeplatform](https://openenergyplatform.org/) (CYA-Graph hat es seit v0.42, Audit-Reports nicht).
- Wissenschaftliche Replikation einzelner Agent-Befunde.
- Datasette-/Dataverse-/Zenodo-Veröffentlichung für Forschungspartnerschaften.

## Vorschlag

1. **Generischer OEMetadata-Builder** für Audit-Reports:
   - `src/audit-oemetadata-builder.js` mit `buildOemetadataForAudit(audit, source)` — analog `src/oemetadata-builder.js` für Datapoints.
   - Nutzt OEO-Mappings aus v0.42 (`src/oeo-context.js`).
2. **Endpunkte pro Audit-Typ:**
   - `GET /api/mastr-quality/audits/:id/oemetadata`
   - `GET /api/redispatch/audits/:id/oemetadata`
   - `GET /api/grid-connection/validations/:id/oemetadata`
   - `GET /api/energy-sharing/validations/:id/oemetadata`
   - `GET /api/finance-agent/analyses/:id/oemetadata`
3. **Bundle-Endpoint:**
   - `GET /api/oemetadata/bundle?since=...&until=...&kinds=mq,rd,gc,es,fa`
   - Liefert ein gepacktes Tar/Zip mit OEMetadata-JSON-LD für alle Audits im Zeitfenster (FAIR-Bulk-Download).
4. **OEO-Subklassen-Anschluss:**
   - `oeo:DataAnalysisProcedure` als Top-Level-Klasse pro Audit
   - `oeo:Finding` als Annotation-Knoten (eine Annotation pro Finding-Code)
5. **DataCite-DOI-Hooks:**
   - Optionaler `POST /api/oemetadata/audits/:id/mint-doi` (full-access) — registriert DOI über DataCite-API für tenant-übergreifende Veröffentlichungen.
6. **Provenance-Hash-Kette:**
   - OEMetadata enthält `provenanceHash` aller Source-Datapoints/Snapshots → reproduzierbarer Replay.

## Akzeptanzkriterien

- Höheinöd-`mq_audit` → OEMetadata-Export → SHACL-Pass gegen OEO 2.11.0.
- Bundle-Endpoint liefert validen Tar mit ≥10 Audits.
- ≥25 Tests pro Audit-Typ (Mapping, Provenance-Hash-Konsistenz, OEO-Klassen-Korrektheit).
- `CONTRIBUTING_SCIENCE.md` um Audit-FAIR-Export-Sektion erweitert.

## Bezug

- v0.42.0 — Productive OEO Export (Graph)
- v0.13 — OEMetadata für Datapoints
- v0.20 — Audit-Persistenz-Schema
- Hängt an Issue 15 (TRL-Tabelle muss FAIR-Reife reflektieren)
