# Cernion v56: Plan für ein rollen- und kontextbasiertes Persona-Resolution-Modell

## 1. Übersicht (Big Picture)

**Ziel:** Entwicklung eines intelligenten Persona-Resolution-Modells, das es Cernion Energy Tools ermöglicht, Benutzer (oder Agenten) basierend auf deren Rolle, aktuellem Kontext (z.B. geöffneter ZNP Workspace, genutztes Tool, spezifische Datenflüsse) und historischer Interaktion dynamisch zu identifizieren und deren Präferenzen, Berechtigungen und Aufgaben zu antizipieren. Dies soll die Personalisierung und Effizienz der Interaktion mit den Cernion-Systemen erheblich verbessern.

**Kernfunktionalität:**
*   **Rollenbasierte Identifikation:** Erkennung von vordefinierten Rollen (z.B. Netzbetreiber, Redispatch-Koordinator, Energiehändler, Systemadministrator, CoPilot-Agent).
*   **Kontextbasierte Anpassung:** Anpassung des Systemverhaltens, der angezeigten Informationen und der verfügbaren Aktionen an den aktuellen Interaktionskontext.
*   **Dynamische Persona-Profile:** Aufbau und Pflege von dynamischen Persona-Profilen, die sich aus Rolleninformationen, Echtzeit-Kontextdaten und gelernten Präferenzen speisen.
*   **API-Bereitstellung:** Eine konsumierbare Schnittstelle für andere Cernion-Module, um die aufgelöste Persona abzufragen.

## 2. Architektonische Integration

Das Persona-Resolution-Modell wird als zentraler Service innerhalb der Cernion-Architektur positioniert und muss nahtlos mit den bestehenden und geplanten Modulen interagieren:

*   **A2MDM (Agentic Asset-MDM):** Das Persona-Modell wird Informationen über die Rolle des Benutzers im Umgang mit Asset-Daten (z.B. Zugriffsberechtigungen, bevorzugte Ansichten von Stammdaten) konsumieren und bereitstellen. Änderungen an Asset-MDM-Strukturen könnten neue Kontextfaktoren für das Persona-Modell darstellen.
*   **ZNP Workspace (Zielnetzplanung):** Der ZNP Workspace wird ein primärer Kontextlieferant sein. Der aktuell bearbeitete Netzbereich, die ausgewählten Datenlayer, laufende Simulationen oder Analysen sind entscheidend für die Persona-Auflösung. Das Modell muss wissen, welche Art von Netzplanung der Nutzer gerade durchführt (z.B. §14a-Konformität, §42c EnWG-Optimierung).
*   **NAP Wallet (SSI/DID/VC):** Eine zukünftige Integration mit dem NAP Wallet könnte eine dezentrale Identitätsprüfung und den Bezug von verifizierbaren Credentials (VCs) für die Rollen- und Berechtigungsbestimmung ermöglichen. Das Persona-Modell würde dann auf diese SSI-Informationen zugreifen.
*   **Cernion Energy Tools:** Alle Cernion Energy Tools, die direkt vom Nutzer bedient werden, werden das Persona-Modell nutzen, um ihre Benutzeroberfläche, Empfehlungen und Automatismen zu personalisieren.
*   **CoPilot / andere Coding-Agenten:** Die Arbeitsweise von CoPilot-Agenten, die an Cernion-Repos arbeiten, könnte ebenfalls durch Persona-Profile optimiert werden (z.B. bevorzugte Codestile, verwendete Bibliotheken, Teststrategien basierend auf der Rolle des "Entwickler-Agenten").

## 3. Technische Komponenten

*   **Kontext-Ingestoren:** Module, die Echtzeit-Daten aus ZNP Workspace (z.B. aktive Session, geladene Netze, gewählte Analysen), A2MDM (z.B. geöffnete Asset-Profile), oder anderen Tools sammeln.
*   **Rollen-Management-Service:** Ein Service zur Definition und Verwaltung von Rollen und deren statischen Eigenschaften/Berechtigungen.
*   **Persona-Matching-Engine:** Die zentrale Logik, die Rolleninformationen, Kontextdaten und ggf. historische Nutzungsdaten kombiniert, um die aktuelle Persona zu ermitteln. Dies könnte regelbasiert, über Graphen oder mit ML-Methoden erfolgen.
*   **Profil-Speicher:** Eine persistente Datenbank (z.B. PouchDB/CouchDB für Offline-Fähigkeit, ergänzt durch einen zentralen Store) für dynamische Persona-Profile und Präferenzen.
*   **API-Schnittstelle:** Eine RESTful oder GraphQL API, über die andere Cernion-Module die aktuelle Persona abfragen können.
*   **Audit-Log:** Nachvollziehbarkeit, wann und wie eine Persona aufgelöst wurde, ist für Compliance und Debugging wichtig.

## 4. Phasen der Umsetzung (v56.1, v56.2, ...)

Die Umsetzung wird in iterativen Schritten erfolgen, um frühzeitig Feedback zu ermöglichen und die Komplexität zu managen. Jede Phase kann dann in detaillierte CoPilot-Prompts übersetzt werden.

*   **v56.1: Grundlagen & Statisches Rollen-Management**
    *   Definition und Implementierung eines initialen Rollen-Datenmodells (z.B. `Netzbetreiber`, `Redispatch-Koordinator`).
    *   Entwicklung eines CRUD-Interfaces für Rollen (mindestens CLI/interne API).
    *   Erstellung des Persona-Services (MVP) mit statischer Rollenzuordnung (z.B. per Konfiguration oder initialer Zuordnung).
    *   Integration einer ersten einfachen API zum Abfragen der zugewiesenen Rolle.
    *   **CoPilot-Aufgaben:** Datenmodell für Rollen, grundlegender Rollen-Service (CRUD), API-Schnittstelle (Read-only Rolle), initiale Konfiguration.

*   **v56.2: Kontext-Ingestion (ZNP Workspace Fokus)**
    *   Identifikation und Spezifikation relevanter Kontext-Datenpunkte aus dem ZNP Workspace (z.B. aktive ZNP-Session, geladene Netzdaten, gewählte Planungsszenarien).
    *   Implementierung von Kontext-Ingestoren, die diese Daten erfassen und an den Persona-Service melden.
    *   Erweiterung der Persona-Matching-Engine um einfache, regelbasierte Logik zur kontextuellen Anpassung (z.B. "Wenn Rolle=Netzbetreiber UND Kontext=ZNP_§14a_Planung, dann Persona=§14a-Experte").
    *   **CoPilot-Aufgaben:** Spezifikation ZNP-Context-Schnittstelle, Implementierung ZNP-Context-Ingestor, Erweiterung Persona-Engine (Regelwerk), Testfälle für kontextuelle Auflösung.

*   **v56.3: Dynamische Persona-Profile & Präferenzen**
    *   Entwicklung des Profil-Speichers für dynamische Persona-Attribute und nutzerspezifische Präferenzen (z.B. bevorzugte Kartenlayer, Standardfilter).
    *   Implementierung von Mechanismen zur Speicherung und Abfrage dieser Präferenzen über die Persona-API.
    *   Erweiterung der Persona-Matching-Engine um die Berücksichtigung dynamischer Profile.
    *   **CoPilot-Aufgaben:** Datenbankschema für Profile, CRUD-Operationen für Profile, Integration in Persona-Service.

*   **v56.4: Monitoring & Audit-Log**
    *   Implementierung eines Audit-Logs für Persona-Auflösungsereignisse (wer, wann, welche Persona, welcher Kontext).
    *   Bereitstellung von Monitoring-Metriken für die Leistung und Nutzung des Persona-Resolution-Modells.
    *   **CoPilot-Aufgaben:** Audit-Log-Spezifikation, Implementierung Audit-Logging, Prometheus/Grafana Metrik-Integration.

*   **v56.5: Erweiterung & Verfeinerung (z.B. A2MDM-Kontext, ML-Ansätze)**
    *   Integration weiterer Kontext-Quellen (z.B. A2MDM-Interaktionen).
    *   Erforschung und prototypische Implementierung von Machine-Learning-Ansätzen für die Persona-Erkennung und -Anpassung (optional, abhängig vom Erfolg der regelbasierten Ansätze).
    *   **CoPilot-Aufgaben:** A2MDM-Context-Ingestor, Machbarkeitsstudie ML-Persona, ggf. Prototyp.

## 5. Offene Fragen & Entscheidungen

*   **Initialer Rollensatz:** Welche Rollen sind für Cernion Energy Tools am wichtigsten und sollen zuerst abgebildet werden?
*   **Kontextgranularität:** Wie detailliert müssen die Kontextinformationen sein, um aussagekräftige Personas zu erhalten? (Trade-off zwischen Komplexität und Nutzen).
*   **Datenhoheit und Datenschutz:** Wie werden sensible Persona-Daten (Präferenzen, Nutzungsmuster) gespeichert und verarbeitet, insbesondere im Hinblick auf regulatorische Anforderungen (Redispatch 2.0, EnWG)?
*   **Technologie-Stack für Matching-Engine:** Regel-Engine (z.B. Drools-ähnlich), Graph-Datenbank (Neo4j-ähnlich für Beziehungen), oder leichtgewichtiger ML-Service?
*   **Authentifizierung/Autorisierung:** Wie greift der Persona-Service sicher auf Rollen- und Kontextdaten zu, und wie werden Anfragen an die Persona-API autorisiert? (Bezug zu NAP Wallet)
*   **`CERNION.md`:** Der Gesamtkontext von Cernion ist noch nicht vollständig dokumentiert. Dies ist eine kritische Basis für die Detailplanung.
