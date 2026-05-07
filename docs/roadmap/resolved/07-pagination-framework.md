# Issue 07 — Globales Pagination-Framework (Cursor-API)

**Bereich:** API · **Priorität:** Mittel · **Ziel-Release:** v0.41

## Problem

Pagination-TODOs sind in Produktiv-Code stehengeblieben:

- `services/cya.service.js:1041` — `// TODO: Pagination für >1000 Sessions (analog mastr-monitor)`
- `services/mastr-monitor.service.js` — `limitApplied`-Flag ist Workaround statt echter Pagination
- `GET /api/cya/a2a-stats?limit=N` (max 1000, default 100) — ohne Cursor
- `GET /api/mastr-quality/audits` und `…/redispatch/audits` — kein Cursor-Schema
- `GET /api/datasources` und `GET /api/datapoints` — liefern alle Records

Bei Tenants mit >10 k Sessions/Audits werden die Endpunkte unbenutzbar.

## Vorschlag

1. **Standardisiertes Cursor-Schema** in `src/pagination.js`:
   - Request: `?limit=N&cursor=<opaque>` (default 50, max 200)
   - Response: `{ data, pageInfo: { nextCursor, prevCursor, hasMore, totalCountApprox } }`
   - Cursor = base64(JSON `{ pivot, direction, hash }`), HMAC-signiert mit Tenant-Salt
2. **Mango-Selectoren** für PouchDB-basierte Endpoints (sortIndex über `createdAt` + `_id`).
3. **Backwards-Compatibility:** `limit/offset` 6 Monate als Deprecated-Aliase, Header `Deprecation: true` + `Sunset: <date>`.
4. **OpenAPI-Update:** Reusable Schema `PaginationCursor` und `PageInfo`.
5. **Affected Endpoints:**
   - [ ] `GET /api/cya/profiles`
   - [ ] `GET /api/cya/a2a-stats`
   - [ ] `GET /api/cya/sessions/:id/a2a-log` (Sub-Pagination)
   - [ ] `GET /api/mastr-monitor/watches` und `…/deltas`
   - [ ] `GET /api/mastr-quality/audits`
   - [ ] `GET /api/redispatch/audits`
   - [ ] `GET /api/grid-connection/validations`
   - [ ] `GET /api/energy-sharing/validations`
   - [ ] `GET /api/energy-sharing-allocation/allocations`
   - [ ] `GET /api/finance-agent/analyses`
   - [ ] `GET /api/datapoints`, `GET /api/datasources`, `GET /api/edm/melos`

## Akzeptanzkriterien

- Performance-Test 100 k Records: erste Page <100 ms, kein Memory-Spike.
- Cursor manipulationssicher (Signature-Check schlägt bei fremden Cursors).
- 1 Test pro Endpoint plus Property-Test gegen `src/pagination.js`.

## Bezug

- v0.38.2 TODO-Marker im CYA-Service
- v0.27.3 chunked persistence (mastr-monitor)
