# Capability routing #730

Closes #730
Part of #693

Der allgemeine Broker-Pfad gewichtet Katalogseltenheit und Spezifität, erkennt Komposita mit der bestehenden Resolver-Zerlegung und Mehrwortbegriffe in einem begrenzten Fenster unabhängig von der Reihenfolge. Konfidenz berücksichtigt Score und Abstand zum Zweitplatzierten. Der Router übergibt seine vorläufige Domain, hält unsichere Treffer als Kandidaten zurück und stellt eine Klärung. Ein kompatibles Anfrage-Embedding ist optional; Modell, Provider, Dimension und Text-Hash des vorhandenen Caches werden geprüft. Ein WeakMap-Eintrag am Moleculer-Wurzelkontext begrenzt wiederholte/nested Broker-Aufrufe auf einen Embedding-Aufruf pro Turn; andere Anfragen im selben Turn fallen sichtbar lexikalisch zurück.

## AC → Tests

| AC | Nachweis |
| --- | --- |
| AC-01 | capability-routing-regression.test.js: vier issue-730-Fälle, Top-1 passend, einer unsicher |
| AC-02 | capability-routing.test.js: häufiger Einzelbegriff, geringer Score/enge Marge |
| AC-03 | eingefrorener bilingualer 413-Fälle-Satz; Redispatch/Zielnetzplanung/MaStR-Regressionstests |
| AC-04 Router | capability-routing-regression.test.js: Kandidaten, leere selectedCapabilities, Rückfrage, activatesCoverage=false |
| AC-04 Coverage | **Ausstehend bis #729 auf main liegt**: origin/main mergen (kein Rebase), Coverage-Guard und Workbench-Durchstich ergänzen |
| AC-05 | check:capability-keywords; Cleanup-Fixture und Test für unveränderte übrige Katalogfelder/172 IDs |
| AC-06 | Fixture-Vektoren: Modell-/Provider-/Dimensionsfehler, kein Provider, ein Aufruf pro Wurzelturn |
| AC-07 | Broker, Domain Router, Resolver/Hybrid, MCP, beide Sidecars, Workbench; Shared-Service-Harness; E2E folgt #729 |
| AC-08 | neues Scoring-Modul/Parameterdatei im automatischen Domänenfreiheitscheck |

## Impact und Risiko

**HIGH Architektur-Risiko**: dynamische RPC-Aufrufe werden vom statischen Graphen nicht vollständig abgebildet. GitNexus-Analyse auf isoliertem origin/main-Worktree: findBestCapability → recommend.handler (ein direkter Aufrufer, drei Flows: StaticRoutes, RuntimeCapability, UnsafePattern). classifyDomain → routeCase → handler (zwei betroffene Symbole). indexModel → resolveFunctions und Resolver-/Workbench-Verbraucher (sechs). tokens: zwei direkte, acht betroffene Symbole, HIGH. normalizePhrase: vier direkte, 19 betroffene Symbole bis OpenAI-Turn, CRITICAL; **Implementierung unverändert**, bestehender Export bleibt erhalten. Die neuen generischen Module werden vor Commit mit detect_changes geprüft.

Tatsächliche Aufrufer von capability-broker.recommend:

| Verbraucher | Stelle/Pfad |
| --- | --- |
| Domain Router | services/domain-router.service.js, routeCase |
| Agent | services/agent.service.js, getCapabilityBrokerRecommendation |
| Personal Agent | methods-part-06-of-11.js und actions-part-01-of-1.js |
| Dashboard/Workbench | dashboard-api/actions-part-01-of-8.js: resolverRules; Workbench ruft Domain Router |
| Agent Sidecar | services/agent-sidecar.service.js: manifest-basierter Dispatch |
| ChatGPT Sidecar | services/chatgpt-sidecar.service.js: handlePlan |
| MCP Server | indirekt personal-agent.askCernionAgent/answerDossier und agent-sidecar.descriptor, kein direkter recommend-Aufruf |
| Domain Route Management | services/domain-routes-management.service.js: _runTestMatrix |
| CYA / ZNP / Utility Report | jeweilige Service-Actions |

Katalog preferredActions, Dashboard sourceActions/referenceListen und Gesundheitsstatistik sind **Referenzen**, keine zusätzlichen Aufrufstellen.

## Unveränderter Bewertungssatz, vorher → nachher

SHA-256: `09ce6e64f9645a3cb11953dda93d1eb8c20f5b3cc9493d11863a93cd2bc610b6`. Baseline stammt aus `3d618836` vor allen Scoring-/Katalogänderungen; der Evaluator verweigert einen veränderten Korpus. Je drei freie realistische deutsche/englische Anfragen für alle 16 Router-Domänen plus vier Issue-Anfragen wurden zuerst geschrieben, danach 27 bestehende Semantic-Beispiele, fünf Receipt-Titel/Beschreibungen und 328 zuordenbare Operation-Summaries aus Datenquellen angefügt. Quellassoziierte Labels der bestehenden Beispiele sind breiter als die einzelnen Capability-Labels im unabhängigen Satz; die Gruppen sind deshalb getrennt ausgewiesen. Die alten Ergebnisse hatten nur eine empfohlene Capability; ihre Top-3-Quote entspricht der beobachtbaren Top-1-Quote. Beide Läufe sind offline/lexikalisch, ohne Anfrage-Provider. Fallback zählt zusätzlich separat; bei erwarteten expliziten Lücken kann ein Fallback korrekt sein.

| Satz | Top-1 | Top-3 | unsicher | interface_placeholder | ECE ↓ |
| --- | --- | --- | --- | --- | --- |
| all (413) | 46.5 % → 57.4 % | 46.5 % → 69.0 % | 0.0 % → 49.6 % | 20.8 % → 22.3 % | 0.362 → 0.166 |
| issue-730 (4) | 0.0 % → 100.0 % | 0.0 % → 100.0 % | 0.0 % → 25.0 % | 0.0 % → 0.0 % | 0.850 → 0.255 |
| independent-regression (48) | 70.8 % → 87.5 % | 70.8 % → 97.9 % | 0.0 % → 22.9 % | 0.0 % → 0.0 % | 0.204 → 0.113 |
| known-correct (1) | 100.0 % → 100.0 % | 100.0 % → 100.0 % | 0.0 % → 0.0 % | 0.0 % → 0.0 % | 0.080 → 0.126 |
| semantic-example (27) | 63.0 % → 74.1 % | 63.0 % → 74.1 % | 0.0 % → 92.6 % | 63.0 % → 74.1 % | 0.608 → 0.846 |
| receipt-example (5) | 60.0 % → 60.0 % | 60.0 % → 80.0 % | 0.0 % → 60.0 % | 20.0 % → 20.0 % | 0.418 → 0.612 |
| operation-summary (328) | 41.8 % → 50.9 % | 41.8 % → 63.7 % | 0.0 % → 50.3 % | 20.7 % → 21.6 % | 0.409 → 0.136 |

Die vier Issue-Anfragen erreichen 4/4 Top-1. Redispatch-Abrechnung, Zielnetzplanung und MaStR bleiben korrekt. Brier/ECE und die Konfidenz-Bins stehen in capability-routing-evaluation.json; es handelt sich um eine empirische Score-/Margin-Kalibrierung, keine Zusage perfekt kalibrierter Wahrscheinlichkeiten.

Regressions-IDs im vorhandenen Operation-Summary-Satz: `capex-prioritization_list`, `capex-prioritization_analyze`, `capex-prioritization_get`, `datasource-cache_query`, `eic-codes_gasFacilities`, `eic-codes_gasOperators`, `fnav-commercial-hedging_listContracts`, `fnav-commercial-hedging_createContract`, `mscons-import_import`. Kurze technische Summaries bleiben teilweise unklar; die Detailergebnisse stehen im JSON. Der unabhängige Satz wird zur Interpretation separat berichtet, nicht nachträglich umgeschrieben.

## Keyword-Bereinigung (nur Daten)

Aktuelles main enthält weiterhin 172 Capabilities, aber nach derselben Verbreitungsdefinition inzwischen 27 betroffene Einträge statt der im Issue genannten 24 (31 verbreitete Rohbegriffe statt 28). Alle 27 werden bereinigt. Nur keywords ändern sich; Actions, Domains, Inputs und alle übrigen Felder bleiben identisch. Allgemeine Einzelbegriffe entfallen; beim MaStR-Inventar ersetzen spezifische Mehrwortbegriffe den entfernten unspezifischen Anlagen-/Speicherbezug.

| Capability | entfernt | ergänzt/Begründung |
| --- | --- | --- |
| `blindflug_radar_anomaly_detection` | `redispatch` | —; spezifische Keywords bleiben |
| `znp_portfolio_assessment` | `fnav` | —; spezifische Keywords bleiben |
| `vnb_delta_signal_classifier` | `frist`, `owner`, `anschluss`, `kapazitaet`, `kapazität` | —; spezifische Keywords bleiben |
| `leadership_delta_cockpit` | `eskalation` | —; spezifische Keywords bleiben |
| `netzfahrplan_fnav_assessment` | `fnav` | —; spezifische Keywords bleiben |
| `residual_load_forecast_for_dso` | `stadtwerk`, `vnb` | —; spezifische Keywords bleiben |
| `vdmi_role_boundary_governance` | `rollen`, `rolle` | —; spezifische Keywords bleiben |
| `vdmi_asset_validation_governance` | `evidence`, `evidenz`, `nachweis` | —; spezifische Keywords bleiben |
| `grid_operator_identity_resolution` | `vnb` | —; spezifische Keywords bleiben |
| `mastr_asset_inventory` | `anlage`, `wind`, `speicher`, `redispatch` | `mastr anlagen`, `mastr netzgebiet`, `mastr inventory` |
| `oep_research_dataset_discovery` | `szenario` | —; spezifische Keywords bleiben |
| `vnb_kpi_benchmark_comparison` | `kpi` | —; spezifische Keywords bleiben |
| `agnes_bottleneck` | `engpass` | —; spezifische Keywords bleiben |
| `fnav_commercial_hedging` | `fnav`, `fna` | —; spezifische Keywords bleiben |
| `flexibilitaetskosten_raster` | `steuerbarkeit` | —; spezifische Keywords bleiben |
| `nkp_reporting` | `kpi` | —; spezifische Keywords bleiben |
| `reporting_governance` | `governance` | —; spezifische Keywords bleiben |
| `gasnetz_waermeplanung` | `gasnetz` | —; spezifische Keywords bleiben |
| `vdmi_portfolio_gatekeeping` | `vdmi`, `governance` | —; spezifische Keywords bleiben |
| `scqa_decision_framing` | `transformation` | —; spezifische Keywords bleiben |
| `jour_fixe_decision_closure_tracker` | `owner`, `kpi`, `eskalation` | —; spezifische Keywords bleiben |
| `off_balancing_metering_pruefmatrix` | `datenqualitaet`, `datenqualität` | —; spezifische Keywords bleiben |
| `grid_connection_transformation_gate` | `netzanschluss` | —; spezifische Keywords bleiben |
| `investment_risk_translation_status` | `folgeentscheidung` | —; spezifische Keywords bleiben |
| `e2e_controllability_check_governance` | `steuerbarkeit` | —; spezifische Keywords bleiben |
| `redispatch_participation_readiness` | `steuerbarkeit` | —; spezifische Keywords bleiben |
| `gasnetz_waermeplanung_assessment` | `gasnetz` | —; spezifische Keywords bleiben |

## Abweichungen und Grenzen

- Bereits bestehende fachliche Mehrsignal-Intent-Regeln und explizite Sicherheits-Fallbacks im Broker bleiben erhalten. Ihr konfigurierbarer Bonus fließt in denselben kalibrierten Rang ein; der neue Keyword-Pfad enthält keine Fachbegriffe.
- Zwei Broker-Negativtests akzeptieren nun den read-only Treffer ausschließlich als **unsicheren** Kandidaten und prüfen zusätzlich, dass legal/provisioning/execution-Actions fehlen. Breite Singleton-Zählung und die alte pauschale 0,84-Konfidenz werden nicht mehr verlangt.
- 25 Cache-Einträge sind durch die Datenbereinigung textlich veraltet und werden ausgeschlossen/offen berichtet. Keine Vektoren erfunden und kein erforderlicher Online-Refresh. Die vorgeschriebene Offline-Modellregeneration kann Gruppen/Lineage verändern; diese Änderungen stehen in den generierten Reports und verwenden die bestehenden stabilen IDs.
- Generisches dispatch-Wort route ist mit Begründung im bestehenden Domänenfreiheits-Allowlist; neue Scoring-Datei und Parameterdatei werden geprüft.
- Coverage-Dateien aus #729 wurden nicht geändert. Nach dessen Merge folgen AC-04-Durchstich und test:e2e:shared-service; erst nach vollständiger grüner CI Ready for review. Kein Merge dieses PRs.

## Lokale Validierung

- `npm run lint`: erfolgreich, eine bereits bestehende Warnung in `tests/domain-free-core.test.js`.
- 422 gezielte Tests über elf Suites grün; nach der zusätzlichen Handoff-Sperre 65 Router-/Regressionstests und elf Scoring-Tests erneut grün.
- `npm run test:shared-service:ci`: 86 Tests grün, Laufzeit 31,76 s.
- `eval:capability-routing`, `check:capability-keywords`: erfolgreich; keine verbliebenen verbreiteten Singleton-Keywords bei Schwelle acht.
- `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`, `check:llm`, `check:quality-gate`, `git diff --check`: erfolgreich.
- `test:e2e:shared-service`: noch nicht verfügbar auf diesem main; folgt zwingend nach #729.

### GitNexus vor Commit

`detect_changes(scope=staged)` für alle elf geänderten/neuen JS-Code-/Testdateien erfolgreich: 62 Symbole, acht erwartete Prozesse, **HIGH**. Betroffen sind die Broker-Flows zu NormalizePhrase, Require, CommonValues, CompareCanonicalStrings, HasEmbeddingText, TextHash, ValidEntry und FindRuntimeCapability. Kein fremder Servicepfad. Der Gesamt-Lauf über die sehr großen generierten Model-Diffs hatte Query-Timeouts und wurde beendet; generierte Daten werden separat durch die erfolgreichen Drift-Checks und den Non-Keyword-Feldhash im Katalogtest geprüft. Die aktualisierte Impact-Analyse für rankCapabilities zeigt drei direkte Aufrufer im Broker/Scoring-Pfad (LOW statisch), während das dynamische Architektur-Risiko HIGH bleibt.
