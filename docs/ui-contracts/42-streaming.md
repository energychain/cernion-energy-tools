# UI Contract 42: Live Update Stream Contract Status

## Scope

`GET /api/dashboard/live-update-stream-contract` is the first read-only contract slice for live-update needs. It does not implement SSE, WebSocket, replay, subscriptions or event emitters. It lets UI and dossier consumers inspect which channel contract is proposed, which source action would feed it, which auth/tenant boundary applies, and which polling fallback remains safe until transport work is approved.

## Response Shape

```json
{
  "capabilityKey": "live_update_stream_contract_status",
  "safety": "read_only",
  "status": "contract_ready",
  "channels": [
    {
      "key": "hitl_queue",
      "proposedTransport": "sse_eventsource",
      "availability": "planned",
      "authBoundary": "bearer_token_and_x_tenant_id",
      "sourceService": "hitl",
      "sourceAction": "list",
      "fallbackPollingPath": "/api/hitl/items",
      "resumePolicy": {
        "required": true,
        "heartbeatSeconds": 15,
        "lastEventId": "expected_for_future_transport"
      },
      "ownerRole": "platform-api",
      "contractComplete": true
    }
  ],
  "missingEvidence": [],
  "positiveFollowUps": [],
  "sourceActions": {
    "notCalled": [
      "sse.openConnection",
      "websocket.upgrade",
      "stream.subscribe",
      "event-emitter.emit",
      "external.connector.call",
      "personal-agent.execute"
    ]
  }
}
```

## Guards

- No SSE or WebSocket server is opened by this endpoint.
- No channel subscription, replay, multiplexing or backpressure behavior is created.
- No token-in-URL or new auth mode is introduced.
- No HITL, NOVA, CYA, RAG, MaStR, observability or external connector action is mutated.
- Unsupported channels must return explicit gaps and positive follow-ups instead of pretending that a stream exists.
