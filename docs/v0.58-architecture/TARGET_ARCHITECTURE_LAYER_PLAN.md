# Cernion Target Architecture - The Layer Plan

**Status:** Proposed (Leitdokument für die strukturelle Entkopplung und das Lagebild der Moleculer-Services)  
**Datum:** 2026-05-31  
**Autor:** DevOps Agent  

---

## 1. Einleitung & Zielbild

Dieses Dokument definiert den **Soll-Zustand (Target Architecture)** für alle Services im Repository `cernion-energy-tools`. 

Das primäre Ziel ist es, **fachliche Optimierungen zu ermöglichen, ohne Quellcode schreiben oder anpassen zu müssen**. Hierzu wird das System in drei strikt getrennte funktionale Schichten (Layer 1 bis 3) sowie eine grundlegende Infrastrukturschicht (Layer 0) unterteilt. 

Jeder Moleculer-Service wird einer dieser Schichten zugewiesen. Jede Schicht hat strenge Designregeln bezüglich Zustand, Determinismus, Abhängigkeiten und Datenflüssen.

---

## 2. Die Schichten im Detail (Designregeln)

```
┌────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: Kognitiver Dialog- & Reasoning-Layer                          │
│ - Charakter: Generisch, kognitiv, auditierbar, nicht-deterministisch   │
│ - Aufgabe: Dialogführung, Slot-Filling, ReAct, Reflection, UI-Präsent. │
│ - Invariante: Absolut KEINE fachlichen Berechnungen oder Spezial-Regeln│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ steuert deklarative Blueprints
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: Semantische Orchestrierung & No-Code Abstraktion              │
│ - Charakter: Deklarativ (JSON/YAML), regelbasiert, interpretierend    │
│ - Aufgabe: Use-Case-Regeln, Verknüpfung von L1-Daten, Berechnungen     │
│ - Invariante: Keine direkte Dialogführung, reine Datenorchestrierung   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ ruft funktionale APIs auf
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: Daten- & Ressourcen-Layer (Passive Backend Services)          │
│ - Charakter: Zustandslos, deterministisch, stabil, rein passiv         │
│ - Aufgabe: Sensoren & Aktuatoren, Datenbeschaffung, CRUD               │
│ - Invariante: Weiß nichts über den Verwendungszweck oder den Benutzer  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ greift zu auf
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ LAYER 0: System- & Infrastruktur-Layer (Cross-Cutting)                 │
│ - Charakter: Technischer Core, Transport, Sicherheit, Ingestion         │
│ - Aufgabe: Routing, Auth, Token, Datenbank-Sync, Quota-Management      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Klassifizierung der bestehenden Moleculer-Services

Nachfolgend werden die existierenden Moleculer-Dienste aus `services/` ihrer Zielschicht im Soll-Modell zugeordnet:

### LAYER 3: Kognitiver Dialog- & Reasoning-Layer
Diese Schicht beherbergt das "Gehirn" des Systems. Die Dienste sind zuständig für die Benutzerinteraktion und das Verstehen von Absichten (Intent Recognition), delegieren aber jede fachliche Arbeit sofort an Layer 2.

*   **`personal-agent.service.js` (Soll-Zustand):** Reiner, domänenunabhängiger Dialog-Interpreter. Führt Slot-Filling durch, um die in Layer-2-Blueprints geforderten Parameter zu sammeln.
    *   *Ist-Zustand-Kritik (303 KB):* Extrem überladen mit L2-Logik (Sonderberechnungen, EV-Spezialregeln, hardcodierte Text-Synthesen).
*   **`agent.service.js`:** Generisches Agenten-Verhalten und Basis-Reasoning-Strukturen.
*   **`finance-agent.service.js`:** Conversational Agent für finanzielle und kaufmännische Fragestellungen (delegiert Rechnungen an L2).
*   **`customer-service.service.js`:** Dialogführung für Kundenbeschwerden und allgemeinen Support.

---

### LAYER 2: Semantische Orchestrierung & No-Code Abstraktion
Hier liegt die fachliche Intelligenz. Dieser Layer koordiniert die passiven Datenlieferanten aus Layer 1, wendet Geschäftsregeln an und führt Berechnungen durch. Use Cases werden über deklarative **Receipts (JSON-Blueprints)** abgebildet.

*   **`agent-receipts.service.js`:** Verwaltet und validiert die registrierten deklarativen Receipts (Soll: Interpreter-Modul für No-Code Blueprints).
*   **`capability-broker.service.js`:** Ordnet Benutzer-Intents den passenden Layer-2-Kapazitäten (Capabilities) oder Receipts zu.
*   **`hitl.service.js`:** Koordiniert Freigabeprozesse (Human-In-The-Loop) vor der Ausführung kritischer operativer Aktionen.
*   **`cookbook.service.js`:** Verwaltet strukturierte Standard Operating Procedures (SOPs) und Runbooks.
*   **`znp.service.js`:** Orchestriert Planungsräume und das Zusammenführen von Layer-Daten für die Zielnetzplanung.
*   **`cya.service.js`:** Engpassanalysen, Netzausbauprüfung und strategische Lastflussbewertung (Congestion-Yield-Analysis).
*   **`vdmi.service.js` & `vdmi-*.service.js`:** Die gesamte Logik für netzbezogene Investitionsentscheidungen, Evidenz-Sammlung und Governance-Reviews.
*   **`grid-connection.service.js` & `grid-operations.service.js`:** Netzanschluss-Prüflogik und VNB-Zuständigkeits-Suchen (VNB Lookup).
*   **`energy-sharing.service.js` & `energy-sharing-allocation.service.js`:** Berechnungsmodelle für Erzeugergemeinschaften und Energie-Sharing-Verrechnungen.
*   **`eog-calculator.service.js`:** Berechnungen rund um EEG- und KWKG-Anlagen.
*   **`utility-report.service.js`:** Erstellt aggregierte Strukturberichte nach regulatorischen Anforderungen (z. B. §14a/14d EnWG).
*   **`redispatch-expost.service.js`:** Koordiniert Berechnungen zu geleisteten Abregelungen und Entschädigungsansprüchen.

---

### LAYER 1: Daten- & Ressourcen-Layer (Passive Backend Services)
Die "Daten-Maschinenräume". Diese Dienste rufen externe APIs ab, parsen Rohdateien, verwalten physikalische Assets oder führen deterministische Standardberechnungen durch. Sie enthalten keinerlei Dialogführung und geben nur strukturierte Daten zurück.

*   **`energy-market.service.js`:** Liefert GSI-Daten (GrünstromIndex), Strompreise und CO2-Prognosen.
*   **`entsoe.service.js`:** Schnittstelle zur ENTSO-E Plattform für europäische Netz- und Lastdaten.
*   **`osm-geo.service.js`:** Abfragen von Geometrien und GIS-Punkten aus OpenStreetMap.
*   **`assets.service.js`:** CRUD-Schnittstelle für physische Betriebsmittel (Transformatoren, Kabel, MaStR-Anlagen) mit Confidence-Bewertungen.
*   **`mastr-monitor.service.js` & `mastr-quality.service.js`:** Datenqualitätsprüfung und Änderungsüberwachung von Marktstammdaten-Einträgen.
*   **`residual-load.service.js`:** Berechnet Lastprofile und historische Netzlastgänge.
*   **`slp.service.js`:** Mathematische Standardlastprofile (SLP) für Gas und Strom.
*   **`german-grid.service.js`:** Statische Daten zu deutschen Übertragungsnetzgrenzen und Regelzonen.
*   **`gas-storage.service.js`:** Füllstände und Kapazitäten europäischer Gasspeicher.
*   **`edm.service.js` & `edm-*.service.js`:** Energiedatenmanagement (Zählerstände, Messkonzepte, MSCONS-Importe und Profilvalidierung).
*   **`object-store.service.js` & `datasource-cache.service.js`:** Reine Persistenz-, Cache- und Dateispeicherdienste.

---

### LAYER 0: System- & Infrastruktur-Layer (Cross-Cutting)
Die technische Basis des Gesamtsystems. Kümmert sich um Netzwerkgateways, Sicherheit, Pipeline-Ingestion und grundlegende Mandanten-Metadaten.

*   **`api.service.js` & `dashboard-api.service.js`:** Moleculer API Gateways für externe REST-Clients und Frontends.
*   **`auth.service.js` & `token-manager.service.js`:** Benutzer-Authentifizierung, Berechtigungsprüfung (RBAC) und Token-Verwaltung.
*   **`datapoint.service.js`:** Speichert atomare, beobachtete Roh-Datenpunkte (L3-Fakten-Store).
*   **`datasource-registry.service.js` & `datasource-*.service.js`:** Pipelines zur Erkennung, Klassifizierung und Verbindung neuer Datenquellen.
*   **`backup-orchestrator.service.js`:** Systemwartung und Daten-Backups.
*   **`observability.service.js`:** Tracing, Logging und System-Metriken.
*   **`system.service.js` & `tenant-quota.service.js`:** Grundlegende Systemgrenzen, Betriebsmittelbeschränkungen und Lizenzkontrollen.
*   **`webhooks.service.js`:** Verwaltet das Heraussenden von Ereignissen (Webhooks) an externe Systeme.
*   **`web-search.service.js` & `knowledge-rag.service.js`:** Standardisierte Internetsuche und Vektorspeicherdienste für unstrukturierte PDFs.
*   **`presentation.service.js`:** Hilfsklassen zur UI-Aufbereitung (HTML, Markdown, Tabellenformate).

---

## 4. Design-Regeln für das „Lagebild“ (Audit Guidelines für Claude/Hermes)

Wenn Claude oder Hermes die Services analysieren, sollten sie für jeden Dienst folgendes dreistufiges Audit durchführen:

1.  **Layer-Adhärenz (Schichtstreue):**
    *   *Frage:* Befindet sich der Service in seiner korrekten Schicht?
    *   *Fehlerbeispiel:* Ein Layer 1 Service (`energy-market`) gibt einen fertigen, deutschsprachigen Antwortsatz für den Benutzer zurück. *Korrektur:* Er darf nur JSON-Rohdaten liefern.
2.  **Abhängigkeits-Richtung (No-Upward-Dependencies):**
    *   *Frage:* Hängt ein unterer Layer von einem oberen Layer ab?
    *   *Fehlerbeispiel:* Ein Layer 2 Service importiert Klassen oder ruft Methoden aus dem `personal-agent` (Layer 3) auf. *Korrektur:* Obere Layer dürfen untere Layer aufrufen, niemals umgekehrt.
3.  **Härtungs-Zustand (Hardcoded vs. Declarative):**
    *   *Frage:* Enthält ein Layer-2- oder Layer-3-Service spezifische fachliche Weichen, die eigentlich in ein deklaratives Receipt gehören?
    *   *Fehlerbeispiel:* In `personal-agent.service.js` steht ein Regex-Check auf das Wort „laden“ oder „Wallbox“, um ein spezielles Tool anzusteuern. *Korrektur:* Dieser Trigger gehört als Keyword in die Konfiguration des `ev-charging`-Receipts.

---

## 5. Nächste Schritte zur Lagebild-Erstellung

1.  **Übergabe an den Review-Prozess:** 
    Dieses Dokument dient als das offizielle Referenzbild (Target Architecture).
2.  **Service-Slices bewerten:**
    Thorsten übergibt die Liste der Services an Claude/Hermes. Die KIs bewerten jeden Service anhand der oben genannten drei Audit-Fragen und erstellen ein rotes/gelbes/grünes Lagebild.
3.  **Identifikation weißer Flecken:**
    Nach dem Lagebild identifizieren wir in der zweiten Iteration fehlende Brücken-Services (z. B. das fehlende generische *Layer-2-Interpreter-Modul* für deklarative Receipts) und leiten die strukturierte Migration ein.
