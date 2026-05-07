# Issue 05 — Outbound Webhook Service

**Bereich:** Integration · **Priorität:** Mittel · **Ziel-Release:** v0.44

## Problem

Der Moleculer-Event-Bus emittiert intern u. a. `cya.a2a.consensus.failed`, `cya.ontology.graph.invalidated`, `mastr-monitor.delta.detected`. Diese Events sind heute rein in-process — eine Integration mit Power Automate, Zammad-Ticketing, BI-Tools oder Slack ist nur über manuelle Polling-Workarounds möglich.

## Vorschlag

`services/webhooks.service.js`:

1. **Subscription CRUD** (tenant-scoped):
   - `POST /api/webhooks` `{ url, events[], secret?, headers?, isActive }`
   - `GET /api/webhooks`
   - `DELETE /api/webhooks/:id`
   - `POST /api/webhooks/:id/test`
2. **Event-Whitelist** (initial):
   - `cya.a2a.consensus.failed`, `cya.a2a.conflict.detected`
   - `mastr-monitor.delta.detected`
   - `hitl.item.created`, `hitl.item.resolved`
   - `redispatch-expost.audit.completed`
   - `mastr-quality.audit.completed`
   - `finance-agent.analysis.completed`
3. **Delivery:**
   - HMAC-SHA256-Signatur Header `X-Cernion-Signature`
   - At-least-once mit Exponential-Backoff (1m/5m/30m/2h/12h, max 5 Versuche)
   - Persistente Outbox `webhook_deliveries`
4. **Replay:**
   - `POST /api/webhooks/:id/deliveries/:deliveryId/replay`
   - `GET /api/webhooks/:id/deliveries?status=failed`
5. **DLQ:** Nach 5 Fehlversuchen `status=dead`, optional Auto-Disable nach 50 toten Lieferungen.

## Akzeptanzkriterien

- Subscription empfängt `cya.a2a.consensus.failed` <2 s nach Emit (lokaler Test).
- Failed-Delivery-Test (HTTP 503) erzeugt Retry-Schedule und manuell auslösbaren Replay.
- Signatur prüfbar mit dokumentiertem Beispiel-Code (Node + Python + Power Automate).
- `docs/INTEGRATION_WEBHOOKS.md` mit Beispielen.

## Bezug

- v0.35.0 A2A-Events
- v0.36.0 Cache-Invalidation-Events
- v0.27.x `mastr-monitor.delta.detected`
