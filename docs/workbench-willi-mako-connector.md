# Workbench Willi-MaKo Evidence Connector

CET remains the case, audit and governance owner. Willi-MaKo is integrated as a tenant-scoped MaKo diagnostic evidence source for Workbench/Open WebUI cases.

## Prerequisites

The following prerequisites apply to session-based diagnostic evidence, not general article knowledge search. General Willi and federated knowledge require no person mapping and use tenant `knowledgeSources` switches (see the deployment runbook).

Before a Workbench case can use session-based Willi-MaKo evidence, CET must have:

- a Willi-MaKo mandant/user mapping via `/api/workbench/admin/willi-mako/mappings`;
- a tenant-scoped role alignment via `/api/workbench/admin/willi-mako/role-alignments` or the safe defaults;
- server-side Willi-MaKo service configuration (`WILLI_MAKO_BASE_URL` plus `WILLI_MAKO_CET_SERVICE_SECRET` or `WILLI_MAKO_CET_SERVICE_TOKEN`).

The connector does not use the legacy/global Willi admin token for customer Workbench flows.

## APIs

- `GET /api/workbench/willi-mako/sessions`
- `POST /api/workbench/cases/:caseId/willi-mako/evidence`
- `POST /api/workbench/cases/:caseId/willi-mako/link`

All calls are tenant-bound and actor-bound. A Willi mandant/user/email without an enabled CET mapping fails closed.

## Evidence model

Willi diagnostic summaries are stored as Workbench EvidenceRefs:

- `sourceType: willi_mako_ref`
- evidence types such as `mako_process_trace`, `mako_error_code_diagnosis`, `aperak_message`, `contrl_message`, `mscons_message_status` or `utilmd_master_data`
- `evidenceRole: diagnostic_signal`
- `claimStrength: supporting`
- `readinessReviewRequired: true`

APERAK/Z18 summaries emit routing signals such as `market_communication`, `aperak_z18` and `market_master_data`, but they do not automatically resolve the case. APERAK/AHB segment context, master-data history and human review remain required before any final claim.

## Safety boundaries

- Raw Willi chat history is not returned to Open WebUI or injected into LLM context.
- Service credentials/tokens/signatures never appear in Workbench responses, ToolRuns or EvidenceRefs.
- Willi staff visibility does not grant CET cross-tenant authority.
- Case linking writes an explicit Willi service API request and returns only a safe confirmation.
- No external MaKo message is prepared or sent by this connector.

## Open WebUI MaKo reference flow

The customer-facing RC3 flow is: Open WebUI sends the MaKo clarification request to the Workbench chat, CET creates or continues the Workbench case, Willi-MaKo is used only as a tenant-mapped diagnostic evidence source, and the resulting `willi_mako_ref` EvidenceRef is attached back to the CET case. APERAK/Z18 evidence may move the case toward `market_communication` and add EDM/master-data alternatives, but the case remains `evidence_required` until APERAK/AHB/segment and master-data context is complete.

The reference flow must never call Willi directly from Open WebUI and must never prepare, send, queue or claim an external MaKo message. Dossiers may cite Willi-MaKo only as supporting diagnostic evidence.

## Mail-Threads und Aufgabenmodell (#752)

`WORKBENCH_MAX_INPUT_CHARS` begrenzt den Rohtext pro Turn (Standard: 40000 Zeichen).
Die Workbench zerlegt eingefügte Korrespondenz anhand von Nachrichtenköpfen und
Zitatmarkern. Wiederholte mehrzeilige Schlussblöcke werden entfernt; wiederholte
Aussagen im Nachrichtentext bleiben erhalten. Das Verstehen erhält eine begrenzte
Darstellung und erstellt eine chronologische Zeitleiste mit Rollen, Datum,
Kernaussagen und berichteten Aussagen. Bei überschrittenem Darstellungsbudget
werden Nachrichten anteilig gekürzt. Die Originalnachricht bleibt beim Client;
die Aufbereitung ersetzt kein revisionssicheres Mailarchiv.

Codearten, Erkennungsmuster und Nachschlagequellen stehen in
`src/workbench-code-catalog.json`. `workbenchCodeCatalog` in den Service-Settings
kann die Quellenkonfiguration ersetzen. `willi-mako.resolveStructure` ruft intern
`search` mit `category`/`tag` und `includeContent` auf: Es ist keine garantierte
Codelisten-API. Nur Treffer mit dem exakten Code im Inhalt werden als Beleg
übernommen; ähnliche Codes und leere, gesperrte oder ausgefallene Quellen bleiben
ungeklärt. In diesem Zustand fragt CET nach dem Originalwortlaut und erzeugt
keinen fachlichen Entwurf. Fachliche Entwurfsmuster stehen ebenfalls im Katalog,
nicht im Gesprächskern. Tenant-Freigaben gelten auch für Codeabfragen.

In Open WebUI unter **Admin → Einstellungen → Aufgaben → Aufgabenmodell** ein
schnelles Modell für Titel, Tags und Folgefragen wählen. Wenn diese Aufgaben
weiterhin an `cernion-governance-assistant` gehen, erkennt CET die Kombination
`### Task:` plus Chatverlaufsblock und nutzt nur das Verstehen-Modell. Die Antwort
ist das angeforderte JSON-Objekt (`title`, `tags` oder `follow_ups`); es entstehen
keine Fälle, Quellenabfragen, Notices oder Coverage-Berührungen. Ein bloßes Wort
„Titel“ oder „Tags“ in einer Nutzernachricht aktiviert diesen Pfad nicht.

Die Produktionspaar-Konfiguration bleibt:

```dotenv
WORKBENCH_LLM_MODEL=gemini-3.5-flash-lite,gemini-flash-latest
WORKBENCH_LLM_TIMEOUT_MS=15000,45000
WORKBENCH_LLM_THINKING=minimal,default
```

Folgeturns verwenden weiterhin ein inkrementelles Lagebild; reine Entwurfswünsche
überspringen Verstehen und Retrieval. Die Phasenzeiten in der Antwort sind die
Betriebsgrundlage für das offene Ziel aus #746: Folgeturn unter zehn Sekunden.
Der Bericht `docs/validation/752-live-model.json` unterscheidet echte Modell- und
Willi-Mako-Aufrufe von den dokumentierten lokalen Quellen-Stubs. Reproduktion:

```bash
WORKBENCH_ENV_FILE=/pfad/zur/.env node scripts/validate-workbench-752-live.js
```

Der Lauf verwendet ausschließlich synthetische Fixtures aus
`tests/fixtures/workbench-752.json`. Die realen Produktionsmails wurden nicht
bereitgestellt; die Fixtures erhalten die im Issue beschriebene Struktur und
Länge, sind aber keine wortgetreuen Anonymisierungen der Originale.

Reine Nächster-Schritt-Folgeturns verwenden dieselbe, maximal fünf Minuten alte
Evidenz erneut. Die Tenant-Freigabe und die Antwortgrenze werden dabei erneut
geprüft. Neue Sachangaben und abgelaufene Evidenz lösen eine neue Abfrage aus;
die gespeicherte Zeitleiste wird beim inkrementellen Verstehen nicht nochmals
übergeben oder erzeugt. Ein weiterer Entwurf liegt nur bei einem neuen Anlass
oder einem ausdrücklichen Entwurfswunsch bei.

Einzelne Szenarien lassen sich mit `WORKBENCH_VALIDATION_SCENARIOS=R3` auswählen;
`WORKBENCH_VALIDATION_REPORT=752-live-r3-final.json` wählt den Berichtsnamen.
