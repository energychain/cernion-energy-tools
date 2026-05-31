# ADR 001: Einführung strikter System-Layer und einer No-Code Orchestrierungsschicht

**Status:** Proposed (In Diskussion mit Thorsten Zoerner)  
**Datum:** 2026-05-31  
**Autor:** DevOps Agent  

---

## 1. Kontext & Problemstellung

Bei der Implementierung des Personal Agents und der verschiedenen fachlichen Use Cases (z. B. §14a EnWG, EV/CO2-Ladeoptimierung, VNB-Lookups, Residuallast-Analysen) sind wir in eine **Legacy-Falle** geraten. 

Durch iterative, minimal-invasive Code-Änderungen (häufig durch automatisierte Coding-Agenten oder CoPilot) ist die Codebasis unkontrolliert gewachsen. Fachliche Detailregeln wurden direkt in den JavaScript-Diensten des Personal Agents (`services/personal-agent.service.js`, `src/personal-agent-routing.js`, etc.) hartverdrahtet.

Dies führt zu folgendem kritischen Zustand:
1. **Hohe Regressionsempfindlichkeit:** Eine fachliche Optimierung an einem Use Case (z. B. EV/CO2-Laden in #158) erzeugt ungewollte Nebeneffekte oder Blockaden in einem anderen Use Case (z. B. DSO-Residuallast).
2. **Fehlende Skalierbarkeit:** Das System kann nicht fachlich erweitert werden, ohne neuen Quellcode zu schreiben und zu deployen. Ein "Lernen" oder "Konfigurieren" im laufenden Betrieb ist unmöglich.
3. **Vermischung der Abstraktionsebenen:** Datenbeschaffung (Layer 1), semantische Geschäftslogik (Layer 2) und kognitive Dialogführung/Reflexion (Layer 3) laufen unsauber ineinander über. Der Personal Agent wurde zu früh auf fachliche Spezialprobleme ausgerichtet, bevor seine fundamentalen Strukturen (Reasoning, Session Handling, Thinking, Reflection) sauber entkoppelt waren.

---

## 2. Vorgeschlagene Lösung: Strikte Schichtenarchitektur (Strict Layering)

Wir stoppen den Code-Zuwachs durch ein radikales Aufräumen und führen drei strikt voneinander isolierte System-Layer ein. 

```
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Kognitiver Dialog & Reasoning Layer (Personal Agent)          │
│ - Generische Chat-Schnittstelle, Session-Handling, Slot-Filling       │
│ - ReAct-Loop, Thinking & Reflection                                    │
│ - Absolut KEIN hartcodiertes Domänen-Wissen (keine EV/DSO-Sonderlogik) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ nutzt deklarative Regeln
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Semantische Orchestrierung & No-Code Abstraktionsschicht      │
│ - Deklarative "Receipts" (Ausführungs-Blueprints) als JSON / YAML      │
│ - Semantische Parameter- und Typendefinitionen (nahe an OEO)           │
│ - No-Code Mappings & mathematische Post-Processing-Regeln              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ steuert deterministische APIs
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Daten- & Ressourcen-Layer (Passive Backend Services)          │
│ - Reine, passive Datenquellen-APIs (MaStR, GSI, OSM, Inhouse, SCADA)   │
│ - Normalisierte Datenstrukturen, deterministisch, zustandslos         │
│ - Keine KI, kein "Thinking", reine "Sensoren & Aktuatoren"             │
└────────────────────────────────────────────────────────────────────────┘
```

### Layer 1: Der Daten- & Ressourcen-Layer (Passive Services)
*   **Charakter:** Rein passiv, zustandslos, deterministisch, stabil.
*   **Aufgabe:** Bietet Schnittstellen für Roh- und Strukturdaten (z. B. `energy-market.service.js` liefert den stündlichen GSI für eine Postleitzahl).
*   **Regel:** Dieser Layer weiß nichts über die Absicht des Nutzers (ob er ein Auto laden oder ein Netz planen will). Er liefert nur Daten.

### Layer 2: Der semantische Orchestrierungs-Layer (Lernfähig & No-Code)
*   **Charakter:** Deklarativ (JSON/YAML), konfigurationsgesteuert, semantisch annotiert.
*   **Aufgabe:** Definiert, wie Daten aus Layer 1 für bestimmte fachliche Probleme genutzt, verknüpft und ausgewertet werden.
*   **Semantische Regeln (OEO-Nähe):**
    *   Verwendet standardisierte Begrifflichkeiten (z. B. `OEO:PostalCode`, `OEO:ActivePower`).
    *   Beschreibt, welche Inputs zwingend benötigt werden, wie sie hydratisiert werden (z. B. durch automatisches PLZ-Mapping) und welche Berechnungsschritte (Post-Processing) nachgelagert sind.
*   **Beispiel:** Ein `VNBLookup` oder ein `CO2ChargingOptimizer` ist kein JS-Code mehr, sondern ein deklarativer Blueprint, der dem System sagt: *„Wenn du eine Postleitzahl hast, rufe Service X auf, ermittle das niedrigste contiguous Zeitfenster der Länge Y und berechne Z.“*

### Layer 3: Der kognitive Dialog- & Reasoning-Layer (Personal Agent Core)
*   **Charakter:** Generisch, kognitiv, robust.
*   **Aufgabe:** Verwaltet die Konversation mit dem Benutzer, das Session-Handling, das Slot-Filling und die Reflection-Phasen.
*   **Regel:** Der Agent enthält **keinerlei fachliche Sonderlogik**. Er liest die in Layer 2 registrierten Blueprints und versucht im Gespräch, die dort deklarierten Input-Parameter des passenden Blueprints zu füllen (Slot-Filling). Sobald alle erforderlichen Parameter vorhanden sind, übergibt er die Ausführung an den Layer 2 Interpreter und präsentiert das Ergebnis.

---

## 3. Auswirkungen & Migrationspfad (Aufräum-Strategie)

### Schritt 1: Code-Zuwachs stoppen & „Schnitt“ setzen
*   Wir stoppen das Schreiben neuer JS-Speziallogik in `personal-agent.service.js`.
*   Wir analysieren vorhandene Duplikate und verwaiste Pfade im Repository. CoPilot wird primär für **Refactoring und Löschen** statt für das Hinzufügen neuer Code-Zweige eingesetzt.

### Schritt 2: Entkopplung der Datenbeschaffung (Layer 1)
*   Sicherstellen, dass Services wie `energy-market` oder `mastr` reine, saubere Datenlieferanten sind, die frei von Dialog- oder Syntheseannahmen agieren.

### Schritt 3: Deklarative Abstraktion der Use Cases (Layer 2)
*   Wir überführen die Logik von `ev-charging-co2-optimization` und `residual_load_forecast_for_dso` aus harten Code-Pfaden in ein erstes deklaratives JSON-Schema (wie im Konzept skizziert).
*   Wir schreiben einen schlanken **Interpreter in Layer 2**, der diese Blueprints parst und die darin definierten Layer 1 Aufrufe sequentiell abarbeitet.

### Schritt 4: Verallgemeinerung des Personal Agents (Layer 3)
*   Wir befreien `personal-agent.service.js` sukzessive von domänenspezifischen Keywords und Weichen.
*   Der Agent verlässt sich beim Slot-Filling und bei der Antwortsynthese rein auf die im Layer-2-Blueprint hinterlegten Deklarationen.

---

## 4. Zu bewertende Risiken und offene Fragen

1.  **Geringere Flexibilität bei komplexen Dialogen?**
    *   *Gegenargument:* Ein deklaratives System zwingt uns, die Interaktionen sauber zu strukturieren. Komplexe Edge Cases im Dialog werden nicht durch Code-Hacks, sondern durch präzisere Eingabe-Resolution-Regeln im Blueprint gelöst.
2.  **OEO-Kompatibilität:**
    *   Wie eng binden wir das Schema an die Open Energy Ontology, um von Anfang an eine standardisierte semantische Daten- und Prozessbeschreibung zu gewährleisten?

---

## 5. Das kaskadierende Broker-Modell & der Hypothese-Modus

Um die No-Code-Entwicklungsfähigkeit über alle Schichten hinweg abzusichern, führen wir eine Erweiterung des Capability-Brokers ein: **Kaskadierende Capability-Broker pro Layer mit einem lernfähigen "Hypothese-Modus"**.

### 5.1 Kaskadierende Broker statt eines globalen Monolithen
Jedes Layer erhält einen eigenen, spezialisierten Capability-Broker. Ein Überspringen von Schichten (Layer-Skipping) ist strikt verboten.

1. **Layer 3 Broker (Kognitiver Broker):** 
   * *Schnittstelle:* User Chat -> Layer 2 Blueprint (Receipt).
   * *Aufgabe:* Übersetzt die natürliche Sprache des Benutzers in den am besten passenden deklarativen Use Case (z. B. "CO2-Laden" oder "Netzengpass"). Er kennt keine Datenbankstrukturen oder Roh-APIs.
2. **Layer 2 Broker (Semantischer Orchestrierungs-Broker):**
   * *Schnittstelle:* Blueprint Requirements -> Layer 1 Service.
   * *Aufgabe:* Ordnet die im Blueprint geforderten semantischen Datenklassen (z. B. `OEO:GridElectricityProfile`) dem am besten geeigneten Layer-1-Datenservice zu.
3. **Layer 1 Broker (Ressourcen-Broker):**
   * *Schnittstelle:* Layer 1 Service -> Physische Datenquelle / Datenbank.
   * *Aufgabe:* Entscheidet, ob eine Abfrage aus dem lokalen Cache, der Inhouse-PouchDB, der Live-API oder der PostgreSQL-Replik bedient wird.

### 5.2 Der "Hypothese-Modus" (Lernen durch Korrektur)
Wenn ein Layer einen Aufruf an das darunterliegende Layer absetzt, aber die exakte Zieladresse oder Parametrisierung unklar ist (z. B. "System ist sich unsicher"), wechselt der Aufruf in den **Hypothese-Modus**:

1. **Hypothese aufstellen:** Der Broker des jeweiligen Layers stellt eine Vermutung (Hypothese) auf, welcher Service oder welcher Parameter-Typ am besten passt (basierend auf semantischen Vektoren oder historischen Mappings).
2. **Ausführung & Feedback-Schleife:**
   * **Erfolg (Reinforcement):** Führt der Aufruf deterministisch zum Erfolg (z. B. die Daten fließen valide zurück, die Validierung ist grün), wird das Mapping gestärkt. Der Confidence-Score für diese Route steigt.
   * **Fehler/Korrektur (Correction):** Schlägt der Aufruf fehl oder korrigiert ein menschlicher Experte (HITL) das Mapping ("Nein, nutze für EV-Lade-Optimierung nicht DSO-Netzlast, sondern GSI"), wird die Hypothese korrigiert. Der Broker *lernt durch Korrektur*.

### 5.3 Nutzen für die No-Code-Evolution
Dadurch müssen fachliche Optimierungen und Routing-Korrekturen nicht mehr programmiert werden. Der Broker lernt im laufenden Betrieb, welche Services und Daten füreinander relevant sind. Fehler im Routing heilen sich durch Korrekturen im Hypothese-Modus selbst.
