# CET RC2 UI — Spec A Core / REST / Middleware Contracts

Status: Phase A abgeschlossen (lokal, Branch `feat/cet-release-rc2-ui`).

## Zweck

Phase A stellt die CET-/Middleware-Verträge bereit, die die UI konsumiert. Die UI darf keine Fachregeln neu erfinden; sie rendert Gateway-, Rollen-, Präsentations-, Nachweis- und Operationskonsole-Verträge.

## Implementierte Contract-Fläche

Experimenteller REST-Namespace über API-Gateway:

- `GET /api/ui/v0/session-context`
- `GET /api/ui/v0/daily-surface`
- `GET /api/ui/v0/cases/:caseId`
- `GET /api/ui/v0/cases/:caseId/evidence`
- `POST /api/ui/v0/cases/:caseId/claim`
- `POST /api/ui/v0/cases/:caseId/freeze`
- `POST /api/ui/v0/cases/:caseId/approval-requests`
- `GET /api/ui/v0/operations`
- `POST /api/ui/v0/operations/:operationId/prepare`

Die Alias-Fläche liegt in `services/api.service.js`; die ausführende Service-Schicht liegt in `services/cet-ui.service.js` und delegiert die kanonischen RC2-Verträge an `src/cet-ui-rc2/ui-gateway-adapter.js`.

## Kernmodule

- `src/cet-ui-rc2/presentation-contract-validator.js`
- `src/cet-ui-rc2/interaction-projection.js`
- `src/cet-ui-rc2/run-card-state.js`
- `src/cet-ui-rc2/evidence-dossier.js`
- `src/cet-ui-rc2/operation-console-contract.js`
- `src/cet-ui-rc2/ui-gateway-adapter.js`
- `src/cet-ui-rc2/fixtures/reference-tenant.js`

## Phase-A-Abnahmepunkte

- Tenant-/Rollen-/Placeholder-Agent-Fixture vorhanden.
- Rollenwechsel wird gegen tatsächliche Tenant-Rollen und Placeholder-Agent-Grenzen geprüft.
- Tagesfläche liefert einen festen RC2-Referenz-Vorgang mit Aufmerksamkeitsgrund, Rollenwirkung und Interaction Projection.
- Vorgang kommt über Präsentationsvertrag und Interaction Projection, nicht als direktes RC1-Objekt.
- Übernahme/Claim schreibt CET-owned Run-Card-State; keine externen Fachsystem-Executions.
- Evidence Dossier materialisiert nur `aggregat`; `einzeldatensatz` bleibt hash/ref-only.
- Operationskonsole filtert Operationen nach Tenant/Rolle/Governance-Policy, erhält `riskClass`, zulässige Methode und Abweisungsgrund und gibt nicht-projizierte Ergebnisse als `unprojected.raw` plus Audit-Payload aus.
- Schreibende `/api/ui/v0`-REST-Routen benötigen Full-Access API-/Session-Auth; Tenant/Rolle werden aus Gateway-Metadaten abgeleitet, nicht aus Client-Parametern.
- API-Gateway-Tests verhindern direkte RC1-/Governance-Architecture-Leaks und Legacy-Alias-Rückfälle.

## Tests

Phase A wird abgedeckt durch:

- `tests/cet-ui-rc2.api-gateway.test.js`
- `tests/cet-ui-rc2.presentation-contract.test.js`
- `tests/cet-ui-rc2.interaction-projection.test.js`
- `tests/cet-ui-rc2.run-card-state.test.js`
- `tests/cet-ui-rc2.tenant-role-agent.test.js`
- `tests/cet-ui-rc2.evidence-dossier.test.js`
- `tests/cet-ui-rc2.operation-console-contract.test.js`
- `tests/cet-ui-rc2.no-direct-rc1-object-leakage.test.js`
- `tests/cet-ui.service.test.js`

## Grenzen

- Phase A ist keine UAT-Oberfläche.
- Phase A liefert die Gateway-/Contract-Voraussetzung für Phase B/C/D.
- OpenAPI-Publication und produktive Bereitstellung bleiben separate Entscheidungen.
