# CET RC2 Phase D — Fachliche, psychologische und Usability-Kontextkapsel

Status: Vorbereitung für Phase D auf Branch `feat/cet-release-rc2-ui`.

## Zweck

Phase D verdrahtet die Phase-C-Komponenten in die konkreten Flächen: Tagesfläche, Vorgangsansicht, Nachweisansicht und Operationskonsole. Damit darf Phase D nicht als Layout-/Component-Wiring allein starten. Der unmittelbare Arbeitskontext ist:

- fachlich: energiewirtschaftliche Vorgänge als überprüfbare Arbeitslage,
- psychologisch: Verantwortung, Vertrauen, Reibung und Entscheidungsdruck reduzieren,
- usability: klare nächste Handlung ohne Ergebnis-Suggestion.

## Fachlicher Kontext

### Leitobjekt

Nutzersichtbar ist `Vorgang`. `Laufkarte` bleibt Systemsprache und Contract-Begriff.

Phase D zeigt keinen generischen Task, sondern einen fachlichen Vorgang mit:

- Rolle und Mandant,
- Aufmerksamkeitsgrund,
- nächstem Beitrag,
- Quellen-/Nachweisstatus,
- Entscheidungsdistanz,
- Freigabe-/HITL-Zustand,
- sichtbaren Grenzen.

### Aussagenregel

Jede fachliche Aussage braucht Präsentationsvertrag und `granularitaet`. Ohne `granularitaet` ist die Aussage nicht renderfähig.

Phase D darf keine Seite bauen, die Aussagen frei aus UI-State oder Operations-JSON formuliert.

### CET-interne Writes

CET-interne Writes sind erlaubt, aber sichtbar zu rahmen:

- Übernahme/Zuweisung,
- Einfrieren,
- Freigabeanforderung,
- HITL-Zustände,
- Zugriffshistorie,
- Konsolen-Nutzungsprotokoll.

Schreibende Intents benötigen `basisRev` und dürfen kein externes Fachsystem suggerieren.

### Operationskonsole

Die Operationskonsole ist kein All-Access-Terminal. Sie bleibt tenant-/rollen-/governance-gefiltert. Nicht projizierte Rohantworten sind:

- `Nicht projiziert`,
- kein Aggregatzustand,
- keine Evidenzmarker-Semantik,
- keine belegte Aussage,
- nicht als Nachweisakte materialisierbar.

## Psychologischer Kontext

### Beitrag statt Ergebnis

Die UI beschreibt den nächsten Beitrag, nicht das fachliche Ergebnis.

Zulässig:

- `Quellen und Unsicherheiten für Freigabe öffnen`
- `Fachliche Freigabe anfordern`
- `Betroffenheit fachlich zuordnen`

Nicht zulässig:

- `Freigabe empfohlen`
- `12 Klärfälle als nicht betroffen markieren`
- `Budgetwirkung ist belastbar`, wenn nicht belegte Aussage.

### Verantwortung bleibt menschlich/rollenbezogen

Die UI darf Entscheidungskraft nicht auf CET verschieben. Die richtige Formulierung ist:

- `Das System entscheidet nicht.`

Freigabezustände brauchen Person oder Agent:

- `Freigabe erteilt durch <Name>`
- `Freigabe verweigert durch <Name>`
- `In Bearbeitung durch Agent <Rolle>`

### Vertrauen entsteht durch Begrenzung

Nutzervertrauen entsteht nicht durch maximal viele Aktionen, sondern durch sichtbare Grenzen:

- was CET hier nicht tut,
- was noch unklar ist,
- welche Evidenz fehlt,
- welche Rolle klären muss,
- ob das Ergebnis nur Arbeitsstand ist.

### Reibung bewusst platzieren

Reibung ist sinnvoll bei:

- schreibenden CET-Zustandswechseln,
- Freigabeanforderungen,
- Einfrieren von Nachweisen,
- nicht projizierten Operations-Ergebnissen.

Reibung ist schädlich bei:

- Orientierung in Tagesfläche,
- Öffnen eines Vorgangs,
- Lesen der fünf Grammatikteile,
- Erkennen des nächsten Beitrags.

## Usability-Kontext

### Tagesfläche

Die Tagesfläche beantwortet: Was braucht heute meine Aufmerksamkeit?

Primär sichtbar je Karte/Bündel:

- Aufmerksamkeitsgrund,
- Rollenwirkung in einem Satz,
- nächster Beitrag,
- Frist, falls vorhanden,
- Übernahme-/Zuweisungsstatus,
- Marker für ungeprüfte Angabe oder offene Klärung.

Bündelung ist nur zulässig bei identischem Aufmerksamkeitsgrund und identischem Beitragstyp. Fristkritische Vorgänge bleiben gesondert.

### Vorgangsansicht

Die Vorgangsansicht hält immer die feste Grammatik:

1. Vorgang
2. Quellen
3. Prüfung
4. Unsicherheit
5. Freigabe

Die Teile dürfen verdichtet werden, aber nicht semantisch entfallen.

### Nachweisansicht

Die Nachweisansicht zeigt den eingefrorenen reproduzierbaren Stand. Einzeldatensätze werden nicht materialisiert, sondern nur Hash/Referenz und `nur mit Quelle reproduzierbar` angezeigt.

### Operationskonsole

Operations-Ergebnisse müssen klar klassifiziert werden:

- Projected Result: Präsentationsvertrag, Aussagen, Markerlogik, Aggregatzustand.
- Unprojected Raw Result: Rohblick, nicht projiziert, keine belegte Aussage, kein Nachweis.

## Phase-D-Umsetzungsregeln

1. Erst Tests für Flächen-Integration, dann Wiring.
2. Keine Fachregel direkt in einer Seitenkomponente; fehlende Anzeige-Regel zuerst in Phase-C-Komponente ergänzen.
3. App-Flächen müssen Phase-C-Komponenten konsumieren, nicht eigene Parallelrenderer bauen.
4. Jede schreibende Handlung erhält `basisRev` aus dem angezeigten Vorgang.
5. Jede Fläche zeigt ihre Grenzen oder einen invalid display state, wenn Grenzen fehlen.
6. Keine nutzersichtbare `Laufkarte`-Sprache außer in dokumentiertem Systemkontext.
7. Keine verbotenen UX-Texte: `Zur Kenntnis`, `Next Best Action`, `erledigt` als Freigabeersatz, `Freigabe empfohlen`, `CET entscheidet`.
8. Operations-JSON bleibt nicht projiziert, bis ein Präsentationsvertrag existiert.
9. Fehlende Evidenz erzeugt Klärung mit Anschlussfrage, keinen leeren Wert und keine Ablehnung.
10. Rollenprojektion verändert Einstieg, Reihenfolge, Prominenz und nächsten Beitrag, nie die Faktenbasis.

## Phase-D-Testanker

Phase D sollte mindestens diese Tests bekommen:

- Tagesfläche rendert Aufmerksamkeitsgrund, Rollenwirkung, nächsten Beitrag und Statussprache.
- Vorgangsansicht rendert alle fünf Grammatikteile in Reihenfolge.
- Nachweisansicht rendert aggregierte Aussagen, Hash-/Ref-only Hinweise und Freigabestatus mit Person/Agent.
- Operationskonsole rendert filtered operations, Risk-Class, Policy-Grenze und `Nicht projiziert`-Rohblick ohne Evidence-Semantik.
- Schreibaktionen ohne `basisRev` sind disabled oder fail-closed.
- App-Flächen verwenden Phase-C-Komponenten und importieren keine direkte RC1-/Moleculer-Fläche.

## Ausgangspunkt für Umsetzung

Phase D beginnt nicht bei visueller Gestaltung, sondern beim belegbaren Flächenvertrag:

`Feinkonzept + QDrant-Grounding + Phase-C-Komponenten → Flächenintegration → Tests → Review`.
