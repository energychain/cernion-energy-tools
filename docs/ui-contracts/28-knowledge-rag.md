# UI Contract 28 — Knowledge RAG

Version: 0.39.0
Status: Draft (backend-owned)

## Purpose

Provides HyDE-aware knowledge retrieval via MCP tool `cernion_rag_search` with async REST job pattern.

- Canonical endpoint (`/query`) supports all `queryType` modes
- Convenience endpoints for `semantic`, `scroll`, `fetch`, `collection_info`
- Full Qdrant-style `filter` object pass-through
- REST callers receive `202 Accepted` and poll `/api/jobs/:jobId/status|result`

## Base Path

`/api/knowledge-rag`

## Endpoints

### 1) POST `/query`
Generic endpoint.

Request:
- `queryType`: `semantic | scroll | fetch | collection_info` (default `semantic`)
- `query` (required for `semantic`)
- `limit` (1..100, default `10`)
- `scoreThreshold` (optional)
- `ids` (required for `fetch`, array of string/number)
- `offset` (optional, string/number/object)
- `filter` (optional, full Qdrant-style object)
- `withPayload` (default `false`)
- `withVectors` (default `false`)

Response:
- External REST: `202` + `jobId`, `statusUrl`, `resultUrl`
- Internal service call: `200` + normalized tool result

### 2) POST `/semantic`
Forces `queryType=semantic`.

### 3) POST `/scroll`
Forces `queryType=scroll`.

### 4) POST `/fetch`
Forces `queryType=fetch`.

### 5) POST `/collection-info`
Forces `queryType=collection_info`.

## Example (semantic + metadata filters)

```json
{
  "query": "Welche Festlegungen der BNetzA gibt es zum Netzanschluss?",
  "limit": 5,
  "filter": {
    "must": [
      { "key": "metadata.docType", "match": { "value": "Festlegung" } },
      { "key": "metadata.authority", "match": { "value": "BNetzA" } }
    ]
  }
}
```

## Async Job Pattern

1. Call any `knowledge-rag` endpoint
2. Receive `202` with `jobId`
3. Poll:
   - `GET /api/jobs/:jobId/status`
   - `GET /api/jobs/:jobId/result`

## Notes

- `withVectors` can significantly increase payload size; default is `false`.
- `filter` is intentionally pass-through to preserve full Qdrant expressiveness.
