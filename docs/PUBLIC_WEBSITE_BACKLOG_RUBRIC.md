# CET Public Website Backlog Rubrik

Diese Rubrik beschreibt, wie aus einer neuen Cernion Energy Tools (CET) Capability eine oeffentlichkeitsfaehige Website-Backlog-Idee abgeleitet wird. Sie ist ein internes Bewertungs- und Handoff-Schema fuer Webmaster, Felix, Viki, DevOps und Rhajaina. Sie veroeffentlicht nichts selbst.

Jede abgeleitete Idee bleibt ein Draft, bis ein separater HITL-, PR- oder Publish-Schritt sie freigibt. Website-Aenderungen, externe Claims, Preis-/Tarif-/Vertragsaussagen, regulatorische Aussagen, GitHub-Write und Deployments sind nicht durch diese Rubrik freigegeben.

## 1. Eingangssignal

Zulaessige Quellen fuer eine Rubrik-Bewertung:

- CHANGELOG-Eintrag, Release-Note oder GitHub-Issue zu einer CET Capability.
- `openapi-export.json`, Swagger/OpenAPI-Pfad, `llm.txt` oder Doku-Anker, der die Capability belegbar macht.
- Freigegebene interne Steering-Signale aus Vertrieb, DevOps, Monitoring, Marktbeobachtung oder Rhajaina-Triage.
- Plaud-/Transkript-derived Inhalte nur, wenn sie explizit als `STROMDAO_INTERNAL_FANOUT` oder als sanitized Folgekarte freigegeben sind.

Nicht zulaessig fuer oeffentliche Ableitung:

- TWL-Rohkontext, private Mails, Personen-/Kundendaten oder nicht freigegebene Transkripte.
- Spekulative Preis-, Tarif-, Vertrags-, Rechts- oder Lieferzusagen.
- Kundenreferenzen, Projektstatus oder Betriebsergebnisse ohne explizite Freigabe.

## 2. Entscheidungsfolge

Jede Capability wird in dieser Reihenfolge bewertet:

1. Belegbarkeit: Gibt es einen stabilen technischen Anker?
   - stark: OpenAPI-Endpunkt, dokumentierte Action, CHANGELOG + Tests, Demo-Artefakt.
   - mittel: Issue/ADR/Plan mit klarer Service-Zuordnung.
   - schwach: nur interne Beobachtung, Brainstorming oder Marktimpuls.
2. Oeffentliche Relevanz: Ist der Nutzen fuer Stadtwerke, Netzbetreiber, Entwickler oder OSS-Interessenten erklaerbar, ohne interne Details offenzulegen?
3. Ziel-Domain: Welche Seite ist fachlich passend?
4. Demo-Reife: Darf daraus eine Demo-/Landingpage-Idee werden oder nur ein interner Draft?
5. Claim-Risiko: Welche Aussagen sind erlaubt, welche brauchen Rhajaina/HITL?
6. Handoff: Webmaster-Aufgabe, Felix-Vertriebsaufgabe, DevOps-/Doku-Folge oder nur Beobachtung.

Ein Kandidat wird nur dann Website-Backlog, wenn Belegbarkeit mindestens mittel ist und ein sicherer, oeffentlicher Nutzen-Satz formuliert werden kann.

## 3. Domain-Routing

| Ziel               | Wann passend                                                                                                                              | Fachlicher Owner                                                                 | Typische Formate                                                        | Nicht verwenden fuer                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `cernion.de`       | B2B-Nutzen fuer Stadtwerke, Netzbetreiber, Regulated-Energy-Prozesse, Capability-/Use-Case-Kommunikation                                  | Felix fachlich; Webmaster fuer Struktur, SEO und Publish-Draft                   | Capability-Teaser, Fachreport, Timeline-Artikel, Demo-Landingpage, FAQ  | OSS-Developer-Howto ohne Produktnutzen; B2C-Tarife; unsichere Claims              |
| `corrently.io`     | Entwickler-/OSS-/API-Dokumentation, Tooling, OpenAPI-/SDK-/Integrationserklaerung                                                         | DevOps/Produkt fachlich; Webmaster koordiniert Doku-Sichtbarkeit                 | API-Rezept, README-Verweis, LLM-/Developer-Discovery, Changelog-Hinweis | Vertriebsclaims, Preise, kundenspezifische Nutzenversprechen                      |
| `stromdao.de`      | neutrale STROMDAO-Publishing-Perspektive, Methodik, Open-Source-/Energy-Data-Referenz, akademisch/verbandlich anschlussfaehige Erklaerung | STROMDAO-Publishing/Thorsten fachlich; Webmaster nutzt `stromdao-web-publishing` | Referenz-/Methodikseite, Hintergrundartikel, Projektlandkarte           | Cernion-Verkaufsseite, Produktversprechen, nicht neutralisierte Herkunftskontexte |
| `corrently.energy` | nur wenn B2C-/Tarifkommunikation, Haushaltskundennutzen oder Corrently-Produkterlebnis betroffen ist                                      | Cori fachlich; Webmaster fuer FAQ/CTA/SEO                                        | FAQ, Tarif-/Produkttext, B2C-CTA                                        | CET-B2B-Capabilities ohne B2C-Bezug                                               |

Default fuer neue CET-Capabilities ist `cernion.de`, sofern kein klarer Developer-/OSS-Fokus (`corrently.io`) oder neutraler STROMDAO-Methodikfokus (`stromdao.de`) vorliegt.

## 4. Demo-Reife-Stufen

| Stufe | Label                          | Kriterien                                                                                     | Erlaubter Output                                     | Nicht erlaubt                                                   |
| ----- | ------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| D0    | `internal-observation`         | Kein stabiler Endpoint, unklare Zielgruppe, interne oder sensitive Herkunft                   | interne Notiz, Markt-/Roadmap-Beobachtung            | Website-Backlog, externer Teaser                                |
| D1    | `api-visible-needs-story`      | OpenAPI-/Service-Anker vorhanden, aber noch keine Demo-Story oder sichere Nutzenformulierung  | Webmaster-Draft, Doku-Frage, DevOps-Doku-Folge       | Landingpage-Publish, Sales-Claim                                |
| D2    | `needs-demo-copy-review`       | Endpoint plus Guardrails/Read-only oder Demo-Signal vorhanden, aber Claim-Grenzen noch offen  | Copy-Draft, FAQ-Entwurf, Rhajaina-Review-Paket       | externe Versandbereitschaft                                     |
| D3    | `demo-ready`                   | Read-only oder synthetische Demo, reproduzierbarer Ablauf, klare No-Call-/No-Mutation-Grenzen | Demo-Teaser, Landingpage-Backlog, Felix-Demo-Snippet | Produktivitaets-, Einspar-, Preis- oder Rechtsclaim ohne Review |
| D4    | `publish-candidate-after-hitl` | D3 plus fachliche Freigabe, PR-/Publish-Pfad, Review der Claims und Zielseite                 | PR/Pub-Freigabevorlage, geplanter Publish-Schritt    | automatisches Deployment durch die Rubrik                       |

D4 ist kein automatischer Publish. Es bedeutet nur: Der naechste sichere Schritt ist eine explizite Freigabe- oder PR-Entscheidung.

## 5. Claim-Risiko-Stufen

| Stufe | Label                            | Kriterien                                                                                                                               | Sichere Formulierung                                                 | Gate                                                  |
| ----- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| R0    | `low-descriptive`                | Read-only, synthetische Demo, Nachweis-/Evidenzsicht, keine operative Zusage                                                            | "CET stellt eine pruefbare Read-only-Sicht auf ... bereit."          | Webmaster kann Draft vorbereiten; Publish bleibt HITL |
| R1    | `medium-operational`             | Workflow-, Prozess-, Integrations- oder Automatisierungsnutzen, aber ohne Preise/Regulatorik/Mutation                                   | "unterstuetzt die Einordnung", "macht Pruefschritte nachvollziehbar" | Copy-Review + Owner-Freigabe vor externem Einsatz     |
| R2    | `high-regulatory-commercial`     | Aussagen zu Abrechnung, Settlement, Tarifen, regulatorischer Konformitaet, Genehmigung, Vertrag, Einsparung oder kommerziellem Ergebnis | nur als Frage/Pruefauftrag formulieren, keine Ergebniszusage         | Rhajaina/Fachowner/HITL erforderlich                  |
| R3    | `blocked-sensitive-or-actioning` | Produktion-Mutation, Device-Control, MaKo/CRM/Billing-Schreibpfad, automatische Entscheidung, Kundendaten, TWL-Rohkontext               | keine oeffentliche Formulierung aus dieser Quelle                    | blockieren oder sanitized Steering-Signal anfordern   |

Triggerwoerter fuer R2/R3: Garantie, garantiert, Einsparung, Preis, Tarif, Vertrag, Abrechnung, Settlement, Genehmigung, Ablehnung, steuernd, schaltet, produktiv schreibt, Kunde X, vertraulich, TWL.

## 6. SEO- und LLM-Discoverability-Regeln

Jeder Website-Backlog-Kandidat sollte maschinenlesbar und suchfaehig genug sein, ohne Marketing zu ueberziehen:

- Entitaeten nennen: `Cernion Energy Tools`, Stadtwerk, Netzbetreiber, Energie-Datenprozess, konkreter Service/Endpoint, relevante Norm-/Prozessbegriffe nur wenn belegbar.
- Einen stabilen technischen Anker setzen: OpenAPI-Pfad, `operationId`, README/Doku-Link oder Changelog-Issue.
- Einen klaren Suchintent bedienen: "Wie prueft ein Stadtwerk ...?", "Welche API liefert ...?", "Wie kann ein Netzbetreiber ... nachvollziehen?".
- LLM-freundliche Struktur: Kurzfassung, Gegenstand, Daten-/Prozessmodell, Pruefregeln, Grenzen, Nachweise, naechster Schritt.
- Keine erfundenen Quellen, Kundenzitate, Benchmarks oder Superlative.
- Claims als bounded capability formulieren: "unterstuetzt", "macht sichtbar", "stellt bereit", "ordnet ein" statt "loest", "garantiert", "automatisiert rechtskonform".

## 7. Handoff-Regeln

### Webmaster-Aufgabe

Ein Punkt ist Webmaster-Aufgabe, wenn:

- eine Zielseite, FAQ, Doku-Struktur, SEO-/LLM-Discoverability oder ein Changelog-/Timeline-Draft benoetigt wird;
- die oeffentliche Formulierung konservativ, belegbar und ohne R2/R3-Claim moeglich ist;
- ein HITL-/PR-/Publish-Schritt als naechster sicherer Schritt formuliert werden kann.

Beispiel-Handoff:

```json
{
  "owner": "Webmaster",
  "domain": "cernion.de",
  "targetPage": "cernion.de/energy-market-api",
  "change": "Capability-Teaser mit OpenAPI-Deeplink und Read-only-Grenze vorbereiten",
  "whyNow": "CHANGELOG + OpenAPI-Endpunkt machen den Nutzen belegbar",
  "demoReadiness": "needs-demo-copy-review",
  "claimRisk": "R1 medium-operational",
  "nextSafeStep": "Draft erstellen, dann Felix/Rhajaina-Freigabe vor PR/Publish"
}
```

### Felix-Vertriebsaufgabe

Ein Punkt ist eher Felix-Aufgabe, wenn:

- der Hauptnutzen in B2B-Kontakt, Demo-Erzaehlung, Zielkunden-Segmentierung oder Angebotspositionierung liegt;
- noch keine Zielseite geaendert werden muss, aber ein Sales-Snippet, Demo-Guide oder Ansprechpartner-Text noetig ist;
- kommerzielle Aussagen, Referenzen oder Nutzenversprechen fachlich eingeordnet werden muessen.

Beispiel-Handoff:

```json
{
  "owner": "Felix",
  "domain": "cernion.de",
  "change": "Demo-Narrativ fuer Stadtwerke ausarbeiten; keine Website-Aenderung vor Freigabe",
  "whyNow": "Capability ist demo-ready, aber Zielsegment und Nutzenversprechen brauchen B2B-Einordnung",
  "demoReadiness": "demo-ready",
  "claimRisk": "R1 medium-operational",
  "nextSafeStep": "Felix formuliert Demo-/Kontaktpaket; Webmaster prueft danach Landingpage-Fit"
}
```

### DevOps-/Doku-Folge

Ein Punkt ist eher DevOps-/Doku-Folge, wenn:

- die API oeffentlich erklaert werden sollte, aber noch Beispiele, Auth-Hinweise, OpenAPI-Korrekturen oder SDK-/curl-Rezepte fehlen;
- `corrently.io` oder Repository-Doku die passendere erste Flaeche ist;
- technische Stabilitaet, Versionierung oder Endpoint-Beleg erst ergaenzt werden muss.

### Nur interne Beobachtung

Ein Punkt bleibt intern, wenn:

- Herkunft oder Kontext nicht public-safe ist;
- die Capability nur eine Hypothese, ein Marktimpuls oder ein nicht belegter Plan ist;
- Claim-Risiko R3 erreicht ist;
- der Nutzen nicht erklaerbar ist, ohne interne Roadmap, Kundendaten oder vertrauliche Prozessdetails offenzulegen.

Beispiel:

```json
{
  "owner": "internal-observation",
  "domain": null,
  "change": "keine Website-Aenderung",
  "whyNow": "Signal ist strategisch interessant, aber noch ohne public-safe Beleg und ohne stabilen Endpoint",
  "demoReadiness": "internal-observation",
  "claimRisk": "R3 blocked-sensitive-or-actioning",
  "nextSafeStep": "sanitized Steering-Signal oder fachliche Freigabe anfordern"
}
```

## 8. Beispielausgaben

### Beispiel A: Read-only Energy-Market-Backtest

- Signal: CHANGELOG-Eintrag + `POST /api/energy-market/portfolio-backtest`.
- Domain: `cernion.de/energy-market-api`.
- Owner: Webmaster fuer Website-Draft; Felix fuer Demo-Snippet.
- Demo-Reife: D3 `demo-ready`, wenn synthetische Demo und No-Call-Grenzen belegt sind.
- Claim-Risiko: R0/R1, solange nur "historische Einordnung" und "Read-only" behauptet wird.
- Naechster sicherer Schritt: Teaser-Draft mit Endpoint-Deeplink, Review durch Felix/Rhajaina vor Publish.

### Beispiel B: Billing-/Settlement-Automation

- Signal: neuer Endpoint oder Konzept fuer Abrechnungs-/Settlement-Prozess.
- Domain: vorerst keine oeffentliche Zielseite; eventuell internes Rhajaina/Fachowner-Review.
- Owner: Rhajaina/Fachowner, spaeter Felix oder Webmaster nach Freigabe.
- Demo-Reife: maximal D1/D2, solange operative/rechtliche Grenzen unklar sind.
- Claim-Risiko: R2 oder R3.
- Naechster sicherer Schritt: Claim-Grenzen, Nachweisbedarf und Nicht-Zusagen dokumentieren; keine externe Formulierung.

### Beispiel C: OpenAPI-Developer-Rezept

- Signal: stabiler OpenAPI-Pfad, aber wenig Produktstory.
- Domain: `corrently.io` oder Repository-Doku zuerst.
- Owner: DevOps/Produkt fachlich; Webmaster fuer Discoverability.
- Demo-Reife: D1 `api-visible-needs-story`.
- Claim-Risiko: R0, wenn rein technisch und ohne kommerzielle Zusage.
- Naechster sicherer Schritt: curl-/Auth-/Response-Beispiel vorbereiten, danach ggf. cernion.de-Teaser pruefen.

### Beispiel D: Neutrale Methodik oder OSS-Referenz

- Signal: Capability erklaert eine allgemeine Energy-Data-Methodik oder OSS-Komponente.
- Domain: `stromdao.de`, wenn neutral und nicht als Cernion-Vertriebsseite formuliert.
- Owner: STROMDAO-Publishing; Webmaster nutzt `stromdao-web-publishing`.
- Demo-Reife: D2/D3 je nach Artefakt.
- Claim-Risiko: R0/R1, solange keine Produkt-/Rechts-/Kundenzusage enthalten ist.
- Naechster sicherer Schritt: neutralisierten Methodik-Draft mit Quellen-/Artefaktankern vorbereiten, HITL vor Publish.

## 9. Minimaler Backlog-Datensatz

Ein Website-Backlog-Kandidat sollte mindestens diese Felder enthalten:

```json
{
  "capability": "kurzer stabiler Capability-Name",
  "source": ["CHANGELOG.md", "openapi-export.json", "Issue/PR falls vorhanden"],
  "domain": "cernion.de | corrently.io | stromdao.de | corrently.energy | null",
  "targetPage": "bestehende oder vorgeschlagene Zielseite",
  "fachlicherOwner": "Felix | DevOps | STROMDAO-Publishing | Cori | Rhajaina | internal-observation",
  "proposedChange": "konkreter Draft-/Doku-/FAQ-/SEO-Schritt",
  "whyNow": "belegbarer Anlass",
  "demoReadiness": "D0-D4 Label",
  "claimRisk": "R0-R3 Label mit Gruenden",
  "seoLlmHints": ["Entitaeten", "Suchintent", "Endpoint-/Doku-Deeplink"],
  "nextSafeStep": "Draft, Review, Folgekarte oder Blocker",
  "publishGate": "HITL/PR/Publish erforderlich; keine automatische Veroeffentlichung"
}
```

## 10. Sichere Kurzformel

Wenn unsicher, lautet die sichere Standardentscheidung:

- keine Live-Aenderung;
- internen Draft statt Publikation;
- `cernion.de` nur fuer belegbaren B2B-Nutzen;
- `corrently.io` fuer Developer-/OSS-Doku;
- `stromdao.de` fuer neutralisierte Methodik;
- R2/R3-Claims an Rhajaina/Fachowner/HITL;
- naechster Schritt als Review-/PR-/Publish-Freigabe formulieren.
