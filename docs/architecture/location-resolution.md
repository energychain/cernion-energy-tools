# Location Resolution Module

**File:** `src/location-resolution.js`

Provides generic, I/O-free location extraction and VNB/market-partner role classification
for Personal Agent, L3 Broker, Consultation-to-Execution Bridge, and future OSM/MaStR
prechecks.

## Motivation

Before this module, the agent could not reliably extract `74889 Sinsheim` from a free-text
message like:

> "Ich bin Bürgermeister von 74889 Sinsheim und soll einschätzen, ob Rechenzentrum,
> PV, BESS und Ladepark angesiedelt werden können."

The BESS_SCREENING evidence gate would report `location_missing` even though a valid
Gemeinde/PLZ was present, forcing the agent into generic advisory mode with no tool calls.

## Precision Ladder

| Precision | When | Sufficient for |
|-----------|------|----------------|
| `site_resolved` | GPS coordinates or street address | Site-specific OSM/grid analysis |
| `municipality_resolved` | PLZ and/or Gemeinde | **Communal pre-check, VNB candidate lookup** |
| `region_resolved` | Bundesland/Region only | Regional overviews |
| `unknown` | No location info | Ask user |

`municipality_resolved` is the key level: it is **sufficient for a communal pre-check**
and VNB candidate lookup, but NOT for a binding Netzanschlusszusage or exact OSM/MaStR
analysis.

## Market-Partner Role Classification

`classifyMarketPartnerRole(name)` prevents Stadtwerk ≠ VNB confusion:

| Name | Role | Note |
|------|------|------|
| `Netze BW GmbH` | `vnb` | Authoritative distribution network operator |
| `Bayernwerk Netz GmbH` | `vnb` | |
| `Stadtwerke Sinsheim GmbH` | `stadtwerk` | May own a VNB subsidiary — check separately |
| `Stadtwerke Karlsruhe Netz GmbH` | `stadtwerk` | Netz-Tochter — VNB-Status separat prüfen |
| `Grundversorger Region X` | `lieferant` | Explicitly NOT a VNB |
| `Stromlieferant Y` | `lieferant` | |
| `Grundzuständiger MSB AG` | `messstellenbetreiber` | |

## How It Integrates

### Personal Agent Service (`services/personal-agent.service.js`)

Before receipt selection, the service now extracts location from the **current turn
message** and the **session history**, then merges the result into `brokerKnownContext`:

```
resolveLocationFromText(ctx.params.message) → buildLocationContextPatch(resolved)
  → brokerKnownContext.postalCode, .municipality, .city, .location, ...
  → brokerKnownContext._locationResolutionTrace (for agentTrace)
```

The trace is exposed in `agentTrace.locationResolution` so DevOps/tools can verify:
- which postal code / municipality was recognised
- how confident the extraction is
- whether site coordinates are still missing
- which evidence fields drove the extraction

### Consultation Bridge (`src/consultation-execution-bridge.js`)

The `BESS_SCREENING` evidence gate now distinguishes two cases:

| Situation | Old gate | New gate | `required` |
|-----------|----------|----------|-----------|
| No location at all | `location_missing` | `location_missing` | `true` (blocks) |
| PLZ/Gemeinde present, no coordinates | `location_missing` (wrong!) | `site_coordinates_missing` | `false` (advisory) |
| Coordinates present | `location_missing` (wrong!) | — no gate — | n/a |

This means `74889 Sinsheim` no longer blocks the BESS pre-check execution.

## Example: `74889 Sinsheim`

```javascript
const { resolveLocationFromText, buildLocationContextPatch } = require('./location-resolution');

const msg = 'Ich bin Bürgermeister von 74889 Sinsheim und soll einschätzen, ob BESS möglich ist.';
const resolved = resolveLocationFromText(msg);
// → {
//   postalCode: '74889',
//   municipality: 'Sinsheim',
//   precision: 'municipality_resolved',
//   municipalityResolved: true,
//   siteCoordinatesMissing: true,
//   locationConfidence: 0.98,
//   ...
// }

const patch = buildLocationContextPatch(resolved);
// → { postalCode: '74889', postleitzahl: '74889', municipality: 'Sinsheim',
//     city: 'Sinsheim', location: 'Sinsheim' }
```

## Limitations

- No authoritative VNB assignment from PLZ/Gemeinde alone. A candidate can be suggested
  via `grid-operations.marketPartners`, but the result must be shown with uncertainty.
- City-states (Berlin, Hamburg, Bremen) are NOT recognized as states by `extractState()`
  to avoid false positives in city names.
- Coordinates are sanity-checked against the rough Germany bounding box (lat 47–56, lon 5–16).

## Blueprint Integration (future: `municipal-energy-site-precheck-v1`)

Once this module exists, the blueprint can reference it as a pre-step:

```json
{
  "id": "municipal-energy-site-precheck-v1",
  "inputs": {
    "postalCode": { "resolveStrategy": { "method": "location_resolution" } },
    "municipality": { "resolveStrategy": { "method": "location_resolution" } }
  }
}
```

The blueprint then orchestrates location resolution → VNB candidate → OSM pre-check →
MaStR context without requiring the user to pre-format their location.
