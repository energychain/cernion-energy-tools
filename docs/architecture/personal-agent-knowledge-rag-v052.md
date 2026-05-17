# Architecture Plan: Personal Agent Knowledge RAG Integration (#CETred v0.52)

## 1. Architekturgrenze & Datenvertrag (Airside)
Der Personal Agent nutzt ausschließlich eine neue Hilfsmethode `queryKnowledgeOrientation` (in `src/personal-agent-knowledge-rag.js`), die den internen Microservice-Call `knowledge-rag.query` kapselt.
Das Ergebnis wird strikt gefiltert: Es gibt **keine Raw-Vector-Payloads** in L4/L3 oder in der Ausgabe. Es wird nur ein abgeleiteter `knowledgeContext` mit Feldern wie `domainHint`, `regulatoryFrame` und `synthesisStyle` erzeugt.
Keine Annahmen über Qdrant, Collection-Namen oder Landside-Details.

## 2. Die 3 Einfügepunkte
- **Vor Routing:** Der `knowledgeContext` wird geholt (synchron, mit hartem Timeout z.B. 2000ms für Graceful Degradation) und an `getBrokerRecommendation` als Hint (`_knowledgeHints`) übergeben.
- **Bei Planbildung:** Die Action-Steps im Deterministic-Plan bekommen ein optionales `contextNote` (z.B. aus `regulatoryFrame`).
- **Bei Synthese:** Das Feld `synthesisStyle` (z.B. `methodological`, `cautionary`) steuert den LLM-Ton für die finale Nutzer-Antwort.

## 3. Leak- und Persistenz-Schutz
- `knowledgeContext` lebt **nur transient im L4-Scope** während des Chat-Turns.
- Er wandert **nicht** in die L3-Persistenz (`buildPersistableSessionState`).
- `assertNoL4RawInPersistedState` in `src/personal-agent-context.js` wird um `knowledgeContext` als verbotenen Key erweitert.
- Keine Duplikation der Evidence-Arbitration aus dem Finance-Agent.

## 4. Implementierungs-Phasen
1. **Airside Adapter:** Erstellung von `src/personal-agent-knowledge-rag.js` und Unit-Tests (`tests/personal-agent-knowledge-rag.test.js`).
2. **Service Integration:** Modifikation der Chat-Pipeline in `services/personal-agent.service.js` (Einfügen des Calls vor dem Routing).
3. **Routing Enrichment:** Hinzufügen von `contextNote` in `src/personal-agent-routing.js`.
4. **Leak Protection & E2E:** Härtung von `src/personal-agent-context.js` und E2E-Blackbox-Test über `/api/personal-agent/chat`.
