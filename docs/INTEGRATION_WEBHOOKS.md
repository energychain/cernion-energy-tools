# Outbound Webhooks Integration (v0.44)

Der Webhook-Service stellt tenant-skopierte Outbound-Events bereit, inklusive Signatur, Retry, Replay und DLQ.

## Endpunkte

- `POST /api/webhooks` — Subscription anlegen
- `GET /api/webhooks` — Subscriptions listen
- `DELETE /api/webhooks/:id` — Subscription löschen
- `POST /api/webhooks/:id/test` — Test-Delivery auslösen
- `GET /api/webhooks/:id/deliveries?status=failed|retrying|dead|sent`
- `POST /api/webhooks/:id/deliveries/:deliveryId/replay`

## Unterstützte Events (Whitelist)

- `cya.a2a.consensus.failed`
- `cya.a2a.conflict.detected`
- `mastr-monitor.delta.detected`
- `hitl.item.created`
- `hitl.item.resolved`
- `redispatch-expost.audit.completed`
- `mastr-quality.audit.completed`
- `finance-agent.analysis.completed`

## Delivery-Semantik

- At-least-once Zustellung
- Retry-Backoff: `1m`, `5m`, `30m`, `2h`, `12h`
- Max. `5` Versuche, danach `status=dead`
- Auto-Disable optional via Schwellwert (`WEBHOOKS_DEAD_DISABLE_THRESHOLD`, Default `50`)

## Payload-Vertrag

Jede Delivery enthält verpflichtend:

- `eventId`
- `deliveryId`
- `event`
- `timestamp`
- `tenantId`
- `attempt`
- `payload`

## Signatur

Wenn bei der Subscription ein `secret` gesetzt ist, wird `X-Cernion-Signature` gesendet.
Format: `sha256=<hex_digest>` über den **raw JSON body**.

### Node.js Verifikation

```js
const crypto = require('crypto');

function verifySignature(rawBody, signatureHeader, secret) {
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader || ''));
}
```

### Python Verifikation

```python
import hmac
import hashlib


def verify_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode('utf-8'), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header or '')
```

### Power Automate (Hinweis)

1. Header `X-Cernion-Signature` lesen.
2. Request-Body als String serialisieren (unverändert).
3. SHA256-HMAC mit Shared Secret berechnen.
4. Ergebnis mit Header vergleichen.

> Wichtig: gleiche Byte-Repräsentation verwenden (keine Reformatierung des JSON).

## Sicherheit

- Secrets werden at-rest verschlüsselt gespeichert.
- Schlüssel wird ausschließlich aus ENV gelesen: `WEBHOOK_SECRET_ENCRYPTION_KEY`.
- Key-Rotation-Modell v0.44: **ein aktiver Key** (Option A).
