# Issue 17 — OIDC / SAML SSO-Adapter

**Bereich:** Security / Auth · **Priorität:** Hoch · **Ziel-Release:** v0.48

## Problem

Heute nur Bearer-Token-Auth (`token-manager`-Service, `ck_`-Token). Multi-Tenant ist seit v0.41 produktiv, aber Authentifizierung erfolgt **nicht über User-Identitäten**, sondern über statische Token. Das führt zu drei Lücken:

1. **Stadtwerke mit Azure AD / Keycloak / ADFS** haben keinen SSO-Pfad. Audit-Anforderungen (z. B. „Wer hat HITL-Item #X approved?") lassen sich nur über Token-Namen rekonstruieren — kein User-Identity-Trail.
2. **HITL-Approver-Rollen** (Issue 12 / v0.44.5) brauchen RBAC, derzeit nur Token-Scope (`full-access` / `read-only`).
3. **Token-Rotation** ist manuell; OIDC-Sessions würden Refresh-Tokens und Auto-Expiry mitbringen.

## Vorschlag

1. **Neues Modul** `src/auth/oidc.js` und `src/auth/saml.js`:
   - OIDC: `openid-client`-basiert
   - SAML: `passport-saml`-basiert
   - Konfig pro Tenant (`tenant:{id}:auth_config`):
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
2. **Auth-Endpoints:**
   - `GET /api/auth/oidc/login?tenantId=...&redirectUri=...`
   - `GET /api/auth/oidc/callback`
   - `POST /api/auth/saml/acs`
   - `POST /api/auth/logout`
3. **Session-Token** ersetzt langlebige `ck_`-Token: `csess_*` mit kurzer Lifetime (z. B. 60 min) + Refresh.
4. **RBAC-Modell:**
   - Rollen: `read-only`, `full-access`, `hitl-approver`, `tenant-admin`, `cross-tenant-admin`
   - `requiresFullAccess` durch Rollen-Check ersetzen.
   - HITL-Approver-Rolle Pflicht für `POST /hitl/items/:id/approve`.
5. **Audit-Trail:**
   - `agent_interventions` und HITL-Items speichern `userId` + `groups[]` + `idpClaims`.
   - Webhook-Event `auth.session.created` und `auth.session.expired`.
6. **Backward-Compat:** Klassische `ck_`-Token bleiben 6 Monate parallel (Deprecated-Header), für API-Integratoren ohne Browser.

## Akzeptanzkriterien

- E2E-Test gegen Keycloak-Container: Login → HITL-Approval → Audit-Trail enthält User+Groups.
- SAML-E2E gegen `simplesamlphp`-Container.
- Tenant-isolierte IdP-Konfig (Tenant A nutzt Azure AD, Tenant B nutzt Keycloak).
- ≥40 Tests (Login, Logout, Refresh, Group-Mapping, Edge-Cases wie abgelaufenes ID-Token).
- `docs/AUTH_OIDC_SAML.md` mit Beispielkonfigurationen für Azure AD, Keycloak, ADFS.

## Bezug

- v0.38.0 — Multi-Tenant-Fundament
- v0.44.5 — HITL First-Class
- Token-Manager-Service bleibt als Service-Token-Verwalter erhalten
