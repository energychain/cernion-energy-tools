# Personal-Agent Multi-Turn Domain E2E (Blackbox)

## Ziel
Diese Testplanung definiert drei Multi-Turn-Szenarien, die **ausschließlich** über `POST /api/personal-agent/chat` ausgeführt werden.

## Rahmenbedingungen
- Tenant-Header: `x-tenant-id: agentic-hackathon`
- Content-Type: `application/json`
- Keine direkten Aufrufe von Unter-Services (`/api/assets/**`, `/api/znp/**`, `/api/grid-operations/**`, ...)
- Keine Service-Mocks, kein Axios-Mocking
- Echter HTTP-Blackbox-Flow gegen laufenden Dev-Server

## Ausführung
Die Jest-Suite ist opt-in, damit CI ohne laufenden Dev-Server stabil bleibt.

```bash
RUN_PERSONAL_AGENT_E2E=true PERSONAL_AGENT_E2E_BASE_URL=http://127.0.0.1:3000 npx jest --runInBand tests/e2e/personal-agent/multi-turn-domain.e2e.test.js
```

## Szenario 1
```yaml
scenarioId: "PA-MT-001"
title: "Journalist CYA-Fallback"
persona: "PS-MT-JR"
tenant: "agentic-hackathon"
priority: 1
turns:
  - turn: 1
    userMessage: "Ich recherchiere zur Versorgungssicherheit. Was ist der aktuelle Stand?"
    expected:
      capability: "cya.generate"
      operationId: "cya.generate"
      responseConstraints:
        - "antwort enthaelt vorsichtige Einordnung oder Quellen-Hinweis"
        - "keine internen Fehlercodes"
      contextMutation: "add"
  - turn: 2
    userMessage: "Bitte nur belastbare Aussagen und kennzeichne Unsicherheiten klar."
    expected:
      capability: "cya.generate"
      operationId: "cya.generate"
      responseConstraints:
        - "antwort markiert Unsicherheiten/Annahmen transparent"
        - "keine internen Fehlercodes"
      contextMutation: "add"
  - turn: 3
    userMessage: "Fasse die Kernaussagen in drei Punkten zusammen."
    expected:
      capability: "cya.generate"
      operationId: "cya.generate"
      responseConstraints:
        - "antwort liefert strukturierte Kurz-Zusammenfassung"
      contextMutation: "add"
  - turn: 4
    userMessage: "Gib ein journalistisches Fazit ohne Spekulationen."
    expected:
      capability: "cya.generate"
      operationId: "cya.generate"
      responseConstraints:
        - "antwort vermeidet Spekulationssprache"
      contextMutation: "add"
    zwiebelCheck:
      l3Compression: true
```

## Szenario 2
```yaml
scenarioId: "PA-MT-002"
title: "Benchmark: Rangliste und Vergleich"
persona: "PS-MT-AN"
tenant: "agentic-hackathon"
priority: 2
turns:
  - turn: 1
    userMessage: "Vergleiche bitte zwei Netzbetreiber hinsichtlich Anschlussgeschwindigkeit."
    expected:
      capability: "benchmark.vnb"
      operationId: "finance-agent.benchmarkComparison"
      responseConstraints:
        - "antwort liefert Vergleichsaussage"
        - "keine internen Fehlercodes"
      contextMutation: "add"
  - turn: 2
    userMessage: "Ergaenze Digitalisierung und Umsetzungsquote im Vergleich."
    expected:
      capability: "benchmark.vnb"
      operationId: "finance-agent.benchmarkComparison"
      responseConstraints:
        - "antwort bleibt im Vergleichsmodus"
      contextMutation: "add"
  - turn: 3
    userMessage: "Gewichte Anschlussgeschwindigkeit hoechst und fasse das Ergebnis zusammen."
    expected:
      capability: "benchmark.vnb"
      operationId: "finance-agent.benchmarkComparison"
      responseConstraints:
        - "antwort synthetisiert Informationen aus vorherigen Turns"
      contextMutation: "add"
  - turn: 4
    userMessage: "Erstelle eine Rangliste mit kurzer Begruendung."
    expected:
      capability: "benchmark.vnb"
      operationId: "finance-agent.benchmarkComparison"
      responseConstraints:
        - "antwort liefert Rangliste oder Vergleich"
        - "synthetisiert Informationen aus vorherigen Turns"
      contextMutation: "add"
    zwiebelCheck:
      l3Compression: true
```

## Szenario 3
```yaml
scenarioId: "PA-MT-003"
title: "Vorstand: Anschlussbegehren Rechenzentrum N-1 fNAV"
persona: "PS-MT-VB"
tenant: "agentic-hackathon"
priority: 1
turns:
  - turn: 1
    userMessage: "Wir pruefen ein Anschlussbegehren fuer ein Rechenzentrum in Frankfurt. Wie ist der Stand?"
    expected:
      capability: "grid-connection.application"
      operationId: "grid-connection.application.status"
      responseConstraints:
        - "antwort enthaelt Status oder Prozessstand"
        - "N-1 Limit-Pruefung wird erwaehnt wenn verfuegbar"
        - "fNAV-Prognose wird genannt wenn verfuegbar"
        - "keine internen Fehlercodes"
      contextMutation: "add"
  - turn: 2
    userMessage: "Was bedeutet das fuer unsere N-1 Reserve?"
    expected:
      capability: "znp.n1-analysis"
      operationId: "znp.n1-analysis"
      responseConstraints:
        - "antwort erklaert N-1 Auswirkungen basierend auf vorherigem Kontext"
        - "keine direkten Service-Fehler sichtbar"
      contextMutation: "add"
    guardRails:
      - "must not invent reserve margins"
  - turn: 3
    userMessage: "Projiziere den fNAV fuer die naechsten 5 Jahre."
    expected:
      capability: "znp.fnav-projection"
      operationId: "znp.fnav-projection"
      responseConstraints:
        - "antwort enthaelt zahlenbasierte fNAV-Trendaussage"
        - "keine Halluzination von Jahreszahlen"
      contextMutation: "add"
  - turn: 4
    userMessage: "Wir verlagern das Projekt nach Muenchen. Aktualisiere die Pruefung."
    expected:
      capability: "grid-connection.application"
      parametersPresent: ["location"]
      responseConstraints:
        - "antwort bezieht sich auf Muenchen"
        - "kein Bezug mehr zu Frankfurt"
        - "N-1 und fNAV fuer neuen Standort"
      contextMutation: "replace"
    zwiebelCheck:
      l3Compression: true
      l4Purge: true
```
