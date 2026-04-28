---
name: cluster-95
description: "Skill for the Cluster_95 area of cernion-energy-tools. 9 symbols across 2 files."
---

# Cluster_95

9 symbols | 2 files | Cohesion: 94%

## When to Use

- Working with code in `src/`
- Understanding how matchesAny, isSensitiveField, pseudonymise work
- Modifying cluster_95-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/prompt-scrubber.js` | matchesAny, isSensitiveField, pseudonymise, scrubForLLM, shouldMask (+2) |
| `src/cya-synthesis.js` | buildPrompt, synthesizeNarrative |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `matchesAny` | Function | `src/prompt-scrubber.js` | 80 |
| `isSensitiveField` | Function | `src/prompt-scrubber.js` | 88 |
| `pseudonymise` | Function | `src/prompt-scrubber.js` | 97 |
| `scrubForLLM` | Function | `src/prompt-scrubber.js` | 122 |
| `shouldMask` | Function | `src/prompt-scrubber.js` | 132 |
| `scrubValue` | Function | `src/prompt-scrubber.js` | 139 |
| `scrubObject` | Function | `src/prompt-scrubber.js` | 158 |
| `buildPrompt` | Function | `src/cya-synthesis.js` | 26 |
| `synthesizeNarrative` | Function | `src/cya-synthesis.js` | 73 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `SynthesizeNarrative → MatchesAny` | intra_community | 8 |
| `SynthesizeNarrative → Pseudonymise` | intra_community | 6 |
| `SynthesizeNarrative → RequireApiKey` | cross_community | 4 |
| `SynthesizeNarrative → ScrubPromptText` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 1 calls |

## How to Explore

1. `gitnexus_context({name: "matchesAny"})` — see callers and callees
2. `gitnexus_query({query: "cluster_95"})` — find related execution flows
3. Read key files listed above for implementation details
