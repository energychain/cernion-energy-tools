# Management-Cockpit: Outcome- und Impact-Feed v1

## Zweck

AP 8 ersetzt die frühere Gleichsetzung „abgeschlossene Karte mit Resultat = Ergebnis“ durch eine konservative, reproduzierbare Outcome-Projektion. Sichtbar werden ausschließlich belegte Außenwirkung und fallabschließende Ergebnisse.

## Aufnahmebedingungen

Ein Vorgang wird nur als Outcome projiziert, wenn alle Bedingungen erfüllt sind:

1. Die Quellkarte ist `done` oder `completed`.
2. Der Typ gehört zur freigegebenen Outcome-Taxonomie.
3. Der Typ bezeichnet Außenwirkung oder einen fachlich endgültigen Abschluss.
4. Mindestens eine materielle Evidenzreferenz ist vorhanden.
5. Ein belastbarer Ereigniszeitpunkt ist vorhanden; ersatzweise gilt der Abschlusszeitpunkt der Quellkarte.

Eine Kanban- oder Task-Referenz ist keine materielle Evidenz. Anhänge werden nicht automatisch als Nachweis gewertet. Sie zählen nur, wenn sie ausdrücklich über `OUTCOME_EVIDENCE` referenziert werden und die Karte einen zulässigen Outcome-Typ ausweist.

## Outcome-Taxonomie

Außenwirkung:

- `customer_dialogue_started`
- `human_reply_received`
- `meeting_agreed`
- `test_or_pilot_agreed`
- `offer_sent`
- `invoice_sent`
- `payment_received`
- `release_live`
- `public_asset_published`

Fallabschließende Ergebnisse:

- `incident_resolved`
- `customer_case_resolved`
- `initiative_closed_no_fit`

`offer_created` bleibt als fachlich bekannter Vorläufer in der Taxonomie, wird aber nicht in den Outcome-Feed aufgenommen. Ein erstelltes oder ungenutztes Angebot ist noch keine belegte Außenwirkung.

## Strukturierte Marker

Agenten können die Projektion über folgende Marker in Resultat, Body oder Kommentar eindeutig machen:

```text
OUTCOME_TYPE: offer_sent
OUTCOME_STATEMENT: Angebot an Stadtwerk Beispiel versendet
OUTCOME_EVIDENCE: message-id:<offer-4711@example.org>
OUTCOME_OCCURRED_AT: 2026-11-08T10:15:00Z
OUTCOME_COUNTERPARTY: Stadtwerk Beispiel
OUTCOME_ECONOMIC_RELEVANCE: konkreter Angebotsdialog
```

Für endgültige Abschlüsse kann zusätzlich `OUTCOME_FINAL: true` verwendet werden.

Zulässige Nachweise sind insbesondere Message-/Matrix-Event-IDs, CRM-Conversation-IDs, Termin-/Pilot-/Angebots-/Rechnungs-/Zahlungs-/Release-/Incident-/Publikations-/Case-IDs sowie erreichbare URLs. Der Marker dokumentiert eine Referenz; der Projektor prüft nicht die externe Quelle selbst. Eine spätere Quellverifikation kann als eigener Adapter ergänzt werden.

## Ausschlüsse

Nicht als Outcome gelten:

- Karte erstellt oder verschoben
- Bericht, Analyse oder Policy geschrieben
- Recherche begonnen oder abgeschlossen
- Status aktualisiert
- Agent beauftragt oder gefragt
- Entwurf erzeugt
- unveröffentlichtes Asset
- Angebot nur erstellt
- Abschlussbehauptung ohne materielle Evidenz
- aktive oder nur vorbereitete Quellkarte

## Deduplizierung

Der Ereignisschlüssel besteht aus Outcome-Typ und stärkster normalisierter Evidenzreferenz. CRM- und Kanban-Spiegel desselben realen Ereignisses werden dadurch nur einmal gezählt. Die ID hängt nicht vom Board oder der Task-ID ab.

## Betriebsgrenzen

AP 8 ist ausschließlich eine lesende Projektion. Quellkarten, Anhänge, Kommentare, CRM, Matrix und externe Systeme werden nicht verändert. TWL-private Quellen bleiben durch die bestehende Quell- und API-Filterung ausgeschlossen.
