---
name: cluster-69
description: "Skill for the Cluster_69 area of cernion-energy-tools. 8 symbols across 1 files."
---

# Cluster_69

8 symbols | 1 files | Cohesion: 94%

## When to Use

- Working with code in `src/`
- Understanding how parsePdfBufferToText, parsePdfToText, normalizePowerToKw work
- Modifying cluster_69-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/znp-pdf-extractor.js` | parsePdfBufferToText, parsePdfToText, normalizePowerToKw, extractLayer2CalibrationFromText, extractLayer2CalibrationFromBuffer (+3) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `parsePdfBufferToText` | Function | `src/znp-pdf-extractor.js` | 65 |
| `parsePdfToText` | Function | `src/znp-pdf-extractor.js` | 77 |
| `normalizePowerToKw` | Function | `src/znp-pdf-extractor.js` | 82 |
| `extractLayer2CalibrationFromText` | Function | `src/znp-pdf-extractor.js` | 115 |
| `extractLayer2CalibrationFromBuffer` | Function | `src/znp-pdf-extractor.js` | 176 |
| `extractLayer2CalibrationFromFile` | Function | `src/znp-pdf-extractor.js` | 181 |
| `extractPeakLoadFromText` | Function | `src/znp-pdf-extractor.js` | 186 |
| `extractPeakLoadFromFile` | Function | `src/znp-pdf-extractor.js` | 191 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ExtractPeakLoadFromFile → RequireApiKey` | cross_community | 6 |
| `ExtractLayer2CalibrationFromBuffer → RequireApiKey` | cross_community | 5 |
| `ExtractPeakLoadFromText → RequireApiKey` | cross_community | 5 |
| `ExtractPeakLoadFromFile → ScrubPromptText` | cross_community | 5 |
| `ExtractLayer2CalibrationFromBuffer → ScrubPromptText` | cross_community | 4 |
| `ExtractPeakLoadFromText → ScrubPromptText` | cross_community | 4 |
| `ExtractPeakLoadFromFile → ParsePdfBufferToText` | intra_community | 4 |
| `ExtractPeakLoadFromFile → NormalizePowerToKw` | intra_community | 4 |
| `ExtractLayer2CalibrationFromBuffer → NormalizePowerToKw` | intra_community | 3 |
| `ExtractPeakLoadFromText → NormalizePowerToKw` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 1 calls |

## How to Explore

1. `gitnexus_context({name: "parsePdfBufferToText"})` — see callers and callees
2. `gitnexus_query({query: "cluster_69"})` — find related execution flows
3. Read key files listed above for implementation details
