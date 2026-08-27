# Speicher-/Flaechennutzung Sonderthemenakte

## Zweck und Betreiberfrage

Speicher-, Grosslast- und Flaechennutzungsanfragen laufen bei einem VNB ueber mehrere parallele Pruefspuren: Flaechenverfuegbarkeit, Netzanschluss, technische Machbarkeit, Vertrags-/Eigentumsgrenzen, kommunaler Kontext, Antwortentwurf und Managemententscheidung (Issue #523). Die Betreiberfrage lautet: *"Was ist der aktuelle, versionierte Arbeitsstand dieser Sonderthemen-Anfrage — welche Nachweise liegen vor, welche fehlen, wer ist verantwortlich, bis wann, und was ist das naechste Entscheidungsgate?"*

Dieser erste Cut fuehrt **keine neue Speicher-, Flaechen-, Anschluss-, Vertrags- oder kommunale Vorgangsplattform** ein. Er ist eine **read-only Dokumentations-Komposition** ueber sechs bereits vorhandene `GET /api/dashboard/*` Bricks und ordnet die im Issue genannten Aktenfelder diesen Bricks zu.

Datenklassen: Alle Beispiele in diesem Dokument sind **explizit synthetisch** oder oeffentlicher Kontext (public-context). Es werden keine realen Kundendaten, Flurstuecke, Anschlussnehmer oder Vertragsdaten benannt.

## Sechs wiederverwendete Bricks

Kein neuer Service, keine neue Route, keine neue Persistenz. Die Sonderthemenakte komponiert ausschliesslich bestehende read-only Actions:

| Brick | Action | Route |
| --- | --- | --- |
| VNB Sonderthema Arbeitsstand | `dashboard-api.vnbSpecialTopicWorkstateStatus` | `GET /api/dashboard/vnb-special-topic-workstate` |
| Spartenuebergreifende Sonderthemen-Queue | `dashboard-api.crossDomainSpecialTopicsQueueStatus` | `GET /api/dashboard/cross-domain-special-topics-queue` |
| Grossspeicher Anschluss Readiness Gate | `dashboard-api.grossspeicherAnschlussReadinessGateStatus` | `GET /api/dashboard/grossspeicher-anschluss-readiness-gate` |
| Areal Network Integration Offer Gate | `dashboard-api.arealNetworkIntegrationOfferGateStatus` | `GET /api/dashboard/areal-network-integration-offer-gate` |
| Owner-Frist-Evidenz Gate | `dashboard-api.ownerDeadlineEvidenceGateStatus` | `GET /api/dashboard/owner-deadline-evidence-gate` |
| Decision Readiness Matrix | `dashboard-api.decisionReadinessMatrixStatus` | `GET /api/dashboard/decision-readiness-matrix` |

Ausfuehrliche Vertraege fuer drei dieser Bricks bestehen bereits: [grossspeicher-anschluss-readiness-gate.md](grossspeicher-anschluss-readiness-gate.md), [areal-network-integration-offer-gate.md](areal-network-integration-offer-gate.md), [owner-deadline-evidence-gate.md](owner-deadline-evidence-gate.md).

## Feld-zu-Brick Mapping

| Sonderthemenakte-Feld (Issue #523) | Brick | Felder auf dem bestehenden Contract |
| --- | --- | --- |
| Anfrageobjekt / Sonderthema, fuehrende Quelle, Owner, fehlende Evidenz | `vnb-special-topic-workstate` | `topic.topicId`, `topic.topicName`, `topic.domain`, `topic.owner`, `topic.accountableRole`, `sourceFreshness.leadingSource`, `missingEvidence[]` |
| Flaechenstatus, Netzbezug/Anschlusskapazitaet, Zielnetzpfad, Investitions-/CAPEX-Bezug, regulatorische Grenze, Entscheidungsfenster | `areal-network-integration-offer-gate` | `siteReference`/`areaReference`, `requestedConnectionCapacity`, `gridCapacityEvidence`, `targetGridPath`, `investmentReference`/`capexReference`, `regulatoryImpactBoundary`, `nextDecisionDate`, `status` |
| Netzanschluss/technische Machbarkeit, NAP, fNAV-/Vertragsgrenze, Fahrplanannahme, Steuerbarkeit, Leitwartenuebergabe | `grossspeicher-anschluss-readiness-gate` | `napMastrNummer`, `napEvidenceStatus`, `fnavProfile`, `contractBoundaryStatus`, `scheduleRequirement`, `storageDispatchAssumption`, `controllabilityStatus`, `controlRoomHandoverStatus` |
| Vertrags-/Eigentumsgrenze (weitergehend) | `grossspeicher-anschluss-readiness-gate` | `fnavProfile`, `contractBoundaryStatus` (kein eigenstaendiges Eigentums-/Flurstuecksfeld — als `evidenceRefs`/freies Textfeld zu liefern) |
| Kommunaler Kontext, spartenuebergreifende Frist, Datenluecke, Asset-/Revenue-Impact, Eskalationsschwelle, naechstes Governance-Gate | `cross-domain-special-topics-queue` | `domainLane`, `dueAt`, `regulatoryReference`, `dataGap`, `assetRevenueImpact`, `escalationThreshold`, `nextGovernanceGate`, `decisionStatus` |
| Owner / Frist / Blocker | `owner-deadline-evidence-gate` | `ownerRole`, `ownerContact`, `dueAt`, `evidenceRef`, `blockedDecision`, `linkedEntity` |
| Antwortentwurf / Managemententscheidung (deskriptive Review-Reife) | `decision-readiness-matrix` | `measureId`, `measureName`, `owner`, `committeeWindow`, `nextDecisionPoint`, `blockers[]`, `openEvidence[]` |

Jeder Brick bleibt eigenstaendig aufrufbar; die Akte ist eine **Dokumentations-Komposition**, kein neuer aggregierender Endpoint.

## Versionierung, Frische und Blocked-State

"Versionierter Stand" bedeutet in diesem Cut ausschliesslich **caller-supplied, aufrufzeitpunkt-gebundene Fakten** — keine neue Persistenz oder Revisionshistorie:

- **Source/Version/Freshness**: `vnb-special-topic-workstate` liefert `sourceFreshness.leadingSource`, `sourceFreshness.leadingSourceVersion`, `sourceFreshness.leadingSourceAgeDays` und `staleMarkers[]`. Ein Leading-Source-Alter oberhalb `freshnessThresholdDays` (Default 45 Tage) setzt `status: "stale"`.
- **Owner/Deadline**: `owner-deadline-evidence-gate` und `cross-domain-special-topics-queue` liefern je eigenstaendig `ownerRole`/`owner` und `dueAt`. Ein ueberschrittenes `dueAt` ohne vollstaendige Evidenz setzt in der Queue `decisionStatus: "escalation_candidate"`.
- **Next-Gate**: `nextGovernanceGate` (Queue), `nextDecisionDate` (Areal Gate), `nextDecisionPoint` (Decision Readiness Matrix) — jedes Feld ist ein caller-supplied Zieldatum/-gremium, kein geplantes Systemereignis.
- **Blocked-State**: Fehlende Pflichtfelder fuehren nie zu einer negativen Aussage, sondern zu einem `needs_*`/`insufficient_evidence`/`blocked_by_*` Status plus `missingEvidence[]` mit `enablesDossierAddition`.

Zwei Aufrufe mit unterschiedlichen Parametern fuer dieselbe `topicId`/`caseId` liefern unterschiedliche abgeleitete Status; keiner der sechs Bricks liest oder schreibt einen vorherigen Aufruf zurueck.

## Synthetisches Beispiel

Das folgende Beispiel ist **ausschliesslich synthetisch**. Es benennt keinen realen VNB, Flurstueck, Anschlussnehmer oder Vertrag.

Fallkontext: Ein synthetisches Speicherprojekt "Beispiel-BESS Musterareal (synthetisch)" mit `topicId=sonderthema:synthetic-bess-001` durchlaeuft die Sonderthemenakte:

1. **Vorhandene Evidenz**: `GET /api/dashboard/vnb-special-topic-workstate?topicId=sonderthema:synthetic-bess-001&topicName=Beispiel-BESS%20Musterareal%20(synthetisch)&domain=anschluss&leadingSource=Netzplanung-Vermerk&leadingSourceTimestamp=2026-08-01&leadingSourceVersion=v3&owner=Netzplanung` liefert `status: "current"`, `decisionReadiness.canUseAsLeadingWorkstate: true`.
2. **Fehlende Evidenz**: `GET /api/dashboard/grossspeicher-anschluss-readiness-gate?gridOperatorId=synthetic-vnb&projectId=synthetic-bess-001&storageAssetId=bess-synthetic-001` ohne NAP-/fNAV-/Fahrplan-Nachweise liefert `status: "needs_nap_evidence"` mit `evidenceGaps[]` und `positiveFollowUps[]`, z. B. "NAP-/MaStR-Anschlussnachweis ergaenzen".
3. **Assumption-only Evidenz**: `GET /api/dashboard/areal-network-integration-offer-gate?siteReference=Musterareal-synthetic&requestedConnectionCapacity=2500&offerDecisionStatus=assumption-only-noch-nicht-bestaetigt` liefert `status: "needs_target_grid_path"`, weil `targetGridPath`/`zielnetzPath` fehlt — die gelieferte `offerDecisionStatus` wird als reine Annahme (`assumption-only`) uebernommen, nicht validiert.
4. **Owner/Frist**: `GET /api/dashboard/owner-deadline-evidence-gate?signalId=synthetic-bess-001&sourceType=vnb-special-topic&ownerRole=Netzplanung&dueAt=2026-09-15` liefert `status: "needs_evidence_ref"`.
5. **Naechstes Gate / deskriptive Review-Reife**: `GET /api/dashboard/decision-readiness-matrix?measureId=sonderthema:synthetic-bess-001&measureName=Beispiel-BESS%20Musterareal%20(synthetisch)&owner=Netzplanung&committeeWindow=2026-Q4&nextDecisionPoint=investment-committee` klassifiziert die Zeile als `evidence_gap`, solange `evidenceSource`/`openEvidence` unvollstaendig sind.

Ergebnis der Akte: ein Aufruf-gebundenes Bild aus vorhandener, fehlender und assumption-only Evidenz je Pruefspur — kein Freigabestatus.

## Positive Follow-ups

Fehlende Datenpunkte fuehren ausschliesslich zu **refresh/inspect/clarify** Folgeaktionen fuer Menschen, niemals zu einer automatisierten Aktion:

- fehlende fuehrende Quelle oder veraltete `leadingSourceTimestamp` -> fuehrende Quelle aktualisieren/erneut liefern (refresh);
- fehlende NAP-/fNAV-/Fahrplan-Nachweise -> bestehenden Nachweis pruefen und ergaenzen (inspect);
- fehlender Owner/Deadline/Next-Gate -> verantwortliche Rolle und Termin klaeren (clarify);
- fehlende `evidenceRefs`/`sourceRefs` -> Quellverweis ergaenzen, keine automatische Beschaffung.

Jede `positiveFollowUps[]`/`missingEvidence[].enablesDossierAddition` Eintrag ist bereits Teil des jeweiligen Bricks; die Akte fuegt keine neue Aktionstyp hinzu.

## No-call / No-write boundary

Diese Akte, und dieses Dokument, loesen keine der folgenden Aktionen aus:

- kein GIS-, CRM-, SharePoint-, Teams-, Outlook- oder sonstiger externer Connector-Aufruf;
- keine Kapazitaetsreservierung oder Anschlussfreigabe;
- keine Flaechen-/Eigentums- oder Rechtsauslegung;
- keine Vertragserstellung oder -unterschrift;
- keine Scoring-/Ranking-/Gewinner-Auswahl;
- keine Workflow-, HITL- oder Task-Erstellung;
- keine beliebige Tabellen- oder Datei-Persistenz;
- keine Kundenkommunikation, kein Mail-/Webhook-Versand;
- keine MaKo-, Billing-, Settlement-, Tarif- oder Finance-Buchung;
- kein Dispatch/Redispatch;
- keine SMGW-/CLS-/Device-Control-Aktion;
- keine Produktionsmutation;
- keine Secrets, Credentials, Wallet-/Key-Material;
- kein Bezug zu Issue #252.

Jeder der sechs Bricks liefert bereits ein eigenes `sourceActions.notCalled`-Array (siehe z. B. `arealNetworkIntegrationOfferGateStatus`: `offer.calculate`, `contract.accept`, `grid-capacity.reserve`, `hitl.create`, `external.connector.call`, `personal-agent.execute`) — diese Guards gelten unveraendert fort.

## Personal Agent, Capability Broker, Hydration Registry, Formatter

Kein Impact:

- **Personal Agent**: kein Hardcoding, kein Persona-/Session-Routing, keine Aenderung an `services/personal-agent.service.js`.
- **Capability Broker**: keine neue Route; bestehendes Routing der sechs referenzierten Capabilities bleibt unveraendert.
- **Hydration Registry**: keine neue Formatter-Regel; bestehende Dossier-Hydration der sechs Bricks bleibt unveraendert.
- **Formatter/Sidecar**: keine Aenderung.
- **LLM/OpenAPI-Generierung**: nicht relevant, da keine API-, OpenAPI-, Capability- oder LLM-Flaeche geaendert wird.

## Verwandte Use-Cases

- [Grossspeicher Anschluss Readiness Gate](grossspeicher-anschluss-readiness-gate.md)
- [Areal Network Integration Offer Gate](areal-network-integration-offer-gate.md)
- [Owner-Frist-Evidenz Gate](owner-deadline-evidence-gate.md)

## Safety-Klasse

`read_only_documented_dossier_composition` — deskriptive Evidenz- und Review-Vorbereitung. Passt zum bestehenden `safety: 'read_only'` Feld und den `sourceActions.notCalled`/`decisionBoundary` Guards, die jeder der sechs referenzierten Bricks bereits zurueckgibt. Fehlende oder assumption-only Evidenz blockiert jeden Fortschritt und erzeugt ausschliesslich deskriptive Folgeaktionen (refresh/inspect/clarify), nie eine automatisierte Freigabe.
