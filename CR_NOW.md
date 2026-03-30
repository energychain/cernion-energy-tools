Hier ist die strukturierte Anforderungsspezifikation (im Epic- / User-Story-Format). Du kannst sie direkt so in euer Ticket-System (Jira, GitHub Issues, o.ä.) oder in die Cernion-Produktdokumentation übernehmen.

Sie ist bewusst so formuliert, dass sie als **Mandanten-fähiges Standard-Feature (SaaS)** für beliebige Verteilnetzbetreiber (VNBs) entwickelt wird und nicht als Insellösung nur für die TWL.

***

# Feature Epic: Cernion "Energy Sharing Bridge" (Agentic MDM)
**Kontext:** Aufgrund der Verzögerung der zentralen IT-Plattform nach § 20b EnWG müssen VNBs zum 01.06.2026 eigene Interimsprozesse für Energy Sharing (§ 42c EnWG) aufbauen.
**Ziel:** Cernion agiert als intelligenter Middleware-Layer ("Agentic MDM") zwischen den Kundenportalen der VNBs und deren starren EDM/SAP-Systemen. Der Cernion-Agent übernimmt die asynchrone Validierung, Datenanreicherung und komplexe Zeitreihenberechnung, um das VNB-Backend von unsauberen Daten und Rechenlast freizuhalten.

---

### Anforderung 1: Automatisierte MaLo-Validierung (MaStR-Abgleich)
**User Story:**
Als VNB-Sachbearbeiter möchte ich, dass eingereichte Marktlokationen (MaLo-IDs) von Energy-Sharing-Gemeinschaften vollautomatisch validiert werden, um manuelle Prüfaufwände zu eliminieren und Stammdatenfehler vor dem EDM-Import zu erkennen.

**Akzeptanzkriterien / Logik:**
* Der Agent nimmt bei der Registrierung einer Sharing-Gemeinschaft die gemeldeten MaLo-IDs (Erzeuger und Verbraucher) entgegen.
* Der Agent fragt die MaLo-IDs über die Schnittstelle zum Marktstammdatenregister (MaStR) ab.
* **Prüfregeln:**
  * Existenz-Check: Ist die MaLo gültig und im MaStR vorhanden?
  * Status-Check: Ist die Anlage im Status "In Betrieb"?
  * Plausibilitäts-Check: Stimmt die Anlagenkonfiguration (z.B. Erzeugungsart, installierte Leistung) mit den Vorgaben für Energy Sharing überein?
* **Output:** Flag `is_valid_mastr_sync` (True/False) pro MaLo inkl. detailliertem Fehlerprotokoll bei Abweichungen.

---

### Anforderung 2: Direktvermarkter-Validierung (DV-Lookup)
**User Story:**
Als VNB-Abrechner muss ich sicherstellen, dass teilnehmende Erzeugungsanlagen zwingend in der Direktvermarktung sind (Vorgabe § 21 Abs. 2 EEG), da sonst die Abrechnung der Energy-Sharing-Mengen rechtlich angreifbar ist.

**Akzeptanzkriterien / Logik:**
* Der Agent liest den angegebenen Direktvermarkter (Marktpartner-ID / Name) aus dem Anmeldedatensatz aus.
* Der Agent nutzt den internen Endpoint `cernion_direktvermarkter_lookup`.
* **Prüfregeln:**
  * Handelt es sich um einen zertifizierten, aktiven Direktvermarkter am Markt?
  * Gibt es für die jeweilige Erzeugungs-MaLo einen aktiven Zuordnungs-Status zu diesem DV?
* **Output:** Status-Bestätigung (DV-Zertifikat gültig) oder automatische Ablehnung/Klärfall-Erstellung, falls keine aktive Direktvermarktung nachgewiesen werden kann.

---

### Anforderung 3: Dynamische Zeitreihen-Allokation (Viertelstundenscharfer Aufteilungsschlüssel)
**User Story:**
Als VNB-System (EDM) benötige ich fertige, viertelstundenscharfe (15-Min) Zeitreihen für die Bilanzierung, da mein System die komplexe Aufteilung einer Erzeugungsanlage auf *n* Verbraucher nicht dynamisch berechnen kann.

**Akzeptanzkriterien / Logik:**
* **Input:** Der Agent erhält die statischen Anmeldedaten (z. B. "Verbraucher A bekommt 30%, Verbraucher B 70% der Erzeugung" oder absolute Leistungszuweisungen) sowie die gemessenen 15-Minuten-Lastgänge der Erzeugungsanlage (iMSys-Daten).
* **Verarbeitung (Calculation Engine):** Der Agent berechnet aus den statischen Schlüsseln und den realen/prognostizierten 15-Minuten-Werten den dynamischen Anteil pro teilnehmender Verbraucher-MaLo für jedes Viertelstunden-Intervall.
* **Sonderfall-Handling:** Der Agent muss den *Redispatch-Vorbehalt* beachten (Mengen, die abgeregelt werden, fallen aus dem Energy Sharing heraus und werden im Intervall mit 0 gewertet).
* **Output:** Generierung einer standardisierten, importfertigen Zeitreihe (z.B. via REST-API Payload oder MSCONS-Export) je Verbraucher-MaLo zur direkten Übergabe an das EDM-System des VNB.

---

### Nicht-funktionale Anforderungen (NFRs)
* **Mandantenfähigkeit:** Die Brücke muss so gebaut sein, dass sie von multiplen VNBs über API-Keys unabhängig voneinander genutzt werden kann.
* **Audit-Log (Traceability):** Jede Entscheidung des Agenten (warum wurde eine MaLo abgelehnt? Wie kam der Aufteilungsschlüssel in Intervall X zustande?) muss revisionssicher für das VNB-Controlling geloggt werden.
