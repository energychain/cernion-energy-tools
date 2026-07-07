# UI Contract: Token Management Page

> **Page ID:** `auth`
> **Version:** 0.63.13
> **Last updated:** 2026-06-29

---

## API Endpoints

| Method   | URL                  | Purpose                                   |
| -------- | -------------------- | ----------------------------------------- |
| `GET`    | `/api/tokens`        | List all tokens (names only — no secrets) |
| `POST`   | `/api/tokens`        | Create a new tenant/user-bound token      |
| `DELETE` | `/api/tokens/:id`    | Revoke a token                            |
| `POST`   | `/api/tokens/verify` | Verify the calling token (self-check)     |

> **Security note:** Token secrets (`ck_` prefix) are never returned after creation.
> The `GET /api/tokens` endpoint returns only non-secret metadata such as `id`, `name`, `scope`, `tenantId`, `userId`, `legacy`, `createdAt`, `lastUsedAt`.
> The `POST /api/tokens` response is the **only** time the token secret is shown.
> Bootstrap/support provisioning uses local CLI commands guarded by `CERNION_SUPPORT_TOKEN`; that secret is not a `ck_` token and is not exposed in the token-management UI.

---

## Token Shape (list)

```json
[
  {
    "id": "tok_abc123",
    "name": "Dashboard frontend",
    "scope": "read-only",
    "tenantId": "public",
    "userId": "svc:dashboard",
    "legacy": false,
    "createdAt": "2026-01-15T00:00:00Z",
    "lastUsedAt": "2026-03-31T11:55:00Z"
  }
]
```

## Token Creation Response (one-time)

```json
{
  "id": "tok_abc123",
  "name": "Dashboard frontend",
  "scope": "read-only",
  "tenantId": "public",
  "userId": "svc:dashboard",
  "legacy": false,
  "token": "ck_abcdef1234567890...",
  "createdAt": "2026-03-31T12:00:00Z"
}
```

---

## UI Elements

### Token List Table

| Column      | Source       | Format                                     |
| ----------- | ------------ | ------------------------------------------ |
| Name        | `name`       | —                                          |
| Scope badge | `scope`      | `read-only` → blue, `full-access` → orange |
| Created     | `createdAt`  | `dd.MM.yyyy`                               |
| Last used   | `lastUsedAt` | Relative time; "Never" if null             |
| Actions     | —            | 🗑 Revoke                                  |

### Create Token Drawer

Fields:

- **Name**: text input (required, max 100 chars)
- **Tenant ID**: text input (required)
- **User ID / Service Account**: text input (required)
- **Scope**: radio buttons — `read-only` / `full-access`

After creation: show **one-time reveal** modal:

```
Token created! Copy it now — it will not be shown again.

ck_abcdef1234567890...  [📋 Copy]

[ I have copied the token ]
```

### Self-Verify Section

"Verify my token" button → POST `/api/tokens/verify` → shows:

- ✓ "Token gültig — Scope: read-only"
- ✗ "Token ungültig oder abgelaufen"

---

## Interactions

- **Copy token**: single click → clipboard + toast "Token kopiert".
- **Revoke**: confirmation "Token unwiderruflich löschen?" → DELETE → row removed.
- **One-time reveal**: "I have copied the token" button closes modal; re-opening shows only masked ID.

---

## Edge Cases

| Scenario                   | Behaviour                                                             |
| -------------------------- | --------------------------------------------------------------------- |
| Token list empty           | "Noch kein Token erstellt" + "Token erstellen" CTA                    |
| Duplicate name on create   | Inline error: "Ein Token mit diesem Namen existiert bereits"          |
| Missing tenantId/userId    | Inline error from API validation; token is not created                |
| Legacy token               | Show `legacy` badge and sunset hint: `Sunset: 2026-12-31 23:59:59 GMT` |
| Revoke own token           | Warning: "Du widerrufst deinen aktuellen Token — du wirst ausgeloggt" |
| Full-access scope creation | Additional confirmation: "Full-Access gibt vollen Schreibzugriff"     |

---

## Änderungen seit letzter Version

### v0.63.13 — Legacy/global Admin Token Sunset und Support-Runbook

Issue #252 definiert den Product Cut fuer legacy `ck_` Tokens ohne `tenantId`/`userId`: sie bleiben bis `2026-12-31 23:59:59 GMT` kompatibel, werden aber als `legacy: true` angezeigt und muessen durch tenant-/user-gebundene Tokens ersetzt werden. Die UI erzeugt weiterhin keine ungebundenen Tokens und soll legacy/global Tokens nicht als Zielzustand bewerben.

Bootstrap-/Support-Provisionierung bleibt lokal. Runbooks sollen das Support-Secret ueber Environment/TTY-Eingabe fuehren und nicht als `--support-token "<secret>"` in Befehle schreiben:

```bash
export CERNION_SUPPORT_TOKEN="$(op read 'op://Cernion/Support Token/credential')"
read -rs CERNION_SUPPORT_TOKEN_INPUT
export CERNION_SUPPORT_TOKEN_INPUT
npm run token:create -- --tenant public --user svc:chat-ui --scope full-access --name "Chat UI"
unset CERNION_SUPPORT_TOKEN_INPUT CERNION_SUPPORT_TOKEN
```

### v0.63.12 — tenantId/userId Pflicht und Support-Bootstrap

Neue Tokens muessen ueber `tenantId` und `userId` bzw. Service-Account gebunden sein. Auth-lose Token-Management-Requests werden am Gateway abgelehnt. Tenant-/User-/Initialtoken-Provisionierung fuer Bootstrap und Break-Glass erfolgt nicht ueber die UI, sondern lokal:

```bash
npm run tenant:create -- --tenant public --name "Public Tenant"
npm run user:create -- --tenant public --user svc:chat-ui --email bootstrap@example.org
npm run token:create -- --tenant public --user svc:chat-ui --scope full-access --name "Chat UI"
```

`CERNION_SUPPORT_TOKEN` ist kein API-Token und darf im UI nicht angezeigt, eingegeben, gespeichert oder rotiert werden.

### v0.38.0 — tenantId-Unterstützung im Token Manager

Der Token Manager unterstützt jetzt optionale Tenant-Isolation.

**Neues Feld `tenantId` beim Token-Erstellen (`POST /api/tokens`):**

```json
{
  "name": "ui-prod-stromdao",
  "scope": "full-access",
  "tenantId": "stromdao-netze"
}
```

- `tenantId`: optional, Format `/^[a-z0-9-]{1,64}$/`, max. 64 Zeichen
- Wird als Klartext im Token-Record gespeichert
- Nicht gesetzt → Default-Tenant (`"default"`) — identisches Verhalten wie vor v0.38.0

**`tenantId` in Token-Verify-Response:**

Die `verify`-Action gibt jetzt `tenantId: string | null` zurück:

```json
{
  "valid": true,
  "scope": "full-access",
  "tenantId": "stromdao-netze"
}
```

`tenantId: null` wenn im Token nicht gesetzt.

**Neuer Endpoint `GET /api/tokens/tenants` (`token-manager.tenant.list`):**

- Listet alle bekannten (unique) `tenantId`s aus gespeicherten Tokens
- Erfordert `full-access`-Token
- Response: `{ "tenants": ["stromdao-netze", "wsw", "default"], "total": 3 }`

**API Gateway — automatische `ctx.meta.tenantId`-Propagation:**

Nach erfolgreicher Token-Verifikation wird `ctx.meta.tenantId` aus dem Token
in alle Downstream-Requests propagiert. Services können `getTenantId(ctx)` aus
`src/tenant-context.js` nutzen, um Namespace-Isolation durchzuführen.

> **Hinweis:** Namespace-Isolation ist in v0.38.0 als PoC in `cya.*`-Profile-Actions
> implementiert. Weitere Services folgen in späteren Versionen.
