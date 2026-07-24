# CET Public Website Backlog Agent Routing

Dieses Dokument spezifiziert, wie erzeugte Public-Website-Backlog-Kandidaten in konkrete interne Folgeimpulse fuer Rhajaina, Webmaster und Felix uebersetzt werden. Es ergaenzt `public-website-backlog-candidate-schema.md` und `PUBLIC_WEBSITE_BACKLOG_RUBRIC.md`.

Die Routing-Entscheidung erzeugt nur Aufgabenentwuerfe oder Review-Impulse. Sie sendet keine externen Nachrichten, schreibt keine GitHub-Issues/PRs, publiziert keine Website-Aenderungen und startet keine Deployments.

## 1. Routing-Grundsatz

1. Jeder Kandidat bleibt ein interner Draft, bis ein expliziter HITL-, PR-, Publish- oder Sending-Schritt freigegeben ist.
2. Rhajaina ist Default-Owner fuer Triage, Claim-Grenzen, Stop-Regeln und unklare Mehrfachzustandigkeit.
3. Webmaster ist Owner fuer oeffentliche Struktur-, SEO-, FAQ-, Doku- und Website-Draft-Arbeit, solange der Inhalt belegbar und claim-sicher formulierbar ist.
4. Felix ist Owner fuer B2B-Sales-Narrative, Zielkunden-Segmentierung, Demo-Gespraechsleitfaeden und Follow-up-Entwuerfe ohne externen Versand.
5. Bei R2/R3-Claim-Risiko, sensitiver Herkunft, fehlendem Beleg oder externer Wirkung wird nicht automatisch geroutet, sondern als Review-/HITL-Impuls markiert.

## 2. Routing-Tabelle

| Bedingung im Kandidaten                                                                                  | Primaerer Folgeimpuls                                      | Sekundaerer Review                                       | Prioritaetssignal                                                       | Naechster sicherer Schritt                                                | Stop-Gate                                                            |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `recommendedFollowUpAgent = rhajaina-claim-review` oder `claimRisk = high`                               | Rhajaina                                                   | Fachowner nach Bedarf                                    | Hoch, wenn Website-/Sales-Nutzen plausibel und nur Claim-Grenzen fehlen | Claim-Grenzen, erlaubte Nicht-Zusagen und Ziel-Owner klaeren              | Keine Website-, Sales- oder GitHub-Aktion vor Freigabe               |
| `recommendedFollowUpAgent = webmaster` und `claimRisk = low                                              | medium`, `demoReadiness != concept-only                    | blocked-unverified`                                      | Webmaster                                                               | Rhajaina bei R1/R2-Begriffen; Felix bei B2B-CTA                           | Hoch bei stabilem OpenAPI-/CHANGELOG-Beleg plus klarer Zielseite     | Website-/FAQ-/SEO-Draft mit Quellenankern vorbereiten          | Kein PR, Publish, Deployment oder Live-CMS-Write |
| `recommendedFollowUpAgent = felix-demo-sales` oder Zielrolle `Cernion-Demo/Vertrieb`, Stadtwerk/VNB/B2B  | Felix                                                      | Rhajaina bei Claims; Webmaster bei spaeterem Website-Fit | Hoch bei demo-ready/read-only und konkretem Zielsegment                 | Demo-Narrativ, Gespraechsleitfaden oder Follow-up-Mailentwurf vorbereiten | Kein Versand, keine Preis-/Vertragszusage, kein CRM-Fakt ohne Quelle |
| Developer-/OSS-Fokus, Zielseite `corrently.io`, API-Rezept- oder Auth-/curl-Luecke                       | Webmaster als Sichtbarkeits-Steward oder DevOps-Doku-Folge | Rhajaina, falls aus Website-Backlog nicht eindeutig      | Mittel; hoch nur bei starker OpenAPI-Relevanz fuer Public Discovery     | Doku-/LLM-Discoverability-Draft oder DevOps-Folgeimpuls formulieren       | Kein GitHub-Issue/PR ohne separate Freigabe                          |
| `demoReadiness = concept-only` bei `claimRisk = low                                                      | medium`                                                    | Felix oder Rhajaina, je nach Nutzenfrage                 | Webmaster erst nach Demo-/Story-Klaerung                                | Mittel, wenn Zielsegment klar; niedrig ohne Zielrolle                     | Demo-Story, Artefaktbedarf und Nicht-Claims klaeren                  | Keine Landingpage- oder Sales-Aussage als send-ready markieren |
| `demoReadiness = blocked-unverified`, fehlende OpenAPI-Belege, R3-Signal, TWL/private/sensitive Herkunft | Rhajaina blockt oder schliesst als interne Beobachtung     | keiner ohne sanitized Signal                             | Niedrig bis Stop                                                        | Nur sanitized Steering-Signal, Quellenklaerung oder bewusste Schliessung  | Kein Export in Webmaster/Felix-Kontext mit Rohdetails                |

## 3. Prioritaetssignale

Prioritaet wird aus Nutzensignal, Belegbarkeit und Risiko gebildet; sie ist keine Freigabe.

| Signal               | Hoch                                                                      | Mittel                                                    | Niedrig / Parken                                                  |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Belegbarkeit         | CHANGELOG plus OpenAPI-Endpunkt oder Demo-Artefakt                        | CHANGELOG oder Service-Anker, aber kein stabiler Endpoint | nur Idee, Marktimpuls oder unklare Herkunft                       |
| Oeffentlicher Nutzen | klarer B2B-, Developer- oder Governance-Suchintent                        | Nutzen erklaerbar, aber Zielseite/Zielrolle offen         | Nutzen nur mit internen Details erklaerbar                        |
| Demo-Reife           | `demo-ready` oder `needs-demo-copy-review` mit No-Call-/Read-only-Grenzen | `api-visible-needs-demo-story` oder `concept-only`        | `blocked-unverified`                                              |
| Claim-Risiko         | R0/R1, keine kommerziellen/regulatorischen Zusagen                        | R1/R2 mit klaren Review-Fragen                            | R3 oder ungerahmte Garantie-/Preis-/Vertrags-/Kundendatenbegriffe |
| Timing               | aktueller Release-, Changelog- oder Kampagnenbezug                        | Roadmap-/Doku-Bezug                                       | kein Anlass oder bewusstes Beobachtungsthema                      |

Empfohlene Prioritaetslabels fuer Aufgabenentwuerfe:

- `P1-review-now`: Starker Beleg, oeffentlicher Nutzen, naechster Schritt ist nur Review/Draft; keine externe Aktion.
- `P2-draft-when-capacity`: Solider Kandidat, aber Story/Zielseite oder Demo-Raum braucht Ausarbeitung.
- `P3-watchlist`: Interessant, aber kein public-safe Draft moeglich.
- `STOP-sensitive-or-actioning`: Nicht weiter routen, bis Rhajaina/HITL sanitized Kontext oder Schliessung bestaetigt.

## 4. HITL-Entscheidungspunkte

Ein Aufgabenentwurf muss als HITL- oder Review-Punkt sichtbar werden, wenn mindestens eine Bedingung zutrifft:

- externer Versand, LinkedIn/Post, Mailing, Kundenansprache oder Follow-up-Mail waere der naechste Schritt;
- Website-PR, CMS-Publish, GitHub-Issue/PR-Publishing, Deployment oder produktiver Restart waere noetig;
- Preis-, Tarif-, Vertrags-, Angebots-, Rechts-, Abrechnungs-, Settlement-, Genehmigungs-, Garantie- oder Einsparungsclaim erscheint;
- echte Kunden-/Partner-/Personenreferenz, privater Mailinhalt oder vertrauliche Herkunft ist beteiligt;
- TWL-Rohkontext oder gemischte sensitive Herkunft ist moeglich;
- Felix soll eine Zusage, ein Angebot oder eine konkrete Kontaktaufnahme vorbereiten, die ueber einen internen Entwurf hinausgeht;
- Webmaster koennte aus dem Draft direkt live publizieren, statt nur einen Review-/PR-Entwurf zu erzeugen.

HITL-Formulierung im Aufgabenentwurf:

```json
{
  "hitlRequired": true,
  "hitlReason": "Publish-/Sending-/Claim-Gate: externer Einsatz erst nach Freigabe",
  "allowedAutonomousWork": ["interner Draft", "Quellenanker pruefen", "Review-Fragen formulieren"],
  "forbiddenUntilApproved": ["Senden", "Publish", "PR erstellen", "Preis-/Vertragszusage"]
}
```

## 5. Mindestinformationen pro Aufgabenentwurf

Jeder aus einem Kandidaten erzeugte Folgeimpuls soll mindestens diese Felder enthalten:

```json
{
  "topicKey": "#CETPublicWebsiteBacklog/#CapabilitySlug",
  "candidateId": "<release>:<slug>",
  "sourceEvidence": [
    { "source": "CHANGELOG.md", "locator": "...", "excerpt": "..." },
    { "source": "openapi-export.json", "locator": "...", "excerpt": "..." }
  ],
  "routingOwner": "Rhajaina | Webmaster | Felix",
  "routingReason": "Warum dieser Owner und kein anderer",
  "prioritySignal": "P1-review-now | P2-draft-when-capacity | P3-watchlist | STOP-sensitive-or-actioning",
  "targetAudience": "Stadtwerk/VNB/Developer/Kommunale Entscheider/interne Review-Rolle",
  "targetSurface": "cernion.de/... | corrently.io/... | stromdao.de/... | interner Draft | kein Public Surface",
  "demoReadiness": "demo-ready | needs-demo-copy-review | api-visible-needs-demo-story | concept-only | blocked-unverified",
  "claimRisk": "low | medium | high plus kurze Begruendung",
  "allowedClaims": ["konservative, belegbare Formulierungen"],
  "forbiddenClaims": [
    "Garantie",
    "Preis",
    "Vertrag",
    "Abrechnung",
    "Genehmigung",
    "Kundenerfolg ohne Freigabe"
  ],
  "nextSafeStep": "konkreter interner Draft-/Review-/Klaerungsschritt",
  "hitlRequired": true,
  "stopRules": ["kein Senden", "kein Publish", "kein PR/GitHub-Write", "kein Deployment"]
}
```

## 6. Beispielaufgaben

### Beispiel A: OpenAPI-sichtbarer Website-Draft

Ausgangskandidat:

- `recommendedFollowUpAgent`: `webmaster`
- `websiteTargetPage`: `cernion.de/energy-market-api`
- `demoReadiness`: `api-visible-needs-demo-story`
- `claimRisk`: `medium`
- Beleg: CHANGELOG plus `POST /api/energy-market/portfolio-backtest`

Aufgabenentwurf:

```json
{
  "title": "[REQUEST][CET][Website] Portfolio-Backtest als cernion.de-Draft pruefen",
  "routingOwner": "Webmaster",
  "routingReason": "Starker API-Anker und Website-Zielseite; Aufgabe ist ein konservativer SEO-/FAQ-/Capability-Draft, kein Sales-Versand.",
  "prioritySignal": "P1-review-now",
  "nextSafeStep": "Draft mit Endpoint-Deeplink, Annahmen, Datenqualitaetsgrenzen und No-Garantie-Hinweis vorbereiten.",
  "hitlRequired": true,
  "stopRules": ["kein PR", "kein Publish", "kein Deployment", "keine Erlos- oder Einspargarantie"]
}
```

### Beispiel B: B2B-Demo-/Sales-Follow-up ohne Versand

Ausgangskandidat:

- `recommendedFollowUpAgent`: `felix-demo-sales`
- Zielrolle: Stadtwerk-Produktmanager oder VNB-Netzplanung
- `demoReadiness`: `demo-ready` oder `concept-only` mit klaren No-Call-Grenzen
- `claimRisk`: `low|medium`

Aufgabenentwurf:

```json
{
  "title": "[REQUEST][CET][Felix] Demo-Narrativ fuer read-only VDMI-Pruefpfad vorbereiten",
  "routingOwner": "Felix",
  "routingReason": "Hauptarbeit ist B2B-Erzaehlung und Zielsegment-Fit; Website-Aenderung ist spaeterer Review-Schritt.",
  "prioritySignal": "P2-draft-when-capacity",
  "nextSafeStep": "Interne Demo-Talking-Points und Follow-up-Mailentwurf mit klaren No-Call-/No-Approval-Grenzen vorbereiten.",
  "hitlRequired": true,
  "stopRules": [
    "kein Versand",
    "keine Preis-/Vertragszusage",
    "keine Anschluss-/Kapazitaetszusage",
    "kein CRM-Eintrag ohne Quelle"
  ]
}
```

### Beispiel C: Claim-Risiko / Rhajaina Review

Ausgangskandidat:

- `recommendedFollowUpAgent`: `rhajaina-claim-review`
- `claimRisk`: `high`
- Begriffe: Abrechnung, Settlement, Genehmigung, Garantie, Steuerung oder echte Kundendaten

Aufgabenentwurf:

```json
{
  "title": "[HITL][CET][Claim-Review] Billing-/Settlement-Kandidat vor Public-Routing pruefen",
  "routingOwner": "Rhajaina",
  "routingReason": "Externer Nutzen ist moeglich, aber R2/R3-Claim-Risiko verhindert direkte Webmaster-/Felix-Folge.",
  "prioritySignal": "STOP-sensitive-or-actioning",
  "nextSafeStep": "Erlaubte Nicht-Zusagen, fachliche Owner und ggf. sanitized Steering-Signal klaeren; danach neu routen oder schliessen.",
  "hitlRequired": true,
  "stopRules": [
    "kein Webmaster-Draft",
    "kein Felix-Outreach",
    "kein Publish",
    "kein GitHub-Issue/PR"
  ]
}
```

### Beispiel D: Developer-/LLM-Discoverability

Ausgangskandidat:

- stabiler OpenAPI-Pfad, aber wenig B2B-Story
- Zielseite eher `corrently.io` oder Repository-Doku
- `claimRisk`: `low`

Aufgabenentwurf:

```json
{
  "title": "[REQUEST][CET][Docs] OpenAPI-Rezept fuer public discovery vorbereiten",
  "routingOwner": "Webmaster",
  "routingReason": "Webmaster steuert oeffentliche Sichtbarkeit; technische Detailklaerung kann als DevOps-Doku-Folge vorbereitet werden.",
  "prioritySignal": "P2-draft-when-capacity",
  "nextSafeStep": "curl/Auth/Response-Beispiel und LLM-freundliche Kurzbeschreibung als Review-Draft formulieren.",
  "hitlRequired": true,
  "stopRules": ["kein GitHub-Issue/PR ohne Freigabe", "kein Publish", "keine Vertriebsclaims"]
}
```

## 7. Stop-Regeln fuer PR, Publish und Sending

Diese Routing-Spezifikation autorisiert niemals:

- externe E-Mail, LinkedIn-, Pubbler-, Blog-, Website- oder Kundenkommunikation zu senden;
- GitHub-Issues, PRs, Releases oder Labels zu erstellen oder zu veroeffentlichen;
- CMS-, Website-, BookStack-, stromdao.de-, cernion.de-, corrently.io- oder corrently.energy-Aenderungen live zu publizieren;
- produktive Deployments, Restarts, PM2/Systemd/Docker-Aktionen oder Serveraenderungen auszufuehren;
- Preise, Angebote, Vertraege, Termine, Rechts-/Regulierungswirkung, Abrechnungsergebnisse, Einsparungen oder Garantien zuzusagen;
- TWL-Rohkontext, Kundendaten, private Mailinhalte oder vertrauliche Entscheidungsstaende in Webmaster-/Felix-Kontexte zu exportieren.

Erlaubt sind nur interne Entwuerfe, Review-Fragen, Quellenverweise, Kanban-Aufgabenentwuerfe und explizit als Draft markierte Handoffs.

## 8. Sichere Default-Entscheidung

Wenn die Route nicht eindeutig ist:

1. Rhajaina als Triage-/Claim-Review-Owner setzen.
2. `prioritySignal = P3-watchlist` oder `STOP-sensitive-or-actioning` waehlen.
3. Mindestinformationen und fehlende Belege benennen.
4. Webmaster/Felix erst nach public-safe Quellen- und Claim-Klaerung einbeziehen.
5. Naechsten Schritt als Review, Draft oder Blocker formulieren, nie als externe Aktion.
