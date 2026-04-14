# UI Contract: Cookbook API

> **Page ID:** `cookbook`
> **Version:** 0.25.0
> **Last updated:** 2026-04-14

---

## Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `GET` | `/api/cookbook` | List recipes (filters: `domain`, `tag`, `status`) |
| `GET` | `/api/cookbook/:id` | Get one recipe by ID |
| `POST` | `/api/cookbook/search` | Semantic recipe search |
| `POST` | `/api/cookbook/validate` | Force runtime validation |
| `GET` | `/api/cookbook/health` | Health + validation summary |
| `GET` | `/api/cookbook/services` | Live REST action catalogue |

---

## List recipes

`GET /api/cookbook?domain=grid-operations&tag=mastr&status=valid`

```json
{
  "success": true,
  "data": [
    {
      "id": "vnb-assets-from-name",
      "title": "Find VNB and list MaStR assets",
      "domain": "grid-operations",
      "tags": ["mastr", "vnb"],
      "relatedRecipes": ["redispatch-risk-check"],
      "status": "valid",
      "validation": { "errors": [], "warnings": [] }
    }
  ],
  "metadata": {
    "count": 1,
    "lastValidatedAt": "2026-04-14T10:00:00.000Z",
    "validationSummary": { "total": 25, "valid": 24, "degraded": 1, "broken": 0, "deprecated": 0 }
  }
}
```

---

## Search recipes

`POST /api/cookbook/search`

```json
{
  "query": "How do I look up a grid operator and list MaStR assets?",
  "limit": 5,
  "includeBroken": false
}
```

```json
{
  "success": true,
  "data": [
    {
      "id": "vnb-assets-from-name",
      "score": 0.91,
      "matchType": "hybrid",
      "recipe": {
        "id": "vnb-assets-from-name",
        "title": "Find VNB and list MaStR assets",
        "status": "valid"
      }
    }
  ],
  "metadata": {
    "model": "gemini-embedding-001",
    "lastValidatedAt": "2026-04-14T10:00:00.000Z"
  }
}
```

---

## Validate recipes

`POST /api/cookbook/validate`

```json
{}
```

```json
{
  "success": true,
  "data": {
    "total": 25,
    "valid": 24,
    "degraded": 1,
    "broken": 0,
    "deprecated": 0,
    "validatedAt": "2026-04-14T10:05:00.000Z"
  }
}
```

---

## Additional UI calls

### `GET /api/cookbook/:id`

Single recipe detail response:

```json
{ "success": true, "data": { "id": "vnb-assets-from-name", "title": "...", "process": [] } }
```

### `GET /api/cookbook/health`

Service summary for status badge/card.

### `GET /api/cookbook/services`

Returns live action registry for recipe generator/editor assist UI.

---

## Error contract

- `404 COOKBOOK_RECIPE_NOT_FOUND` on unknown `:id`
- `422 VALIDATION_ERROR` for malformed request payloads

UI should keep current result set and show inline form validation errors.
