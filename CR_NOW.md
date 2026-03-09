# Change Request CR-SWF-2026-003
## 360° Management Report v2 – Stadtwerke Frankenthal GmbH
### Delta-Prüfung nach Neuversand · 9. März 2026

---

| Feld | Inhalt |
|---|---|
| **CR-Nummer** | CR-SWF-2026-003 |
| **Datum** | 9. März 2026 |
| **Bezug-Report-ID** | 51f51240-5eba-40fe-a712-0f6809f83c9e |
| **Vorgänger-CR** | CR-SWF-2026-002 (8. März 2026) |
| **VNB-BDEW / MaStR** | 9900191000003 · SNB961745390019 |
| **Validierungsbasis** | Cernion MCP API – Live-Abfrage `cernion_installations_local` (9. März 2026) |
| **Adressat** | Cernion Energy Intelligence / STROMDAO GmbH |
| **Priorität gesamt** | 2× Kritisch · 3× Offen (aus CR-002 unverändert) |
| **Ersteller** | Stadtwerke Frankenthal GmbH – Geschäftsführung |

---

## 1  Fortschritt gegenüber CR-SWF-2026-002

Von 12 geforderten Korrekturen wurden **7 vollständig oder weitgehend umgesetzt**. Dies wird ausdrücklich anerkannt.

| CR-002-Punkt | Status v2 | Bemerkung |
|---|---|---|
| CR-01 Anzahl Prüfungen | ⚠️ Teilweise | Interner Widerspruch – siehe CR-03-A unten |
| CR-02 Stillgelegte mit Prüfstatus | ✅ Umgesetzt | Eigene Tabelle mit allen 4 Anlagen |
| CR-03 Redispatch-Pool-Sektion | ⚠️ Teilweise | Tabelle vorhanden, aber neuer Datenfehler – siehe CR-03-B |
| CR-04 Top-10 mit MaStR-Nummern | ✅ Umgesetzt | Vollständige Tabelle |
| CR-05 PLZ-Ausreißer mit MaStR-Referenz | ❌ Offen | Weiterhin „–", keine konkreten Nummern |
| CR-06 CO₂-Framing | ✅ Umgesetzt | Korrekt als §14a-Indikator gelabelt |
| CR-07 Residuallast-Disclaimer | ✅ Umgesetzt | Caveat „Worst-Case-Schätzung" ergänzt |
| CR-08 Gasfüllstand-Framing | ✅ Umgesetzt | Als „Marktkontext DE/EU – kein lokaler Netzindikator" |
| CR-09 Baiersbronn-Extremwert | ✅ Umgesetzt | Strukturhinweis ergänzt |
| CR-10 VNB-Grundgesamtheit | ❌ Offen | 740 vs. 698 weiterhin ohne Erklärung |
| CR-11 Zeitstempel/Quellen | ✅ Teilweise | Quellenangaben je Abschnitt vorhanden |
| CR-12 Ungenutzte Tools | ❌ Offen | Nicht adressiert |

---

## 2  Neue und verbleibende Befunde

### 🔴 CR-03-A (Kritisch, NEU) – Interner Widerspruch: Drei verschiedene Prüfungszahlen im selben Report

**Befund:**
Im Report v2 erscheinen für die Anzahl der Anlagen in Netzbetreiberprüfung drei verschiedene, sich widersprechende Werte:

| Stelle im Report | Wert |
|---|---|
| Management Briefing (SOFORT-Abschnitt, Titel) | **4 Anlagen** |
| Management Briefing (⚠️ Prüffristen, nächste Zeile) | **24 Anlagen / 2,2 MW** |
| Aktionsplan (WOCHE 1–2) | **4 offene MaStR-Datenpunkte** |
| **Live-Abfrage `cernion_installations_local` (9.3.2026)** | **41 Anlagen** |

Ein Report, der in sich selbst widersprüchlich ist, ist für die interne Kommunikation (Geschäftsführung, Aufsichtsrat) und für externe Zwecke (BNetzA-Korrespondenz, EWK-Dokumentation) nicht verwendbar.

**Geforderte Maßnahme:**
Einheitliche Zahl auf Basis der Live-Abfrage (41 Anlagen, ~2.354 kW gesamt) in allen Report-Sektionen. Die Schocker-Seite, das Management Briefing und der Aktionsplan müssen denselben Wert tragen. Aufschlüsselung nach Typ (24 Solar, 13 Speicher, 1 Wind, 3 Verbrennung) wie in CR-002 gefordert.

**Frist:** Neuversand innerhalb von 5 Werktagen.

---

### 🔴 CR-03-B (Kritisch, NEU) – Falscher Prüfstatus Vestas V-80 in Redispatch-Tabelle

**Befund:**
In der neuen Redispatch-/§51-Tabelle wird die Windkraftanlage SEE995453733875 (13458, Vestas V-80, 2.000 kW, MS, Heuchelheim) unter der Spalte „Prüfung" mit **✅ (Geprüft)** ausgewiesen.

Die Live-Abfrage vom 9. März 2026 ergibt eindeutig:

```
MaStR: SEE995453733875
NB-Prüfung: In Prüfung ⏳
Betriebsstatus: InBetrieb (seit 29.12.2002)
Spannungsebene: Mittelspannung
```

Das ist die **größte Einzelanlage im Netzgebiet** (2 MW = 2,8 % der gesamten installierten EE-Leistung) und die einzige Redispatch-pflichtige Windkraftanlage. Ihr seit über 20 Jahren offener Prüfstatus ist der kritischste Compliance-Befund des Netzgebiets – er darf nicht als „Geprüft" dargestellt werden.

**Auswirkung:**
Ein Netzbetreiber, der aufgrund dieser Fehlanzeige keine Maßnahmen ergreift, riskiert ein §118-EnWG-Bußgeld und nicht abrechenbare Redispatch-Kosten (~3.000 €/Jahr nach §12 StromNZV).

**Geforderte Maßnahme:**
- Prüfstatus in der Tabelle korrigieren auf: **⚠️ In Prüfung**
- Zelle rot hervorheben
- Hinweis: „Redispatch-pflichtig, Prüfstatus offen seit 29.12.2002 – sofortiger Handlungsbedarf"
- Konsistenz mit der Top-10-Tabelle der offenen Prüfungen sicherstellen

**Frist:** Neuversand innerhalb von 5 Werktagen (identisch mit CR-03-A).

---

### 🟠 CR-05 (Hoch, aus CR-002 offen) – PLZ-Ausreißer ohne MaStR-Referenz und Prüfstatus

**Befund:**
Der Wert „Ortsfremde Anlagen (PLZ-Ausreißer)" ist in Report v2 weiterhin als **„–"** ausgewiesen. Dabei sind zwei konkrete Anlagen bekannt und durch Live-Abfrage validiert:

| MaStR-Nr. | Typ | PLZ (ist) | PLZ (soll) | NAP | Prüfstatus |
|---|---|---|---|---|---|
| SEE954885337037 | Solar, 5,67 kW | 67069 | 672xx | SAN906305299067 | ⚠️ In Prüfung |
| SEE936879976590 | Speicher, 3,84 kW | 67069 | 672xx | SAN906305299067 | ⚠️ In Prüfung |

Beide Anlagen teilen denselben NAP und dieselbe MeLo und sind zusätzlich in Netzbetreiberprüfung – eine Doppelproblematik, die im Fotojahr 2026 den AgNeS-Effizienzwert für 60 Monate belastet.

**Geforderte Maßnahme:**
Tabelle mit MaStR-Nummer, tatsächlicher PLZ, NAP-Nummer und Prüfstatus. Wenn PLZ-Fehler und offener Prüfstatus zusammentreffen: explizite Kennzeichnung als Doppelrisiko.

**Frist:** Report v2.1.

---

### 🔵 CR-10 (Mittel, aus CR-002 offen) – Inkonsistente VNB-Grundgesamtheit (740 vs. 698)

**Befund:**
Unverändert gegenüber CR-002. Im Regulierungsteil wird „Rang 452/740" (Anschlussdauer) und „Rang 187/698" (Umsetzungsquote) nebeneinander ausgewiesen – 42 VNBs Differenz ohne jede Erläuterung.

**Geforderte Maßnahme:**
Fußnote mit Erklärung der abweichenden Teilmengen (z. B. unterschiedliche EWK-Erhebungsabschnitte). Alternativ: einheitliche Grundgesamtheit mit Hinweis auf Datenprovider.

---

### 🔵 CR-12 (Mittel, aus CR-002 offen) – Verfügbare Cernion-Tools nicht genutzt

**Befund:**
Unverändert gegenüber CR-002. Sieben Tools mit nachgewiesenem fachlichem Mehrwert für Stadtwerke Frankenthal werden im Report nicht genutzt (Trafo-Auslastung, Redispatch-Export, EEG-Ablaufdaten, regionale Netto-Residuallast, stündliche CO₂-Intensität u. a.).

**Geforderte Maßnahme:**
Roadmap-Abschnitt im Report mit Kennzeichnung „Modul verfügbar – auf Anfrage aktivierbar" statt undokumentiertem Weglassen.

---

## 3  Akzeptanzkriterien für Report v2.1

- [ ] Eine einzige konsistente Prüfungszahl (41) in allen Report-Sektionen
- [ ] SEE995453733875 in Redispatch-Tabelle als ⚠️ In Prüfung mit roter Hervorhebung
- [ ] PLZ-Ausreißer mit MaStR-Nummern, NAP und Prüfstatus
- [ ] Fußnote zur VNB-Grundgesamtheit (740 vs. 698)

---
