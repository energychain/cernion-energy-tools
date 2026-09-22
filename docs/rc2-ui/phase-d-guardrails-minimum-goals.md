# CET RC2 Phase D — Guardrails und Mindestziele

Status: verbindlicher Vorbereitungsanker für Phase D auf Branch `feat/cet-release-rc2-ui`.

## Entscheidung

Ja: Phase D soll erst beginnen, nachdem Guardrails und Mindestziele explizit festgelegt sind. Phase D ist die erste Verdrahtung in reale Arbeitsflächen; Fehler an dieser Stelle werden später als UX-Wahrheit wahrgenommen. Deshalb braucht Phase D vor Code-Start eine harte Grenze zwischen Muss, Darf und Nicht-Ziel.

## Mindestziel Phase D

Phase D ist erfolgreich, wenn die vier RC2-Flächen als integrierte Arbeitsoberfläche laufen und den Referenzfall verständlich, mandanten-/rollenbezogen und governance-sicher darstellen:

1. Tagesfläche
2. Vorgangsansicht
3. Nachweisansicht
4. Operationskonsole

Der Nutzer muss im Referenzfall erkennen:

- was heute Aufmerksamkeit braucht,
- warum die aktive Rolle betroffen ist,
- welcher Beitrag als nächstes erforderlich ist,
- welche Quellen/Nachweise vorliegen,
- welche Unsicherheit oder Evidenz fehlt,
- welche Freigabe erforderlich ist,
- warum das System nicht entscheidet,
- welche Grenzen die Ansicht hat,
- welche CET-internen Writes möglich sind,
- welche Operations-Ergebnisse nicht projiziert sind.

## Harte Guardrails

### 1. Kein Ergebnisversprechen

Die UI beschreibt Beiträge, Prüfstände und Grenzen. Sie beschreibt nicht das fachliche Ergebnis, das ein Mensch treffen soll.

Verboten:

- `Freigabe empfohlen`
- `CET entscheidet`
- `bewertet`, wenn Systembewertung suggeriert wird
- `sicher`, wenn nur Arbeitsstand
- `erledigt` als Freigabeersatz
- `Zur Kenntnis`
- `Next Best Action`

Pflichtformulierung für Verantwortungsgrenze:

- `Das System entscheidet nicht.`

### 2. Präsentationsvertrag vor sichtbarer Aussage

Jede fachliche Aussage in Phase-D-Flächen braucht:

- `id`
- `label`
- `wert`
- `quelle`
- `sicherheit`
- `aggregatzustand`
- `granularitaet`

Ohne `granularitaet` wird nicht gerendert. Roh-Operationsdaten sind keine Aussagen.

### 3. Rollenprojektion verändert keine Fakten

Rollen dürfen ändern:

- Einstieg,
- Reihenfolge,
- Prominenz,
- nächsten Beitrag,
- Sprache.

Rollen dürfen nie die Aussagenmenge oder Faktenbasis ändern.

### 4. Tenant- und Rollenwirkung bleibt geschlossen

Ein Benutzer sieht und aktiviert nur Rollen seines Mandanten. Unbesetzte Rollen werden über Platzhalter-Agents dargestellt. Rollen/Agents wirken nicht mandantenübergreifend.

### 5. Schreibende CET-Handlungen brauchen angezeigte Revision

CET-interne Writes sind erlaubt, aber nur auf Basis der sichtbaren Revision:

- `claim/takeover`,
- `freeze`,
- `request approval`,
- Audit-/Zugriffshistorie,
- Konsolen-Nutzungsprotokoll.

Jede schreibende Aktion braucht `basisRev`. Ohne `basisRev` ist die Aktion disabled oder fail-closed.

### 6. Keine externe Fachsystemausführung

Phase D darf keine produktiven externen Fachsystem-Writes andeuten oder ausführen. Nicht angebundene externe Systeme bleiben außerhalb des RC2-Scopes.

### 7. Grenzen sind sichtbar

Jede Fläche zeigt ihre Grenzen. Fehlende oder leere Grenzen sind ein invalid display state, kein stilles leeres Panel.

### 8. Nicht projiziert bleibt getrennt

Unprojected Raw Result bedeutet:

- `Nicht projiziert`,
- keine belegte Aussage,
- kein Nachweis,
- kein Aggregatzustand,
- keine Evidence-/Marker-Semantik,
- Nutzung nur als Bedarfssignal/Audit.

### 9. Fehlende Evidenz wird Klärung

Fehlende Evidenz erzeugt:

- offene Unsicherheit,
- Anschlussfrage,
- klärende Rolle,
- Bezug zu Aussage/Kriterium.

Sie erzeugt nicht automatisch Ablehnung, Fehler, leeren Wert oder Entscheidungsreife.

### 10. Phase-C-Komponenten sind Pflichtbasis

Phase D darf keine parallelen Seitenrenderer für bereits vorhandene Governance-Primitives bauen. Neue Anzeigebedarfe werden zuerst als Phase-C-kompatible Komponente oder Helper ergänzt und dann in die Fläche integriert.

## Mindestziele pro Fläche

### Tagesfläche

Muss zeigen:

- Aufmerksamkeitsgrund,
- Rollenwirkung in einem Satz,
- nächster Beitrag,
- Frist falls vorhanden,
- Übernahme-/Zuweisungsstatus,
- offene Klärung oder ungeprüfte Angabe,
- Bündelung nur bei identischem Aufmerksamkeitsgrund und identischem Beitragstyp.

Abnahmesatz:

> Ich sehe sofort, was heute meine Aufmerksamkeit braucht und welchen Beitrag ich leisten soll.

### Vorgangsansicht

Muss die fünf Grammatikteile in Reihenfolge zeigen:

1. Vorgang
2. Quellen
3. Prüfung
4. Unsicherheit
5. Freigabe

Muss zusätzlich zeigen:

- aktive Rolle,
- aktuelle Station,
- Entscheidungsdistanz als Kriterienliste, nicht Score,
- Freigabesatz,
- `basisRev`-gebundene Aktionen,
- Grenzen der Ansicht.

Abnahmesatz:

> Ich verstehe, was passiert ist, warum meine Rolle betroffen ist und was als nächstes zu tun ist.

### Nachweisansicht

Muss zeigen:

- eingefrorenen Präsentations-/Interaktionsstand,
- Aussagen mit Quelle/Sicherheit/Aggregatzustand/Granularität,
- Evidence-/Receipt-Referenzen,
- Hashes/Referenzen für Einzeldatensatz-Ebene,
- Freigabestatus mit Person oder Agent,
- reproduzierbare Darstellung auch bei nicht erreichbarer Quelle.

Abnahmesatz:

> Ich kann nachvollziehen, welcher Stand eingefroren wurde und welche Aussagen belegbar sind.

### Operationskonsole

Muss zeigen:

- erlaubte Operationen für Tenant/Rolle,
- Risk-Class,
- Governance-/Policy-Grenze,
- Methode und Zulässigkeit,
- Abweisungsgrund bei Nichtzulassung,
- Projected Result vs. Unprojected Raw Result,
- Audit-/Bedarfssignal-Hinweis.

Abnahmesatz:

> Ich kann REST-/Capability-Aufgaben nutzen, ohne die Governance-Grenze zu übersehen oder Rohdaten mit Nachweisen zu verwechseln.

## Nicht-Ziele Phase D

Phase D baut nicht:

- freie LLM-Darstellung,
- Mustererzeugung,
- produktive Musterkandidatenstrecke,
- vollständige Arbeitsflächen-Komposition,
- externe Fachsystem-Writes,
- Public-Web-Erklärung,
- bestandene Nutzerabnahme U12,
- bindende regulatorische, Budget- oder Gremienentscheidung.

## Quality Gates vor Phase-D-Abschluss

Phase D ist erst abgeschlossen, wenn diese Gates grün sind:

1. Flächen-Integrationstests für alle vier Flächen.
2. Feinkonzept-Wording-Guard gegen verbotene Formulierungen.
3. REST-only Guard: keine direkte Moleculer-/RC1-Objekt-Nutzung in UI-Flächen.
4. `basisRev`-Guard für alle schreibenden Aktionen.
5. Tenant-/Role-/Agent-Fixture deckt mindestens zwei Personen in Marktkommunikation und eine unbesetzte Rollenfamilie mit Agent ab.
6. Nachweisansicht materialisiert keine Einzeldatensätze.
7. Operationskonsole trennt projected und unprojected Result sichtbar und testbar.
8. Build, TypeScript-Check, Jest-Fokuslauf und `git diff --check` sind grün.
9. Review gegen Feinkonzept und Phase-D-Kontextbrief ist dokumentiert.

## Stop-Kriterien

Phase D muss stoppen und zuerst korrigieren, wenn:

- eine Fläche eine fachliche Aussage ohne Präsentationsvertrag rendert,
- eine schreibende Aktion ohne `basisRev` möglich wird,
- Rollen-/Tenant-Grenzen clientseitig frei überschrieben werden können,
- nicht projiziertes JSON wie Nachweis, Aussage oder Entscheidungsgrund wirkt,
- ein UI-Text Ergebnis/Empfehlung statt Beitrag suggeriert,
- eine Seite eigene Fachlogik statt Phase-C-Komponenten/Shared Functions verwendet.
