# UI Contract: Datapoints Management Panel

> **Page ID:** `datapoints`
> **Version:** 0.19.0
> **Last updated:** 2026-03-31

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `GET`    | `/api/datapoints`              | List all datapoints (optional `?tags=solar,stromdao-netze`) |
| `POST`   | `/api/datapoints`              | Create a new datapoint |
| `GET`    | `/api/datapoints/:name`        | Get a datapoint by name |
| `PUT`    | `/api/datapoints/:name`        | Update a datapoint |
| `DELETE` | `/api/datapoints/:name`        | Delete a datapoint |
| `POST`   | `/api/datapoints/:name/refresh`| Trigger a manual refresh |
| `GET`    | `/api/datapoints/health`       | Get health overview |
| `POST`   | `/api/datapoints/snapshot`     | Create a snapshot |
| `GET`    | `/api/datapoints/snapshots`    | List snapshots |
| `GET`    | `/api/datapoints/snapshots/:id`| Get a snapshot |
| `DELETE` | `/api/datapoints/snapshots/:id`| Delete a snapshot |

---

## Datapoint Shape

```json
{
  "name":            "solar-assets-stromdao",
  "description":     "Solar installations for STROMDAO Netze GmbH",
  "source":          "mastr",
  "tags":            ["solar", "stromdao-netze"],
  "schedule":        "0 */6 * * *",
  "lastRefreshed":   "2026-03-31T06:00:00Z",
  "status":          "healthy",
  "provenanceHash":  "sha256:abc123...",
  "createdAt":       "2026-01-01T00:00:00Z"
}
```

### `status` values

| Value | Colour | Meaning |
|-------|--------|---------|
| `healthy` | green | Refreshed within expected schedule window |
| `stale`   | yellow | Last refresh older than 1.5× schedule interval |
| `errored` | red | Last refresh failed |
| `pending` | grey | Never refreshed |

---

## UI Elements

### Datapoint List

Table with sortable columns:

| Column | Source | Format |
|--------|--------|--------|
| Name | `name` | Monospace link |
| Description | `description` | Truncated to 60 chars |
| Tags | `tags[]` | Chip list |
| Status | `status` | Status badge |
| Last refreshed | `lastRefreshed` | Relative time (`2h ago`) |
| Schedule | `schedule` | Cron expression with human label |
| Actions | — | ↻ Refresh, ✎ Edit, 🗑 Delete |

### Tag Filter

Chip input above the table: `?tags=solar,stromdao-netze` (AND semantics).
Clear button resets to unfiltered list.

### Health Overview (top of panel)

Three KPI chips sourced from `GET /api/datapoints/health`:

| Chip | Field | Colour |
|------|-------|--------|
| Healthy | `overview.healthy` | green |
| Stale | `overview.stale` | yellow — link to filtered stale list |
| Errored | `overview.errored` | red — link to filtered errored list |

### Snapshots Sub-Section

Collapsible section below the table:

- **Create snapshot**: form with `datapointNames` or `tags` input + "Create" button.
- **Snapshot list**: table with `id`, `createdAt`, `snapshotHash` (truncated), actions (view, validate, delete).
- **Validate snapshot**: calls validate endpoint → shows pass/fail per datapoint.

---

## Interactions

- **Create datapoint**: opens a side drawer with name, description, source, tags, schedule fields.
- **Refresh**: POST to `/api/datapoints/:name/refresh` → shows spinner on row until refresh completes.
- **Delete**: confirmation dialog with "This cannot be undone" warning.
- **Snapshot create**: drawer with datapoint multiselect or tag filter → POST.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Empty list | Show "No datapoints yet" with "Create first datapoint" CTA |
| Name collision on create | Inline error: "A datapoint with this name already exists" |
| Snapshot freshness failure | Warning: "N datapoint(s) are stale — refresh before creating snapshot?" |
| Schedule cron invalid | Live cron expression validator with next-run preview |
