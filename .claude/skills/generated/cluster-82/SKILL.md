---
name: cluster-82
description: "Skill for the Cluster_82 area of cernion-energy-tools. 9 symbols across 2 files."
---

# Cluster_82

9 symbols | 2 files | Cohesion: 94%

## When to Use

- Working with code in `src/`
- Understanding how resolveSourceMeta, collectUniqueLicenses, inferFieldType work
- Modifying cluster_82-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/oemetadata-builder.js` | inferFieldType, extractSpatialName, buildSpatial, buildTemporal, buildFields (+2) |
| `src/source-license-map.js` | resolveSourceMeta, collectUniqueLicenses |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `resolveSourceMeta` | Function | `src/source-license-map.js` | 219 |
| `collectUniqueLicenses` | Function | `src/source-license-map.js` | 250 |
| `inferFieldType` | Function | `src/oemetadata-builder.js` | 48 |
| `extractSpatialName` | Function | `src/oemetadata-builder.js` | 116 |
| `buildSpatial` | Function | `src/oemetadata-builder.js` | 134 |
| `buildTemporal` | Function | `src/oemetadata-builder.js` | 158 |
| `buildFields` | Function | `src/oemetadata-builder.js` | 186 |
| `buildSources` | Function | `src/oemetadata-builder.js` | 218 |
| `buildOEMetadata` | Function | `src/oemetadata-builder.js` | 269 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `BuildOEMetadata → ForDomain` | cross_community | 4 |
| `BuildOEMetadata → ByIri` | cross_community | 4 |
| `BuildOEMetadata → InferFieldType` | intra_community | 3 |
| `BuildOEMetadata → ResolveSourceMeta` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_100 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "resolveSourceMeta"})` — see callers and callees
2. `gitnexus_query({query: "cluster_82"})` — find related execution flows
3. Read key files listed above for implementation details
