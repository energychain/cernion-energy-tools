---
name: cluster-89
description: "Skill for the Cluster_89 area of cernion-energy-tools. 48 symbols across 1 files."
---

# Cluster_89

48 symbols | 1 files | Cohesion: 99%

## When to Use

- Working with code in `src/`
- Understanding how escapeHtml, fmtNum, fmtPct work
- Modifying cluster_89-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/report-builder.js` | escapeHtml, fmtNum, fmtPct, fmtMw, fmtKwp (+43) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `escapeHtml` | Function | `src/report-builder.js` | 18 |
| `fmtNum` | Function | `src/report-builder.js` | 26 |
| `fmtPct` | Function | `src/report-builder.js` | 31 |
| `fmtMw` | Function | `src/report-builder.js` | 36 |
| `fmtKwp` | Function | `src/report-builder.js` | 41 |
| `getVal` | Function | `src/report-builder.js` | 46 |
| `safeData` | Function | `src/report-builder.js` | 53 |
| `extractEwkJson` | Function | `src/report-builder.js` | 67 |
| `isAvail` | Function | `src/report-builder.js` | 83 |
| `typLabel` | Function | `src/report-builder.js` | 90 |
| `spannungLabel` | Function | `src/report-builder.js` | 111 |
| `pruefungStatusInfo` | Function | `src/report-builder.js` | 122 |
| `renderMaStrTable` | Function | `src/report-builder.js` | 149 |
| `parseMaStrLocalStats` | Function | `src/report-builder.js` | 232 |
| `asNumber` | Function | `src/report-builder.js` | 384 |
| `asPercent` | Function | `src/report-builder.js` | 389 |
| `fmtEuro` | Function | `src/report-builder.js` | 395 |
| `extractComplianceSignals` | Function | `src/report-builder.js` | 401 |
| `renderSchockerBlocks` | Function | `src/report-builder.js` | 528 |
| `renderChallengeQuestions` | Function | `src/report-builder.js` | 637 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `BuildHtmlReport → SafeData` | intra_community | 4 |
| `BuildHtmlReport → ParseMaStrLocalStats` | intra_community | 4 |
| `BuildHtmlReport → AsNumber` | intra_community | 4 |
| `BuildHtmlReport → ExtractEwkJson` | intra_community | 4 |
| `RenderSection1 → FmtNum` | intra_community | 3 |
| `RenderSection5 → AsNumber` | intra_community | 3 |
| `RenderSection8 → EscapeHtml` | intra_community | 3 |
| `RenderSchockerBlocks → AsNumber` | intra_community | 3 |
| `RenderSchockerBlocks → ExtractEwkJson` | intra_community | 3 |
| `RenderSection4 → EscapeHtml` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 1 calls |
| Cluster_90 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "escapeHtml"})` — see callers and callees
2. `gitnexus_query({query: "cluster_89"})` — find related execution flows
3. Read key files listed above for implementation details
