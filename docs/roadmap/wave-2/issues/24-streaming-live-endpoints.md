# Issue 24 — Live-Streaming-Endpoints (SSE / WebSocket)

**Bereich:** UX / API · **Priorität:** Mittel · **Ziel-Release:** v0.50

## Problem

Heute existiert nur `/api/nova/stream` als SSE-Endpunkt (TRL 5). Für moderne UI-Use-Cases (Stadtwerk-Dashboard, HITL-Approval-Cockpit, RAG-Ingestion-Progress, MaStR-Delta-Live-Stream, CYA-Session-Schritte) fehlen Live-Updates → UI-Layer fällt auf 5-Sekunden-Polling zurück, was Latenz und Last erzeugt.

## Vorschlag

1. **Standardisierter SSE-Endpoint pro Domäne:**
   - `GET /api/cya/sessions/:id/events` — Phase-1-bis-N-Schritte, A2A-Messages, Konsens-Updates
   - `GET /api/knowledge-rag/jobs/:id/events` — Ingestion-Progress (Chunk-für-Chunk)
   - `GET /api/hitl/events?filter=…` — Live-Queue-Updates
   - `GET /api/mastr-monitor/watches/:id/events` — Delta-Stream
   - `GET /api/jobs/:id/events` — generischer Job-Progress (löst Polling auf)
   - `GET /api/observability/events?level=warn|error` — Live-Log-Tail (full-access)
2. **WebSocket-Alternative** pro Tenant:
   - `WS /api/ws?tenantId=…&token=…&channels=…` — multiplext alle Streams
   - Channel-Subscription-Management via Client-Nachrichten (`{ type: 'subscribe', channel: 'cya.session.<id>' }`)
3. **Backpressure & Heartbeats:**
   - SSE-Heartbeat alle 15 s (`event: heartbeat\ndata: {}`)
   - Server-side Throttle (max 50 events/sec/connection)
   - Client-disconnect-Handling mit `last-event-id` für Resume
4. **Auth:**
   - SSE: Bearer-Token in `?token=…` (URL) oder Header (wenn EventSource das unterstützt)
   - WS: HTTP-Upgrade mit Token-Header
   - Tenant-Isolation per Subscription-Channel
5. **Observability:**
   - Metriken: `cernion_sse_open_connections`, `cernion_sse_events_emitted`, `cernion_ws_messages`
6. **UI-Contract** `docs/ui-contracts/42-streaming.md` mit Beispiel-EventSource/WebSocket-Snippets.

## Akzeptanzkriterien

- Browser-EventSource gegen `/api/cya/sessions/:id/events` zeigt Live-Phasen-Updates ohne Polling.
- Disconnect/Reconnect mit `last-event-id` liefert verpasste Events nach.
- Tenant-Isolation: Tenant A's SSE-Stream blockt Channels von Tenant B.
- Lasttest: 1000 simultane SSE-Verbindungen, Latenz <250 ms.
- ≥30 Tests inkl. Disconnect-Edge-Cases.

## Bezug

- v0.24.0 — NOVA SSE als heutiger einziger Stream
- v0.44.5 — HITL First-Class (UI-Contract verlangt Live-Updates)
- v0.43.1 — Knowledge-RAG Ingestion (lange Jobs, Progress nötig)
- Hängt an Issue 18 (Rate-Limit pro Connection) + Issue 19 (NOVA-Decision-Stream)
