# Cernion Spezifikation: Deklarative Blueprints & Kaskadierende Broker

**Status:** Proposed (Spezifikationsentwurf zur Implementierung der Schichten-Orchestrierung)  
**Datum:** 2026-05-31  
**Autor:** DevOps Agent  

---

## 1. Die Vision

Diese Spezifikation beschreibt die Implementierungs-Blaupause für den Übergang von hartcodierter JavaScript-Logik zu einer **rein daten- und ontologiegetriebenen Orchestrierung**. 

Fachliche Use Cases (z. B. CO2-optimiertes E-Auto-Laden, VNB-Zuständigkeitsprüfung oder Redispatch-Mengenermittlung) werden als **deklarative JSON-Blueprints (Layer-2-Receipts)** hinterlegt. Eine stabile Engine (Interpreter) führt diese aus, indem sie die Daten über kaskadierende, selbstlernende Broker anfordert.

---

## 2. Das JSON-Schema für deklarative Blueprints (L2 Receipts)

Jeder fachliche Use Case wird in einer JSON-Datei spezifiziert. Das nachfolgende Schema beschreibt den standardisierten Aufbau eines solchen Blueprints.

```json
{
  "$schema": "https://cernion.ai/schemas/blueprint.v1.json",
  "id": "string (UUID oder kanonischer String, required)",
  "version": "string (semver, required)",
  "meta": {
    "title": "string (Anzeige-Name, required)",
    "description": "string (Beschreibung des Use Cases, required)",
    "targetAudience": "string (end_user | grid_operator | internal, required)"
  },
  "routing": {
    "intentSignals": ["array of strings (Keywords/Auslöser für L3-Broker)"],
    "negativeSignals": ["array of strings (Ausschluss-Kriterien für L3-Broker)"],
    "priorityBoost": "integer (Default: 0)"
  },
  "inputs": {
    "parameter_name": {
      "type": "string | number | boolean | object",
      "required": "boolean",
      "semanticType": "string (OEO-Klasse, z. B. OEO:PostalCode)",
      "resolveStrategy": {
        "method": "llm_extraction | static_default | context_lookup",
        "defaultValue": "any (optional)",
        "prompt": "string (Anweisung für den L3-Agenten bei fehlendem Parameter)"
      }
    }
  },
  "execution": {
    "steps": [
      {
        "id": "string (Eindeutige Step-ID im Blueprint)",
        "action": "string (Der semantische Name des L1-Dienstes)",
        "params": {
          "api_param_key": "string (Template-String, z. B. {{inputs.parameter_name}})"
        }
      }
    ]
  },
  "postProcessing": {
    "calculations": {
      "calculation_key": "string (Mathematische Formel, z. B. inputs.energyKWh / inputs.powerKW)"
    },
    "mappings": {
      "mapped_key": {
        "strategy": "find_lowest_contiguous_average | pluck | filter",
        "source": "string (Pfad zum Step-Ergebnis, z. B. steps.step_id.output.forecast)",
        "windowSize": "string (Template-String oder Zahl für Fenstergröße)"
      }
    }
  },
  "synthesis": {
    "evidenceRequired": ["array of strings (Welche Ausgaben zwingend vorliegen müssen)"],
    "templates": {
      "success": "string (Template-String für die L3-Antwort im Erfolgsfall)",
      "error": "string (Template-String für Fehlermeldungen)"
    }
  },
  "persistence": {
    "l3_facts": {
      "fact_name": "string (Pfad zum Wert, der als L3-Fakt in die Session einfließen soll)"
    }
  }
}
```

---

## 3. Die kaskadierenden Capability-Broker

Die Kommunikation zwischen den Schichten erfolgt streng linear und wird über drei unabhängige Broker-Schnittstellen geschleust.

```
┌────────────────────────────────────────────────────────┐
│ L3 Broker (Kognitiver Dialog-Broker)                   │
│ - API: L3Broker.resolveIntent(userUtterance, history)  │
│ - Output: Matching L2 Blueprint                        │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ L2 Broker (Semantischer Orchestrierungs-Broker)        │
│ - API: L2Broker.executeBlueprint(blueprintId, inputs)  │
│ - Output: Structured Data & Calculations               │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ L1 Broker (Ressourcen- & API-Broker)                   │
│ - API: L1Broker.resolveData(semanticAction, params)    │
│ - Output: Raw JSON Data                                │
└────────────────────────────────────────────────────────┘
```

### 3.1 Der Layer 3 Broker (Kognitiver Broker)
*   **Aufgabe:** Analysiert die freisprachliche Eingabe des Nutzers und mappt sie auf den passenden Blueprint.
*   **Arbeitsweise:** Nutzt die `intentSignals` und `negativeSignals` der Blueprints. Bei hoher Unsicherheit stellt er im *Hypothese-Modus* eine Vermutung auf oder bittet den L3-Agenten, eine klärende Rückfrage zu stellen.

### 3.2 Der Layer 2 Broker (Semantischer Orchestrierungs-Broker)
*   **Aufgabe:** Führt den Blueprint aus und vermittelt zwischen dem Blueprint und den Layer-1-Services.
*   **Arbeitsweise:** Er mappt die semantischen Anforderungen des Blueprints (z. B. `OEO:GridElectricityProfile`) auf die konkrete Layer-1-Aktion. Er führt die im Blueprint definierten mathematischen Berechnungen und Datenaggregationen (Post-Processing) deterministisch aus.

### 3.3 Der Layer 1 Broker (Ressourcen-Broker)
*   **Aufgabe:** Löst die semantische Datenanforderung in einen echten API-Call oder Datenbank-Query auf.
*   **Arbeitsweise:** Entscheidet über Caching-Szenarien und Lastverteilungen. Er weiß, ob die Daten lokal in der PouchDB liegen oder live über eine externe Schnittstelle (z. B. ENTSO-E) geladen werden müssen.

---

## 4. Der "Hypothese-Modus" & die Lernschleife

Um starren Code komplett zu eliminieren, werden Mappings zwischen Schichten probabilistichen Confidence-Scores unterworfen.

### 4.1 Die Mapping-Tabelle (PouchDB oder JSON-Registry)
Jeder Broker verwaltet eine interne Mapping-Registry mit Confidence-Scores:

```json
{
  "sourcePattern": "OEO:GridElectricityProfile",
  "targetSymbol": "energy-market.co2Intensity",
  "confidence": 0.95,
  "successCount": 124,
  "failCount": 1,
  "lastUsedAt": "2026-05-31T10:00:00Z"
}
```

### 4.2 Die Feedback-Schleife (Lernen durch Korrektur)
1. **Unbekanntes oder unsicheres Signal:** Hat eine Zuordnung einen Confidence-Score von unter *0.7*, markiert der Broker den Aufruf als **Hypothese**.
2. **Deterministische Verifikation:** Läuft der Pfad erfolgreich durch (L1-Sensor liefert fehlerfreie Daten, Typenprüfung ist grün), wird der Score erhöht:
   $$\text{confidence} = \min(1.0, \text{confidence} + 0.05)$$
3. **Menschliche Korrektur (HITL):** Schlägt der Pfad fehl oder greift ein Experte korrigierend ein, wird der Score drastisch gesenkt und die Alternativ-Hypothese gestärkt:
   $$\text{confidence} = \max(0.0, \text{confidence} - 0.30)$$

---

## 5. Implementierungs-Fahrplan (Der 3-Phasen-Schnitt)

Wir implementieren diese Architektur in drei überschaubaren, risikofreien Phasen, die im Einklang mit unserer Aufräum-Strategie stehen.

### Phase A: Der L2-Blueprint-Interpreter & L2 Broker (Core-Bau)
1.  **Dienst erstellen:** Wir bauen ein neues Modul oder erweitern `agent-receipts.service.js` zu einer rein deklarativen Laufzeitumgebung (Interpreter).
2.  **Berechnungskern:** Wir binden einen sicheren, sandboxtauglichen mathematischen Parser (z. B. einen einfachen arithmetischen AST-Interpreter oder eine minimalistische Expression-Engine) ein, um Post-Processing-Formeln im Blueprint ohne `eval()` auszuführen.
3.  **Verifikation:** Wir schreiben Unit-Tests, die beweisen, dass der Interpreter ein komplexes JSON-Receipt liest, L1-Services triggert und das Post-Processing korrekt ausführt.

### Phase B: Die Entkopplung der Daten- und Dialog-Schichten
1.  **L1-Bereinigung:** Wir bereinigen die gelben Services in Tranche A von ihren hartcodierten Stadt- und PLZ-Fallbacks.
2.  **L3-Entschlackung:** Wir entfernen die ersten großen Prompt- und Berechnungsblöcke aus `personal-agent.service.js` und ersetzen sie durch den Aufruf des L3-Brokers.

### Phase C: Die Aktivierung des Hypothese-Modus & HITL-Integration
1.  **Confidence-Registry:** Wir implementieren die Mapping-Registry in PouchDB.
2.  **Lern-Schnittstelle:** Wir integrieren den `hitl.service` als offizielles Korrektur-Schnittstellen-Ereignis, um schlechte Hypothesen live im Betrieb abzuwerten.
