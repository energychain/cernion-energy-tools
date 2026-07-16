# Cernion Open WebUI Deployment & Safety Runbook

This runbook covers how to run the Open WebUI integration safely: a disposable local-only
demo profile, a shared/team profile with auth and RBAC, tool-server registration, session
lifecycle, and a startup smoke checklist. It documents existing boundaries only — it does not
add a deployment stack, a credential, or a behavior change. See `README.md` for adapter start
commands and request/response shapes.

## 1. Local-only demo profile

- `WEBUI_AUTH=False` is acceptable **only** for a disposable, loopback-bound demo on a single
  operator machine. It removes Open WebUI's own login gate; anyone who can reach the port has
  full access.
- Bind Open WebUI and both adapters (`cernion-openapi-tool-server.js`,
  `cernion-process-intake-tool-server.js`) to `127.0.0.1` only. The adapters already default to
  `127.0.0.1` (see `README.md`); do not override `CERNION_OPEN_WEBUI_HOST` /
  `CERNION_PROCESS_INTAKE_HOST` to `0.0.0.0` or a LAN address in this profile.
- **Pre-exposure stop condition:** if you are about to put any of these ports behind `0.0.0.0`,
  a LAN interface, a reverse proxy, a tunnel, or public ingress, stop and switch to the
  shared/team profile (Section 2) first. `WEBUI_AUTH=False` plus network exposure means
  unauthenticated access to Evidence Lookup and Process Intake drafting for anyone on that
  network path.

## 2. Shared/team profile

Before exposing Open WebUI beyond localhost, all of the following must be true:

- **Auth enabled.** `WEBUI_AUTH` must not be `False`. Open WebUI's own account system (or an
  upstream SSO/reverse-proxy auth layer) must gate every request.
- **Named admin ownership.** A specific person, not a shared/anonymous account, owns the Open
  WebUI admin role and is accountable for user and tool-server onboarding/offboarding.
- **Least-privilege groups.** Use Open WebUI's RBAC groups to grant model and tool access per
  team/purpose rather than granting every user every tool by default.
- **Explicit per-tool/model grants.** Evidence Lookup and Process Intake tool servers must be
  enabled per group/user, not globally, and reviewed when group membership changes.
- **Deny-by-default onboarding/offboarding.** New users start with no tool access until
  explicitly granted; removed users lose tool and model access immediately as part of
  offboarding, not on a delayed cleanup pass.
- **TLS and network allowlist.** Anything beyond loopback must sit behind TLS (reverse proxy or
  equivalent) and a network allowlist. Do not put an unauthenticated adapter port directly on a
  public interface.
- **Separate credentials per adapter.** Keep `CERNION_READONLY_TOKEN` (Evidence) and
  `CERNION_PROCESS_TOKEN` (Process Intake) distinct, scoped to their single upstream call each
  (see `README.md` and Section 6), and never shared across adapters or environments.
- **No anonymous access.** Disable any Open WebUI anonymous/guest mode for shared deployments.

## 3. User Tool Server vs Global Tool Server

Open WebUI supports registering an OpenAPI tool server at two levels; they resolve the adapter
URL from different network locations:

- **User (browser) tool server:** registered per-user from the browser's tool-server settings.
  The **browser** on the operator's/user's machine must be able to reach the adapter URL
  directly. A `127.0.0.1:3910` URL only works this way if the browser and the adapter run on
  the same host.
- **Global (backend) tool server:** registered by an admin at the instance/workspace level. The
  **Open WebUI backend container/process** — not the browser — makes the request, so the URL
  must be reachable from wherever that backend runs (e.g. a Docker service/container DNS name
  or an internal host address), which is frequently different from what a browser on the
  operator's laptop can reach.

Do not assume one topology covers both cases. If Open WebUI runs in a container and the
adapters run on the container host, `127.0.0.1` from inside the container does not reach the
host adapters for global registration — use the container's host-reachable address for global
tool servers, and keep browser-facing (user) registration on an address the browser can reach.
Verify each registration independently with the `/health` and `/openapi.json` checks in
Section 7.

## 4. Prefer external tool servers over Workspace Tools

For Cernion integrations, always register the bounded OpenAPI adapters
(`cernion-openapi-tool-server.js`, `cernion-process-intake-tool-server.js`) as external tool
servers rather than pasting equivalent logic into Open WebUI's Workspace Tools (Python code
executed in-process by Open WebUI):

- The adapters expose a narrow, fixed OpenAPI schema (one operation each) instead of arbitrary
  code.
- Each adapter reads its own credential from its own process environment; a Workspace Tool
  would require embedding or referencing the credential inside Open WebUI itself.
- Each adapter has exactly one fixed upstream path (see Section 8) and cannot be edited at
  runtime from the chat UI; Workspace Tools can be edited by anyone with Workspace access.
- Each adapter fails closed and returns structured, auditable responses (`readOnly`,
  `draftOnly`, `notCalled`, etc.); arbitrary Workspace Tool code has no equivalent guarantee.

Never paste Cernion credentials into Workspace Tool code, and do not enable Workspace Tools
that would allow arbitrary Python execution against Cernion endpoints.

## 5. Native Function Calling

Enable Open WebUI's **Native Function Calling** mode for models used with these tool servers so
the model emits structured tool calls instead of freeform text that Open WebUI must parse
heuristically.

- **Model-quality caveat:** not every model reliably supports native function calling with
  correct argument shapes. Verify actual tool-call behavior (correct operation, correct
  arguments) for each model before relying on it in a demo.
- Never treat a model's natural-language claim that it "called" a tool as authorization or
  confirmation. Only a real HTTP request to the adapter (visible in adapter logs/response, or
  in Section 7's smoke checks) counts as a tool call.

## 6. Session and credential lifecycle

- `CERNION_READONLY_TOKEN` and `CERNION_PROCESS_TOKEN` are minted, rotated, and revoked through
  Cernion's existing token management API (`services/token-manager.service.js`: `POST
  /api/tokens` to issue, `DELETE /api/tokens/:id` to revoke, `POST /api/tokens/verify` to check
  validity) — this runbook does not create or broaden any credential.
- Treat both tokens as expiring/renewable, not permanent:
  - **Health/failure symptoms:** `GET /health` on an adapter reports only configured/missing
    state (never the token itself); repeated `401`/`403` from the adapter's upstream call, or a
    `/health` response showing the credential as missing, indicates the token needs renewal.
  - **Approved renewal:** only an operator authorized to manage that credential rotates it
    through the token management API, then restarts the affected adapter process with the new
    value in its environment.
  - **Re-registration/re-smoke:** after rotating a token or restarting an adapter, re-run the
    startup and smoke checklist in Section 7 before resuming use.
  - **Revocation/offboarding:** when an operator or demo environment is decommissioned, revoke
    its tokens via the token management API and stop the corresponding adapter process; do not
    leave a revoked-but-running adapter process reachable.
- Never log, paste, or commit a token value. Adapter `/health` responses and logs are designed
  to omit the token; do not add debug logging that would print `CERNION_READONLY_TOKEN`,
  `CERNION_PROCESS_TOKEN`, or any `Authorization`/bearer header value.

## 7. Startup and smoke-test checklist

Run in order after starting the adapters (and Open WebUI itself):

1. **Loopback/listener check** — confirm each adapter is bound to `127.0.0.1` (local profile)
   or to the intended internal interface only (shared profile), e.g. `ss -ltnp | grep 391`.
2. **Auth-state check** — for a shared/team instance, confirm `WEBUI_AUTH` is not `False` and
   that anonymous access is disabled in Open WebUI's admin settings.
3. **Adapter health:**
   ```bash
   curl -s http://127.0.0.1:3910/health
   curl -s http://127.0.0.1:3911/health
   ```
   Both must report configured state without ever including a token value.
4. **OpenAPI shape and operation count:**
   ```bash
   curl -s http://127.0.0.1:3910/openapi.json | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log(Object.keys(d.paths))"
   curl -s http://127.0.0.1:3911/openapi.json | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log(Object.keys(d.paths))"
   ```
   Each must expose exactly one operation: `/tools/cernion-evidence-lookup` and
   `/tools/cernion-process-intake-draft` respectively.
5. **Mock smoke:**
   ```bash
   node integrations/open-webui/smoke-test.js
   ```
6. **Live read-only Evidence smoke (optional, only with an already-approved token):** if a
   read-only Evidence credential has already been approved and configured, you may additionally
   run:
   ```bash
   OPEN_WEBUI_SMOKE_USE_MOCKS=0 \
   OPEN_WEBUI_BRIDGE_BASE_URL=http://127.0.0.1:3900 \
   OPEN_WEBUI_TOOLSERVER_BASE_URL=http://127.0.0.1:3910 \
   node integrations/open-webui/smoke-test.js
   ```
   Do not create a new credential solely to run this step.
7. **Process Intake fail-closed smoke (default):** with `CERNION_PROCESS_TOKEN` unset, confirm
   the adapter's `/health` reports missing configuration and that a tool request is rejected
   before any upstream call is attempted. Do not create a Process Intake receipt merely to
   validate documentation.
8. **Log inspection** — check adapter stdout/stderr for accidental secret leakage (token
   values, `Authorization` headers); none should appear.
9. **RBAC negative check (shared profile only)** — confirm a user without the Evidence/Process
   Intake tool grant cannot see or invoke either tool server from Open WebUI.

## 8. Service/API boundary (unchanged)

- **Evidence adapter** (`cernion-openapi-tool-server.js`): `GET /health`, `GET /openapi.json`,
  `POST /tools/cernion-evidence-lookup`. Its only valid upstream call is `POST
  <CERNION_AGENT_SIDECAR_BASE_URL>/api/agent-sidecar/tools/cernion.answer_dossier/call`.
- **Draft Process Intake adapter** (`cernion-process-intake-tool-server.js`): `GET /health`,
  `GET /openapi.json`, `POST /tools/cernion-process-intake-draft`. Its only valid upstream call
  is `POST <CERNION_BASE_URL>/api/copilot-process/intents`, producing at most
  `pending_confirmation`.
- Open WebUI remains a client/renderer and tool-call surface. It is not a system of record and
  has no policy authority; Cernion remains authoritative for tenant, role, scope, and HITL
  decisions.

## 9. No-call boundary

Neither adapter, nor Open WebUI acting through them, may ever send external messages, call
webhooks, sign anything, execute/approve/auto-confirm a pending intent, resolve a HITL decision,
or reach MaKo, CRM, billing, settlement, tariff mutation, device control, deployment, an
external connector, or a direct database path. There is no code path in either adapter to any
such endpoint (see `README.md` for the full forbidden-action list enforced by the Process Intake
adapter). This runbook describes those boundaries; it does not change them.
