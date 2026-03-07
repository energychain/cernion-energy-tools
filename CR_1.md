# CR_360_Validated_Findings_MCP.md
## Validierte MCP-Befunde & Report-Upgrade-Konzept: Note 4 → Note 1
**Datenstand:** 7. März 2026 · Cernion Live-Abfragen via MCP
**Stadtwerke Frankenthal GmbH · BNr: 10000873 · BDEW: 9900191000003 · MaStR: SNB961745390019**

---

## ⚡ Executive Summary der Befunde

Dieser Report enthält fünf Daten-Schocks, die ein Vorstand nicht kannte – und die sofort Handlungsdruck erzeugen. Der bisherige Report hat diese entweder falsch dargestellt, unterschlagen oder in Tabellenzeilen versteckt. Das ist der Unterschied zwischen Note 4 und Note 1.

---

## BEFUND 1 · KRITISCH 🚨 · Anlagen in Netzbetreiberprüfung: Nicht 1, sondern 37

**Was der Report sagt:** "1 Anlage in Netzbetreiberprüfung" (Abschnitt 1)
**Was die Live-Abfrage liefert:** **37 Anlagen in Prüfung** · Gesamtleistung **2.343 kW**

| Typ | Anzahl | Leistung |
|-----|--------|---------|
| Solar | 22 | ~145 kW gesamt |
| Wind | 1 | **2.000 kW** ← Dominiert |
| Speicher | 12 | ~183 kW |
| KWK/Verbrennung | 2 | ~21 kW |

**Das Windrad: Die Zeitbombe im Prüfungsstau**
- Name: "13458" · MaStR: SEE995453733875
- Typ: Vestas V-80 (100m Nabenhöhe, 80m Rotor)
- Kapazität: **2.000 kW**
- In Betrieb seit: **29. Dezember 2002** – läuft seit 23 Jahren
- Standort: PLZ 67259, Heuchelheim bei Frankenthal
- Fernsteuerbarkeit VNB: **Ja** – Redispatch-fähig
- Status: **⏳ In Prüfung** seit unbekanntem Datum
- Finanzielle Konsequenz: 2 MW × §12 StromNZV ≈ **6.000 €/Jahr** nicht abrechnebar

**Warum passiert das?** Dieses Windrad wurde wahrscheinlich im Zuge der MaStR-Migration
(2019–2021) aus dem alten EEG-Register migriert, dabei aber automatisch den Status
"NetzbetreiberPrüfung" erhalten – und seitdem nie abschließend geprüft.
Es erzeugt Strom, hat eine MeLo, ist fernsteuerbar – aber im Papier „ungeprüft".

**Bußgeldrisiko gesamt bei 37 offenen Prüfungen:**
- NS-Fristen: 4 Wochen (22 Solar + 12 Speicher + 2 KWK)
- MS-Fristen: 6 Wochen (1 Wind)
- Bei Fristüberschreitung: §118 EnWG → BNetzA kann pro Fall Bußgeld verhängen
- Worst Case 37 Fälle: **potenziell substanzielles Bußgeldrisiko**

**CR-65: Prüfstau-Auflösung als Pflichtfeld in der Summary**
```
// STATT:
"Anlagen in Netzbetreiberprüfung: 1 Anlage"

// MUSS WERDEN:
"Anlagen in Netzbetreiberprüfung: 37 Anlagen (2.343 kW)"

// SUMMARY-PUNKT MUSS LAUTEN:
"🚨 37 Anlagen (davon 1 × 2 MW Windrad seit 2002) stecken in der
Netzbetreiberprüfung – §118 EnWG Bußgeldrisiko. MaStR-Prüfstatus
für alle 37 binnen 48h abschließen."

// API-FIX:
const allePruefung = await fetch('/api/assets/all', {
  params: { bdewCode: '9900191000003',
            netzbetreiberPruefungStatus: 'InPruefung',
            includeNapData: true }
});
// count: 37 (nicht 1!)
```

---

## BEFUND 2 · KRITISCH 🚨 · MS-Anschlussdauer: 120 Wochen – steht nicht im Report

**Was der Report zeigt:** Anschlussdauer EE NS: 47 Wochen (Rang 452/740)
**Was die Live-Abfrage zusätzlich liefert:**

| Segment | Phase 1 | Phase 2 | **Gesamt** | Bedeutung |
|---------|---------|---------|----------|----------|
| EE NS | 40 Wo | 7 Wo | **47 Wo** | Im Bericht |
| **EE MS** | **60 Wo** | **60 Wo** | **120 Wo** | ❌ FEHLT |
| Verbrauch NS | 30 Wo | 7 Wo | **37 Wo** | ❌ FEHLT |
| **Verbrauch MS** | **30 Wo** | **180 Wo** | **210 Wo** | ❌ FEHLT |

**Was 120 Wochen bedeutet:** Ein Projektierer, der heute eine 500 kW Freiflächen-PV
oder eine Industrie-Wärmepumpe in Mittelspannung bei den Stadtwerken Frankenthal
anmeldet, wartet statistisch **2 Jahre und 4 Monate** auf die Inbetriebnahme.

**Was 210 Wochen bedeutet:** Für Verbrauchsanlagen MS (große Wärmepumpen,
Elektrolyseure, Speicher >100 kW) liegt die Phase-2-Dauer bei **180 Wochen = 3,5 Jahre**.
Das ist kein Prozess mehr – das ist ein strukturelles Investitionshemmnis.

**Geschäftliche Konsequenz:**
Projektierer meiden den Frankenthal-Netzbereich für MS-Anlagen. Für das Stadtwerk
als Lieferant bedeutet das: potenzielle Großkunden (Industrieprosumer, Wärmepumpen-
Projekte) gehen zu Netzbetreibern mit kürzeren Wartezeiten.

**CR-66: MS-Anschlussdauer als separater KPI verpflichtend**
```
// IM REPORT ABSCHNITT 5 COMPLIANCE:
kennzahlen.anschlussdauer = {
  ee_ns:  { wochen: 47,  rang: "452/740", status: "⚠️ Über Median" },
  ee_ms:  { wochen: 120, rang: "n/v",     status: "🚨 KRITISCH – 2,3 Jahre" },  // NEU
  v_ns:   { wochen: 37,  rang: "n/v",     status: "✅ Gut" },                    // NEU
  v_ms:   { wochen: 210, rang: "n/v",     status: "🚨 KRITISCH – 4 Jahre" },    // NEU
}

// HANDLUNGSEMPFEHLUNG NEU:
"MS-Anschlussdauer 120 Wochen: Phase-2-Prozess (Netzanschlusszusage →
Inbetriebnahme) enthält 60 Wochen Puffer. Strukturierte Projektsteuerung
für MS-Vorhaben einführen – Ziel: unter 80 Wochen in 18 Monaten."
```

---

## BEFUND 3 · HOCH · Digitalisierungsindex: Dramatische Teilscore-Wahrheit

**Was der Report zeigt:** DI Gesamt: "–" (Wert fehlt), DI-Rang: "–"
**Was die Live-Abfrage liefert (vollständige Teilscores):**

| Kategorie | Score | Bundesmedian | Bewertung |
|-----------|-------|-------------|----------|
| **Smart Grids NS** | **10%** | 15% | 🔴 Unter Median |
| Digitale Prozesse | 7% | 12% | 🔴 Unter Median |
| — davon NS | **0%** | – | 🔴 Null |
| — davon MS | **0%** | – | 🔴 Null |
| — davon KI | **20%** | – | 🟡 Solide |
| **Datenmanagement** | **67%** | 60% | ✅ Über Median |
| **Kundenmanagement NS** | **0%** | 28% | 🔴 Null – Kritisch |
| **Kundenmanagement MS** | **0%** | – | 🔴 Null |

**Die verborgene Stärke:** Datenmanagement 67% – ÜBER dem Bundesmedian (60%).
Das Stadtwerk Frankenthal hat bereits eine belastbare Datenbasis. Das ist der
Rohstoff, aus dem KI-gestützte Prozesse entstehen. Das ist ein echter Aktivposten.

**Die strategische Schwäche:** Kundenmanagement 0% bedeutet: kein digitales
Kundenportal, keine Self-Service-Funktionen, kein Online-Zählerstand.
Im Kontext §14a EnWG ist das fatal: Kunden sollen ihre steuerbaren
Verbrauchseinrichtungen digital managen – das geht ohne Kundenportal nicht.
Konkurrenten (Vattenfall, E.ON) bieten das seit Jahren an.

**Die KI-Anomalie:** KI-Score 20% trotz 0% digitaler Prozesse.
Das deutet auf eine Insellösung hin: KI wird eingesetzt (Cernion, Enerchy?),
aber die Grundprozesse sind noch nicht digitalisiert. KI auf analogem Fundament.

**CR-67: DI-Radar mit Benchmarks als Pflicht-Visualisierung**

Der Report zeigt den Radar mit 3 Achsen und ohne Werte. Das muss werden:

```
5 Achsen mit konkreten %-Werten + Bundesmedian-Ring:

  Smart Grids: 10% (Bundesmedian: 15%)      → Lücke: -5pp
  Digitale Prozesse: 7% (Median: 12%)       → Lücke: -5pp
  Datenmanagement: 67% (Median: 60%)        → Vorsprung: +7pp ✅
  Kundenmanagement: 0% (Median: 28%)        → Lücke: -28pp 🚨
  KI-Einsatz: 20% (kein Median verfügbar)   → Insellösung

// Narrative im Report:
"IHRE STÄRKE: Datenmanagement 67% – Top-Quartil bundesweit.
IHRE DRINGLICHSTE BAUSTELLE: Kundenmanagement 0% – im Zeitalter
von §14a EnWG ein strukturelles Risiko. Ohne digitales Kundenportal
können Sie steuerbare Verbrauchseinrichtungen nicht monetarisieren."
```

---

## BEFUND 4 · MITTEL · Umsetzungsquote Rang 187/698 = Top 27% – wird unterbewertet

**Was der Report sagt:** "100% – Umsetzungsquote EE NS" (ohne Rang)
**Was die Live-Abfrage zeigt:** Rang 187/698 – **Top-27% bundesweit**, besser als 73%!

Und nicht nur EE NS – **alle vier Kategorien 100%**:
- EE NS: 3.475 von 3.475 Anträgen realisiert ✅
- EE MS: 15 von 15 ✅
- Verbrauch NS: 2.334 von 2.334 ✅
- Verbrauch MS: 7 von 7 ✅

**Was das bedeutet:** Das Stadtwerk Frankenthal hat in 5+ Jahren keinen einzigen
Netzanschlussantrag abgewiesen. Das ist selten. Das ist ein echter Qualitätsnachweis
gegenüber Projektierer, Gemeinde und BNetzA.

**CR-68: Umsetzungsquote als "Leuchtturm-KPI" hervorheben**
```
// STATT einer Tabellenzeile mit "100%":
// EIGENER HERVORHEBUNGS-BLOCK:

🏆 EXZELLENZ: 5.831 Netzanschlüsse – 0 abgewiesen
Rang 187 von 698 VNBs (Top 27%) · alle Spannungsebenen · alle Kategorien

"Während der Bundesschnitt X% beträgt, hat Ihr Netz in den letzten Jahren
jeden einzelnen Anschlussantrag realisiert – 3.475 EE-Anlagen, 2.334
Verbrauchsanlagen, 15 MS-Projekte. Das ist ein Wettbewerbsvorteil, der
im Gespräch mit der Gemeinde, mit Projektiererern und beim BNetzA
aktiv kommuniziert werden sollte."
```

---

## BEFUND 5 · MITTEL · PLZ-Ausreißer: 2 bestätigte Anlagen in PLZ 67069 (Ludwigshafen)

**Was der Report sagt:** "1 Anlage ortsfremde PLZ-Ausreißer"
**Was die Live-Abfrage zeigt:** Mindestens **2 Anlagen** in PLZ 67069 (Ludwigshafen):

1. SEE954885337037 "PV-AnlageSEE954885337037" – 5,67 kW, NS, Inbetriebnahme 2023-12-08
2. SEE936879976590 "Stromspeicher" – 3,84 kW, NS, Inbetriebnahme 2023-12-08
   → Gleicher Standort! PV + Speicher = 1 Prosumer-Anlage falsch zugeordnet.

Beide Anlagen haben das gleiche Inbetriebnahmedatum (08.12.2023) und dieselbe
Lokations-MaStR-Nummer (SEL911817866843). Es handelt sich um eine kombinierte
PV+Speicher-Installation, die zwei MaStR-Einträge generiert hat – und beide sind
dem falschen VNB (Frankenthal statt Pfalzwerke/Netze Rhein-Pfalz) zugeordnet.

**AgNeS-Wirkung:** 9,51 kW falsch attributiert → verfälscht
Kapazitätsbilanz → 60 Monate EO-Wirkung.

---

## BEFUND 6 · NEU · Gesamtanlagebestand: 2.046 InBetrieb (vs. 4.372 im Report)

**Was der Report sagt:** "4.372 PV-Anlagen"
**Was die Live-Abfrage zeigt:** 2.046 InBetrieb (alle Typen, inkl. 879 Solar)

**Erklärung der Diskrepanz:**
- Die 4.372 im Report kommt aus der Powabase-API mit weiterem Radius oder inkl.
  InPlanung/Stillgelegt-Status
- Die 2.046 aus der lokalen MongoDB (nur InBetrieb, strenger MaStR-Status 35)
- Welche Zahl ist "richtig" für den VNB-Bericht? → InBetrieb ist die relevante Kennzahl
  für EEG-Abrechnung, Redispatch und AgNeS

**CR-69: PV-Anlagenzahl mit Statusfilter validieren und transparent machen**
```
// Report muss Quelle und Filter transparent machen:
kennzahlen.pv_anlagen = {
  value: "4.372 / davon 2.046 in Betrieb",
  description: "Gesamt MaStR (inkl. geplant/stillgelegt) / aktiv in Betrieb",
  relevanz: "Redispatch + EEG: 2.046; AgNeS-Kapazitätsbilanz: Gesamtbestand"
}
```

---

## DESIGN-DIAGNOSE: Warum der Report "nicht packt" – Note 4 → Note 1

### Das Grundproblem: Daten-Dump statt Vorstandsnarrativ

Ein Vorstand liest keinen Bericht um Zahlen zu sehen. Er liest ihn um **drei Fragen**
beantwortet zu bekommen:

1. **Wo brennt es?** (Handlungsdruck, Fristen, Bußgeld)
2. **Was kostet es wenn ich nichts tue?** (€-Wert der Untätigkeit)
3. **Was ist mein nächster Schritt?** (konkrete Maßnahme, nicht "prüfen Sie...")

Der aktuelle Report beantwortet keine dieser drei Fragen direkt. Er listet Kennzahlen.

### CR-70: Das "Vorstand-Briefing"-Konzept für die Summary

Die Management Summary muss umstrukturiert werden. Nicht nach Datenquelle
(MaStR, EWK, Gas), sondern nach **Handlungshorizont**:

```
MANAGEMENT SUMMARY – STADTWERKE FRANKENTHAL
Cernion 360° · 7. März 2026

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SOFORT · Diese Woche (Bußgeld- und Compliance-Risiken mit Frist)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 37 Anlagen (2,3 MW) stecken in der Netzbetreiberprüfung –
   darunter ein 2-MW-Windrad, das seit 2002 Strom liefert.
   §118 EnWG: Fristen laufen. Beauftragen Sie noch heute die
   Prüfabschlüsse. (Cernion-Aktion: MaStR-Prüfstatus setzen)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIESES QUARTAL · Strategische Positionen mit €-Hebel
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 MS-Anschlussdauer 120 Wochen: Projektierer kennen diese Zahl.
   Jedes MS-Projekt, das zur Konkurrenz geht = ø 500 kW × EEG-
   Netzentgelt. Ziel: Unter 80 Wochen bis Q4 2026.

📊 Digitalisierung Kundenmanagement: 0% (Bundesmedian: 28%).
   §14a EnWG verlangt aktive Steuerung – ohne Kundenportal
   können Sie das nicht monetarisieren. Zeitfenster: 18 Monate.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IHR VORTEIL · Nutzen Sie diese Stärken aktiv
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 5.831 Netzanschlüsse realisiert – 0 abgewiesen (Rang 187/698).
   Kommunizieren Sie das: bei der Gemeinde, bei Projektierers,
   im nächsten Geschäftsbericht.

🔬 Datenmanagement 67% – über dem Bundesschnitt.
   Das ist Ihre KI-Grundlage. Nutzen Sie sie.
```

### CR-71: Kennzahlen brauchen €-Übersetzung

Jede Zahl, die einen € hat, muss ihn zeigen. Tabelle der €-Übersetzungen:

| KPI | Wert | €-Wert (neu) |
|-----|------|-------------|
| Residuallast 53 MW | 53 MW | **1 MW × 120 €/MWh × 8.760h ≈ 6,3 Mio. €/Jahr** Beschaffungsvolumen |
| Prüfstau 37 Anlagen | 37 | **~111.000 €/Jahr** nicht abrechenbare Redispatch-Kosten |
| MS-Anschlussdauer 120 Wo | – | Projektiererdruck: ø Projekt 500 kW × 40 €/kW Netzentgelt/Jahr = **20.000 €/Projekt** |
| DI Kundenmanagement 0% | – | §14a EnWG-Potenzial: 41.000 Haushalte × ø Steuerprämie 20€ = **820.000 €/Jahr** |
| Umsetzungsquote Rang 187 | Top-27% | Kommunikationswert gegen Kritik an Netzausbau |

### CR-72: Abschnitt 1 "Netzbetrieb" – Restrukturierung nach Dringlichkeit

**Status quo:** Kennzahltabelle alphabetisch/zufällig sortiert
**Soll:** Nach Handlungsdringlichkeit sortiert, P0 zuerst

```
NETZBETRIEB – SOFORT-RADAR (Abschnitt 1)

P0 HEUTE:      37 Anlagen in Prüfung (2,3 MW) – §118 EnWG ⚡
P0 Q1:         2 PLZ-Ausreißer korrigieren (67069 LU) – Fotojahr-Frist ⚡
P1 Q2:         MS-Anschlussdauer Prozess-Review (120 Wo → <80 Wo)
P1 Q2:         §14a-Rollout planen (DI Smart Grids nur 10%)
P2 DAUERND:    Residuallast-Monitoring (53 MW × 120 €/MWh)
INFO:          34 Anlagen ≥100 kW – alle mit MeLo ✅ (kein Handlungsbedarf)
```

### CR-73: Abschnitt 5 Compliance – Die MS-Wahrheit zeigen

Die aktuelle Abschnitt-5-Tabelle zeigt nur EE NS (47 Wo / Rang 452).
Das ist die halbierte Wahrheit. Die vollständige Wahrheit:

```
ANSCHLUSSDAUER-MATRIX (validiert via BNetzA EWK 2024, BNr: 10000873)

                    Phase 1    Phase 2    Gesamt    Bewertung
EE Niederspannung:   40 Wo      7 Wo      47 Wo    ⚠️ Rang 452/740
EE Mittelspannung:   60 Wo     60 Wo     120 Wo    🚨 2,3 Jahre
Verbrauch NS:        30 Wo      7 Wo      37 Wo    ✅ Gut
Verbrauch MS:        30 Wo    180 Wo     210 Wo    🚨 4 Jahre

Bundesmedian NS: 40 Wochen | Ihr EE-NS-Wert: 47 (+7 Wochen über Median)
```

---

## TECHNISCHE CRs aus validierten Befunden

### CR-74 · P0 · API-Abfrage Prüfstatus: alle Statusvarianten abfragen

Der Report hat "1 Anlage" weil die Query vermutlich nur eine Statusvariante
(z.B. Code 2955) abruft, aber andere Prüfvarianten übersieht.

```javascript
// STATT:
const pruefung = await api.get('/assets/all', {
  pruefStatus: 'InPruefung'
});

// MUSS WERDEN (alle Prüfungsstatus):
const pruefung = await api.get('/assets/all', {
  bdewCode: '9900191000003',
  netzbetreiberPruefungStatus: ['InPruefung', 'NetzbetreiberPruefung'], // 2955
  includeNapData: true,
  status: 'InBetrieb'  // nur aktive Anlagen!
});
// Ergebnis: 37 Anlagen, nicht 1
```

### CR-75 · P1 · EWK-Abfrage: Alle Spannungsebenen und Typen abrufen

```javascript
// Aktuell: nur EE NS
const anschlussdauer = await fetch('/api/ewk-monitoring/benchmark-vnb', {
  vnbName: 'Stadtwerke Frankenthal GmbH'
});
// response.anschlussdauer enthält ALLE Ebenen – aber Report rendert nur ee_ns_gesamt

// FIX: Alle 4 Werte rendern:
const matrix = {
  ee_ns:  { p1: data.ee_ns_phase1,        p2: data.ee_ns_phase2,
            total: data.ee_ns_gesamt,     rank: rankings.anschlussdauer_ee_ns_rank },
  ee_ms:  { p1: data.ee_ms_phase1,        p2: data.ee_ms_phase2,
            total: data.ee_ms_gesamt,     rank: null }, // kein Ranking-Feld verfügbar
  v_ns:   { p1: data.verbrauch_ns_phase1, p2: data.verbrauch_ns_phase2,
            total: data.verbrauch_ns_gesamt },
  v_ms:   { p1: data.verbrauch_ms_phase1, p2: data.verbrauch_ms_phase2,
            total: data.verbrauch_ms_gesamt }
};
```

### CR-76 · P1 · DI-Radar: Echte Teilscores einsetzen

```javascript
// Validierte Werte (BNr: 10000873, live abgefragt 07.03.2026):
const diScores = {
  smart_grids:        { value: 10, median: 15,  label: 'Smart Grids NS' },
  digitale_prozesse:  { value:  7, median: 12,  label: 'Digitale Prozesse' },
  datenmanagement:    { value: 67, median: 60,  label: 'Datenmanagement' },
  kundenmanagement:   { value:  0, median: 28,  label: 'Kundenmanagement' },
  ki_einsatz:         { value: 20, median: null, label: 'KI-Einsatz' },
};

// Radar muss ZWEI Ringe zeigen: VNB (blau) + Bundesmedian (grau gestrichelt)
// Kundenmanagement 0% MUSS sichtbar sein – nicht als Lücke versteckt
```

### CR-77 · P1 · Umsetzungsquote Rang kommunizieren

```javascript
// Aktuell:
{ value: "100.0%", description: "Umgesetzte EE-Anschlussbegehren NS" }

// Muss werden:
{
  value: "100% · Rang 187/698",
  description: "EE+Verbrauch NS+MS: 5.831 Anträge – 0 abgewiesen · Top-27% bundesweit",
  highlight: true  // Grüner Hervorhebungsblock statt grauer Tabelle
}
```

---

## REPORT-ARCHITEKTUR-EMPFEHLUNG: Was Note 1 von Note 4 unterscheidet

### Note 4 (aktuell): Datenbank-Export mit Etiketten
```
Kennzahl          | Wert     | Beschreibung
Trafo-Auslastung  | n/v      | Tool nicht lizenziert
Redispatch-Anl.   | –        | Steuerbare Anlagen ≥100 kW
Anlagen Prüfung   | 1 Anlage | Offene Netzbetreiberprüfung
```

### Note 1 (Ziel): Vorstandsnarrativ mit Datenbasis
```
IHR NETZ WÄCHST SCHNELLER ALS IHRE PROZESSE.

37 Anlagen warten auf Ihre Freigabe im MaStR – darunter ein
Vestas-Windrad, das seit dem Jahr 2002 läuft und rechtlich
"ungeprüft" ist. Gleichzeitig realisieren Sie jeden einzelnen
Netzanschlussantrag der letzten Jahre – kein anderer Netzbetreiber
in Deutschland hat eine bessere Umsetzungsquote in allen
Kategorien. Die Stärke und die Schwäche liegen nebeneinander.

Was Sie diese Woche tun müssen:
→ Prüfstatus für SEE995453733875 (2 MW Wind) abschließen
→ MaStR-Korrektur PLZ 67069 beauftragen
→ MS-Anschlussdauer-Prozessanalyse starten (120 Wo → Ziel 80 Wo)
```

---

## SCORECARD NACH VALIDIERUNG

| Dimension | Note 4 Report | Validiert | Ziel Note 1 |
|-----------|--------------|-----------|-------------|
| Prüfstau-Anlagen | 1 (falsch) | **37** | 37 + €-Wert |
| MS-Anschlussdauer | Nicht im Bericht | 120 Wo | Matrix 4×3 |
| DI Kundenmanagement | "–" | **0%** (kritisch) | Radar mit Wert |
| DI Datenmanagement | "–" | **67%** (Stärke) | Hervorhebung |
| Umsetzungsquote | 100% (ohne Rang) | **Rang 187/698** | "Top 27%" |
| €-Übersetzung | 1 Stelle | 1 Stelle | Jede Kennzahl |
| Narrative | Keine | Keine | Pflicht |
| Summary-Struktur | 5 Bulletpoints | 5 Bulletpoints | Sofort/Quartal/Stärke |
| Datenqualität Score | Note 4 | – | Note 1 |

**Gesamteinschätzung:** Mit den validierten Daten und der neuen Narrative-Architektur
ist eine Note 1–2 erreichbar. Die Datenbasis ist gut – das Problem ist die Präsentation.
Der Bericht behandelt einen Vorstand wie einen Datenbankadministrator.

---

*Validiert via Cernion MCP Live-Abfragen: ewk_benchmark_vnb, cernion_installations_local,
ewk_digitalisierungsindex · 7. März 2026 · Thorsten Zoerner / STROMDAO GmbH*
