# Energy Domain Canon

Generated: 2026-10-11T01:32:48.510Z

Status: deterministic Shepherd working model, not a legal/regulatory assertion. It describes recurring fachliche structures visible in code/docs and should guide agentic development.

## Core principle

CET soll nicht nur Evidenz liefern, sondern energiewirtschaftliche Fälle bearbeitbar machen. Wenn harte Evidenz fehlt, soll CET Unsicherheit sauber halten, plausible Klärpfade anbieten und nächste Arbeitsschritte vorbereiten, ohne nicht belegte Dinge als entschieden darzustellen.

## Layers

- Evidence Layer: Quellen, Logs, Daten, OpenAPI, Belege, Nachweise.
- Practice Layer: fachlich übliche Bearbeitung, Plausibilisierung, Rückfragen, implizite Prozesslogik.
- Decision Layer: menschliche Arbeitsentscheidung, Eskalation, Freigabe, externe Kommunikation, Budget/Spend.
- Assistance Layer: natürliche Antwort, strukturierter Arbeitsstand, Next Best Action, Dokumentationsvorschlag.

## Foundational case types

- `stammdaten_marktrollen_klaerfall` — Stammdaten-/Marktrollen-Klärfall (observed)
- `messwert_edm_plausibilitaetsfall` — Messwert-/EDM-Plausibilitätsfall (observed)
- `kunden_service_klaerfall` — Kunden-/Service-Klärfall (routable)
- `netzanschluss_kapazitaets_klaerfall` — Netzanschluss-/Kapazitäts-Klärfall (observed)
- `prognose_abweichungsfall` — Prognose-/Abweichungsfall (observed)
- `redispatch_steuerbarkeits_readiness` — Redispatch-/Steuerbarkeits-Readiness (observed)
- `waerme_gas_eog_szenariofall` — Wärme-/Gas-/EOG-Szenariofall (observed)

## Domain clusters

## Fallarbeit und Assistenz

Arbeitsmodell: CET soll unvollständige Vorgänge bearbeitbar machen: einordnen, offene Punkte halten, nächste Schritte vorbereiten und Entscheidungspunkte sichtbar machen.

Starke Code-/Doku-Signale:

- `src/capability-catalog.js` (613 hits)
- `services/workbench.service.js` (524 hits)
- `docs/reviews/730-capability-routing-evaluation.json` (462 hits)
- `src/answer-dossier-hydration-rules.json` (361 hits)
- `services/personal-agent/actions-part-01-of-1.js` (360 hits)
- `services/capability-broker.service.js` (329 hits)
- `services/dashboard-api/methods-part-09-of-14.js` (265 hits)
- `services/dashboard-api/methods-part-08-of-14.js` (264 hits)
- `services/dashboard-api/actions-part-06-of-8.js` (256 hits)
- `services/dashboard-api/methods-part-10-of-14.js` (228 hits)
- `src/workbench-content-turn.js` (213 hits)
- `integrations/budibase/README.md` (196 hits)

Zugeordnete Services nach Heuristik:

- `domain-router` — services/domain-router.service.js (5 actions)
- `personal-agent` — services/personal-agent.service.js

## Evidence, Nachweis und Vertrauen

Arbeitsmodell: Nachweise begrenzen Aussagen, ersetzen aber nicht jede fachliche Arbeitshypothese. CET muss Unsicherheit sichtbar halten statt nützliche Fallstrukturierung zu verweigern.

Starke Code-/Doku-Signale:

- `src/answer-dossier-hydration-rules.json` (4049 hits)
- `services/dashboard-api/methods-part-05-of-14.js` (1574 hits)
- `services/dashboard-api/methods-part-04-of-14.js` (1416 hits)
- `services/personal-agent/actions-part-01-of-1.js` (1200 hits)
- `services/dashboard-api/methods-part-06-of-14.js` (1195 hits)
- `services/dashboard-api/methods-part-03-of-14.js` (1119 hits)
- `src/evidence-registry.js` (1100 hits)
- `src/capability-catalog.js` (1024 hits)
- `services/dashboard-api/methods-part-13-of-14.js` (660 hits)
- `services/dashboard-api/methods-part-12-of-14.js` (642 hits)
- `services/dashboard-api/methods-part-07-of-14.js` (636 hits)
- `services/dashboard-api/methods-part-11-of-14.js` (550 hits)

Zugeordnete Services nach Heuristik:

- `agent-receipts` — services/agent-receipts.service.js (19 actions)
- `blueprint-management` — services/blueprint-management.service.js (6 actions)
- `clarification-policy` — services/clarification-policy.service.js (6 actions)
- `connection-rejection-evidence` — services/connection-rejection-evidence.service.js (9 actions)
- `copilot-process` — services/copilot-process.service.js (3 actions)
- `datasource-cache` — services/datasource-cache.service.js (11 actions)
- `datasource-classifier` — services/datasource-classifier.service.js (8 actions)
- `datasource-connector` — services/datasource-connector.service.js (12 actions)
- `datasource-discovery` — services/datasource-discovery.service.js (3 actions)
- `datasource-registry` — services/datasource-registry.service.js (9 actions)
- `datasource-watcher` — services/datasource-watcher.service.js (2 actions)
- `dossier-hydration` — services/dossier-hydration-management.service.js (5 actions)
- `governance` — services/governance.service.js (6 actions)
- `investment-maturity-off-balance-gate` — services/investment-maturity-off-balance-gate.service.js (17 actions)
- `knowledge-continuity-governance-gate` — services/knowledge-continuity-governance-gate.service.js (17 actions)
- `knowledge-rag` — services/knowledge-rag.service.js (8 actions)
- `mcp-server` — services/mcp-server.service.js (9 actions)
- `municipality` — services/municipality.service.js (4 actions)
- `personal-agent-work-out-loud-listener` — services/personal-agent-work-out-loud-listener.service.js
- `presentation` — services/presentation.service.js (9 actions)

## MaKo / EDM / Stammdaten

Arbeitsmodell: Viele Vorgänge sind fachlich richtige Klärprozesse mit unvollständigen Datenständen. CET soll Klärpfade, Plausibilitäten und Rückfragen modellieren.

Starke Code-/Doku-Signale:

- `src/capability-catalog.js` (363 hits)
- `docs/validation/739-routing.json` (271 hits)
- `src/evidence-registry.js` (144 hits)
- `services/api.service.js` (131 hits)
- `services/capability-broker.service.js` (131 hits)
- `src/answer-dossier-hydration-rules.json` (121 hits)
- `services/dashboard-api/methods-part-05-of-14.js` (116 hits)
- `services/dashboard-api/methods-part-07-of-14.js` (114 hits)
- `services/dashboard-api/actions-part-01-of-8.js` (98 hits)
- `services/dashboard-api/methods-part-03-of-14.js` (96 hits)
- `docs/validation/746-answer-recovery-timeout-repeat-live.json` (93 hits)
- `src/workbench-activity-taxonomy.js` (89 hits)

Zugeordnete Services nach Heuristik:

- `edm-messkonzept` — services/edm-messkonzept.service.js (12 actions)
- `edm-validation` — services/edm-validation.service.js (9 actions)
- `edm-virtual` — services/edm-virtual.service.js (9 actions)
- `mscons-import` — services/mscons-import.service.js (3 actions)
- `re4de-variable-grid-fee` — services/re4de-variable-grid-fee.service.js (6 actions)
- `slp` — services/slp.service.js (3 actions)
- `willi-federated` — services/willi-federated.service.js (7 actions)
- `willi-mako` — services/willi-mako.service.js (7 actions)

## Netz, Anschluss und Kapazität

Arbeitsmodell: Netz- und Anschlussfälle brauchen Raum-/Zeit-/Asset-Kontext, plausible Last-/Kapazitätsannahmen und klare Grenzen zwischen Einschätzung und Entscheidung.

Starke Code-/Doku-Signale:

- `src/capability-catalog.js` (1056 hits)
- `docs/validation/739-routing.json` (821 hits)
- `docs/agent-responses/rd-audit.json` (719 hits)
- `services/assets.service.js` (617 hits)
- `services/capability-broker.service.js` (549 hits)
- `src/answer-dossier-hydration-rules.json` (543 hits)
- `services/grid-operations.service.js` (536 hits)
- `src/evidence-registry.js` (536 hits)
- `services/mastr-quality.service.js` (521 hits)
- `services/znp.service.js` (439 hits)
- `src/report-builder.js` (434 hits)
- `services/utility-report.service.js` (416 hits)

Zugeordnete Services nach Heuristik:

- `direktvermarkterName` — services/agent.service.js (4 actions)
- `vnbName` — services/assets.service.js (8 actions)
- `backup-orchestrator` — services/backup-orchestrator.service.js (4 actions)
- `bess-screening` — services/bess-screening.service.js (10 actions)
- `bilanzkreis` — services/bilanzkreis.service.js (5 actions)
- `Erneuerbare-Energien-Gesetz (EEG)` — services/community.service.js (6 actions)
- `cookbook` — services/cookbook.service.js (5 actions)
- `customer-service` — services/customer-service.service.js (3 actions)
- `datapoint` — services/datapoint.service.js (10 actions)
- `e2e-connection-check` — services/e2e-connection-check.service.js (9 actions)
- `edm` — services/edm.service.js (11 actions)
- `eeg-clawback-calculator` — services/eeg-clawback-calculator.service.js (5 actions)
- `energy-sharing-allocation` — services/energy-sharing-allocation.service.js (13 actions)
- `energy-sharing` — services/energy-sharing.service.js (10 actions)
- `ewk-monitoring` — services/ewk-monitoring.service.js (5 actions)
- `file-ingest-monitor` — services/file-ingest-monitor.service.js (11 actions)
- `finance-agent` — services/finance-agent.service.js (14 actions)
- `gas-capacity-order-revision-gate` — services/gas-capacity-order-revision-gate.service.js (18 actions)
- `ghost-asset-alert` — services/ghost-asset-alert.service.js (6 actions)
- `grid-connection` — services/grid-connection.service.js (18 actions)

## Prognose, Markt und Portfolio

Arbeitsmodell: Prognosen und Marktbezüge sind selten endgültige Beweise. CET soll Annahmen, Sensitivitäten, Abweichungen und nächste Prüfpfade ausweisen.

Starke Code-/Doku-Signale:

- `services/energy-market.service.js` (447 hits)
- `src/report-builder.js` (277 hits)
- `src/capability-catalog.js` (243 hits)
- `services/residual-load.service.js` (239 hits)
- `services/in-memory-join.service.js` (234 hits)
- `docs/validation/739-routing.json` (213 hits)
- `services/agent.service.js` (211 hits)
- `services/utility-report.service.js` (182 hits)
- `src/cookbook-recipes.js` (176 hits)
- `MCP_TOOLS.md` (157 hits)
- `services/forecast-engine.service.js` (145 hits)
- `docs/sonarcloud-security-review.json` (144 hits)

Zugeordnete Services nach Heuristik:

- `churn-prediction-${Date.now()}.csv` — services/business-intelligence.service.js (7 actions)
- `energy-market` — services/energy-market.service.js (8 actions)
- `entsoe` — services/entsoe.service.js (7 actions)
- `flex` — services/flex.service.js (4 actions)
- `forecast-engine` — services/forecast-engine.service.js (7 actions)
- `forecast-sandbox` — services/forecast-sandbox.service.js (3 actions)
- `forecast` — services/forecast.service.js (3 actions)
- `german-grid` — services/german-grid.service.js (6 actions)
- `in-memory-join` — services/in-memory-join.service.js (10 actions)
- `mqtt-broker` — services/mqtt-broker.service.js (8 actions)
- `mqtt-edm-ingest` — services/mqtt-edm-ingest.service.js (6 actions)
- `nkp-reporting` — services/nkp-reporting.service.js (8 actions)
- `object-store` — services/object-store.service.js (4 actions)
- `residual-load` — services/residual-load.service.js (12 actions)
- `settlement` — services/settlement.service.js (15 actions)

## Redispatch, Steuerbarkeit und Flexibilität

Arbeitsmodell: Steuerbarkeit ist ein Prozesszustand aus Technik, Vertrag, Marktrolle, Kommunikation und Nachweis. CET soll readiness statt binärer Freigabe modellieren.

Starke Code-/Doku-Signale:

- `docs/agent-responses/rd-audit.json` (836 hits)
- `src/capability-catalog.js` (629 hits)
- `services/capability-broker.service.js` (390 hits)
- `docs/validation/739-routing.json` (343 hits)
- `src/validation-findings.js` (337 hits)
- `src/report-builder.js` (199 hits)
- `src/answer-dossier-hydration-rules.json` (197 hits)
- `src/evidence-registry.js` (164 hits)
- `services/dashboard-api/methods-part-05-of-14.js` (158 hits)
- `services/api.service.js` (154 hits)
- `services/dashboard-api/methods-part-03-of-14.js` (141 hits)
- `services/redispatch-expost.service.js` (116 hits)

Zugeordnete Services nach Heuristik:

- `battery-redispatch-special-gate` — services/battery-redispatch-special-gate.service.js (15 actions)
- `capex-prioritization` — services/capex-prioritization.service.js (7 actions)
- `flexibilitaetskosten-raster` — services/flexibilitaetskosten-raster.service.js (7 actions)

## Gas, Wärme und EOG

Arbeitsmodell: Wärme-/Gasprozesse sind politisch, planerisch und datenfachlich unscharf. CET soll Szenarien, Befassungen und Klärpunkte trennen.

Starke Code-/Doku-Signale:

- `src/capability-catalog.js` (426 hits)
- `docs/validation/739-routing.json` (257 hits)
- `src/evidence-registry.js` (249 hits)
- `services/capability-broker.service.js` (243 hits)
- `src/answer-dossier-hydration-rules.json` (181 hits)
- `services/dashboard-api/methods-part-06-of-14.js` (165 hits)
- `services/dashboard-api/methods-part-12-of-14.js` (100 hits)
- `services/znp.service.js` (89 hits)
- `services/eog-calculator.service.js` (85 hits)
- `docs/eog-calculator-quality-element.md` (77 hits)
- `docs/reviews/730-capability-routing-evaluation.json` (74 hits)
- `services/gasnetz-waermeplanung.service.js` (73 hits)

Zugeordnete Services nach Heuristik:

- `eic-codes` — services/eic-codes.service.js (8 actions)
- `eog-calculator` — services/eog-calculator.service.js (7 actions)
- `gasnetz-waermeplanung` — services/gasnetz-waermeplanung.service.js (8 actions)

## Tenant, Rollen und Betrieb

Arbeitsmodell: Ein selbstlaufender EVU-Assistent muss bei erster Nutzung Kontext, Rollen, Zuständigkeiten und zulässige Handlungen schrittweise ausrichten.

Starke Code-/Doku-Signale:

- `services/workbench.service.js` (582 hits)
- `services/dashboard-api/methods-part-07-of-14.js` (492 hits)
- `services/api.service.js` (453 hits)
- `docs/v0.58-architecture/lagebild/roles_audit.md` (449 hits)
- `services/dashboard-api/actions-part-06-of-8.js` (448 hits)
- `services/dashboard-api/methods-part-09-of-14.js` (422 hits)
- `services/agent-persona.service.js` (409 hits)
- `services/personal-agent/actions-part-01-of-1.js` (393 hits)
- `src/capability-catalog.js` (381 hits)
- `services/vdmi.service.js` (376 hits)
- `src/answer-dossier-hydration-rules.json` (375 hits)
- `src/vdmi-blueprint-pack-seeds.js` (370 hits)

Zugeordnete Services nach Heuristik:

- `X-Tenant-Id` — services/agent-persona.service.js (9 actions)
- `agnes-bottleneck` — services/agnes-bottleneck.service.js (7 actions)
- `altdaten-assessment` — services/altdaten-assessment.service.js (7 actions)
- `api` — services/api.service.js (1 actions)
- `auth` — services/auth.service.js (5 actions)
- `automatisierungsradar` — services/automatisierungsradar.service.js (6 actions)
- `blindflug-radar` — services/blindflug-radar.service.js (6 actions)
- `company` — services/company.service.js (11 actions)
- `cya` — services/cya.service.js (8 actions)
- `dashboard-api` — services/dashboard-api.service.js
- `dataset` — services/dataset.service.js (9 actions)
- `decision-frame` — services/decision-frame.service.js (2 actions)
- `energy-sharing-community` — services/energy-sharing-community.service.js (5 actions)
- `evidence-requirement` — services/evidence-requirement.service.js (10 actions)
- `evidence-revalidation` — services/evidence-revalidation.service.js (9 actions)
- `flexibility-conductor-role-model` — services/flexibility-conductor-role-model.service.js (13 actions)
- `fnav-commercial-hedging` — services/fnav-commercial-hedging.service.js (13 actions)
- `activation` — services/function-activation.service.js (1 actions)
- `function-coverage` — services/function-coverage.service.js (1 actions)
- `gas-storage` — services/gas-storage.service.js (5 actions)

## OpenWebUI und agentisches Routing

Arbeitsmodell: Chat darf nicht nur Toolnamen sehen. Routing braucht Falltyp, Prozesszustand, Capability, Nachweisbedarf und HITL-Grenze.

Starke Code-/Doku-Signale:

- `services/capability-broker.service.js` (758 hits)
- `services/chatgpt-sidecar.service.js` (335 hits)
- `services/personal-agent/actions-part-01-of-1.js` (330 hits)
- `function-model.report.md` (309 hits)
- `src/capability-catalog.js` (292 hits)
- `services/domain-routes-management.service.js` (275 hits)
- `src/answer-dossier-hydration-rules.json` (235 hits)
- `services/personal-agent/methods-part-03-of-11.js` (234 hits)
- `services/workbench.service.js` (232 hits)
- `services/api.service.js` (187 hits)
- `src/personal-agent-routing.js` (168 hits)
- `docs/sonarcloud-security-review.json` (155 hits)

Zugeordnete Services nach Heuristik:

- `agent-manifest` — services/agent-manifest.service.js (3 actions)
- `agent-sidecar` — services/agent-sidecar.service.js (2 actions)
- `startDate` — services/capability-broker.service.js (4 actions)
- `ticket` — services/chatgpt-sidecar.service.js (8 actions)
- `domain-routes` — services/domain-routes-management.service.js (5 actions)
- `evidence-router` — services/evidence-router.service.js (4 actions)
- `system` — services/system.service.js (3 actions)


## Unclassified service candidates

Diese Services sind nach Heuristik nicht stark einem Cluster zugeordnet und sollten fachlich eingeordnet oder als technisch/experimentell markiert werden:

- none detected
