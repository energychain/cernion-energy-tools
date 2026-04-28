---
name: cluster-113
description: "Skill for the Cluster_113 area of cernion-energy-tools. 13 symbols across 1 files."
---

# Cluster_113

13 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `src/`
- Understanding how isSmtpConfigured, assertSmtpConfigured, buildSmtpConfig work
- Modifying cluster_113-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/mastr-monitor-notify.js` | isSmtpConfigured, assertSmtpConfigured, buildSmtpConfig, createTransport, baseUrl (+8) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `isSmtpConfigured` | Function | `src/mastr-monitor-notify.js` | 12 |
| `assertSmtpConfigured` | Function | `src/mastr-monitor-notify.js` | 16 |
| `buildSmtpConfig` | Function | `src/mastr-monitor-notify.js` | 25 |
| `createTransport` | Function | `src/mastr-monitor-notify.js` | 37 |
| `baseUrl` | Function | `src/mastr-monitor-notify.js` | 41 |
| `fromAddress` | Function | `src/mastr-monitor-notify.js` | 45 |
| `maxDetailItems` | Function | `src/mastr-monitor-notify.js` | 49 |
| `buildDeltaSection` | Function | `src/mastr-monitor-notify.js` | 56 |
| `buildDeltaBody` | Function | `src/mastr-monitor-notify.js` | 86 |
| `buildDeltaSubject` | Function | `src/mastr-monitor-notify.js` | 139 |
| `sendDeltaNotification` | Function | `src/mastr-monitor-notify.js` | 161 |
| `sendConfirmationEmail` | Function | `src/mastr-monitor-notify.js` | 182 |
| `sendNoChangesNotification` | Function | `src/mastr-monitor-notify.js` | 223 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `SendDeltaNotification → IsSmtpConfigured` | intra_community | 3 |
| `SendDeltaNotification → BuildSmtpConfig` | intra_community | 3 |
| `SendConfirmationEmail → IsSmtpConfigured` | intra_community | 3 |
| `SendConfirmationEmail → BuildSmtpConfig` | intra_community | 3 |
| `SendNoChangesNotification → IsSmtpConfigured` | intra_community | 3 |
| `SendNoChangesNotification → BuildSmtpConfig` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "isSmtpConfigured"})` — see callers and callees
2. `gitnexus_query({query: "cluster_113"})` — find related execution flows
3. Read key files listed above for implementation details
