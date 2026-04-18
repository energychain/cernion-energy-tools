# Release Summary Q2 2026 — CYA Agent Feature-Complete (v0.27.5)

## Overview

v0.27.5 marks the **Q2 2026 Feature-Complete milestone** for the CYA (Cover Your Assets) Agent.
All planned CYA features are implemented, tested end-to-end, and production-ready.

## CYA Features (v0.27.x Gesamtübersicht)

| Version | Feature | Status |
|---------|---------|--------|
| v0.27.0 | CYA Core Pipeline (4 Phasen: Retrieval → Reg-Graph → Grounding → LLM) | ✅ Released |
| v0.27.0 | Object Store Integration (`cya_profiles`, `cya_sessions`) | ✅ Released |
| v0.27.1 | PDF/JSON Export (`exportPdf`, `exportJson`, `src/cya-report-builder.js`) | ✅ Released |
| v0.27.2 | CYA Refinement (`refine` Action, iterative Verbesserung) | ✅ Released |
| v0.27.3 | Multi-Perspektive Generator (`compareProfiles`, 2–5 Rollen parallel) | ✅ Released |
| v0.27.4 | Profile-Templates Katalog (6 Rollen, `listTemplates`, `createFromTemplate`) | ✅ Released |
| v0.27.5 | E2E-Integrationstest Höheinöd + Session-Persistenz-Bugfix | ✅ Released |

## Architektur

```
POST /api/cya/generate
        │
        ├─ Phase 1: cya-data-retriever.js   (energy-market, grid-operations, osm-geo)
        ├─ Phase 2: cya-regulatory-graph.js  (9 Regeln, NOVA/Curtailment/Voltage)
        ├─ Phase 3: Grounding                (Faktenprüfung via MCP)
        └─ Phase 4: llm-client.js            (Google Gemini, strukturiertes Schema)

Persistenz:
  object-store.cya_profiles  (PouchDB, Prefix: profile:)
  object-store.cya_sessions  (PouchDB, Prefix: session:)
```

## Test-Coverage-Kennzahlen (v0.27.5)

| Metrik | Wert |
|--------|------|
| Gesamt-Tests | ~2 340+ |
| Test-Suites | ~86+ |
| CYA Unit-Tests (`cya.service.test.js`) | 37 |
| CYA E2E-Tests (`cya-e2e-hoeheinoed.test.js`) | 31 |
| Coverage Branches | ≥ 60 % |
| Coverage Functions | ≥ 75 % |
| Coverage Lines | ≥ 75 % |

## CYA REST Endpoints (vollständig)

| Method | Path | Action |
|--------|------|--------|
| POST | `/api/cya/profile` | `cya.createProfile` |
| GET | `/api/cya/profile/:id` | `cya.getProfile` |
| GET | `/api/cya/profiles` | `cya.listProfiles` |
| GET | `/api/cya/templates` | `cya.listTemplates` |
| GET | `/api/cya/templates/:templateId` | `cya.getTemplate` |
| POST | `/api/cya/profile/from-template` | `cya.createFromTemplate` |
| POST | `/api/cya/generate` | `cya.generate` |
| POST | `/api/cya/refine` | `cya.refine` |
| POST | `/api/cya/compare-perspectives` | `cya.compareProfiles` |
| POST | `/api/cya/export/pdf` | `cya.exportPdf` |
| POST | `/api/cya/export/json` | `cya.exportJson` |

## Breaking Changes

**Keine.** v0.27.5 ist vollständig rückwärtskompatibel zu v0.27.4.

## Known Limitations

- PDF-Export verwendet `pdfkit` (High-Advisory `xlsx` nicht betroffen); dokumentiert in SECURITY.md.
- LLM-Backend: Google Gemini (konfigurierbar via `GEMINI_API_KEY`); kein Fallback zu lokalem Modell.
- `compareProfiles` führt Phase 1–3 einmalig aus und re-synthetisiert Phase 4 je Perspektive —
  bei > 3 Perspektiven erhöhte LLM-Token-Last.

## Nächste Schritte (v0.28.x Outlook)

- CYA Scheduler: Automatische Refresh-Zyklen für gespeicherte Sessions (analog Datapoint-Scheduler).
- CYA Webhook: Push-Notification bei Regulatory-Graph-Änderungen.
- Dashboard-Integration: CYA KPIs in `dashboard-api.vnbOverview`.
