# Issue 08 — Asset-Override produktiv (Persistenz, Provenance, NOVA-Decision-Trail)

**Bereich:** Plattform · **Priorität:** Mittel · **Ziel-Release:** v0.41

## Problem

`POST /api/assets/:assetId/override` ist im OpenAPI explizit als *"Temporary stub endpoint... No persistence yet."* gekennzeichnet (`services/assets.service.js`, `tests/assets.override.test.js`). Aktuell `success: true` ohne Persistenz, Audit-Trail oder Wirkung.

NOVA-SSE-Decisions können dadurch nicht korrekt rückverfolgt werden, und Stadtwerke, die eine MaStR-Korrektur per UI veranlassen, erhalten keine deterministische Reaktion.

## Vorschlag

1. **Persistenz-Schema** im Object-Store-Namespace `tenant:{id}:asset_overrides`:
   ```json
   {
     "_id": "ovr_<assetId>_<sha8>",
     "assetId": "...",
     "field": "...",
     "previousValue": ...,
     "value": ...,
     "reason": "...",
     "approvedBy": "user|agent",
     "approvedAt": "...",
     "agent_interventions": [...],
     "supersedes": "ovr_..." | null,
     "tenantId": "...",
     "provenanceHash": "sha256(...)"
   }
   ```
2. **Read-API:**
   - `GET /api/assets/:assetId/overrides`
   - `GET /api/assets/:assetId/effective` — MaStR + applied Overrides mit Source-Trail
3. **Validierung:** Whitelist überschreibbarer Felder (`capacityKW`, `voltageLevel`, `commissionDate`, `direktvermarktungActive`); kritische Felder erfordern HITL-Approval (Issue 12).
4. **Wirkung:** `mastr-quality.audit`, `redispatch-expost.audit`, `assets.solar/wind/storage` lesen `assets.effective` statt MaStR-Roh.
5. **Soft-Revert:** `DELETE /api/assets/:assetId/overrides/:id` setzt `supersedesReverted=true`.

## Akzeptanzkriterien

- Override → `mastr-quality.audit` reflektiert neuen Wert; ohne Override unverändert.
- 100 % Audit-Trail (timestamp, user/agent, reason, hash).
- Tests: Persistenz, Stack mehrerer Overrides, Revert, Cross-Tenant-Isolation, NOVA-Apply-Pfad.
- Stub-Hinweis aus OpenAPI entfernt; UI-Contract `docs/ui-contracts/31-asset-overrides.md`.

## Bezug

- `tests/assets.override.test.js`
- v0.24 NOVA SSE-Feed (`nova_apply` braucht echte Persistenz)
- Hängt an Issue 12 (HITL)
