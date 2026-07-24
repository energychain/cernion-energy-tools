# Cernion public API recipes for developer and LLM discovery

Status: public documentation package with synthetic examples. Do not commit real tokens, live tenant IDs, customer data, or screenshots containing secrets.

Source of truth:

- Swagger UI: <https://api.cernion.de/api/docs>
- OpenAPI JSON: <https://api.cernion.de/api/openapi.json>
- Public repository: <https://github.com/energychain/cernion-energy-tools>

## Safety boundary

- Use `CERNION_TOKEN` as a private environment variable; never paste tokens into docs, prompts, browser code, query strings, or commits.
- Use a synthetic tenant such as `docs-sandbox-slot5` for examples.
- Keep tokens server-side for real integrations. Browser examples must not contain productive credentials.
- Treat the responses below as synthetic fixtures, not live execution evidence.
- These recipes do not authorize automatic decisions, production mutation, billing, settlement, tariff changes, device control, contract actions, grid-connection approval/rejection, or customer-specific claims.
- Mutation or intake endpoints are shown only as request/response contracts. They are not free-to-run public demos.

## Environment

```bash
export CERNION_TOKEN="<set privately, never commit>"
export CERNION_TENANT="docs-sandbox-slot5"
```

## Recipe 1: OpenAI-compatible consultation

Endpoint: `POST https://api.cernion.de/v1/chat/completions`

OpenAPI anchor: `paths['/v1/chat/completions'].post`, operationId `createChatCompletion`.

Link target: <https://api.cernion.de/api/docs> and OpenAPI JSON path `paths['/v1/chat/completions'].post`.

Claim boundary: consultation/integration surface only; no automatic process execution, no legal/regulatory/customer-specific decision, and no productive mutation.

Example request with synthetic data:

```bash
curl -sS https://api.cernion.de/v1/chat/completions \
  -H "Authorization: Bearer ${CERNION_TOKEN}" \
  -H "x-tenant-id: ${CERNION_TENANT}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cernion-agent-mvp",
    "messages": [
      {
        "role": "user",
        "content": "Welche Nachweise sollte ein Stadtwerk in einer synthetischen Anschlusspruefung vor einer fachlichen Befassung sichtbar machen?"
      }
    ],
    "metadata": {
      "purpose": "public-docs-synthetic-example",
      "caseId": "DOCS-SLOT5-CHAT-001"
    },
    "stream": false
  }'
```

Synthetic response fixture:

```json
{
  "id": "chatcmpl-docs-slot5-001",
  "object": "chat.completion",
  "created": 1784827200,
  "model": "cernion-agent-mvp",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Fuer eine fachliche Befassung sollten Ziel, betroffene Anlage, Netzebene, Nachweisstatus, offene Evidenzluecken und HITL-Grenzen getrennt sichtbar sein. Das Beispiel ist ein synthetischer Pruefpfad und ersetzt keine Anschluss-, Genehmigungs- oder Vertragsentscheidung."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 96,
    "completion_tokens": 58,
    "total_tokens": 154
  },
  "cernion": {
    "mode": "consultation",
    "tenant": "docs-sandbox-slot5",
    "claimBoundary": "no execution, no approval, no production mutation"
  }
}
```

## Recipe 2: Copilot process intent intake

Endpoint: `POST https://api.cernion.de/api/copilot-process/intents`

OpenAPI anchor: `paths['/api/copilot-process/intents'].post`, operationId `prepareProcessIntent`.

Link target: <https://api.cernion.de/api/docs> and OpenAPI JSON path `paths['/api/copilot-process/intents'].post`.

Claim boundary: this documents a pending-confirmation contract. Do not present it as a public live demo that performs productive changes, approvals, MaKo actions, billing actions, or contract actions.

Example request with synthetic data:

```bash
curl -sS https://api.cernion.de/api/copilot-process/intents \
  -H "Authorization: Bearer ${CERNION_TOKEN}" \
  -H "x-tenant-id: ${CERNION_TENANT}" \
  -H "Content-Type: application/json" \
  -d '{
    "operationFamily": "docs_synthetic_process_review",
    "proposedAction": "prepare_evidence_gap_review",
    "targetType": "syntheticGridConnectionCase",
    "targetId": "DOCS-SLOT5-CASE-002",
    "inputSummary": "Synthetischer Review-Wunsch: fehlende Nachweise vor fachlicher Befassung markieren.",
    "payload": {
      "anlage": "SYNTH-BESS-42",
      "netzebene": "MS",
      "missingEvidence": ["netzverknuepfungspunkt", "fernwirk-nachweis"],
      "dataClass": "synthetic-docs-fixture"
    },
    "risk": "medium",
    "reason": "Dokumentationsbeispiel fuer pending_confirmation, keine Ausfuehrung.",
    "correlationId": "docs-slot5-intent-002"
  }'
```

Synthetic response fixture:

```json
{
  "intentId": "intent_docs_slot5_002",
  "status": "pending_confirmation",
  "operationFamily": "docs_synthetic_process_review",
  "proposedAction": "prepare_evidence_gap_review",
  "targetType": "syntheticGridConnectionCase",
  "targetId": "DOCS-SLOT5-CASE-002",
  "risk": "medium",
  "createdAt": "2026-07-23T17:20:00.000Z",
  "claimBoundary": "Intent prepared for human review only; no dispatch table execution, no production mutation."
}
```

## Recipe 3: customer-service portal-widget fixture

Endpoint: `POST https://api.cernion.de/api/customer-service/portal-widget`

OpenAPI anchor: `paths['/api/customer-service/portal-widget'].post`, operationId `customer-service_portalWidget`.

Link target: <https://api.cernion.de/api/docs> and OpenAPI JSON path `paths['/api/customer-service/portal-widget'].post`.

Claim boundary: synthetic integration fixture only; no customer-specific legal, tariff, billing, or contract advice and no production portal write.

Example request with synthetic data:

```bash
curl -sS https://api.cernion.de/api/customer-service/portal-widget \
  -H "Authorization: Bearer ${CERNION_TOKEN}" \
  -H "x-tenant-id: ${CERNION_TENANT}" \
  -H "Content-Type: application/json" \
  -d '{
    "widgetType": "faq_embedded",
    "mode": "embedded",
    "theme": "light",
    "language": "de",
    "outputFormat": "json",
    "postalCode": "50667",
    "installationAge": 18,
    "includeBranding": true,
    "includeContactCTA": false
  }'
```

Synthetic response fixture:

```json
{
  "widgetType": "faq_embedded",
  "mode": "embedded",
  "language": "de",
  "dataClass": "synthetic-docs-fixture",
  "title": "Haeufige Fragen zur Energieanlage",
  "items": [
    {
      "question": "Welche Daten sind fuer eine erste Einordnung noetig?",
      "answer": "Fuer eine unverbindliche Einordnung werden Anlagentyp, Inbetriebnahmedatum, Netzbetreiber und vorhandene Nachweise getrennt betrachtet."
    },
    {
      "question": "Ist das eine verbindliche Rechts- oder Tarifauskunft?",
      "answer": "Nein. Dieses Widget ist ein technisches Integrationsbeispiel und ersetzt keine rechtliche, regulatorische oder vertragliche Pruefung."
    }
  ],
  "claimBoundary": "synthetic example; no customer data; no billing, tariff or contract decision"
}
```

## Release-signal quality chain

Public-website and developer-discovery candidates should remain evidence-first. PR #480 added the read-only generator/rubric/schema flow that maps CHANGELOG and OpenAPI signals into reviewable public-backlog candidates. Use it to find candidates; do not treat it as authorization to publish.
