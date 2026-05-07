# Issue 04 — Knowledge-RAG Eigene Ingestion-Pipeline

**Bereich:** RAG / Wissen · **Priorität:** Hoch · **Ziel-Release:** v0.43

## Problem

`services/knowledge-rag.service.js` (v0.39.0) ist heute nur ein Lese-Wrapper um das externe MCP-Tool `cernion_rag_search`. Es gibt keinen eigenen Ingest-Pfad: weder regulatorische Texte (EnWG, BNetzA-Festlegungen, EEG), noch interne Dokumente (Stadtwerk-Verträge, VNB-Bedienungsanweisungen) oder Audit-Reports lassen sich aus der Plattform heraus indexieren. Konsequenz: der Finance-Agent (v0.40) liefert in `rule_plus_hyde`-Modus regelmäßig "no hits found" für tenant-spezifische Fragen.

## Vorschlag

1. **Neuer Service `services/knowledge-rag-ingest.service.js`:**
   - `POST /api/knowledge-rag/collections` (tenant-isoliert, default `tenant:{id}:knowledge`)
   - `POST /api/knowledge-rag/ingest` (`{ collection, documents[], chunking, metadata }`) — async-Job
   - `POST /api/knowledge-rag/ingest/from-datasource` (nutzt `datasource-registry`)
   - `POST /api/knowledge-rag/ingest/from-audit` (CYA-Session, MaStR-Audit, Redispatch-Audit als Self-Knowledge)
   - `DELETE /api/knowledge-rag/collections/:name`
   - `POST /api/knowledge-rag/reindex/:collection`
2. **Chunking:** `paragraph`, `markdown-section`, `fixed-window`, `semantic` (Konfig pro Collection).
3. **Embedding** über die Adapter-Kette aus Issue 03 (`embeddings()`-Capability).
4. **Provenance:** Jeder Chunk trägt `sourceId`, `sourceVersion`, `sha256(chunk)`, `oeoTags[]`, `tenantId`, `ingestedAt`.
5. **Re-Index-Migration:** Wechsel des Embedding-Modells löst kontrollierten Re-Embed mit Versions-Tag aus, alter Index 7 Tage live.
6. **Self-Knowledge:** Audit-Reports werden automatisch in `tenant:{id}:audit_history` indexiert — Finance-Agent kann eigene Vorbefunde zitieren.

## Akzeptanzkriterien

- Ingest eines 50-Seiten-PDFs (BNetzA-Festlegung) <60 s, nachvollziehbare Chunks mit Provenance.
- Finance-Agent-Recipe zitiert nach Ingest interne Quellen.
- Modell-Wechsel-Test: alter + neuer Index nebeneinander, Cutover-Endpoint.
- ≥30 Tests inkl. Chunking-Edge-Cases.

## Bezug

- v0.39.0 Knowledge-RAG-Service (Read-only)
- v0.40.4 Finance-Agent A²MDM
- Hängt an Issue 03 (Embeddings-Capability)
