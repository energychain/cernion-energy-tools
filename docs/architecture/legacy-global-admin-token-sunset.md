# Legacy/Global Admin Token Sunset Decision

**Issue:** #252  
**Status:** Product cut, no runtime restriction in this slice  
**Decision date:** 2026-06-29  
**Runtime sunset header:** `Sunset: Wed, 31 Dec 2026 23:59:59 GMT`

## Decision

Legacy `ck_` API tokens that predate tenant/user binding remain valid during the transition window, including legacy `full-access` tokens. They are compatibility-only credentials and must not be minted again.

The accepted policy is:

- New `ck_` tokens must always carry `tenantId` and `userId`.
- Existing tenant-neutral/global `ck_` tokens keep their current scope until the published sunset date.
- All `ck_` API-token responses continue to emit deprecation headers.
- Legacy records without `tenantId` or `userId` are surfaced as `legacy: true` in token list/verify responses.
- No automatic scope downgrade is introduced in this slice.
- No public HTTP support-token endpoint will be added.

## Threat Model

Legacy/global admin tokens are high-risk because they are not attributable to a tenant/user principal. For `full-access` tokens this means a stolen token can mutate administrative surfaces without a tenant boundary and with weak human attribution.

The main risks are:

- cross-tenant administrative use where a tenant-bound principal would now be rejected;
- insufficient audit attribution for write/HITL/admin activity;
- long-lived service integrations that silently keep privileged access;
- accidental support-secret exposure through command history, process arguments, logs, tickets, or shared runbooks.

The current compatibility behavior is acceptable only as a time-limited bridge because newer token creation already rejects unbound tokens and gateway responses already warn callers through `Deprecation` and `Sunset`.

## Migration Plan

1. Inventory all token records where `legacy: true`, especially `scope: full-access`.
2. For each active integration, create a replacement token with an explicit tenant and user/service account.
3. Rotate consumers to the bound replacement token and verify the old token's `lastUsedAt` stops changing.
4. Revoke old legacy tokens before 2026-12-31.
5. After the sunset date, implement an explicit runtime restriction or rejection policy with token-manager/API tests.

## Support-Token Runbook

`CERNION_SUPPORT_TOKEN` is a local bootstrap secret, not a `ck_` API token. It must not be entered in URLs, HTTP requests, UI forms, shell-history-bearing command arguments, tickets, or logs.

Preferred local flow:

```bash
export CERNION_SUPPORT_TOKEN="$(op read 'op://Cernion/Support Token/credential')"
read -rs CERNION_SUPPORT_TOKEN_INPUT
export CERNION_SUPPORT_TOKEN_INPUT

npm run tenant:create -- --tenant public --name "Public Tenant"
npm run user:create -- --tenant public --user svc:chat-ui --email bootstrap@example.org
npm run token:create -- --tenant public --user svc:chat-ui --scope full-access --name "Chat UI"
unset CERNION_SUPPORT_TOKEN_INPUT CERNION_SUPPORT_TOKEN
```

The legacy `--support-token` argument remains accepted for backward compatibility, but operators should avoid it because command-line arguments can be captured in shell history and process listings.

## Follow-Up Cut

Runtime hardening after migration should be a separate security change with tests. Candidate behavior:

- reject legacy `full-access` tokens after the sunset date;
- allow legacy read-only tokens only for low-risk read paths for one additional grace window;
- add explicit error codes and tests for post-sunset legacy-token rejection;
- preserve no-public-endpoint support-token posture.
