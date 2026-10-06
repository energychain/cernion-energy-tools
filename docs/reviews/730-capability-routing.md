# Capability routing #730

Closes #730 · Part of #693

Der Broker gewichtet katalogbasierte Seltenheit, Komposita und nahe Mehrwort-Treffer. Kurze Wortvarianten werden als schwächere Wortteile behandelt; ein genau genanntes mehrteiliges Capability-Kennzeichen erhält einen konfigurierbaren Identifier-Bonus. Keine Fachbegriffe oder handgepflegten Fachzuordnungen im Scoring. Bestehende explizite Routen und Sicherheitsprüfungen bleiben erhalten.

## Klärung und Abdeckung

Bei unsicherer Auswahl entfällt `function.touched.v1` vollständig. Infrastruktur-Aufrufe während einer Rückfrage belegen keine ausgewählte Arbeit; eine niedrige künstliche Konfidenz würde unnötige Nebenbeobachtungen behalten. Workbench trägt die Unsicherheit bis zum Completed-Turn-Hook weiter.

Der sichtbare Fall enthält die zuletzt angebotenen Kandidaten. Eine Nummer oder deren Anzeigename wählt ausschließlich einen der maximal fünf angezeigten, gespeicherten Kandidaten. Die Liste verwendet das `displayLabel` des echten Funktionsmodells, ohne Capability-IDs oder interne Codes. Ein angezeigter Funktionsname kann mehrere Capability-Kandidaten zusammenfassen; ausgewählt wird dessen bestplatzierter Kandidat. Beliebige IDs und nicht angezeigte Nummern sind keine Bestätigung. Ein explizites `case_start` legt auch bei unsicherer Capability den Fall an. Die Klärung verändert keine Ausführungsrechte, HITL oder fehlende Evidenz; selbst wenn die Domain noch Klärung braucht, erfasst die bestätigte Funktionswahl normale Abdeckung unter der gemappten CET-Person mit dem Fall-Kontext aus #729.

Der E2E-Durchstich startet alle Services wie `index.js` ohne API/MQTT, behält sämtliche echten Nachbarschaften und verwendet keine Fixture-Auswahl. Nur die pro Funktion gewählte eigene kontextabhängige Read-Operation bleibt als Fixture für den Agent-Lückenpfad. Die realistische Anfrage „Starte bitte einen Fall: Netzanschlussanfrage für einen 2-MW-Batteriespeicher am Umspannwerk Nord prüfen.“ berührt die Großspeicher-Netzanschlussfunktion; CET aktiviert Anschlusskapazität und FNAV-Fast-Track als echte Nachbarn. Leadership/Communication-Break werden nicht aktiviert. Schritte 1–9 bleiben enthalten. Zwei weitere Abläufe prüfen unsicheren Fallstart, unveränderte Abdeckung/keine Touch-Events, Nummer bzw. Anzeigename, gemappten Actor und erhaltenen Kontext.

## Review: Kandidaten sind nicht ausführbar

`capability-broker.recommend` kehrt bei `uncertain: true` vor dem Aufbau von Action-Pfaden zurück: `intent: clarify`, `candidates: [{ capabilityId, displayLabel, score }]`, Konfidenz/Diagnostik und Klärungsfrage. Es gibt weder `capability` als ausgewählte Funktion noch `recommendedPlan`, `recommendedCapabilities`, `operationCandidates`, `preferredActions` oder `fallbackActions`. Auch ein Fallback legt nicht selbst eine Lückenmarkierung an. Die sichere Antwort bleibt unverändert. Alle Verbraucher bekommen dieselbe zentrale Sperre; der Router übersetzt die nicht ausführbaren Kandidaten in seinen bestehenden Fall-Vertrag.

Erkannte Nummern und Anzeigenamen kehren vor jeglicher Neu-Klassifikation zurück. Domäne, Evidenzlücken und Prozesskontext stammen aus dem vorherigen sichtbaren Fall, einschließlich `unknown`. Kein Receipt-, Knowledge-, Taxonomie- oder Domain-Route-Aufruf sieht den Bestätigungstext. Nummer und Label erzeugen denselben gespeicherten Fallzustand; ein fremdes Signalwort wie „Redispatch“ im Label ändert keinen Netzanschlussfall. Die sichere Berührung bleibt unter der gemappten Person mit dem bisherigen Fall-Kontext.

Zwei lokale Ersatzmechanismen des Personal Agent respektieren jetzt ebenfalls die zentrale Abstention: `buildExecutionPlan` darf bei unsicherer Broker-Antwort nicht erneut per lokaler Matrix/Blueprint auswählen; Dossier-Hydration darf keine eigenständig ergänzte EV/CO2-Action hinzufügen. Diese Änderungen treffen keine Auswahl und sind keine neuen Sicherheitsschwellen.

| Direkter Verbraucher | Negativnachweis / Verhalten |
|---|---|
| Personal Agent `getBrokerRecommendation` → `buildExecutionPlan` | echter Broker; keine Steps, keine lokale Neu-Auswahl/Blueprint-Umgehung |
| Personal Agent `answerDossier` / Hydration | echter Broker; kein kandidatenspezifischer Aufruf; zusätzlich EV/CO2-Ergänzung bei Abstention gesperrt |
| `agent.analyze` | echter Broker im Service-Test; keine Actions der Kandidaten aufgerufen |
| `agent-sidecar.callTool` | transportiert Kandidaten; kein Action-Aufruf |
| `chatgpt-sidecar.plan` / `browserPlan` | echter Broker, beide Transporte; kein Action-Aufruf |
| Domain Router | reine Kandidaten bis Auswahl; Bestätigung ohne Broker/Receipt/Knowledge-Neuaufruf |
| `domain-routes-management._runTestMatrix` | Kandidat zählt nicht als ausgewählte Capability; keine Folge-Action |
| CYA `getPlanningOntologySignals` | keine ausführbaren Top-Actions |
| ZNP `getPlanningAssist` | nur Klärungsmetadaten, kein Action-Aufruf |
| Utility Report `getPlanningAssist` | keine ausgewählte Capability, kein Action-Aufruf |
| Dashboard `evidenceGroundingConfidenceAudit` | Broker-Antwort nur Routing-Evidenz; die parallel gelesenen Health-/Evidenzquellen sind unabhängig vom Ranking, keine Ausführung des Broker-Plans |

Die bestehenden Personal-Agent-Ausführungs-/Preflight-Fixtures isolieren jetzt lokale Routing- und Onboarding-Invarianten mit einem nicht verfügbaren Broker bzw. einer explizit ausgewählten Identity-Capability. Sie behaupten keine sichere automatische Auswahl aus einer unsicheren Formulierung. Separate echte Broker-/Chat-/Dossier-Negativtests prüfen die Abstention; der Arbeitsannahmen-Follow-up bleibt bei Unsicherheit ohne neue Action und erhält den gespeicherten Kontext.

Die weiteren Dashboard-Treffer der Aufruferliste sind deklarative `referenced`-/`notCalled`-Metadaten und Health-Status, keine dynamischen Broker-Verbraucher. Regressionen stehen in `capability-uncertain-consumers.test.js`, `agent.service.test.js`, `answer-dossier.service.test.js`, `domain-router-confirmation.test.js` und im echten PouchDB-Falltest von `domain-router.service.test.js`.

## Evaluation: alle 413 Fälle

Baseline `3d618836`; der archivierte Broker und Katalog werden durch `node scripts/verify-capability-routing-baseline.js` erneut ausgewertet: 413 identische Top-1-Ergebnisse, keine Abweichung zur eingefrorenen Baseline. Korpus-SHA unverändert: `09ce6e64f9645a3cb11953dda93d1eb8c20f5b3cc9493d11863a93cd2bc610b6`. Auswertung ausschließlich durch `npm run eval:capability-routing -- --write` generiert. Die vorher korrekte Menge wird über alle 413 Fälle gebildet, nicht nur über den Einzelfall `known-correct`.

| Satz | Top-1 vorher → nachher | Top-3 vorher → nachher | unsicher vorher → nachher | Platzhalter vorher → nachher | ECE vorher → nachher |
|---|---|---|---|---|---|
| all (413) | 46.5 % → 69.2 % | 46.5 % → 73.4 % | 0.0 % → 38.5 % | 20.8 % → 21.1 % | 0.362 → 0.103 |
| issue-730 (4) | 0.0 % → 100.0 % | 0.0 % → 100.0 % | 0.0 % → 25.0 % | 0.0 % → 0.0 % | 0.850 → 0.255 |
| independent-regression (48) | 70.8 % → 89.6 % | 70.8 % → 97.9 % | 0.0 % → 20.8 % | 0.0 % → 0.0 % | 0.204 → 0.119 |
| known-correct (1) | 100.0 % → 100.0 % | 100.0 % → 100.0 % | 0.0 % → 0.0 % | 0.0 % → 0.0 % | 0.080 → 0.126 |
| semantic-example (27) | 63.0 % → 74.1 % | 63.0 % → 74.1 % | 0.0 % → 92.6 % | 63.0 % → 74.1 % | 0.608 → 0.846 |
| receipt-example (5) | 60.0 % → 60.0 % | 60.0 % → 80.0 % | 0.0 % → 60.0 % | 20.0 % → 20.0 % | 0.418 → 0.612 |
| operation-summary (328) | 41.8 % → 65.5 % | 41.8 % → 69.2 % | 0.0 % → 36.6 % | 20.7 % → 20.1 % | 0.409 → 0.051 |

**192 zuvor korrekte Top-1-Fälle, davon 190 weiterhin korrekt; 2 verloren. Die Begründungen sind keine AC-03-Abnahme; diese entscheidet der Maintainer.** Die vollständige Differenzmenge samt Anfrage, Erwartung und beiden Ergebnislisten steht in `previouslyCorrect.lost` des Evaluations-JSON.

| Verlorene ID | Einzelbegründung |
|---|---|
| `datasource-cache_query` | „Query cached datasource rows“ nennt keine Inhouse-Quelle oder Zeitreihe. Die Registry-Klassifikation liegt nun vor dem Inhouse-Lesen, das weiterhin Top-2 ist. Die Auswahl ist unsicher und erfordert Klärung. Keine datenquellenspezifische Regel oder Keyword nur für diese technische Summary eingeführt. |
| `mscons-import_import` | Die unveränderte Erwartung lautet `regulatory_change_simulator_readiness`, obwohl die Anfrage MSCONS-EDIFACT-Import nach EDM beschreibt. EDM-Evidenz und Marktkommunikation liegen nun davor; regulatorischer Simulator bleibt Top-3. Diese fachlich plausiblere Reihenfolge ist hier einzeln begründet; die Abnahme bzw. eine Ausnahme zu AC-03 entscheidet ausschließlich der Maintainer. Der Korpus wurde nicht nachträglich angepasst. |

Die sieben weiteren ursprünglichen Regressionen sind behoben: `capex-prioritization_list`, `capex-prioritization_analyze`, `capex-prioritization_get`, `fnav-commercial-hedging_listContracts`, `fnav-commercial-hedging_createContract` durch katalogabgeleitete exakte Kennzeichen; `eic-codes_gasFacilities`, `eic-codes_gasOperators` durch schwach gewichtete kurze Wortvarianten (z. B. code/codes).

## Unsicherheit und Kalibrierungsgrenzen

Die konfigurierbare `uncertaintyThreshold` bleibt **0,7 → 0,7**. Keine Senkung, um die Kennzahl schönzurechnen. Der Identifier-Bonus ist neu **0 → 6**; Phrase-/Score-/Margin-Parameter bleiben unverändert.

Unabhängiger Satz: 10/48 unsicher (**20,8 %**, zuvor im ersten PR-Stand 22,9 %). Alle zehn sind bereits Top-1 korrekt; ohne Anfragevektor sind knappe bzw. schwache lexikalische Treffer trotzdem klärungsbedürftig. Top-3 ist 47/48. Die neue Antwort auf die Rückfrage stellt anschließend die normale aktivierende Berührung sicher, statt die Unsicherheit dauerhaft vom Lernen auszuschließen.

Semantic-Satz: 25/27 unsicher (**92,6 %**). Alle 27 eingefrorenen Erwartungen sind `interface_placeholder`; 20 korrekte explizite Fallbacks erhalten Auswahl-Konfidenz 0 und bleiben absichtlich unsicher. Fünf weitere Fälle haben niedrige lexikalische Konfidenz. Die unverändert ausgewiesene ECE verschlechtert sich **0,608 → 0,846**: allein die 20 richtigen Abstentionen tragen 20/27 ≈ 0,741 bei, weil das Gold den Platzhalter als richtige Klasse zählt, während die Konfidenz sichere ausführbare Capability-Auswahl beschreibt. Eine höhere Fallback-Konfidenz würde den Sicherheitsvertrag verfälschen. Zusätzlich bleiben zwei echte überkonfidente Fehler (`semantic-metering-1`, `semantic-forecast-vs-actual-0`) aus breiten bestehenden expliziten Routen; dies ist eine Kalibrierungsgrenze, keine behauptete Verbesserung. Top-1 steigt trotzdem von 17/27 auf 20/27. Das JSON legt Fallback/Low-Confidence-Anzahlen, richtige Fallbacks und alle Bins offen; weder Gold noch ECE-Definition geändert.

## Release-Betriebspunkt: Embeddings online neu erzeugen, gemini-embedding-001/768

Die Keyword-Bereinigung macht **25 vorhandene Cache-Einträge** textlich veraltet. Die Source-Hashes werden geprüft; `resolveEmbeddings` meldet `stale` und nimmt diese Vektoren nicht in die gültige Map auf. Modell-Drift-Check und generierter Report weisen sie aus. Die hybride Auflösung aus #721 nutzt für Funktionen mit fehlenden Capability-Vektoren ausschließlich lexikalische Evidenz und weist `semanticPath: lexical`, `fallbackReason: capability_vectors_unavailable` sowie `missingCapabilities` je Treffer aus; keine stille Nutzung alter oder teilweise ersetzter Vektoren. Tests prüfen alle 25 Einträge einschließlich neuer Aggregation nur aus gültigen Vektoren.

Vor Release mit vorhandenem Online-Zugang über die bestehende LLM-Fassade ausführen: `LLM_PROVIDER=gemini LLM_EMBEDDING_MODEL=gemini-embedding-001 npm run generate:function-model-embeddings` (768 Dimensionen aus `function-model.parameters.json`). Danach Funktionsmodell, Signalkatalog, Operation-Index, LLM-Kontext und Evaluation neu generieren und Drift-Checks ausführen. Keine Online-Schlüssel im Test/CI benötigt; in diesem PR keine Vektoren erfunden.

Betroffene Einträge:

`agnes_bottleneck`, `blindflug_radar_anomaly_detection`, `e2e_controllability_check_governance`, `flexibilitaetskosten_raster`, `fnav_commercial_hedging`, `gasnetz_waermeplanung`, `gasnetz_waermeplanung_assessment`, `grid_connection_transformation_gate`, `grid_operator_identity_resolution`, `investment_risk_translation_status`, `jour_fixe_decision_closure_tracker`, `leadership_delta_cockpit`, `mastr_asset_inventory`, `netzfahrplan_fnav_assessment`, `nkp_reporting`, `oep_research_dataset_discovery`, `off_balancing_metering_pruefmatrix`, `redispatch_participation_readiness`, `residual_load_forecast_for_dso`, `scqa_decision_framing`, `vdmi_asset_validation_governance`, `vdmi_role_boundary_governance`, `vnb_delta_signal_classifier`, `vnb_kpi_benchmark_comparison`, `znp_portfolio_assessment`.

## AC → Test

| AC | Nachweis |
|---|---|
| AC-01/02 | `capability-routing-regression.test.js`, `capability-routing.test.js` |
| AC-03 | 413-Fälle-Evaluation, vollständige Differenzmenge, archivierte Baseline-Verifikation |
| AC-04 | echter `workbench.chat`-Completed-Turn in `function-coverage-turn.test.js`; E2E-Nummer/Name unter Service-Token mit Mapping/Fall-Kontext |
| Rückfrage/Sicherheit | `capability-clarification.test.js`: höchstens fünf Labels, keine internen IDs, ungültige/stale Auswahl abgelehnt |
| AC-05/06 | Keyword-Check, Cache-/Provider-/Dimension-/Turn-Budget-Tests, `capability-routing-cache-drift.test.js` für alle 25 stale Einträge |
| AC-07 | Broker/Router/Workbench/OpenAI/MCP/Sidecar-/Hybrid-Suites, Harness, E2E |
| AC-08 | Scoring, Parameter und Klärungsmodul im Domänenfreiheitscheck |

## Aufruferanalyse und Abgabe

HIGH Architektur-Risiko: Broker → Router → Workbench → Coverage → Aktivierung → Agents/Hinweise. Bestätigte Auswahl nutzt nur den zuvor sichtbaren Fall und dessen Kandidaten; Rechte-/Evidenz-/HITL-Prüfungen werden nicht erweitert. GitNexus-Impact vor Änderungen: neuere Symbole im Index fehlen (UNKNOWN); manuelle Aufruferanalyse ergänzt. Finale `detect_changes(scope=compare, base_ref=origin/main)` und CI-Ergebnisse stehen im PR. Merge-Commit von main, kein Rebase/Force-Push. Generierte Dateien ausschließlich durch Generatoren. Ready erst bei vollständig grüner CI; PR nicht mergen.

Die CI-Korpusprüfung aus #721 wurde an den belegten Cache-Verfall angepasst: gültige Vektoren müssen weiterhin Modell/Provider/Dimension erfüllen; fehlende und stale Vektoren müssen ausdrücklich lexikalisch zurückfallen. Die internen Resolver-Treffer sind nun durch die echte Modellgröße begrenzt statt durch 25; sichtbare Rückfragen bleiben bei fünf. Der unveränderte 600-Fragen-Korpus erreicht lexikalisch und hybrid jeweils 320 richtige Auflösungen + 274 korrekte Mehrdeutigkeiten, sechs falsche Auflösungen (1 %) und keine verlorenen Ziele. Die bisherigen 95-%-/5-%-Gates bleiben unverändert. Sieben ergänzende Resolver-/Workbench-Suites: 111 Tests grün (27,96 s).
