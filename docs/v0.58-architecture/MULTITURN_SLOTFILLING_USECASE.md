# Multi-Turn Slot-Filling & No-Code Execution Use Case (v0.58)

Dieses Dokument beschreibt einen vollständigen, dokumentierten und funktionsfähigen Multi-Turn-Ablauf über die REST-API von Cernion Energy Tools (`v0.58`).

Der gezeigte Anwendungsfall führt eine **automatisierte Netzanschlussprüfung (§14a / §14d EnWG)** für einen neuen Erzeuger durch. Da der Nutzer im ersten Schritt unvollständige Daten liefert, wechselt der L3-Broker deterministisch in das **Slot-Filling-Verfahren** und fordert den fehlenden Parameter an, bevor in Turn 2 die Ausführung über den L2-Interpreter und die L1-Services erfolgt.

---

## Fachliche Beschreibung des Szenarios

1. **Turn 1 (Initialisierung & Datenerfassung):**
   * **Nutzerwunsch:** *"Ich möchte eine Netzanschlussprüfung für ein neues Solar-Lager-Projekt in der Postleitzahl 76131 machen."*
   * **L3-Broker Analyse:** Der Broker erkennt den Intent `grid-connection-validation-v1`. Er findet die Postleitzahl (`76131`) und setzt das Feld `postalCode`. Das Pflichtfeld für die gewünschte Leistung (`capacityKW`) ist jedoch nicht in den extrahierten Daten vorhanden.
   * **System-Reaktion:** Der Plan wechselt auf `status: "missing_inputs"`. In `missingRequiredInputs` wird `'capacityKW'` aufgelistet. Der Dialog-Agent stellt dem Nutzer die präzise Rückfrage nach der Leistung.

2. **Turn 2 (Daten-Komplettierung & Ausführung):**
   * **Nutzerantwort:** *"Die geplante Leistung beträgt 250 kW."*
   * **L3-Broker Analyse:** Der Broker führt die Sitzung (`sessionId`) fort. Er verknüpft die neue Angabe mit dem bestehenden Kontext (`postalCode: "76131"`). Nun sind alle Pflichtparameter vorhanden.
   * **L2-Ausführung:** Der Plan wechselt auf `status: "ready"`. Die No-Code-Engine führt nacheinander aus:
     1. `grid-operations.vnbLookup` (liefert den zuständigen Netzbetreiber: *Netze BW GmbH*, BDEW-Code: *9900012345678*).
     2. `grid-connection.validate` (simuliert die physikalische Netzanschlussprüfung und liefert die Entscheidung: `GO_CONDITIONAL`).
     3. **Post-Processing (Expression-Parser):** Berechnet die geschätzten Baukostenzuschüsse über die Formel `capacityKW * 45` = `11.250 €`.
   * **Synthese:** Der Nutzer erhält ein vollständig gegründetes, verständliches Antwortschreiben.

---

## Turn 1: Initiale Anfrage mit fehlender Leistung (`capacityKW`)

### 1. API-Aufruf (cURL)
Der Client initiiert die Konversation und übergibt eine eindeutige `sessionId`, um den Zustand über mehrere Turns hinweg zu halten:

```bash
curl -X POST http://localhost:3000/api/personal-agent/chat \
  -H "Content-Type: application/json" \
  -H "x-cernion-tenant: tenant_twl" \
  -d '{
    "sessionId": "session-grid-check-2026",
    "message": "Ich möchte eine Netzanschlussprüfung für ein neues Solar-Lager-Projekt in der Postleitzahl 76131 machen."
  }'
```

### 2. System-Antwort (JSON)
Das System erkennt den Intent, identifiziert den fehlenden Pflichtparameter und verlangt diesen zurück. Es wird **noch kein** L1-Service aufgerufen:

```json
{
  "success": true,
  "sessionId": "session-grid-check-2026",
  "status": "missing_inputs",
  "missingRequiredInputs": [
    "capacityKW"
  ],
  "message": "Gerne helfe ich Ihnen bei der Netzanschlussprüfung für die Postleitzahl 76131. Um die Prüfung durchzuführen, benötige ich noch eine Angabe: Welche Anschlussleistung in kW ist für das Solar-Lager-Projekt gewünscht?",
  "trace": {
    "detectedBlueprint": "grid-connection-validation-v1",
    "extractedInputs": {
      "postalCode": "76131",
      "capacityKW": null,
      "energyType": "pv-open-field"
    }
  }
}
```

---

## Turn 2: Komplettierung der Parameter & Ausführung

### 1. API-Aufruf (cURL)
Der Client antwortet in derselben Session mit der gewünschten Leistung:

```bash
curl -X POST http://localhost:3000/api/personal-agent/chat \
  -H "Content-Type: application/json" \
  -H "x-cernion-tenant: tenant_twl" \
  -d '{
    "sessionId": "session-grid-check-2026",
    "message": "Die geplante Leistung beträgt 250 kW."
  }'
```

### 2. System-Antwort (JSON)
Der L3-Broker fügt die Parameter zusammen. Da der Plan nun vollständig ist (`status: "ready"`), triggert der L2-Blueprint-Interpreter die L1-Dienste und synthetisiert die finale Antwort:

```json
{
  "success": true,
  "sessionId": "session-grid-check-2026",
  "status": "ready",
  "message": "Ergebnis der Netzanschlussprüfung für 76131: Der zuständige Netzbetreiber ist Netze BW GmbH (BDEW: 9900012345678). Die Prüfung über 250 kW (pv-open-field) ergab die Entscheidung: GO_CONDITIONAL. Geschätzte Anschlusskosten: ca. 11250 €.",
  "data": {
    "blueprintId": "grid-connection-validation-v1",
    "evaluation": {
      "success": true,
      "pipelineVersion": "1.0.0",
      "steps": [
        {
          "id": "fetch_vnb_bdew",
          "action": "grid-operations.vnbLookup",
          "output": {
            "success": true,
            "data": {
              "companyName": "Netze BW GmbH",
              "bdew": "9900012345678",
              "mastrId": "SNB935578300972",
              "evidenceStatus": "verified"
            }
          }
        },
        {
          "id": "validate_connection",
          "action": "grid-connection.validate",
          "output": {
            "success": true,
            "decision": "GO_CONDITIONAL",
            "findingsCount": {
              "info": 1,
              "warning": 0,
              "error": 0
            },
            "summary": {
              "totalCapacityMW": 0.25,
              "totalInstallations": 1
            }
          }
        }
      ],
      "postProcessing": {
        "calculations": {
          "estimatedGridCostEUR": 11250
        }
      }
    }
  },
  "persistence": {
    "l3_facts": {
      "gridConnectionPostalCode": "76131",
      "gridConnectionCapacityKW": 250,
      "gridConnectionOperatorName": "Netze BW GmbH",
      "gridConnectionFindingClass": "GO_CONDITIONAL"
    }
  }
}
```

---

## Vorteile dieser Architektur (v0.58)

1. **Kein neuer JavaScript-Code:** Der gesamte Ablauf wird über die JSON-Deklaration gesteuert.
2. **Sicherheits-Garantie:** Es wird keinerlei `eval()` oder dynamische JS-Code-Generierung im Post-Processing genutzt. Der Expression-Parser arbeitet strikt als isolierter AST-Interpreter.
3. **Automatisches Slot-Filling:** Fehlen Daten, bricht das System nicht ab und liefert auch kein fehlerhaftes Ergebnis mit Null-Werten, sondern steuert deterministisch die Interaktion zur Nacherfassung.
4. **Vollständige Trace-Transparenz:** Entwickler und Auditoren können die L1-Schritte, Post-Processing-Kalkulationen und Quell-Nachweise im JSON-Payload lückenlos nachvollziehen.
