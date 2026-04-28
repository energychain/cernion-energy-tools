---
name: cluster-110
description: "Skill for the Cluster_110 area of cernion-energy-tools. 8 symbols across 1 files."
---

# Cluster_110

8 symbols | 1 files | Cohesion: 88%

## When to Use

- Working with code in `src/`
- Understanding how CernionMCPClient, _sanitizeErrorMessage, _executeCall work
- Modifying cluster_110-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/mcp-client.js` | CernionMCPClient, _sanitizeErrorMessage, _executeCall, connect, callTool (+3) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `CernionMCPClient` | Class | `src/mcp-client.js` | 20 |
| `_sanitizeErrorMessage` | Method | `src/mcp-client.js` | 49 |
| `_executeCall` | Method | `src/mcp-client.js` | 69 |
| `connect` | Method | `src/mcp-client.js` | 94 |
| `callTool` | Method | `src/mcp-client.js` | 152 |
| `pollJobResult` | Method | `src/mcp-client.js` | 274 |
| `listTools` | Method | `src/mcp-client.js` | 396 |
| `disconnect` | Method | `src/mcp-client.js` | 421 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `PollJobUntilComplete → _isQuotaError` | cross_community | 6 |
| `PollJobUntilComplete → _sanitizeErrorMessage` | cross_community | 6 |
| `DiscoverAvailableTools → _isQuotaError` | cross_community | 6 |
| `DiscoverAvailableTools → _sanitizeErrorMessage` | cross_community | 6 |
| `CallWithAutoPoll → _isQuotaError` | cross_community | 5 |
| `CallWithAutoPoll → _sanitizeErrorMessage` | cross_community | 5 |
| `CallWithAutoPoll → CernionMCPClient` | cross_community | 5 |
| `PollJobUntilComplete → Disconnect` | cross_community | 4 |
| `PollJobResult → _isQuotaError` | cross_community | 4 |
| `PollJobResult → _sanitizeErrorMessage` | intra_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 1 calls |

## How to Explore

1. `gitnexus_context({name: "CernionMCPClient"})` — see callers and callees
2. `gitnexus_query({query: "cluster_110"})` — find related execution flows
3. Read key files listed above for implementation details
