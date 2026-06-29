# Netzsignal Delta-Gating

## Zweck

`netzsignal_delta_gating` klassifiziert vom Caller gelieferte operative Signal-Metadaten in eine dossierfaehige Managementsicht:

- `known_context`
- `freshness_only`
- `decision_delta`
- `new_blocker`
- `insufficient_evidence`

Die Faehigkeit hilft VNB-/EVU-Fuehrungsroutinen, bekannte Kontextanker, reine Aktualitaetsnachweise und echte neue Entscheidungsdeltas auseinanderzuhalten.

## Erster Slice

Der erste Slice ist eine read-only Dashboard/API-Faehigkeit:

- Action: `dashboard-api.netzsignalDeltaGatingStatus`
- API: `GET /api/dashboard/netzsignal-delta-gating`
- Evidence key: `netzsignal_delta_gating`

Eingaben bleiben skalare, synthetik- und dossierfreundliche Metadaten wie `domain`, `signalType`, `knownContextRef`, `freshnessProof`, `decisionTopic`, `owner`, `dueDate`, `materiality`, `newFact`, `blockedDecision` und `nextEvidencePoint`.

## Sicherheitsgrenze

Der Slice liest keine Outlook-, Teams-, Monitoring-, Ticket-, Budibase-, MaKo-, Billing-, Settlement-, Tarif- oder Device-Control-Systeme. Er erzeugt keine Eskalation, kein HITL-Item, kein Ticket, keinen Webhook und keine produktive Mutation. Eine Eskalation wird nur als Textempfehlung fuer ein spaeteres Dossier formuliert.

## Dossier-Nutzung

Answer Dossier kann die Faehigkeit ueber die Hydration Registry konsumieren. Der Formatter liefert nur schlanke Fakten: Klassifikation, Empfehlung, Non-Eskalationsgrund, Owner, Friststatus, Materialitaet, blockierte Entscheidung, fuehrende Evidenzluecke und positive Follow-ups.
