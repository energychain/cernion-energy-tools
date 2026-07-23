# CET Backlog-Kandidatenschema

Ziel: kompakte, maschinenlesbare Struktur fuer Backlog-Kandidaten, die read-only aus `CHANGELOG.md` und `openapi-export.json` beziehungsweise `/api/openapi.json` abgeleitet werden. Das Schema ist ein Entscheidungs- und Handoff-Format; es loest keine GitHub-, Website-, CRM-, Matrix- oder Kanban-Writes aus.

## JSON-Zielformat

```json
{
  "schemaVersion": "cernion.publicWebsiteBacklogCandidate.v1",
  "generatedAt": "2026-07-22T00:00:00.000Z",
  "sourceSet": {
    "changelogPath": "CHANGELOG.md",
    "openapiPath": "openapi-export.json",
    "openapiInfoVersion": "0.67.8"
  },
  "candidates": [
    {
      "id": "0.67.10:historical-portfolio-market-value-backtest",
      "capability": "historical-portfolio-market-value-backtest",
      "endpointOrService": ["POST /api/energy-market/portfolio-backtest", "Energy Market"],
      "targetRole": "Stadtwerk-Produktmanager",
      "websiteTargetPage": "cernion.de/energy-market-api",
      "demoReadiness": "api-visible-needs-demo-story",
      "claimRisk": "medium",
      "sourceEvidence": [
        {
          "source": "CHANGELOG.md",
          "locator": "0.67.10 Added",
          "excerpt": "New endpoint POST /api/energy-market/portfolio-backtest computes the Day-Ahead spot market value ..."
        },
        {
          "source": "openapi-export.json",
          "locator": "paths['/api/energy-market/portfolio-backtest'].post",
          "excerpt": "Historical portfolio market value backtest"
        }
      ],
      "recommendedFollowUpAgent": "webmaster",
      "rationale": "API-Anker ist sichtbar; oeffentliche Story muss Wertbeitrag, Annahmen und Grenzen ohne Garantie-/Abrechnungsclaim erklaeren."
    }
  ]
}
```

## Felddefinitionen

| Feld                                    | Typ              | Pflicht  | Zulaessige Werte / Regeln                                                                                                                                                                                                                                       | Beispiel                                                                                                          |
| --------------------------------------- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                         | string           | ja       | Fix fuer dieses Format: `cernion.publicWebsiteBacklogCandidate.v1`. Bei inkompatiblen Feld-/Enum-Aenderungen hochzaehlen.                                                                                                                                       | `cernion.publicWebsiteBacklogCandidate.v1`                                                                        |
| `generatedAt`                           | string, ISO-8601 | ja       | UTC-Zeitpunkt der Ableitung; reine Provenienz, kein Freigabezeitpunkt.                                                                                                                                                                                          | `2026-07-22T00:00:00.000Z`                                                                                        |
| `sourceSet`                             | object           | ja       | Quellen, aus denen die Kandidaten abgeleitet wurden. Muss mindestens `changelogPath` und `openapiPath` enthalten; `openapiInfoVersion` empfohlen.                                                                                                               | siehe JSON oben                                                                                                   |
| `candidates[]`                          | array<object>    | ja       | Kann leer sein; Reihenfolge darf Priorisierung abbilden, ist aber keine Veroeffentlichungsfreigabe.                                                                                                                                                             | `[ { ... } ]`                                                                                                     |
| `candidates[].id`                       | string           | ja       | Stabiler, slugfaehiger Schluessel aus Release/Abschnitt und Capability; keine Datenbank-ID. Muster: `<release>:<slug>`.                                                                                                                                         | `0.67.10:historical-portfolio-market-value-backtest`                                                              |
| `candidates[].capability`               | string           | ja       | Kurzer Capability-Slug oder bekannter CET-Capability-Key; energy-decision-support Sprache bevorzugen: Lagebild, Backtest, Evidenzmatrix, Guardrail, Governance-Readiness.                                                                                       | `municipal-energy-value-lagebild`                                                                                 |
| `candidates[].endpointOrService`        | array<string>    | ja       | Mindestens ein API-Endpunkt (`METHOD /api/...`) oder Service/Tag (`Dashboard API`, `Energy Market`, `VDMI Blueprint Pack`). Mehrere Werte erlaubt, wenn CHANGELOG und OpenAPI mehrere Anker liefern.                                                            | `["GET /api/dashboard/municipal-energy-value-analysis", "Dashboard API"]`                                         |
| `candidates[].targetRole`               | string           | ja       | Fachliche Zielrolle, nicht zwingend interner Agent. Empfohlene Werte: `Stadtwerk-Produktmanager`, `VNB-Netzplanung`, `Regulierungs-/Governance-Verantwortliche`, `Kommunale Entscheider`, `Cernion-Webmaster`, `Cernion-Demo/Vertrieb`, `Cernion-Claim-Review`. | `Kommunale Entscheider`                                                                                           |
| `candidates[].websiteTargetPage`        | string           | ja       | Zielseite oder Platzhalter. Erlaubt sind konkrete Cernion-Zielseiten (`cernion.de/...`) oder `cernion.de/produkt-roadmap` fuer noch nicht positionierte Kandidaten. Keine automatische Publikationsannahme.                                                     | `cernion.de/kommunale-energiedaten`                                                                               |
| `candidates[].demoReadiness`            | enum string      | ja       | `demo-ready`, `needs-demo-copy-review`, `api-visible-needs-demo-story`, `concept-only`, `blocked-unverified`. `demo-ready` nur bei API-/Demo-Anker plus read-only/No-Call/Guardrail-Beleg.                                                                      | `needs-demo-copy-review`                                                                                          |
| `candidates[].claimRisk`                | enum string      | ja       | `low`, `medium`, `high`. `low` nur fuer belegte read-only/Guardrail/Synthetic-Demo-Aussagen; `high` bei Garantie, Abrechnung, Steuerung, Approval/Rejection, Vertrags-/Rechtswirkung oder Produktionsmutation ohne klare No-Call-Grenze.                        | `medium`                                                                                                          |
| `candidates[].sourceEvidence`           | array<object>    | ja       | Mindestens eine CHANGELOG-Belegstelle; OpenAPI-Belegstelle verpflichtend, sobald ein Endpoint behauptet wird. Jedes Objekt: `source`, `locator`, `excerpt`. Excerpt knapp, keine Secrets/PII.                                                                   | `[{"source":"CHANGELOG.md","locator":"0.67.8 Added","excerpt":"derivedLoadProfileRows ..."}]`                     |
| `candidates[].recommendedFollowUpAgent` | enum string      | ja       | Interner Folge-Agent oder Prozessrolle. Empfohlene Werte: `webmaster`, `felix-demo-sales`, `rhajaina-claim-review`, `viki-market-scouting`, `devops-api-check`, `product-owner-decision`. Bedeutet Handoff-Empfehlung, keine automatische Ausfuehrung.          | `rhajaina-claim-review`                                                                                           |
| `candidates[].rationale`                | string           | ja       | 1-3 Saetze: Warum ist der Kandidat relevant, welcher Beleg traegt ihn, welche Grenze muss beachtet werden. Muss claim-sicher formuliert sein.                                                                                                                   | `Oeffentlich gut erklaerbarer Lagebild-Endpunkt; lokale Werterfassung bleibt als Evidenzstatus/Annahme markiert.` |
| `candidates[].confidence`               | enum string      | optional | `high`, `medium`, `low`; confidence ist Ableitungsqualitaet, nicht fachliche Wahrheitsgarantie.                                                                                                                                                                 | `medium`                                                                                                          |
| `candidates[].tags`                     | array<string>    | optional | Kleine Normalisierungsanker fuer Suche/Priorisierung, z. B. `read-only`, `guardrail`, `vdmi`, `kommunal`, `market-value`, `openapi`.                                                                                                                            | `["read-only", "kommunal", "guardrail"]`                                                                          |
| `candidates[].nextAction`               | string           | optional | Konkreter naechster Pruef-/Draft-Schritt; kein Sendebefehl.                                                                                                                                                                                                     | `Website-Draft mit Annahmen- und No-Autarky-Grenzen formulieren.`                                                 |

## Normierungsregeln

1. `endpointOrService` darf nur Endpunkte enthalten, die in `openapi-export.json` oder `/api/openapi.json` nachweisbar sind; sonst nur Service-/Capability-Text wie `VDMI Blueprint Pack` verwenden.
2. `websiteTargetPage` ist eine Zielannahme fuer Redaktion und SEO, nicht die Anweisung zu schreiben oder zu deployen.
3. `demoReadiness = demo-ready` braucht alle drei Signale: pruefbarer API-/Demo-Anker, Demo-/Fixture-/Workbench-Hinweis, und read-only/No-Call/Guardrail/Synthetic-Beleg.
4. `claimRisk` ist konservativ: unklare externe Wirkung bleibt `medium`; Mutation, Abrechnung, Steuerung, Approval/Rejection oder Garantie ohne klare Grenzen wird `high`.
5. `sourceEvidence[].excerpt` soll Belege reproduzierbar machen, aber keine langen CHANGELOG-Abschnitte kopieren.
6. Sprache: Capability- und Rationale-Texte sollen CET-typisch vorsichtig formulieren: Lagebild, Evidenz, Annahme, Pruefpfad, Guardrail, Read-only, Demo-Raum; keine Erfolgs-, Autarkie-, Garantie- oder Rechtswirkungsclaims.

## Beispiel-Kandidaten aus hypothetischen CET-Release-Aenderungen

```json
[
  {
    "id": "0.67.10:historical-portfolio-market-value-backtest",
    "capability": "historical-portfolio-market-value-backtest",
    "endpointOrService": ["POST /api/energy-market/portfolio-backtest", "Energy Market"],
    "targetRole": "Stadtwerk-Produktmanager",
    "websiteTargetPage": "cernion.de/energy-market-api",
    "demoReadiness": "api-visible-needs-demo-story",
    "claimRisk": "medium",
    "sourceEvidence": [
      {
        "source": "CHANGELOG.md",
        "locator": "0.67.10 Added",
        "excerpt": "New endpoint POST /api/energy-market/portfolio-backtest computes the Day-Ahead spot market value for an asset portfolio."
      },
      {
        "source": "openapi-export.json",
        "locator": "paths['/api/energy-market/portfolio-backtest'].post",
        "excerpt": "Historical portfolio market value backtest"
      }
    ],
    "recommendedFollowUpAgent": "webmaster",
    "rationale": "Starker API-Anker fuer eine oeffentliche Entscheidungsunterstuetzungsseite. Der Claim muss als Backtest/Lagebild mit Annahmen und Datenqualitaetsgrenzen formuliert werden, nicht als Erlosgarantie.",
    "confidence": "high",
    "tags": ["market-value", "backtest", "openapi"],
    "nextAction": "Demo-Story mit Beispielportfolio, Datenqualitaetsstufen und Negativpreis-Grenzen formulieren."
  },
  {
    "id": "0.67.8:derived-municipal-load-profile",
    "capability": "derived-municipal-load-profile",
    "endpointOrService": ["GET /api/dashboard/municipal-energy-value-analysis", "Dashboard API"],
    "targetRole": "Kommunale Entscheider",
    "websiteTargetPage": "cernion.de/kommunale-energiedaten",
    "demoReadiness": "needs-demo-copy-review",
    "claimRisk": "low",
    "sourceEvidence": [
      {
        "source": "CHANGELOG.md",
        "locator": "0.67.8 Added",
        "excerpt": "Bevoelkerungsbasierte Jahres-Lastkurve ... SLP-Proxy; kein Messwert."
      },
      {
        "source": "openapi-export.json",
        "locator": "paths['/api/dashboard/municipal-energy-value-analysis'].get",
        "excerpt": "Municipal Energy Value Lagebild Endpoint"
      }
    ],
    "recommendedFollowUpAgent": "rhajaina-claim-review",
    "rationale": "Guter kommunaler Lagebild-Kandidat, weil fehlende Messwerte als Evidenzstatus/SLP-Proxy transparent bleiben. Vor externer Kommunikation muss die Grenze 'kein Messwert, nicht abrechnungsrelevant' sichtbar bleiben.",
    "confidence": "medium",
    "tags": ["kommunal", "lagebild", "missing-evidence", "guardrail"],
    "nextAction": "Claim-Review fuer SLP-Proxy-, No-Autarky- und Nichtabrechnungsformulierungen."
  },
  {
    "id": "unreleased:flexible-grid-connection-release-file",
    "capability": "flexible-grid-connection-release-file-review",
    "endpointOrService": ["VDMI Blueprint Pack", "Dashboard API"],
    "targetRole": "VNB-Netzplanung",
    "websiteTargetPage": "cernion.de/vdmi-governance",
    "demoReadiness": "concept-only",
    "claimRisk": "low",
    "sourceEvidence": [
      {
        "source": "CHANGELOG.md",
        "locator": "Unreleased Added",
        "excerpt": "read-only vdmi_blueprint_pack_seed ... required release-file evidence gates ... no-call guards for capacity reservation, connection approval/rejection, contract creation ..."
      }
    ],
    "recommendedFollowUpAgent": "felix-demo-sales",
    "rationale": "Als Governance-/Pruefpfad gut erzaehlbar, aber ohne direkten oeffentlichen Endpoint-Anker zunaechst nur Konzept-/Demo-Packaging. No-Call-Grenzen verhindern, dass die Website eine Anschlusszusage oder Kapazitaetsreservierung suggeriert.",
    "confidence": "medium",
    "tags": ["vdmi", "grid-connection", "read-only", "no-call"],
    "nextAction": "Demo-Raum oder Screenshot-/Dossier-Paket definieren, bevor ein oeffentlicher Website-Draft entsteht."
  }
]
```

## Minimaler Validator-Kontrakt

- Alle Pflichtfelder muessen vorhanden und nicht leer sein.
- Enum-Werte muessen exakt den oben genannten Werten entsprechen.
- Jeder Endpoint-Wert im Muster `METHOD /api/...` muss gegen OpenAPI validiert werden.
- `claimRisk = low` darf nicht gesetzt werden, wenn `rationale` oder `sourceEvidence[].excerpt` ungerahmte Hochrisiko-Begriffe enthaelt (`guarantee`, `Garantie`, `Abrechnung`, `settlement`, `approval`, `rejection`, `device-control`, `Steuerung`) und kein No-Call-/Read-only-Kontext belegt ist.
- Kandidaten mit `demoReadiness = demo-ready` und `claimRisk != low` bleiben intern pruefbar, aber nicht send-ready.
