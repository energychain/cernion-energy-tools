# UI Contract: ZNP Workspace API

> **Page ID:** `znp-workspace`
> **Version:** 0.25.0
> **Last updated:** 2026-04-14

---

## Scope

This contract defines the Zielnetzplanung (ZNP) project workspace API used by the UI.
The ZNP graph is persisted in PouchDB (`znp:meta:*`, `znp:graph:*`) and hydrated on access.

---

## Endpoints (11 operations)

| # | Method | URL | Purpose |
|---|--------|-----|---------|
| 1 | `GET` | `/api/znp/projects` | List projects |
| 2 | `POST` | `/api/znp/projects` | Create project |
| 3 | `GET` | `/api/znp/projects/:projectId` | Read project metadata + graph stats |
| 4 | `DELETE` | `/api/znp/projects/:projectId` | Delete project (meta + graph) |
| 5 | `POST` | `/api/znp/projects/:projectId/layer0` | Load MaStR assets |
| 6 | `POST` | `/api/znp/projects/:projectId/layer1` | Load OSM buildings/clustering (async job) |
| 7 | `POST` | `/api/znp/projects/:projectId/layer2` | Load transformer calibration from PDF (async job) |
| 8 | `GET` | `/api/znp/projects/:projectId/g-factor` | Compute adjusted capacity |
| 9 | `GET` | `/api/znp/projects/:projectId/strategic-prompts` | AI strategic questions |
| 10 | `POST` | `/api/znp/projects/:projectId/assumptions` | Add planning assumption node |
| 11 | `GET` | `/api/znp/projects/:projectId/assets` | List/filter/paginate layer0 assets |

---

## Core Request/Response Shapes

### 1) Create project

`POST /api/znp/projects`

```json
{
  "bbox": { "south": 49.47, "west": 8.43, "north": 49.52, "east": 8.52 },
  "name": "Ludwigshafen Nord"
}
```

```json
{
  "projectId": "a1b2c3d4-...",
  "name": "Ludwigshafen Nord",
  "bbox": { "south": 49.47, "west": 8.43, "north": 49.52, "east": 8.52 },
  "createdAt": "2026-04-12T12:00:00.000Z",
  "graphStats": { "nodes": 1, "edges": 0 }
}
```

### 2) Layer 0 ingestion

`POST /api/znp/projects/:projectId/layer0`

```json
{
  "assets": [
    {
      "mastrNummer": "SEE900123456789",
      "capacity": 120,
      "assetType": "solar",
      "lat": 49.491,
      "lon": 8.471,
      "status": "InBetrieb",
      "commissioningDate": "2024-06-15",
      "fernsteuerbarkeitDv": true,
      "fernsteuerbarkeitSonstige": false
    }
  ]
}
```

```json
{
  "projectId": "a1b2c3d4-...",
  "nodesAdded": 1,
  "edgesAdded": 1,
  "skipped": 0,
  "totalNodes": 2,
  "totalEdges": 1
}
```

### 3) Layer 1 and Layer 2 are async jobs

`POST /api/znp/projects/:projectId/layer1` and `POST /api/znp/projects/:projectId/layer2`
return `202` for REST callers:

```json
{
  "success": true,
  "jobId": "6fd6a40e-...",
  "status": "queued",
  "statusUrl": "/api/jobs/6fd6a40e-.../status",
  "resultUrl": "/api/jobs/6fd6a40e-.../result"
}
```

Layer2 accepts either:
- `filePath` (uploaded file)
- `fileContentBase64` (+ optional `fileName`)

### 4) G-factor

`GET /api/znp/projects/:projectId/g-factor?target_layer=1&substationId=SUB_1`

```json
{
  "projectId": "a1b2c3d4-...",
  "substationId": "SUB_1",
  "targetLayer": 1,
  "assetCount": 42,
  "totalCapacityKW": 7240,
  "simultaneityFactor": 0.71,
  "adjustedCapacityKW": 5140.4,
  "flexNavExcluded": 3
}
```

### 5) Add assumption

`POST /api/znp/projects/:projectId/assumptions`

```json
{ "text": "Wir planen einen 5 MW Speicher mit flexiblem NAV." }
```

```json
{
  "projectId": "a1b2c3d4-...",
  "assumptionId": "f0e2...",
  "nodeKey": "assumption:f0e2...",
  "extracted": {
    "assetType": "storage",
    "capacityKW": 5000,
    "status": "planned",
    "hasFlexibleNav": true
  },
  "hasFlexibleNav": true,
  "graphStats": { "nodes": 97, "edges": 140 }
}
```

### 6) Assets list

`GET /api/znp/projects/:projectId/assets?assetType=solar&status=InBetrieb&limit=100&offset=0&sortByCapacity=desc`

```json
{
  "totalCount": 201,
  "offset": 0,
  "limit": 100,
  "assets": [
    {
      "mastrNummer": "SEE900123456789",
      "capacity": 120,
      "assetType": "solar",
      "status": "InBetrieb",
      "commissioningDate": "2024-06-15",
      "lat": 49.491,
      "lon": 8.471
    }
  ]
}
```

### 7) Project metadata and deletion

- `GET /api/znp/projects/:projectId` returns `projectId`, `name`, `bbox`, `createdAt`, `layers`, `graphStats`
- `DELETE /api/znp/projects/:projectId` returns:

```json
{ "success": true, "projectId": "a1b2c3d4-...", "message": "Project \"a1b2c3d4-...\" has been permanently deleted." }
```

---

## Graph Schema Contract

### Node types

- `substation` (seeded as `SUB_1`)
- `mastr_asset` (Layer 0)
- `building` (Layer 1)
- `measurement` (Layer 2 peak load)
- `calibration_node` (Layer 2 calibration context)
- `assumption` (Layer 2.5 strategic assumptions)

### Edge types

- `CONTRIBUTES_LOAD` (asset/assumption -> substation)
- `oeo_located_in` (asset -> building)
- `oeo_measures` (measurement -> substation)

### Important attributes used by UI logic

- Asset: `mastrNummer`, `capacity`, `capacity_kw`, `assetType`, `status`, `commissioningDate`
- Contribution edge: `layer`, optional `gFactor`
- Measurement: `value` (`peakLoadKw`), `transformerId`, `nominalCapacityKw`
- Project-layer metadata: `layer1GFactorAdjustment`, `layer2CalibrationFactor`

---

## Layer Lifecycle (UI Flow)

1. Create project (`POST /projects`)
2. Load Layer0 assets (`POST /layer0`)
3. Start Layer1 async job (`POST /layer1`) and poll `/api/jobs/:jobId/status`
4. Start Layer2 async job (`POST /layer2`) and poll `/api/jobs/:jobId/status`
5. Query analytics (`GET /g-factor`, `GET /assets`, `GET /strategic-prompts`)
6. Add assumptions (`POST /assumptions`)
7. Optional cleanup (`DELETE /projects/:projectId`)

---

## Error Contract

- `404 ZNP_PROJECT_NOT_FOUND` for unknown `projectId`
- `404 ZNP_SUBSTATION_NOT_FOUND` for missing `substationId` in graph
- `400 INVALID_ASSET` for malformed asset payload
- `400 ZNP_LAYER2_FILE_REQUIRED` when neither `filePath` nor `fileContentBase64` is provided
- `503 LLM_NOT_CONFIGURED` for AI endpoints without `GEMINI_API_KEY`

UI should keep workspace state and show actionable inline errors per operation.
