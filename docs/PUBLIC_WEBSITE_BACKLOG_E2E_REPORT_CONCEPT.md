# CET Public-Website-Backlog: End-to-End-Report-Konzept

Status: interner Konzept-/README-Entwurf. Dieses Dokument fuehrt Kandidatenschema, Bewertungsrubrik, Release-Signal-Extractor und Agent-Routing zu einem pruefbaren Report-Ablauf zusammen. Es autorisiert keine externen Writes.

## Ziel

Aus einem CET-Release sollen read-only Backlog-Kandidaten entstehen, die Menschen schnell pruefen koennen:

1. Welche Capability ist im Release sichtbar geworden?
2. Welcher technische Anker belegt sie im CHANGELOG und/oder OpenAPI?
3. Fuer welche Zielrolle und Zielseite ist eine public-safe Erklaerung denkbar?
4. Wie reif ist eine Demo-/Website-Erzaehlung?
5. Welche Claim-Grenze verhindert Marketing-, Regulierungs- oder Betriebsueberdehnung?
6. Welcher Folge-Agent kann intern einen Draft, eine Review-Frage oder eine Klaerung vorbereiten?

## Bausteine

| Baustein                 | Datei / Quelle                                                           | Rolle im Ablauf                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kandidatenschema         | `docs/public-website-backlog-candidate-schema.md`                        | Definiert Pflichtfelder, Enums, Nachweisregeln und Validator-Kontrakt fuer maschinenlesbare Kandidaten.                                                                        |
| Bewertungsrubrik         | `docs/PUBLIC_WEBSITE_BACKLOG_RUBRIC.md`                                  | Bewertet Domain-Routing, Demo-Reife D0-D4, Claim-Risiko R0-R3, SEO-/LLM-Discoverability und sichere Handoff-Regeln.                                                            |
| Release-Signal-Extractor | `scripts/extract-release-signals.js`, `docs/release-signal-extractor.md` | Liest CHANGELOG/OpenAPI read-only und erzeugt neutrale Rohsignale ohne GitHub-, Website-, Kanban- oder Deploy-Writes.                                                          |
| Backlog-Generator        | `scripts/generate-public-website-backlog.js`                             | Verdichtet Release-Eintraege und OpenAPI-Operationen zu Kandidaten mit Endpoint/Service, Zielrolle, Website-Zielseite, Demo-Reife, Claim-Risiko, Folge-Agent und Kanalpaketen. |
| Agent-Routing            | `docs/PUBLIC_WEBSITE_BACKLOG_AGENT_ROUTING.md`                           | Uebersetzt Kandidaten in interne Rhajaina-/Webmaster-/Felix-/DevOps-Review-Impulse und Stop-Regeln.                                                                            |

## Geplanter Ablauf

### 1. Release-Quellen fixieren

Input:

- `CHANGELOG.md` aus dem CET-Release oder Release-Kandidaten.
- `openapi-export.json` oder ein lokal gespeichertes `/api/openapi.json` aus derselben Release-Basis.
- Optional: `llm.txt`, README-Abschnitte, Issue-/PR-Nummern nur als Beleganker, nicht als Write-Ziel.

Vorbedingung: Quellen sind public-safe oder intern bereits fuer DevOps/CET sanitized. TWL-Rohkontext, Kundendaten, private Mails oder gemischt-sensitive Signale duerfen nicht in diesen Ablauf.

### 2. Rohsignale extrahieren

Befehl:

```bash
node scripts/extract-release-signals.js --changelog=CHANGELOG.md --openapi=openapi-export.json --format=json --limit=50
```

Ergebnis: `cernion.releaseSignals.v1` mit OpenAPI-Metadaten, Endpoint-Signalen, Service-Clustern und Changelog-Hinweisen. Dieser Schritt dient nur der technischen Orientierung und schreibt nichts.

### 3. Kandidaten erzeugen

Befehl:

```bash
node scripts/generate-public-website-backlog.js --changelog=CHANGELOG.md --openapi=openapi-export.json --limit=30
node scripts/generate-public-website-backlog.js --changelog=CHANGELOG.md --openapi=openapi-export.json --limit=30 --json
```

Jeder Kandidat enthaelt mindestens:

- Capability,
- Endpoint/Service,
- Zielrolle,
- Website-Zielseite,
- Demo-Reife,
- Claim-Risiko,
- Folge-Agent,
- Kanalpakete und Folgehinweis.

### 4. Rubrik anwenden

Der Generator liefert eine erste maschinelle Einordnung. Menschliche Pruefung nutzt danach die Rubrik:

- Domain-Fit: `cernion.de`, `corrently.io`, `stromdao.de`, `corrently.energy` oder kein Public Surface.
- Demo-Reife: D0-D4. D4 bleibt ein Freigabekandidat, kein Publish.
- Claim-Risiko: R0-R3. R2/R3 braucht Rhajaina/Fachowner/HITL oder Schliessung.
- SEO/LLM: Entitaeten, Suchintent, Endpoint-/Doku-Deeplinks, klare Grenzen.

### 5. Routing in interne Folgeimpulse

Empfohlene Routing-Interpretation:

| `recommendedFollowUpAgent` | Bedeutung                                                                                       | Erlaubter naechster Schritt                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `webmaster`                | Website-/FAQ-/SEO-/Doku-Draft ist plausibel und claim-sicher genug fuer einen internen Entwurf. | Interne Webmaster-REQUEST auf `public-web-presence`; kein PR/Publish.  |
| `felix-demo-sales`         | B2B-Demo-Narrativ oder Zielsegment-Fit ist die Hauptarbeit.                                     | Interne Felix-REQUEST fuer Demo-/Talking-Point-Draft; kein Versand.    |
| `rhajaina-claim-review`    | Claim-, Herkunfts- oder Freigabegrenze ist unklar/hoch.                                         | Review-Fragen, erlaubte Nicht-Zusagen, ggf. HITL-Blocker.              |
| `devops-api-check`         | Developer-/OpenAPI-/corrently.io-Discoverability braucht technische Doku-Klaerung.              | Doku-/Beispiel-/Endpoint-Pruefung; kein GitHub-Issue/PR ohne Freigabe. |

## Minimaler Akzeptanztest

Automatisiert in `tests/generate-public-website-backlog.test.js`:

- Gegeben ist ein Beispiel-Changelog mit zwei Added-Eintraegen.
- Gegeben ist ein Beispiel-OpenAPI-Dokument mit zwei passenden Pfaden.
- Erwartet werden mindestens zwei Kandidaten.
- Jeder relevante Kandidat muss Capability, Endpoint/Service, Zielrolle, Website-Zielseite, Demo-Reife, Claim-Risiko und Folge-Agent enthalten.
- Der Markdown-Report muss die Spalte `Folge-Agent` ausgeben.

Fokussierter Testlauf:

```bash
npx jest tests/generate-public-website-backlog.test.js --runInBand --forceExit
```

## Beispielinput

### Beispiel-CHANGELOG

```md
# Changelog

## [0.68.0] — 2026-07-22

### Added

- **Municipal Energy Value Lagebild Endpoint** (#501): New endpoint `GET /api/dashboard/municipal-energy-value-analysis` exposes read-only dashboard rows with SLP proxy evidence and no billing relevance.
- **Historical portfolio market value backtest** (#502): New endpoint `POST /api/energy-market/portfolio-backtest` provides demo-ready read-only market value backtests with no-call guardrails.
```

### Beispiel-openapi.json (gekuerzt)

```json
{
  "openapi": "3.0.0",
  "info": { "title": "Cernion Energy Tools API", "version": "0.68.0" },
  "paths": {
    "/api/dashboard/municipal-energy-value-analysis": {
      "get": {
        "operationId": "dashboard_municipalEnergyValueAnalysisStatus",
        "summary": "Municipal Energy Value Lagebild Endpoint",
        "description": "Read-only municipal energy value analysis with SLP proxy evidence.",
        "tags": ["Dashboard API"],
        "x-ui-page": "dashboard"
      }
    },
    "/api/energy-market/portfolio-backtest": {
      "post": {
        "operationId": "energy-market_portfolioBacktest",
        "summary": "Historical portfolio market value backtest",
        "description": "Read-only market value backtest for demo portfolios.",
        "tags": ["Energy Market"],
        "x-ui-page": "energy-market"
      }
    }
  }
}
```

## Beispielreport

Erzeugt mit:

```bash
node scripts/generate-public-website-backlog.js --changelog=/tmp/cet-e2e-report-changelog.md --openapi=/tmp/cet-e2e-report-openapi.json --limit=10
```

```md
# CET Public Website Backlog Candidates

Read-only Ableitung aus CHANGELOG.md und openapi-export.json. Kein GitHub-/Website-/Kanban-Write.

- generatedAt: 2026-07-22T23:34:24.070Z
- candidateCount: 2

| Capability                                 | Endpoint/Service                                   | Zielrolle | Website-Zielseite                 | Demo-Reife | Claim-Risiko                        | Folge-Agent      | Kanalpakete                                                                                                                                                                                                                                                                                     | Folgehinweis                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------- | --------- | --------------------------------- | ---------- | ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| municipal-energy-value-lagebild-endpoint   | GET /api/dashboard/municipal-energy-value-analysis | Felix     | cernion.de/kommunale-energiedaten | demo-ready | low (read-only, evidence)           | felix-demo-sales | Webmaster: send-ready-draft via cernion.de/corrently.io/stromdao.de<br>Rhajaina: review-package via Claim-Governance/Freigabe-/Nachweisprüfung<br>Felix: send-ready-draft via LinkedIn/Pubbler/B2B-E-Mail-Kontakte<br>Viki: send-ready-draft via Viki-Markt-Scouting/LinkedIn-Signalbeobachtung | Added-Release-Kandidat: Endpoint-Bezug prüfen: GET /api/dashboard/municipal-energy-value-analysis. Claim als read-only/guarded formulieren. |
| historical-portfolio-market-value-backtest | POST /api/energy-market/portfolio-backtest         | Felix     | cernion.de/energy-market-api      | demo-ready | low (read-only, no-call, guardrail) | felix-demo-sales | Webmaster: send-ready-draft via cernion.de/corrently.io/stromdao.de<br>Rhajaina: review-package via Claim-Governance/Freigabe-/Nachweisprüfung<br>Felix: send-ready-draft via LinkedIn/Pubbler/B2B-E-Mail-Kontakte<br>Viki: send-ready-draft via Viki-Markt-Scouting/LinkedIn-Signalbeobachtung | Added-Release-Kandidat: Endpoint-Bezug prüfen: POST /api/energy-market/portfolio-backtest. Claim als read-only/guarded formulieren.         |
```

Interpretation: Die beiden Beispielkandidaten sind review-faehige interne Draft-Impulse. `send-ready-draft` in Kanalpaketen bedeutet nur, dass ein interner Entwurf formuliert werden kann; es ist keine Versand- oder Publish-Freigabe.

## Bekannte Grenzen

- Heuristische Zuordnung: Keywords und OpenAPI-Matching koennen Zielrolle, Zielseite oder Follow-up-Agent falsch priorisieren.
- CHANGELOG-Qualitaet bestimmt die Signalqualitaet; zu knappe Eintraege erzeugen schwache Kandidaten.
- OpenAPI-only Operations ohne Changelog-Bezug koennen technisch sichtbar sein, sind aber nicht automatisch release-relevant.
- Claim-Risiko erkennt Triggerwoerter, ersetzt aber keine fachliche/regulatorische Pruefung.
- Demo-Reife basiert auf Textsignalen wie `read-only`, `demo`, `no-call`, `guardrail`; echte Demo-UX, Screenshots oder Tenant-Zustaende werden nicht geprueft.
- Der Ablauf prueft keine Website-Bestaende live und entscheidet nicht, ob eine Zielseite tatsaechlich existiert.
- Viki-/Felix-/Webmaster-Kanalpakete sind Entwurfsformen; echte externe Kommunikation braucht separate Freigabe.

## Explizite Nicht-Ziele

- Keine automatischen GitHub-Issue-, Label-, Branch-, PR- oder Release-Writes.
- Keine Website-, CMS-, BookStack-, stromdao.de-, cernion.de-, corrently.io- oder corrently.energy-Writes.
- Keine Deployments, Restarts, PM2/Systemd/Docker-Aktionen oder Serveraenderungen.
- Keine externen E-Mails, LinkedIn-/Pubbler-Posts, Kundenansprachen oder CRM-Fakten ohne Quelle.
- Keine Uebernahme von TWL-Rohkontext, Kundendaten, privaten Mails oder gemischt-sensitiver Herkunft.
- Keine fachliche Garantie zu Preisen, Einsparungen, Abrechnung, Settlement, Genehmigung, Vertrag oder Rechtswirkung.

## Sichere naechste Nutzung

1. Release-Signale read-only extrahieren.
2. Kandidatenbericht erzeugen.
3. Menschlich gegen Rubrik und Routing-Spezifikation pruefen.
4. Falls public-web-wertvoll: interne REQUEST an `webmaster` auf `public-web-presence` formulieren.
5. Falls Claim- oder Herkunftsrisiko: Rhajaina-/HITL-Review statt Public-Web-Folge.
6. Erst nach expliziter Freigabe PR/Publish/Send/Deploy als separate Aufgabe behandeln.
