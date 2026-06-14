# n8n Answer Dossier Renderer Test

## Zweck

n8n ist der erste externe Renderer-Test fuer das Cernion Answer Dossier. Ziel ist, die fachliche Orchestrierung vollstaendig in Cernion zu testen und die Prosa-Generierung auszulagern, ohne MS365/Copilot Studio fuer jede Iteration anfassen zu muessen.

## Workflow

```text
Webhook Trigger
  -> Set Session Context
  -> HTTP Request: Cernion Answer Dossier
  -> LLM Renderer
  -> Respond to Webhook
```

## Webhook Input

```json
{
  "question": "Ist die aktuelle Antwort so belastbar?",
  "sessionId": "n8n-test-001",
  "conversationId": "n8n-test-001",
  "userId": "test-user"
}
```

## Cernion Request

```json
{
  "question": "={{ $json.question }}",
  "sessionId": "={{ $json.sessionId || $json.conversationId }}",
  "domain": "auto",
  "mode": "answer_dossier",
  "maxEvidence": 5,
  "timeBudgetMs": 30000,
  "context": {
    "channel": "n8n",
    "surface": "external-renderer",
    "conversationId": "={{ $json.conversationId }}",
    "userId": "={{ $json.userId }}"
  }
}
```

## Timeout Configuration

The Answer Dossier endpoint may take up to 30 seconds by default. n8n's HTTP Request node
must be configured with a sufficient timeout.

In the HTTP Request node settings:
- Set **Timeout** to `45000` (45 seconds) or higher
- The response includes a `timeoutWarning` field when the budget exceeds 25 seconds — use
  this as a reminder to check client timeout settings

For faster responses, pass a smaller `timeBudgetMs` (e.g. `8000` for minimal dossiers):
```json
{
  "timeBudgetMs": 8000
}
```
This produces a dossier using only session state, without running evidence collection.

## Renderer Input

Cernion liefert `dossierMarkdown` als vollstaendiges Renderer Package. n8n soll keinen
zusaetzlichen Fachprompt, Systemhinweis oder Aufgaben-Wrapper ergaenzen.

```text
{{$json.dossierMarkdown}}
```

Cernion baut die Renderer-Anweisungen direkt in das Markdown ein:

```text
# CERNION RENDERER PACKAGE

## Systemhinweis
...

## Aufgabe
...

## Cernion Answer Dossier
# CERNION ANSWER DOSSIER
...
```

## Abnahmekriterien

- n8n bekommt ein einzelnes Renderer Package von Cernion.
- Der LLM Renderer erhaelt keine zusaetzlichen Fachprompts.
- Die finale Antwort enthaelt keine Fakten ausserhalb des Dossiers.
- Bei `user_context=unknown` wird eine Rueckfrage formuliert.
- Bei `answer_mode=evidence_collection` wird keine finale Planungsaussage formuliert.
- `Forbidden Claims` werden nicht wiedergegeben oder verletzt.
- Das Dossier kann als Golden Fixture versioniert und lokal getestet werden.
