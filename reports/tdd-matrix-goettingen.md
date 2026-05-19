# Test-Szenario: Stadtwerke Göttingen (Leinetal-Campus) - UAT

Dieses Dokument beschreibt den Testablauf zur Validierung des Cernion Personal Agents (v0.52+). Der Test prüft die korrekte Handhabung von "Conversational Onboarding" (Missing Context) in Verbindung mit dem asynchronen Job-Pattern und der fachlichen Tiefe (fNAV vs. §17 EnWG).

## Test ID: T-PA-MT-004
**Titel:** Multi-Turn UAT Göttingen (Leinetal-Campus) mit Async-Job-Pattern

### Vorbedingungen
- `tenantId` ist `uat-tenant-goettingen-002`
- `agentId` ist `Stadtwerke_Goettingen_Netz`
- Der Personal Agent API-Endpunkt (`POST /api/personal-agent/chat`) liefert sofort einen `jobId` anstelle einer synchronen Blockierung. Das asynchrone Polling-Pattern muss verwendet werden.

### Schritt 1 (Initialisierung & Asset Validierung)
**Eingabe:** "Wir haben hier bei der Stadtwerke Göttingen AG (Netzgesellschaft) eine Netzanschlussanfrage für das neue Projekt 'Leinetal-Campus'. Es geht um 15 MW Kapazität, primär für ein Rechenzentrum und eine 3 MW Wärmepumpe zur Abwärmenutzung. Kannst du bei der Prüfung unterstützen?"
**Erwartetes Verhalten:**
- Die API antwortet synchron mit HTTP 200 und einem `jobId`.
- Das asynchrone Polling (`GET /api/jobs/:jobId/status`) signalisiert irgendwann `completed`.
- Der Agent identifiziert die Entitäten (15 MW, RZ, WP).
- *NEU (v0.52.7 erwartetes Verhalten):* Wenn ein Pflichtfeld fehlt (z.B. `fnavProfile` für kaufmännische Bewertungen), liefert der Agent eine `awaiting-onboarding` Presentation, die das fehlende Feld **empathisch in den Kontext einbettet** (z.B. "Um das 15 MW Projekt zu prüfen, benötige ich noch...") anstatt nur den statischen String zu senden.

### Schritt 2 (Regulatorik & Konflikt-Einführung)
**Eingabe:** "Der Anschluss soll auf der 20-kV-Mittelspannungsebene erfolgen. Unser technischer Planer sagt, das zuständige Umspannwerk operiert am N-1 Limit. Ein konventioneller Ausbau dauert 4 Jahre und kostet 3,5 Mio. Euro CAPEX. Er will den Antrag aus Kapazitätsgründen ablehnen. Geht das rechtlich nach §17 EnWG so einfach?"
**Erwartetes Verhalten:**
- Asynchrones Job-Handling funktioniert.
- Der Agent schlägt die Brücke zwischen der N-1 Limitierung und den rechtlichen Grenzen von §17 EnWG (Pauschale Ablehnung unzulässig bei wirtschaftlicher Zumutbarkeit).
- Der Agent bringt idealerweise selbst fNAV / Spitzenkappung ins Spiel.

### Schritt 3 (Prozess & Rollen-Klärung)
**Eingabe:** "Guter Punkt zur flexiblen Netzanschlussvereinbarung (fNAV). Der kaufmännische Bereich will ohnehin hohe CAPEX/Stranded Assets vermeiden und die Netzentgelte sofort sichern. Wie sieht der genaue Prozess (Rollen und Verantwortlichkeiten) aus, um diesen Konflikt zwischen Technik (will ablehnen) und Kaufmännischem Bereich (will fNAV) aufzulösen?"
**Erwartetes Verhalten:**
- Der Agent skizziert die prozessuale Konfliktauflösung (Routing auf `vdmi_role_boundary_governance` oder ähnlich).

### Schritt 4 (Presentation Layer / Formatter Test)
**Eingabe:** "Erstelle mir daraus eine VDMI-Matrix (Verantwortlich, Durchführend, Mitwirkend, Informiert) für den finalen Entscheidungsprozess und die Umsetzung dieses fNAV für den Leinetal-Campus."
**Erwartetes Verhalten:**
- `presentationApplied` ist `true`.
- `presentationType` ist `vdmi_matrix_table`.
- Die zurückgegebene Tabelle strukturiert den Lösungsraum für das Management.
