# Issue 19 — NOVA Decision-Engine produktiv (TRL 5 → 7)

**Bereich:** Domäne · **Priorität:** Mittel · **Ziel-Release:** v0.49

## Problem

`nova.service.js` ist seit v0.24 als **TRL 5** klassifiziert: SSE-Protokoll stabil, „Anwendungslogik im Aufbau". v0.44.3 (Asset-Override Production Path) hat die Persistenz für Override-Entscheidungen geliefert, aber die NOVA-Decision-Engine selbst (welche Entscheidungen werden vorgeschlagen, mit welcher Begründung, welcher Lebenszyklus?) bleibt skizzenhaft — drei Endpunkte (`stream`, `pendingDecisions`, `apply`) ohne dokumentierten Decision-Lifecycle.

## Vorschlag

1. **Decision-Lebenszyklus** in `src/nova-decision-machine.js`:
   ```
   proposed → triaged → pending_approval → approved → applied
                     ↘ rejected
                     ↘ expired
   ```
   Jeder Übergang mit Audit-Eintrag + Webhook-Event.
2. **Decision-Quellen** dokumentieren:
   - `mastr-quality.audit` Findings → MaStR-Korrektur-Decision
   - `redispatch-expost.audit` Findings → Settlement-Korrektur
   - `vnb-monitor` Alerts → Threshold-Anpassung
   - `cya.a2a.consensus.failed` → HITL-Eskalation (gibt es schon)
   - `mastr-monitor.delta.detected` → Stammdaten-Update
3. **Persistenz:** `tenant:{id}:nova_decisions` mit Schema:
   ```json
   {
     "_id": "dec_<sha8>",
     "kind": "mastr_correction|threshold_update|asset_override|...",
     "source": { "service": "...", "action": "...", "evidence": [...] },
     "proposal": { "field": "...", "value": ..., "previousValue": ... },
     "agent_interventions": [...],
     "lifecycle": { "current": "pending_approval", "history": [...] },
     "tenantId": "...",
     "createdAt": "...",
     "expiresAt": "..."
   }
   ```
4. **REST:**
   - `GET /api/nova/decisions?status=...&kind=...` (Cursor-Pagination)
   - `GET /api/nova/decisions/:id`
   - `POST /api/nova/decisions/:id/approve` (HITL-integriert)
   - `POST /api/nova/decisions/:id/reject`
   - `GET /api/nova/decisions/stats` (per Tenant Counts pro Status)
5. **SSE-Erweiterung** `/api/nova/stream`:
   - Channels `tenant:{id}:nova` mit Heartbeats
   - Event-Typen `decision.proposed|approved|rejected|applied|expired`
6. **HITL-Bridge:** Decisions mit `kind` ∈ {`mastr_correction`, `asset_override (critical)`, `threshold_update`} erzeugen automatisch HITL-Items.
7. **Replay-Endpoint** für Tests/Audits: `POST /api/nova/decisions/:id/replay-trigger` rekonstruiert die Entscheidung aus Quellen.

## Akzeptanzkriterien

- E2E-Test: `mastr-monitor.delta.detected` → NOVA-Decision `proposed` → HITL-Approval → `applied` → asset-effective ändert sich.
- SSE-Stream-Test mit zwei Tenants: jeder sieht nur eigene Events.
- ≥30 Tests inkl. Lifecycle-State-Machine, Expiry, Replay.
- `docs/NOVA_DECISION_GUIDE.md` mit Decision-Kind-Katalog.
- TRL-Update auf 7 in `ARCHITECTURE.md` (Issue 15).

## Bezug

- v0.24.0 — NOVA SSE-Feed (Original-Einführung)
- v0.44.3 — Asset Override Production Path
- v0.44.5 — HITL First-Class
- Hängt an Issue 14 (Async-Job für Replay) + Issue 24 (SSE-Streaming)
