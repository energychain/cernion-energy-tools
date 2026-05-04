# Issue 12 — HITL-Approval-Workflow First-Class

**Bereich:** Compliance / Agent · **Priorität:** Mittel · **Ziel-Release:** v0.42

## Problem

Im CYA-Service (v0.35.0) wurde ein `events:`-Block für `cya.a2a.consensus.failed` mit "HITL escalation hook" eingeführt. Der Hook ist heute aber **nur ein Logging-Eintrag**, kein produktiver HITL-Workflow. Asset-Overrides (Issue 08), automatische MaStR-Korrekturen (geschlossenes Issue #33) und Finance-Agent-Hypothesen (`hypothetical_scenario`-Status, v0.40.4) brauchen einen einheitlichen menschlichen Freigabepfad.

## Vorschlag

1. **Neuer Service `services/hitl.service.js`:**
   - `POST /api/hitl/items` `{ kind, payload, originService, originAction, severity, requiredScope, dueAt }`
   - `GET /api/hitl/items?status=pending|approved|rejected&kind=...`
   - `GET /api/hitl/items/:id`
   - `POST /api/hitl/items/:id/approve` `{ comment }`
   - `POST /api/hitl/items/:id/reject` `{ comment, feedbackToAgent? }`
   - `POST /api/hitl/items/:id/escalate` (zweite Eskalationsstufe)
2. **Persistenz** in `tenant:{id}:hitl_items` mit vollständigem `agent_interventions[]`-Array.
3. **Events** für Webhook-Service (Issue 05): `hitl.item.created`, `hitl.item.resolved`, `hitl.item.expired`.
4. **Caller-Integration:**
   - `cya.refine` schreibt bei `consensus.failed` ein HITL-Item
   - `assets.override` bei kritischen Feldern erfordert HITL-Item-Approval bevor `effective` umschaltet
   - `finance-agent.analyze` schreibt bei `hypothetical_scenario` ein HITL-Item zur User-Bestätigung
5. **UI-Contract** `docs/ui-contracts/30-hitl.md` — Approval-Dashboard, Bulk-Actions, Filter, SLA-Heatmap.

## Akzeptanzkriterien

- E2E-Test: Asset-Override (kritisches Feld) → HITL-Item → Approval → Wirkung.
- E2E-Test: CYA-Konsens-Fehler → HITL-Item mit `agent_interventions`-Trail.
- SLA-Default: pending >7 Tage → `expired` + Webhook-Event.
- ≥20 Tests (Service + Caller-Integration + Permissions).

## Bezug

- Geschlossenes Issue #33 (HITL-Approval-Dashboard)
- v0.35.0 — `events:`-Hook in CYA
- v0.40.4 — `hypothetical_scenario`-Status im Finance Agent
