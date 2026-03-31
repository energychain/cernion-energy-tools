# UI Contract: Finding Codes Reference

> **Page ID:** `finding-codes`
> **Version:** 0.19.0
> **Last updated:** 2026-03-31

---

## Primary API Endpoint

```
GET /api/dashboard/finding-codes
```

**Cache TTL:** 24 hours (static data — changes only on service restart)
**Expected latency:** < 100 ms (no upstream calls, served from in-memory map)
**Auth:** Bearer token (read-only scope sufficient)

---

## Response Shape

```json
{
  "codes": {
    "GO_DIRECT": {
      "severity":      "info",
      "agent":         "grid-connection",
      "step":          5,
      "description":   "Grid connection approved without conditions",
      "descriptionDe": "Netzanschluss ohne Auflagen genehmigt"
    },
    "MQ_ZERO_CAPACITY": {
      "severity":      "error",
      "agent":         "mastr-quality",
      "step":          4,
      "description":   "Gross capacity (Bruttoleistung) is zero",
      "descriptionDe": "Bruttoleistung = 0"
    }
  },
  "agents": {
    "grid-connection": {
      "label":         "Netzanschluss-Validierung",
      "version":       "0.14.0",
      "steps":         6,
      "pouchdbPrefix": "val:",
      "endpoint":      "POST /api/grid-connection/validate"
    },
    "energy-sharing": {
      "label":         "Energy Sharing Validierung",
      "version":       "0.15.0",
      "steps":         6,
      "pouchdbPrefix": "es:",
      "endpoint":      "POST /api/energy-sharing/validate"
    },
    "mastr-quality": {
      "label":         "MaStR Datenqualität",
      "version":       "0.17.0",
      "steps":         8,
      "pouchdbPrefix": "mq:",
      "endpoint":      "POST /api/mastr-quality/audit"
    },
    "redispatch-expost": {
      "label":         "Redispatch Ex-Post",
      "version":       "0.18.0",
      "steps":         7,
      "pouchdbPrefix": "rd:",
      "endpoint":      "POST /api/redispatch/audit"
    }
  },
  "totalCodes": 92
}
```

---

## UI Elements

### Finding Codes Reference Table

Use `codes` map to build a searchable, filterable reference table:

| Column | Source | Format |
|--------|--------|--------|
| Code | `codes` key | `MQ_ZERO_CAPACITY` — monospace |
| Severity chip | `codes[key].severity` | Chip: error=red, warning=yellow, info=blue |
| Agent badge | `codes[key].agent` | `mastr-quality` — small badge |
| Step | `codes[key].step` | Integer, right-aligned |
| Description | `codes[key].description` | English |
| Description (DE) | `codes[key].descriptionDe` | German — show in secondary row or on hover |

### Filter Controls

- **Severity filter**: checkbox group — error / warning / info
- **Agent filter**: dropdown — all agents from `agents` catalogue
- **Step filter**: number range 1–8
- **Text search**: searches `code`, `description`, `descriptionDe`

### Agent Catalogue Section

Display `agents` map as 4 info cards:

| Card field | Source |
|-----------|--------|
| Label | `agents[key].label` |
| Version | `agents[key].version` — badge |
| Steps | `agents[key].steps` — "N-step pipeline" |
| PouchDB prefix | `agents[key].pouchdbPrefix` — code font |
| Endpoint | `agents[key].endpoint` — link |
| Code count | Count of `codes` entries where `agent === key` |

---

## Usage as Tooltip Source

Finding codes are referenced throughout the UI wherever a finding code appears
(in audit reports, quality summaries, alert lists). The UI SHOULD cache this
endpoint response in memory for the session and use it to:

1. Render severity chip colour for each finding code
2. Render the English or German description as a tooltip on hover
3. Provide a "view in reference" link for full details

---

## Interactions

- **Sort**: by severity (error→warning→info), by agent, by step, or alphabetically
- **Export CSV**: download `finding-codes.csv` from `codes` map (browser-side only)
- **Copy code**: click code → copy to clipboard

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| `totalCodes` !== 92 | Show yellow warning banner: "Finding code catalogue may be outdated" |
| Unknown code in audit | Show `???` chip with tooltip "Unknown code — contact support" |
| `descriptionDe` missing | Fall back to `description` |
| API error | Use stale cached version (24h TTL); show "Cached data" label |
