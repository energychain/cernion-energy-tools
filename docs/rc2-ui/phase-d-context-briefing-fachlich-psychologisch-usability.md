# CET RC2 UI — Phase D Context Briefing: Fachlich, psychologisch, usability

> **Status:** unmittelbarer Kontext vor Phase D
>
> **Branch:** `feat/cet-release-rc2-ui`
>
> **Datum:** 2026-09-22
>
> **Zweck:** Phase D nicht als reine Layout-/Komponentenverdrahtung starten, sondern mit den fachlichen, psychologischen und Usability-Regeln im Arbeitsgedächtnis.

## 1. Quellenlage

### Verwendete lokale/Nextcloud-Artefakte

- `cet-rc2-ux-ui-feinkonzept.md`
- `cet-rc2-ux-ui-spezifikationsschnitt.md`
- `cet-rc2-detailplanung-vor-umsetzung.md`
- `docs/rc2-ui/phase-b-governance-grounding-validation.md`
- `docs/rc2-ui/phase-b-qdrant-grounding-validation.md`
- `docs/rc2-ui/spec-c-display-elements.md`
- `docs/rc2-ui/spec-c-visible-components.md`

### OpenClaw/Qdrant-Recheck

Query:

```text
CET RC2 UI Phase D fachlich psychologisch usability Tagesfläche Vorgangsansicht Nachweisansicht Operationskonsole mentale Last Vertrauen Freigabe Rollen Stadtwerk UX
```

Resultat: keine zusätzlichen Treffer über die bereits eingebundenen Governance-/RC2-Artefakte hinaus. Damit bleiben die Nextcloud-Artefakte und die Phase-B/Phase-C-Grounding-Dokumente die unmittelbare Arbeitsbasis.

## 2. Aktive Grundentscheidung für Phase D

Phase D verdrahtet die Phase-C-Primitives in konkrete Flächen:

1. Tagesfläche
2. Vorgangsansicht
3. Nachweisansicht
4. Operationskonsole

Phase D ist **keine** Gelegenheit, Fachregeln in Page-Komponenten neu zu erfinden. Wenn ein fachliches, psychologisches oder Usability-Muster fehlt, wird zuerst die Primitive-/Helper-Schicht erweitert und erst danach in die Fläche eingebaut.

## 3. Fachliche Leitplanken

### REST- und Rollen-Grenze

- Browser/UI spricht nur `/api/ui/v0/...`.
- Keine direkten Moleculer Actions aus der UI.
- Alle UI-Reads und CET-internen Writes laufen über REST-Gateway, Tenant/Auth, aktive Rolle, Rollenfilter und Logging.
- Rollenwechsel zeigt nur Rollen, die Benutzer oder Agent im Mandanten tatsächlich haben.
- Placeholder-Agent wird als Agent der Rolle sichtbar, nicht als unsichtbarer Systemersatz.

### Vorgang statt Systemsprache

Primäre UI-Sprache:

- `Vorgang`
- `Heute`
- `Nachweise`
- `Konsole`
- `Grenzen dieser Ansicht`
- `Freigabe`
- `Unsicherheit`
- `In Bearbeitung durch <Name>`

Nicht primär sichtbar:

- `Laufkarte`
- `Präsentationsvertrag`
- `Schnittplan`
- `Situationsschlüssel`
- `Vertragsdeklaration`
- `Render-Gate`
- `Next Best Action`
- `Zur Kenntnis`

### Nachweis und Rohdaten

- Jede dargestellte Aussage braucht `granularitaet`.
- `aggregat` darf als projizierte Aussage materialisiert werden.
- `einzeldatensatz` bleibt hash/ref-only und wird als `nur mit Quelle reproduzierbar` markiert.
- Nicht-projiziertes JSON bleibt Rohantwort und ist kein Nachweis.
- Nicht-projiziertes JSON erhält keinen Aggregatzustand und keine Evidenzmarker.

### Freigabe

- Zustände: `offen`, `angefordert`, `erteilt`, `verweigert`.
- `erteilt` und `verweigert` sind menschliche bzw. rollen-/agenten-attribuierte Akte.
- UI darf nicht suggerieren, CET entscheide, empfehle oder genehmige selbst.
- Der Freigabesatz ist in der Vorgangsansicht immer sichtbar, auch mobil.

## 4. Psychologische Leitplanken

### Zielgefühl: Orientierung statt Kontrollverlust

Die UI soll nicht wie ein generischer Task-Manager wirken. Der Nutzer soll sofort verstehen:

- Warum sehe ich diesen Vorgang?
- Welche Rolle habe ich gerade?
- Was wird von mir oder meiner Rolle gebraucht?
- Was ist belegt, was ist ungeprüft, was ist unklar?
- Was kann ich sicher tun, ohne ein externes Fachsystem auszulösen?

### Aufmerksamkeit statt KPI-Druck

Die Tagesfläche beantwortet: **Was braucht heute meine Aufmerksamkeit?**

Sie ist kein KPI-Dashboard. Zahlen dürfen orientieren, aber nicht dominieren. Relevanz entsteht aus:

- Aufmerksamkeitsgrund;
- Frist;
- nächstem Beitrag;
- Rollenwirkung;
- sichtbarem No-Action-/Übernahmezustand.

### Reduzierte Entscheidungslast

Phase D muss Entscheidungsdistanz sichtbar machen, ohne den Nutzer zu drängen.

Gute Wirkung:

- offene Kriterien klar sichtbar;
- `nicht_anwendbar` eingeklappt;
- nächster Beitrag ist Beitrag, nicht Ergebnisversprechen;
- Action-Buttons benennen die Art des Schreibens: lesend, CET-intern, HITL, extern nicht angebunden.

Schlechte Wirkung:

- globale Ampel ohne Quellen;
- “Entscheidungsreif” ohne offene/erfüllte Kriterien;
- Aktionen mit Ergebnisversprechen;
- unklare Freigabewirkung.

### Vertrauen durch Attribution

Vertrauen entsteht durch sichtbare Verantwortung:

- Person/Rolle/Agent getrennt darstellen;
- Mandant sichtbar halten;
- Freigabehandlungen mit Actor/Rolle/Zeit zeigen;
- Nachweise mit Herkunft, Zeit und Reproduzierbarkeit zeigen;
- Console-Nutzung als Bedarfssignal loggen, aber nicht als Entscheidung darstellen.

### Unsicherheit ist ein eigener Arbeitsgegenstand

Unsicherheit darf nicht versteckt werden. Sie muss zeigen:

- was nicht klar ist;
- warum es unklar ist;
- welche Rolle klären kann;
- welche Anschlussfrage besteht;
- ob eine unbesetzte Rolle durch Placeholder-Agent bedient wird.

## 5. Usability-Leitplanken je Fläche

### D1 Tagesfläche

Zweck: Einstiegsfläche für Aufmerksamkeit.

Muss sichtbar machen:

- Mandant, Benutzer, aktive Rolle;
- Attention Summary;
- Vorgänge, die Aufmerksamkeit brauchen;
- Grund + nächster Beitrag + Frist + Status;
- Übernahmezustand;
- Empty States unterschieden nach: keine Vorgänge, keine Rolle, kein Tenant-Datenstand, Placeholder-Agent, Auth/API-Fehler.

Nicht erlaubt:

- reine KPI-Tafel;
- generisches “Keine Daten” für alle Leerzustände;
- direkte Freigabe aus der Karte;
- versteckte Statusübergänge.

### D2 Vorgangsansicht

Zweck: zentrale Arbeitsfläche für einen Vorgang.

Muss sichtbar machen:

- fünf Grammatikteile in fester Reihenfolge: Vorgang, Quellen, Prüfung, Unsicherheit, Freigabe;
- linker Arbeitskontext: Rolle, Übernahme, nächster Beitrag, Entscheidungsdistanz, sichere Actions;
- rechte Zusatzfläche: Grenzen, Herkunft, Historie, seit letztem Zugriff;
- mobile Minimalprominenz: Vorgang, nächster Beitrag, Freigabesatz.

Nicht erlaubt:

- Grammatikteile semantisch verstecken;
- Freigabe nur in einem entfernten Tab;
- Quellen/Unsicherheit ohne Label unauffindbar machen;
- systeminterne Architekturbegriffe in Hauptcopy.

### D3 Nachweisansicht

Zweck: eingefrorenen, reproduzierbaren Nachweiszustand prüfen.

Muss sichtbar machen:

- Freeze-Zeitpunkt;
- Actor/Rolle/Tenant/Zeit;
- Materialisierte Aussagen;
- `granularitaet`;
- Quelle/Hash/Ref;
- Reproduzierbarkeit: vollständig vs. nur mit Quelle;
- Freigabestatus zum Freeze.

Nicht erlaubt:

- Einzeldatensatz als Rohwert materialisieren;
- fehlende Granularität tolerieren;
- nicht-projizierte Rohantwort als Nachweis anzeigen.

### D4 Operationskonsole

Zweck: UI-Zugang zu CET REST API Tasks und Bedarfssignal für zukünftige Muster.

Muss sichtbar machen:

- Operation finder mit Capability/Rolle/Risk-/Write-Class;
- Operation Contract: Zweck, Inputs, Output, Rollen-/Tenant-Grenze, Write-Grenze, `nichtHandlungen`;
- klar getrennte Resultzustände: projected vs. not_projected;
- Nutzung wird als Bedarfssignal protokolliert.

Nicht erlaubt:

- unfiltered internal/dev/system routes;
- externe Fachsystem-Writes;
- direkte Moleculer Actions;
- not_projected JSON als Aussage/Nachweis/Entscheidung darstellen.

## 6. Phase-D Testpflichten

### Surface-Tests

- D1: Tagesfläche ist Startseite, keine KPI-Seite.
- D1: Sortierung nach Aufmerksamkeit/Frist.
- D1: Gruppierung nur bei identischem Aufmerksamkeitsgrund und Beitragstyp.
- D1: Empty States unterscheiden fachliche Ursachen.
- D2: fünf Grammatikteile vorhanden und in Reihenfolge.
- D2: Freigabesatz immer sichtbar.
- D2: mobile Minimalprominenz für Vorgang, nächster Beitrag, Freigabesatz.
- D3: `einzeldatensatz` nie als Rohwert materialisiert.
- D3: fehlende Granularität blockiert Proof/Freeze-Rendering.
- D4: not_projected Result ist strukturell getrennt und enthält keine Evidence-/Aggregation-Semantik.

### Source-/Wording-Tests

- Keine primäre UI-Copy mit verbotener Systemsprache.
- Keine Copy, die CET als Entscheider darstellt.
- No external-system write action visible.
- Actions labeln `read`, `cet_internal_write`, `hitl`, `external_write_unavailable`.

## 7. Unmittelbare Umsetzungsempfehlung

Phase D sollte in vier kleine test-first Slices gehen:

1. `spec-d1-tagesflaeche.md` + Tagesflächen-Wiring-Test.
2. `spec-d2-vorgangsansicht.md` + Grammar-/Mobile-Prominence-Test.
3. `spec-d3-nachweisansicht.md` + F3-/Freeze-/Reproduzierbarkeits-Test.
4. `spec-d4-operationskonsole.md` + Not-Projected-/Permission-/No-Execute-Test.

Erst danach sollten wir die App-Shell vollständig auf diese D-Flächen umbauen.
