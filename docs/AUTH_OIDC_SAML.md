# AUTH OIDC/SAML (Issue 17)

Status: Foundation in v0.48.0

## Zielbild

Mandanten sollen zwischen `token`, `oidc` und `saml` wechseln können. In v0.48.0 ist die Session/RBAC-Basis umgesetzt (`csess_*`), inklusive Backward-Compat für `ck_*`.

## Tenant-Konfiguration (Zielschema)

```json
{
  "method": "oidc|saml|token",
  "issuer": "https://login.stadtwerk.de/realms/cernion",
  "clientId": "...",
  "clientSecretRef": "secret://...",
  "groupClaim": "groups",
  "groupRoleMap": {
    "cernion-admin": "full-access",
    "cernion-approver": "hitl-approver",
    "cernion-viewer": "read-only"
  }
}
```

## Endpunkte

- `GET /api/auth/oidc/login`
- `GET /api/auth/oidc/callback`
- `POST /api/auth/saml/acs`
- `POST /api/auth/verify`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

## Rollenmodell (Baseline)

- `read-only`
- `full-access`
- `hitl-approver`
- `tenant-admin` (Folgeschritt)
- `cross-tenant-admin` (Folgeschritt)

Regeln v0.48.0:

- Write-Endpunkte benötigen `full-access`.
- `POST /api/hitl/items/:id/approve` und `POST /api/hitl/items/bulk-approve` benötigen `hitl-approver`.
- Legacy `ck_` + `full-access` wird im Übergang auf Rollen `full-access` + `hitl-approver` gemappt.

## Beispiele IdP-Konfiguration

### Azure AD (OIDC)

```bash
AUTH_OIDC_ISSUER="https://login.microsoftonline.com/<tenant-id>/v2.0"
AUTH_OIDC_CLIENT_ID="<client-id>"
AUTH_OIDC_AUTHORIZATION_ENDPOINT="https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize"
AUTH_OIDC_REDIRECT_URI="https://api.example.com/api/auth/oidc/callback"
AUTH_OIDC_SCOPE="openid profile email"
```

### Keycloak (OIDC)

```bash
AUTH_OIDC_ISSUER="https://keycloak.example.com/realms/cernion"
AUTH_OIDC_CLIENT_ID="cernion-energy-tools"
AUTH_OIDC_AUTHORIZATION_ENDPOINT="https://keycloak.example.com/realms/cernion/protocol/openid-connect/auth"
AUTH_OIDC_REDIRECT_URI="https://api.example.com/api/auth/oidc/callback"
AUTH_OIDC_SCOPE="openid profile email groups"
```

### ADFS (SAML)

```bash
AUTH_SAML_ENTRY_POINT="https://adfs.example.com/adfs/ls/"
AUTH_SAML_ISSUER="urn:cernion:energy-tools"
AUTH_SAML_CALLBACK_URL="https://api.example.com/api/auth/saml/acs"
AUTH_SAML_CERT="-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----"
```

## Backward-Compatibility

`ck_`-Tokens bleiben parallel aktiv (Übergangszeitraum 6 Monate). Antworten bei `ck_`-Authentifizierung enthalten:

- `Deprecation: true`
- `Sunset: <http-date>`

## Audit-Trail

HITL-Interventions speichern zusätzlich:

- `userId`
- `groups[]`
- `idpClaims`

## Phase 2 (v0.48.x+)

Geplante Härtung:

- OIDC mit `openid-client` (Discovery, PKCE, ID-Token-Validierung)
- SAML mit `passport-saml` (Signaturprüfung, Metadata)
- Tenant-spezifische IdP-Konfiguration via Object Store (`tenant:{id}:auth_config`)
- E2E-Container-Tests gegen Keycloak und simplesamlphp
