# Referenz-Case: Messkonzept-Konflikt & Beratungspflichten (v0.58)

Dieses Dokument dokumentiert einen vollständig neutralisierten, praxisnahen Multi-Turn-Referenzfall zur Fehlplanung bei der Anmeldung im Netzanschlussportal (NAP) von Verteilnetzbetreibern (VNB). Er dient als technischer und fachlicher Nachweis für den No-Code-Messkonzept-Engine-Ansatz von Cernion.

---

## Fachlicher Hintergrund & Ausgangsszenario

*   **Bestand vor der Dachplanung:**
    1.  Eine über 20 Jahre alte PV-Anlage (Volleinspeisung) mit eigenem Zähler (vor oder nach dem Auslauf der regulären EEG-Vergütung).
    2.  Eine Bestands-Wärmepumpe (unterbrechbare Verbrauchseinrichtung, 7,5 kW) mit separatem Zähler für den vergünstigten Heizstrom-/Heizwärmetarifsatz.
*   **Neue Installation (durchgeführt von einem Photovoltaik-Fachbetrieb / Solarteur):**
    *   Neubau einer PV-Anlage (10 kWp) mit Batteriespeicher (10 kWh, 5 kW Ladeleistung) und einem intelligenten Messsystem (iMSys).
*   **Der Planungs- und Anmeldefehler des Fachbetriebs:**
    *   Der Elektroinstallateur deinstallierte den separaten Heizstromzähler und meldete im Netzanschlussportal (NAP) des VNB lediglich eine simple **„Zusammenlegung der Zähler“** (Messkonzept MK 10 - Einzähler-Eigenverbrauch) an.
    *   **Die Folgen:**
        1.  **Zerstörung des Sondertarifs:** Die Wärmepumpe wird nun über den teureren Haushaltsstromtarif abgerechnet (Schaden ca. **1.400 € pro Jahr**). Es wurde versäumt, eine Kaskadenmessung (Messkonzept MK 40) aufzubauen.
        2.  **Vergessene § 14a EnWG-Anmeldung:** Der Batteriespeicher (> 4,2 kW Ladeleistung) und die Wärmepumpe wurden nicht als steuerbare Verbrauchseinrichtungen (steuVE) nach § 14a EnWG registriert, was ein Bußgeld- und Abschaltungsrisiko birgt.
        3.  **Fehlende Integration der Altanlage:** Die über 20 Jahre alte Volleinspeise-Anlage wurde nicht intelligent über ein Kaskaden-Messkonzept untermessen, um sie auf Eigenverbrauch umzustellen.

---

## Wie der Fachbetrieb den Fehler durch Cernion verhindert hätte

Hätte der Installateur **Cernion als Planungs- und Beratungswerkzeug** vor dem Umbau genutzt, wäre der Fehler vollständig vermieden worden. 

### Der präventive Ablauf mit Cernion:
1.  **Datenerfassung im Erstgespräch:** Der Solarteur erfasst die Bestandsdaten des Kunden (Bestand: Wärmepumpe 7,5 kW, Volleinspeisung Altanlage; Neu geplante PV: 10 kWp + 5 kW Batteriespeicher).
2.  **Abfrage an die Cernion-Engine:** Der Vertrieb oder die technische Arbeitsvorbereitung füttert Cernion mit dieser Konstellation.
3.  **Sofortige Warnung der Cernion-Plattform:**
    *   *„Achtung: Der Endkunde verliert durch die geplante Standard-Zusammenlegung (MK 10) den vergünstigten Heizstromtarif für die Wärmepumpe. Empfohlenes Soll-Messkonzept: Kaskadenmessung (MK 40).“*
    *   *„Achtung: Der geplante Batteriespeicher (Ladeleistung 5 kW) überschreitet die Freigrenze von 4,2 kW. Es handelt sich um eine steuerbare Verbrauchseinrichtung nach § 14a EnWG. Anmeldung im NAP ist zwingend erforderlich.“*
4.  **Umsatz- und Haftungseffekte für den Fachbetrieb:**
    *   **Keine Haftung:** Der Betrieb begeht keine Beratungspflichtverletzung, da der Kunde vorab über die Messkonzepte und Kosten aufgeklärt wird.
    *   **Mehr Umsatz:** Der Fachbetrieb kann dem Kunden die Ertüchtigung des Zählerschranks für die Kaskadenmessung (MK 40) direkt als kostenpflichtige Zusatzleistung (Zusatzumsatz im Elektro-Handwerk) anbieten.
    *   **Perfekter Kundenservice:** Die Anmeldung nach § 14a EnWG wird fehlerfrei durchgeführt und sichert dem Kunden die reduzierten Netzentgelte.

---

## Multi-Turn REST-API Simulation via cURL & JSON

Dieser Ablauf simuliert, wie Cernion den Nutzer schrittweise durch die Erfassung führt, den Fehler analysiert, das richtige Soll-Messkonzept vorschlägt und die juristisch-regulatorische Argumentation für Schadensersatzansprüche aufbaut.

---

## Turn 1: Problembeschreibung & Erkennung

### 1. API-Aufruf (cURL)
Der Nutzer schildert das Problem im Freitext:

```bash
curl -X POST http://localhost:3000/api/personal-agent/chat \
  -H "Content-Type: application/json" \
  -H "x-cernion-tenant: tenant_twl" \
  -d '{
    "sessionId": "session-messkonzept-conflict-2026",
    "message": "Ich habe eine neue PV mit Speicher installiert bekommen. Der Installateur hat den separaten Zähler meiner Wärmepumpe deinstalliert und einfach nur eine Zusammenlegung gemeldet. Jetzt habe ich meinen günstigen Wärmepumpen-Tarif verloren und der Netzbetreiber sagt, der Speicher sei nicht nach §14a angemeldet. Außerdem habe ich noch eine 20 Jahre alte PV-Altanlage mit Volleinspeisung. Wie sieht das optimale Messkonzept aus?"
  }'
```

### 2. System-Antwort (JSON)
Der L3-Broker erkennt das komplexe Messkonzept-Szenario (`edm-melo-timeseries-v1` gekoppelt mit `grid-fnav-validation-v1`), stellt fest, dass wichtige Standort- und Leistungswerte zur präzisen VNB-Prüfung fehlen, und startet das Slot-Filling:

```json
{
  "success": true,
  "sessionId": "session-messkonzept-conflict-2026",
  "status": "missing_inputs",
  "missingRequiredInputs": [
    "postalCode",
    "requestedCapacityKW"
  ],
  "message": "Das ist ein schwerwiegender Planungsfehler des Installateurs. Durch die unvollständige Anmeldung haben Sie Ihren Heizstromtarif verloren und verstoßen gegen §14a EnWG. Um die genauen Vorgaben Ihres Netzbetreibers und das korrekte Soll-Messkonzept zu ermitteln, benötige ich bitte noch zwei Angaben:\n1. Wie lautet Ihre Postleitzahl?\n2. Wie hoch sind die Leistungen (kWp der neuen PV, Leistung des Speichers in kW und Leistung der Wärmepumpe)?",
  "trace": {
    "detectedBlueprint": "grid-fnav-validation-v1",
    "extractedInputs": {
      "postalCode": null,
      "requestedCapacityKW": null,
      "energyType": "pv-plus-storage"
    }
  }
}
```

---

## Turn 2: Dateneingabe & Automatisierte Bewertung

### 1. API-Aufruf (cURL)
Der Nutzer liefert die fehlenden Leistungswerte und die Postleitzahl (z. B. 71332 für Waiblingen / Netze BW):

```bash
curl -X POST http://localhost:3000/api/personal-agent/chat \
  -H "Content-Type: application/json" \
  -H "x-cernion-tenant: tenant_twl" \
  -d '{
    "sessionId": "session-messkonzept-conflict-2026",
    "message": "Meine Postleitzahl ist 71332. Die Wärmepumpe hat eine thermische Leistung von 7,5 kW, die neue PV-Anlage hat 10 kWp und der Batteriespeicher hat 5 kW Ladeleistung."
  }'
```

### 2. System-Antwort (JSON)
Cernion führt die Analyse im Hintergrund aus. Sie prüft den Netzbetreiber (*Netze BW GmbH*), validiert das Messkonzept (MK 40 Kaskade) und liefert die vollständige fachliche, finanzielle und regulatorische Bewertung:

```json
{
  "success": true,
  "sessionId": "session-messkonzept-conflict-2026",
  "status": "ready",
  "message": "Analyse abgeschlossen für PLZ 71332 (Netzbetreiber: Netze BW GmbH). Hier ist die Soll-Konzeption und die rechtliche Einordnung Ihres Falls zur Vorlage beim Photovoltaik-Fachbetrieb:\n\n### 1. Das Soll-Messkonzept: Kaskadenmessung (MK 40)\nUm die Wärmepumpe und den Haushaltsstrom über denselben Hausanschluss zu betreiben, die PV-Anlage für beide zu nutzen und dennoch den getrennten Heizstromtarif zu erhalten, ist eine **Kaskadenmessung (MK 40)** zwingend erforderlich.\n\n*   **Zähler 1 (iMSys - Zweirichtungszähler):** Sitzt am Netzanschlusspunkt. Er erfasst den gesamten Bezug aus dem Netz sowie die Überschusseinspeisung der PV-Anlage.\n*   **Zähler 2 (iMSys - Untermessung):** Trennt den Haushaltsbezug mitsamt dem PV-Eigenverbrauch vom Wärmepumpenstrom. Der Bezug der Wärmepumpe Errechnet sich als Differenz (Zähler 1 - Zähler 2).\n\n### 2. Verletzung der Beratungspflichten durch den Fachbetrieb\n*   **Beratungsfehler:** Die Deinstallation des separaten Heizstromzählers ohne den gleichzeitigen Aufbau eines Kaskaden-Messkonzepts (MK 40) stellt einen klaren Planungs- und Ausführungsfehler dar. Dadurch wurde Ihr günstiger Wärmepumpenbezug zerstört.\n*   **Schadensersatz:** Dem Fachbetrieb steht hier eine Pflicht zur Nachbesserung (Rückbau auf Kaskade) sowie Schadensersatz für die seit Januar 2025 fälschlicherweise zum Haushaltsstromtarif abgerechneten Heizstrommengen zu (Schaden: ca. 1.400 € pro Jahr).\n\n### 3. Verstoß gegen § 14a EnWG\n*   **Anmeldepflicht:** Da Ihre neue PV-Anlage und der Batteriespeicher nach dem 01.01.2024 in Betrieb genommen wurden und die Netzladeleistung des Speichers 5 kW (> 4,2 kW) beträgt, handelt es sich um eine steuerbare Verbrauchseinrichtung (steuVE).\n*   **Säumigkeit:** Der Fachbetrieb ist verpflichtet, diese steuVE im Netzanschlussportal (NAP) anzumelden, um Ihnen das reduzierte Netzentgelt (Modul 1 oder Modul 2) zu sichern. Das Argument, dies sei Kundensache, widerspricht den BNetzA-Richtlinien für eingetragene Fachbetriebe.\n\n### 4. Integration der Altanlage (Volleinspeisung)\n*   Da die Altanlage über 20 Jahre alt ist, läuft deren ursprüngliche EEG-Vergütung aus. Sie sollte als dritter Kaskadenschritt integriert werden, um vorrangig den Eigenverbrauch der Wärmepumpe und des Haushalts zu decken, anstatt sie ungenutzt auslaufen zu lassen.",
  "data": {
    "blueprintId": "grid-fnav-validation-v1",
    "evaluation": {
      "success": true,
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
          "id": "validate_fnav",
          "action": "grid-connection.fnavValidate",
          "output": {
            "success": true,
            "feasibility": "FEASIBLE",
            "governanceStatus": "approved",
            "findings": [
              {
                "code": "FA_14A_REGISTRATION_REQUIRED",
                "message": "Steuerbare Verbrauchseinrichtung Batteriespeicher (5 kW) ist zwingend anzumelden."
              },
              {
                "code": "FA_MESSKONZEPT_ERROR_MK10",
                "message": "Fehlerhaftes Messkonzept MK10 gemeldet. Soll-Messkonzept ist MK40 (Kaskade)."
              }
            ]
          }
        }
      ],
      "postProcessing": {
        "calculations": {
          "calculatedFlexibleCapacityKW": 5
        }
      }
    }
  },
  "persistence": {
    "l3_facts": {
      "fnavPostalCode": "71332",
      "fnavRequestedCapacityKW": 10,
      "fnavFeasibility": "FEASIBLE",
      "fnavSollMesskonzept": "MK40_KASKADE",
      "fnavSchadenssummeEUR": 1400
    }
  }
}
```

---

## Vorteile für die Plattform & Vertriebs-Argumentation

1. **Gewerbliche und private Mehrwerte vereint:** Dieser Referenzcase zeigt, wie Cernion komplexe Messkonzepte auflöst. Es schützt Endkunden vor teuren Installationsfehlern und sichert die Rechtskonformität für Installateure und Stadtwerke.
2. **Nachweis der No-Code-Stabilität:** Der gesamte Dialog benötigt keinerlei Anpassungen am Cernion-Code. Das Verhalten wird rein über die standardisierte Blueprint-Abarbeitung und die parametrisierte L3-Broker-Struktur von v0.58 gesteuert.
3. **Dokumentierter Schadensersatz-Hebel:** Mit dem JSON-Output von Cernion hat der Anschlussnehmer ein hieb- und stichfestes, durch Gesetzesdaten gestütztes Gutachten, um Nachbesserungen beim Fachbetrieb rechtlich durchzusetzen.
