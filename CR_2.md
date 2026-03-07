# CR_360_DomainKnowledge_Vorstand_NEST.md
## Change Requests CR-78 bis CR-90
## Thema: Vorstandsaufklärung · NEST-Erklärung · Schocker-Didaktik · Next-Steps-Modul

**Grundthese dieser CR-Gruppe:**
Der 360° Report muss drei Rollen gleichzeitig erfüllen, die heute alle fehlen:
1. **Aufklärer** – erklärt dem Vorstand regulatorische Zusammenhänge die er nicht kennt
2. **Ankläger** – zeigt konkrete Missstände mit Namen, Zahlen, Konsequenz
3. **Coach** – liefert den nächsten Schritt, nicht die nächste Analyse

Ein Report, der einen Berater braucht um ihn zu erklären, ist kein Produkt – er ist ein Entwurf.

---

## CR-78 · P0 · NEST-Erklärbaustein: "Was bedeutet das für Sie?"

### Das Problem
Jeder Stadtwerke-Vorstand hat von NEST gehört. Die wenigsten wissen, was er konkret für ihre Erlösobergrenze bedeutet. Der Report erwähnt "NEST-Compliance ✓ Bericht verfügbar" – ohne zu erklären, was das ist oder was passiert wenn es fehlt. Ein Vorstand, der das nicht weiß, kann seine Mitarbeiter nicht challengen.

### CR-78: NEST-Erklärbaustein als eigener Abschnitt (nicht Fußnote)

**Wo:** Abschnitt 5 "Regulierung & Compliance", als einleitende Erklärbox VOR der Kennzahltabelle.

**Inhalt (Domain Knowledge für den Report Generator):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WIE DIE REGULIERUNG IHR BUDGET BESTIMMT
(Lesen Sie dies, wenn Sie noch nicht im Detail stecken)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Die BNetzA legt alle 5 Jahre fest, wieviel Geld Sie als
Netzbetreiber einnehmen dürfen – die sogenannte Erlösobergrenze (EO).
Wie hoch diese ist, bestimmt direkt Ihr Investitionsbudget.

Die Entscheidung fällt nicht willkürlich. Sie basiert auf einem
Effizienzvergleich: Die BNetzA misst alle ~740 deutschen VNBs
mit demselben Maßstab (AgNeS-Effizienzwert) und belohnt die
Besten mit einer höheren EO.

Das EWK-Monitoring ist das Messgerät der BNetzA.
Es misst jährlich drei Dinge:
  → Wie schnell schließen Sie neue Anlagen an? (Anschlussdauer)
  → Wie digital sind Ihre Prozesse?          (Digitalisierungsindex)
  → Realisieren Sie alle Anträge?             (Umsetzungsquote)

NEST ist das Verfahren, mit dem die BNetzA aus diesen Werten
Ihre individuelle Erlösobergrenze für die nächste Regulierungsperiode
(5 Jahre) berechnet.

FÜR STADTWERKE FRANKENTHAL KONKRET:
  Ihr EWK-Rang: 452 / 740 (unteres Mittelfeld)
  Das bedeutet: Sie bekommen eine niedrigere EO als die ~290 VNBs
  die besser performen. Jeder Platz den Sie gewinnen = mehr Budget
  für Kabel, Trafos und Speicher – ohne Antrag, ohne Verhandlung.

Die einzige Frage ist: Wo verlieren Sie aktuell die meisten Punkte?
Die Antwort steht unten.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Implementierungshinweis:** Dieser Text ist STATISCH für alle Stadtwerke-Reports.
Nur die Werte (Rang 452/740, "~290 VNBs besser") werden dynamisch befüllt.
Der Erklärtext selbst ändert sich nicht – er ist Domain Knowledge.

---

## CR-79 · P0 · Die NEST-Kausalitätskette als Visualisierung

### Das Problem
EWK → AgNeS → NEST → EO → Budget: Diese Kette ist für Vorstände unsichtbar.
Ohne sie erscheinen EWK-Kennzahlen als bürokratische Pflichtübung, nicht als Hebel.

### CR-79: Pflicht-Infografik in Abschnitt 5 (generiert, nicht als Bild)

```
IHRE REGULIERUNGSKAUSALITÄT – STADTWERKE FRANKENTHAL

[BNetzA misst jährlich]
        ↓
┌─────────────────────────────────────────────────────────┐
│ EWK-MONITORING 2024 (Ihr aktueller Stand)               │
│                                                          │
│  Anschlussdauer NS:  47 Wo  → Rang 452/740  ⚠️          │
│  Digitalisierung DI: —      → Rang —/656    ❓           │
│  Umsetzungsquote:   100%    → Rang 187/698  ✅          │
└─────────────────────────────────────────────────────────┘
        ↓ fließt ein in
┌─────────────────────────────────────────────────────────┐
│ AgNeS-EFFIZIENZWERT (BNetzA Beschlusskammer 8)          │
│  Ihr Wert: individuell bei BNetzA BK8 abrufbar          │
│  Benchmark: 740 VNBs werden verglichen                   │
│  Wer effizienter ist: bekommt mehr EO                    │
└─────────────────────────────────────────────────────────┘
        ↓ bestimmt
┌─────────────────────────────────────────────────────────┐
│ ERLÖSOBERGRENZE (EO) – Ihre Einnahmegrenze              │
│  Gilt für: 5 Jahre (aktuelle Periode läuft bis ~2028)   │
│  Jeder verlorene EWK-Rangplatz = weniger Budget          │
└─────────────────────────────────────────────────────────┘
        ↓ definiert
┌─────────────────────────────────────────────────────────┐
│ IHR INVESTITIONSBUDGET                                   │
│  CAPEX für: Kabel · Trafos · Speicher · Digitalisierung  │
│  NEST-Förderantrag: §11 Abs. 2 EnWG Engpassnachweis      │
└─────────────────────────────────────────────────────────┘

FAZIT: Ihre EWK-Kennzahlen von heute sind Ihr Budget von morgen.
       Der Zeitverzug beträgt 1–3 Jahre.
```

**Technische Umsetzung:** HTML-Flowchart mit dynamischen Werten, kein Bildasset.
Alle Werte kommen aus EWK-API-Response – statische Texte hard-coded als Template.

---

## CR-80 · P0 · "SCHOCKER"-Modul: Konkreter Name, konkrete Zahl, konkrete Konsequenz

### Das Problem
Der Report sagt "1 Anlage in Netzbetreiberprüfung". Ein Vorstand liest das als Routinehinweis. Die Realität: 37 Anlagen, darunter ein 23 Jahre altes Windrad mit 2 MW, das rechtlich "ungeprüft" ist. Das muss ankommen.

### Didaktisches Prinzip für den Report Generator

Jeder Befund, der ein Compliance-Risiko oder einen €-Hebel über 10.000 €/Jahr darstellt,
muss im Format "SCHOCKER" aufbereitet werden:

```
FORMAT: SCHOCKER-BLOCK

╔══════════════════════════════════════════════════════════════╗
║ 🚨 [TITEL IN EINEM SATZ]                                     ║
╠══════════════════════════════════════════════════════════════╣
║ WAS IST PASSIERT:                                            ║
║  [Sachverhalt in 2 Sätzen, ohne Fachbegriffe]               ║
║                                                              ║
║ EIN KONKRETES BEISPIEL AUS IHREM NETZ:                       ║
║  [Anlage/Ort/Datum – kein Abstraktum]                        ║
║                                                              ║
║ WAS PASSIERT WENN SIE NICHTS TUN:                            ║
║  [Bußgeld / Erlösobergrenze / Reputationsschaden – €-Wert]  ║
║                                                              ║
║ WAS SIE DIESE WOCHE TUN KÖNNEN:                              ║
║  [1 konkreter Schritt, 1 Verantwortlicher, 1 Frist]         ║
╚══════════════════════════════════════════════════════════════╝
```

### Anwendung: SCHOCKER #1 – Prüfstau (37 Anlagen, validiert via MCP)

```
╔══════════════════════════════════════════════════════════════╗
║ 🚨 37 ANLAGEN WARTEN AUF IHRE FREIGABE – DARUNTER EIN       ║
║    WINDRAD DAS SEIT 2002 LÄUFT                               ║
╠══════════════════════════════════════════════════════════════╣
║ WAS IST PASSIERT:                                            ║
║  Im deutschen Marktstammdatenregister (MaStR) stehen         ║
║  37 Ihrer Anlagen als "in Prüfung" – sie speisen Strom       ║
║  ein, haben alle nötigen Zähler, aber den offiziellen        ║
║  Abschluss der Netzbetreiberprüfung fehlt noch.              ║
║  Vermutlich ein Migrationsfehler bei der MaStR-Einführung    ║
║  2019 – die Anlagen wurden automatisch als "zu prüfen"       ║
║  markiert und danach nie abgeschlossen.                       ║
║                                                              ║
║ EIN KONKRETES BEISPIEL AUS IHREM NETZ:                       ║
║  Windkraftanlage "13458" in Heuchelheim bei Frankenthal:     ║
║  Vestas V-80, 2.000 kW, seit 29. Dezember 2002 in Betrieb.  ║
║  MaStR-Nummer: SEE995453733875                               ║
║  Diese Anlage erzeugt seit 23 Jahren Strom in Ihrem Netz     ║
║  – rechtlich ist die Netzbetreiberprüfung noch offen.        ║
║                                                              ║
║ WAS PASSIERT WENN SIE NICHTS TUN:                            ║
║  §118 EnWG: Bußgeld bei Fristüberschreitung (4 Wo NS,        ║
║  6 Wo MS). Fotojahr 2026: Offene Prüfungen verschlechtern    ║
║  Ihre EWK-Umsetzungsquote → direkter Einfluss auf Ihre       ║
║  Erlösobergrenze für die nächste Regulierungsperiode.        ║
║  Auch: Redispatch-Kosten für die Windanlage (2 MW ×          ║
║  §12 StromNZV ≈ 6.000 €/Jahr) sind nicht abrechenbar        ║
║  solange die Prüfung offen ist.                              ║
║                                                              ║
║ WAS SIE DIESE WOCHE TUN KÖNNEN:                              ║
║  Beauftragen Sie Ihren MaStR-Beauftragten: Prüfstatus        ║
║  für SEE995453733875 und alle 36 weiteren Anlagen auf        ║
║  "Geprüft" setzen. Aufwand: ca. 2 Stunden. Frist: 14 Tage. ║
╚══════════════════════════════════════════════════════════════╝
```

### Anwendung: SCHOCKER #2 – Verbrauch MS 210 Wochen (validiert via MCP)

```
╔══════════════════════════════════════════════════════════════╗
║ 🚨 EIN INDUSTRIEKUNDE BRAUCHT IN IHREM NETZ 4 JAHRE FÜR     ║
║    EINEN STROMANSCHLUSS – IN WAIBLINGEN SIND ES 4 WOCHEN    ║
╠══════════════════════════════════════════════════════════════╣
║ WAS IST PASSIERT:                                            ║
║  Für Verbrauchsanlagen in Mittelspannung (große Wärme-       ║
║  pumpen, Elektrolyseure, Industriespeicher über 100 kW)      ║
║  beträgt Ihre mediane Anschlusszeit 210 Wochen – das sind    ║
║  vier Jahre. Der deutsche Bundesmedian liegt bei 111 Wo.     ║
║  Stadtwerke Waiblingen schafft dasselbe in 4 Wochen.         ║
║                                                              ║
║ WAS DAS FÜR EINEN PROJEKTENTWICKLER BEDEUTET:               ║
║  Ein Projektierer plant eine 500 kW Industrie-Wärmepumpe    ║
║  in Frankenthal. Er fragt bei Ihnen an: "Wann ist der        ║
║  Anschluss möglich?" Ihre Antwort: frühestens 2030.         ║
║  Er geht zum nächsten Netzbetreiber.                         ║
║  Sie verlieren: Netzentgelt, EEG-Abrechnung, Kundenbindung. ║
║                                                              ║
║ WAS PASSIERT WENN SIE NICHTS TUN:                            ║
║  Frankenthal wird als "langsam" bekannt in der Projektier-   ║
║  community. Das ist kein Bußgeld – aber es kostet Sie        ║
║  systematisch Projekte. EWK-Einfluss: Phase-2-Dauer          ║
║  (180 Wochen!) fließt in Ihren Rang ein → EO-Druck.         ║
║                                                              ║
║ WAS SIE DIESES QUARTAL TUN KÖNNEN:                           ║
║  Process Review Phase 2 (Zusage → Inbetriebnahme): Wo        ║
║  liegen die 180 Wochen? Bauplanung? Materialbeschaffung?     ║
║  Kapazität Netzplanung? Das ist ein 2-Tages-Workshop.        ║
║  Ziel: 80 Wochen bis Q4 2026. Benennen Sie einen Owner.     ║
╚══════════════════════════════════════════════════════════════╝
```

### Anwendung: SCHOCKER #3 – Kundenmanagement 0% im §14a-Kontext

```
╔══════════════════════════════════════════════════════════════╗
║ 🚨 §14a EnWG VERLANGT DIGITALES KUNDENMANAGEMENT –          ║
║    IHR SCORE IST 0%. BUNDESMEDIAN: 28%                       ║
╠══════════════════════════════════════════════════════════════╣
║ WAS IST PASSIERT:                                            ║
║  §14a EnWG verpflichtet Sie, steuerbare Verbrauchsein-       ║
║  richtungen (Wärmepumpen, Wallboxen, Klimaanlagen >2 kW)    ║
║  aktiv zu managen – zu drosseln wenn das Netz es braucht,   ║
║  und Kunden dafür zu vergüten. Das funktioniert nur über     ║
║  ein digitales Kundenportal + SMGW. Ihr Kundenmanagement-   ║
║  Score im BNetzA-Monitoring: 0%. Bundesmedian: 28%.          ║
║                                                              ║
║ WAS DAS KONKRET BEDEUTET:                                    ║
║  In Ihrem Netzgebiet leben 41.000 Haushalte. Bis 2030        ║
║  werden schätzungsweise 10–20% Wärmepumpen oder E-Autos      ║
║  betreiben. Ohne digitales Steuerungssystem können Sie        ║
║  diese nicht koordinieren. Sie müssen dann teuer Netz        ║
║  ausbauen (Kabel, Trafos) was Sie ohne §14a nicht bräuchten. ║
║                                                              ║
║ DAS IHNEN ENTGEHENDE GELD:                                   ║
║  §14a Steuerprämie: bis 110 €/kW/Jahr pro Anlage.           ║
║  Bei 1.000 steuerbaren Wallboxen/WPs à 11 kW:                ║
║  = potenziell 1,2 Mio. €/Jahr vermiedener CAPEX +           ║
║    direkte Erlöse durch Netzentlastung.                       ║
║                                                              ║
║ WAS SIE DIESES JAHR TUN KÖNNEN:                              ║
║  Schritt 1 (heute): Cernion §14a-Audit: welche steuerbaren  ║
║  Anlagen sind bereits im Netz, keine MeLo → keine Prämie.   ║
║  Schritt 2 (Q2): Kundenportal-Pflichtenheft beauftragen.    ║
║  Schritt 3 (Q4): SMGW-Rolloutplan mit MSB abstimmen.        ║
╚══════════════════════════════════════════════════════════════╝
```

---

## CR-81 · P0 · NEXT STEPS-Modul als Pflichtbaustein am Ende jedes Reports

### Das Problem
Der Report endet mit Abschnitt 8 "Digitalisierung". Es gibt keine Synthese, keinen Fahrplan, keine priorisierten Maßnahmen. Ein Vorstand legt den Report weg ohne zu wissen, was er morgen früh seinem Team sagen soll.

### CR-81: "IHR NÄCHSTER MONAT" – Milestone-Tabelle als Abschluss

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IHR AKTIONSPLAN – NÄCHSTE 90 TAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WOCHE 1–2: Compliance bereinigen (kein Budget nötig)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ MaStR-Prüfstatus: 37 Anlagen abschließen (SEE995453733875 zuerst)
  → Owner: [Netzplanung/MaStR-Beauftragter]
  → Frist: 21. März 2026 (§118 EnWG)
  → Cernion-Hilfe: MaStR-Prüfstatus-Export → Massenaktion

□ PLZ-Ausreißer: 2 Anlagen in PLZ 67069 (Ludwigshafen) korrigieren
  → Owner: [Netzplanung]
  → Frist: 31. März 2026 (Fotojahr-Frist)
  → Impact: AgNeS-Kapazitätsbilanz (60 Monate EO-Wirkung)

MONAT 1: Strategische Analyse (1–2 Arbeitstage)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ MS-Anschlussdauer Phase 2: Workshop "Wo sind die 180 Wochen?"
  → Owner: [Betriebsleiter Netz]
  → Ziel: Root Cause für Verbrauch MS 210 Wo identifizieren
  → Benchmark: Waiblingen 4 Wo – fragen Sie: was machen die anders?

□ §14a EnWG Bestandsaufnahme: Wie viele Wallboxen/WPs im Netz?
  → Owner: [Cernion via MCP in 5 Minuten abrufbar]
  → Frist: vor Q2-Budgetrunde

MONAT 2–3: Investitionsentscheidungen vorbereiten
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Kundenportal-Entscheidung: Eigenlösung vs. Kooperationsmodell
  → Budget-Implikation: 200–500 k€ Einmalaufwand
  → §14a-Gegenrechnung: bis 1,2 Mio. €/Jahr vermiedener CAPEX

□ NEST-Strategie: EWK-Rang 452 → Ziel-Rang 350 in 2 Jahren
  → Primärer Hebel: Anschlussdauer NS (Phase 1: 40 Wo → 25 Wo)
  → Sekundärer Hebel: DI Digitale Prozesse (7% → 25%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IHRE STÄRKEN: KOMMUNIZIEREN SIE DIESE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 5.831 Netzanschlüsse realisiert – 0 abgewiesen (Top 27%)
   → Nächste Gemeinderatssitzung: diese Zahl aktiv einbringen
   → Nächster Jahresbericht: als Kennzahl aufführen

✅ Datenmanagement 67% – über Bundesschnitt (60%)
   → Das ist Ihr KI-Rohstoff. Bereits für Cernion-Reports genutzt.
   → Nächster Schritt: auch Kundenmanagement-Prozesse digitalisieren
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## CR-82 · P1 · Domain Knowledge Layer: Automatische €-Übersetzung aller KPIs

### Das Problem
KPIs ohne €-Wert sind für Vorstände wertlos. Der Report nennt "Rang 452/740" – aber nicht was das in Euro bedeutet.

### CR-82: Pflicht-€-Übersetzung für 8 Schlüssel-KPIs

Der Report Generator muss folgende Berechnungen **automatisch** durchführen und ausgeben:

```javascript
// DOMAIN KNOWLEDGE: €-Formeln die der Generator kennen MUSS

const euroTranslations = {

  // 1. RESIDUALLAST → BESCHAFFUNGSVOLUMEN
  residuallast_mw: (mw, dayAheadPrice) => ({
    label: "Jahresbeschaffungsvolumen",
    calc: `${mw} MW × ${dayAheadPrice} €/MWh × 8.760 h`,
    value: mw * dayAheadPrice * 8760,
    einheit: "€/Jahr",
    hinweis: "1% Beschaffungsoptimierung = " + Math.round(mw * dayAheadPrice * 8760 * 0.01) + " €"
  }),

  // 2. REDISPATCH OHNE MELO → NICHT ABRECHENBARE KOSTEN
  anlagen_ohne_melo: (count) => ({
    label: "Nicht abrechenbare Redispatch-Kosten",
    calc: `${count} Anlagen × 3.000 €/Anlage/Jahr`,
    value: count * 3000,
    einheit: "€/Jahr",
    rechtsgrundlage: "§12 StromNZV"
  }),

  // 3. EWK-RANG → ERLÖSOBERGRENZE-IMPLIKATION
  ewk_rang: (rang, total) => {
    const percentile = rang / total;
    if (percentile > 0.75) return {
      status: "KRITISCH",
      text: `Rang ${rang}/${total} (Bottom-25%) – EO-Absenkung bei nächster Regulierungsperiode möglich`
    };
    if (percentile > 0.50) return {
      status: "WARNUNG",
      text: `Rang ${rang}/${total} (50–75%) – EO-Druck möglich.
             ${Math.round((rang - total*0.5))} Plätze bis Mittelfeld.`,
      // WICHTIG: konkreter Platz-Abstand, nicht nur "möglich"
    };
    return { status: "OK", text: `Rang ${rang}/${total} – obere Hälfte, kein EO-Risiko` };
  },

  // 4. ANSCHLUSSDAUER ÜBER MEDIAN → PROJEKTIERERRISIKO
  anschlussdauer_wochen: (ist, median, segment) => ({
    label: `${segment}: ${ist} Wochen vs. Median ${median} Wochen`,
    delta: ist - median,
    bewertung: ist > median * 1.5
      ? `🚨 ${Math.round((ist/median - 1)*100)}% über Median – Projektierer kennen diese Zahl`
      : ist > median
        ? `⚠️ ${ist - median} Wochen über Bundesmedian`
        : `✅ ${median - ist} Wochen unter Bundesmedian`,
    peer_best: `Beste VNBs schaffen ${segment === 'EE MS' ? '4 Wo' : '1 Wo'}
                (Stadtwerke Waiblingen)`
  }),

  // 5. PRÜFSTAU → BUSSGELDRISKO + EWK-EINFLUSS
  anlagen_in_pruefung: (count, leistung_kw) => ({
    label: "MaStR-Prüfstau",
    redispatch_entgang: leistung_kw / 1000 * 3000, // €/Jahr
    ewk_einfluss: "Fotojahr 2026: verfälscht Umsetzungsquote",
    bussgeldrisko: `§118 EnWG: bis zu ${count * 5000} € möglich (Schätzwert)`,
    sofortmassnahme: `${count} Prüfstatus-Einträge schließen (Aufwand: ~2h)`
  }),

  // 6. §14A-POTENZIAL
  section_14a_potential: (haushalte, wachstumsrate = 0.15) => {
    const steuerbarAnlagen = Math.round(haushalte * wachstumsrate);
    const kw_pro_anlage = 11; // kW Wallbox / WP Durchschnitt
    const praemie_kw = 110;   // €/kW/Jahr max
    return {
      label: "§14a EnWG Steuerungspotenzial",
      anlagen_2030: steuerbarAnlagen,
      max_ertrag: steuerbarAnlagen * kw_pro_anlage * praemie_kw,
      einheit: "€/Jahr",
      voraussetzung: "Digitales Kundenportal + SMGW-Rollout"
    };
  }
};
```

---

## CR-83 · P1 · Peer-Vergleich als Pflicht-Feature: Nicht nur Bundesmedian – konkrete Namen

### Das Problem
"Rang 452/740" bleibt abstrakt. "Stadtwerke Waiblingen schafft MS-Anschlüsse in 4 Wochen, Sie brauchen 120" ist konkret. Ein Vorstand kann mit einem Namen seiner Abteilung gegenübertreten.

### CR-83: Automatischer Peer-Vergleich für jede EWK-Kennzahl

```javascript
// Im Report-Generator: nach EWK-Daten immer Peer-Vergleich ergänzen

// Für Anschlussdauer-Abschnitt:
const peers = {
  ee_ms: {
    top_performer: { name: "Stadtwerke Waiblingen", wochen: 4, bnr: "10000726" },
    comparable_size: [], // VNBs ähnlicher Größe, nächste API-Iteration
    bundesmedian: 120,
    frankenthal: 120   // am Median – kein Schock hier
  },
  verbrauch_ms: {
    top_performer: { name: "Gemeindewerke Baiersbronn", wochen: 5, bnr: "10001510" },
    bundesmedian: 111,
    frankenthal: 210   // 90 Wochen über Median – HIER ist der Schock
  }
};

// Template für Peer-Vergleichs-Satz:
// "Während die besten deutschen VNBs (z.B. Stadtwerke Waiblingen)
//  MS-Anschlüsse für Verbrauchsanlagen in 5 Wochen realisieren,
//  liegt Ihr Median bei 210 Wochen. Das ist der gleiche Auftrag –
//  aber ein anderer Prozess dahinter."
```

---

## CR-84 · P1 · Glossar-Hover für Fachbegriffe im Report

### Das Problem
Ein Vorstand, der EWK, AgNeS, NEST, MeLo, NAP, StromNZV nicht kennt, muss gerade dafür keinen Berater engagieren. Das kostet ihn Entscheidungsgeschwindigkeit.

### CR-84: Inline-Glossar für 12 Pflichtbegriffe

```javascript
// Im Report-Generator: diese Begriffe beim ersten Erscheinen automatisch
// mit Tooltip / Klapptext versehen:

const glossar = {
  "MaStR": "Marktstammdatenregister – die Bundesbehörde, bei der jede
            Energieerzeugungsanlage in Deutschland registriert sein muss.
            Wie das Handelsregister, nur für Solardächer, Windräder und Speicher.",

  "EWK": "Energiewendekompetenz-Monitoring – jährliche BNetzA-Messung
          aller ~740 Netzbetreiber. Ergebnis: Ihr Rangplatz im bundesweiten
          Vergleich. Einfluss auf Erlösobergrenze.",

  "AgNeS": "Anreizregulierungsverfahren für Netzbetreiber – das BNetzA-Modell,
            das aus EWK-Kennzahlen Ihren individuellen Effizienzwert berechnet.
            Basis für die Erlösobergrenze.",

  "NEST": "Netz-Effizienz-Screening-Tool – das Verfahren, mit dem die BNetzA
           Ihre Erlösobergrenze für die nächste Regulierungsperiode (5 Jahre)
           festlegt. Ergebnis = Ihr genehmigtes Investitionsbudget.",

  "Erlösobergrenze": "Das Maximum, das Sie als Netzbetreiber pro Jahr an
                      Netzentgelten einnehmen dürfen. Festgesetzt von der BNetzA
                      auf 5 Jahre. Wer effizienter ist (AgNeS), bekommt mehr.",

  "MeLo": "Messlokation – eine eindeutige Adresse für jeden Zählpunkt.
           Ohne MeLo können keine Abrechnungen erstellt werden.
           Wie eine IBAN – ohne geht nichts.",

  "NAP": "Netzanschlusspunkt – der technische Übergabepunkt zwischen Ihrer
          Infrastruktur und der Anlage des Kunden. Jede Anlage im MaStR
          braucht einen NAP.",

  "Redispatch 2.0": "Seit 2021: Bei Netzengpässen können Sie Einspeiseanlagen
                    ≥100 kW zwangsweise reduzieren – müssen aber entschädigen.
                    Funktioniert nur mit vollständigen MeLo-Verknüpfungen.",

  "§14a EnWG": "Seit Januar 2024: Pflicht, steuerbare Verbrauchseinrichtungen
               (Wallboxen, Wärmepumpen) aktiv zu managen – mit SMGW und
               digitalem Kundenportal. Dafür gibt es eine Netzentgelt-Reduzierung
               für den Kunden.",

  "Fotojahr": "Stichtagsprinzip: Die BNetzA bewertet den Zustand Ihrer MaStR-Daten
               zu einem bestimmten Datum ('Foto'). Fehlerhafte Daten an diesem Tag
               beeinflussen Ihre Erlösobergrenze für 60 Monate.",

  "Digitalisierungsindex": "BNetzA-Score von 0–100% für Smart Grids, digitale
                            Prozesse, Datenmanagement und Kundenmanagement.
                            Fließt in AgNeS-Effizienzwert ein. Bundesmedian: 30%.",

  "Residuallast": "Der Strombedarf in Ihrem Netz nach Abzug aller lokalen
                   Einspeisung (Solar, Wind, KWK). Das ist, was Sie am EPEX-
                   Spotmarkt einkaufen müssen. Frankenthal: 53 MW Ø."
};
```

---

## CR-85 · P1 · "Challenge-Fragen" Baustein: Womit ein Vorstand seine Mitarbeiter befragen kann

### Das Problem
Ein Vorstand, der diesen Report liest, soll seine Mitarbeiter in der nächsten Runde konkret befragen können. Das fehlt vollständig.

### CR-85: Abschnitt "5 Fragen an Ihr Team" am Ende jedes Reports

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5 FRAGEN, DIE SIE IHREM TEAM STELLEN SOLLTEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(Generiert aus Ihren aktuellen Cernion-Daten · 7. März 2026)

1. PRÜFSTAU:
   "Ich sehe 37 Anlagen in Netzbetreiberprüfung, davon ein
    2-MW-Windrad seit 2002. Bis wann sind alle abgeschlossen,
    und wer ist dafür verantwortlich?"

2. MS-ANSCHLUSSDAUER:
   "Unsere Verbrauchsanlagen in Mittelspannung warten 210 Wochen.
    Stadtwerke Waiblingen schafft das in 5 Wochen. Was machen
    die, was wir nicht tun? Wo sind die 180 Wochen in Phase 2?"

3. §14a-READINESS:
   "Unser Kundenmanagement-Score ist 0%. Wie viele Wallboxen und
    Wärmepumpen haben wir gerade im Netz, die wir theoretisch
    steuern könnten – und können wir das heute schon?"

4. NEST-ZIEL:
   "Wir sind Rang 452 von 740. Was ist unser Ziel-Rang für die
    nächste Regulierungsperiode, und welche zwei Maßnahmen
    würden am meisten Plätze bringen?"

5. DATEN-STÄRKE NUTZEN:
   "Unser Datenmanagement liegt über dem Bundesschnitt.
    Wo nutzen wir das aktiv – nicht nur für Compliance,
    sondern für operative Entscheidungen?"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Implementierungslogik:** Die Fragen werden automatisch aus den KPIs generiert.
Jede Kennzahl die einen Schock-Schwellenwert überschreitet → erzeugt eine Challenge-Frage.
Fragen werden priorisiert: max. 5, wichtigste zuerst.

---

## CR-86 · P1 · KORREKTURBEFUND: Verbrauch MS ist der echte Schock, nicht EE MS

**Validierung via MCP (07.03.2026):**

| Segment | Frankenthal | Bundesmedian | Delta | Bewertung |
|---------|------------|-------------|-------|----------|
| EE NS | 47 Wo | **40 Wo** | +7 Wo | ⚠️ 18% über Median |
| EE MS | 120 Wo | **120 Wo** | 0 Wo | ✅ Genau am Median |
| Verbrauch NS | 37 Wo | **30 Wo** | +7 Wo | ⚠️ 23% über Median |
| **Verbrauch MS** | **210 Wo** | **111 Wo** | **+99 Wo** | 🚨 **89% über Median** |

**Korrektur zu CR-66 (aus vorherigem Dokument):**
EE MS ist KEIN Schock – Frankenthal liegt exakt am Bundesmedian.
Der echte Schock ist **Verbrauch MS: 210 vs. 111 Wochen** (+89%).
Das sind Wärmepumpen, Elektrolyseure, Industrie-Speicher – genau die
Anlagen die für die Energiewende ab 2025 kritisch werden.
**Peer-Kontrast:** Gemeindewerke Baiersbronn: 5 Wochen (= 42× schneller).

---

## CR-87 · P1 · Zusätzliche Domain Knowledge: Was der Report Generator über Fotojahr wissen muss

```javascript
// DOMAIN KNOWLEDGE: Fotojahr 2026 – Erklärung und Implikation

const fotojahr_domain = {

  erklaerung: `
    Die BNetzA macht jedes Jahr einen "Schnappschuss" (Foto) Ihrer MaStR-Daten.
    Dieser Stichtag heißt "Fotojahr". Jeder Fehler, der an diesem Tag im MaStR
    steht, wird für die nächste Regulierungsperiode (60 Monate) eingefroren.

    Konkret: Eine PV-Anlage, die am Fotojahr-Stichtag falsch zugeordnet ist,
    verfälscht Ihre AgNeS-Kapazitätsbilanz für FÜNF JAHRE.
  `,

  implikation_frankenthal: {
    pruefstau: `37 offene Prüfungen am Fotojahr-Stichtag =
                verfälschte Umsetzungsquote → EWK-Rang-Verlust`,
    plz_ausreißer: `2 Anlagen in PLZ 67069 (Ludwigshafen) =
                    falsche Kapazitätsbilanz für 5 Jahre`,
    handlungsfrist: `Frankenthal muss BEIDE Punkte vor dem Fotojahr-Stichtag
                    2026 bereinigen. Frist: typischerweise Ende Q1/Anfang Q2.`
  },

  // Für den Report Generator:
  // WENN Fotojahr-relevante Fehler vorhanden → SOFORT-Block generieren
  // NICHT in normaler Kennzahltabelle verstecken
  generate_alert: (pruefstau_count, plz_ausreißer_count) => {
    if (pruefstau_count > 0 || plz_ausreißer_count > 0) {
      return `
        ⚡ FOTOJAHR-ALERT: ${pruefstau_count + plz_ausreißer_count} Datenfehler
        müssen vor dem Stichtag bereinigt werden.
        Jeder verbleibende Fehler wirkt 60 Monate auf Ihre Erlösobergrenze.
        Cernion-Aktion: MaStR-Korrekturbericht → an Netzplanung senden.
      `;
    }
  }
};
```

---

## CR-88 · P2 · "Regulierungsperioden-Uhr" als visueller Kontext-Anker

### Das Problem
Ein Vorstand weiß nicht intuitiv: "Wann endet die aktuelle Regulierungsperiode? Bis wann muss ich handeln?" Der Report hat keinen Zeitkontext.

### CR-88: Visueller Zeitstrahl im NEST-Abschnitt

```
IHRE REGULIERUNGSZEITLINIE

2024    2025    2026    2027    2028    2029    2030
  |       |       |       |       |       |       |
  ├───────[AKTUELLE REGULIERUNGSPERIODE (Ω)────────]
  |       |       |       |       |       |       |
          |   [EWK-Foto 2025]     |       |
          |       |   [SIE SIND HIER: März 2026]
          |       |       |       |
          |       |       |  [EWK-Foto 2026 → fließt in NÄCHSTE EO ein]
          |       |       |       |
                          |       [AgNeS-Festsetzung ~2027/2028]
                                          |
                                    [NEUE EO ab ~2029:
                                     Ergebnis Ihrer heutigen Maßnahmen]

→ Ihre Handlungen im Frühjahr 2026 bestimmen Ihr Budget 2029–2033.
  Das ist kein fernes Zukunftsprojekt. Das ist jetzt.
```

---

## CR-89 · P2 · Stärken-Sektion: Umsetzungsquote als Wettbewerbsvorteil kommunizieren

### Das Problem
Der Report nennt die Umsetzungsquote in einer grauen Tabelle. Das ist die eine Kennzahl, die der Vorstand nach außen kommunizieren sollte – und der Report würdigt sie nicht.

### CR-89: Hervorhebungs-Block für Exzellenz-KPIs

```
╔══════════════════════════════════════════════════════════════╗
║ 🏆 IHR ECHTER WETTBEWERBSVORTEIL                             ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  5.831 NETZANSCHLÜSSE – 0 ABGEWIESEN                        ║
║  Rang 187 von 698 VNBs · Top 27% bundesweit                  ║
║                                                              ║
║  Das bedeutet:                                               ║
║  Jeder Projektierer, jede Gemeinde, jeder Bürger, der        ║
║  in Ihrem Netzgebiet eine PV-Anlage, Wallbox oder            ║
║  Wärmepumpe angemeldet hat: Sie haben ihn angeschlossen.     ║
║  Immer. Alle.                                                ║
║                                                              ║
║  Warum das zählt:                                            ║
║  → Gemeinderatssitzungen: diese Zahl gehört in Ihre         ║
║    Präsentation wenn über Netzausbau diskutiert wird         ║
║  → Presseanfragen: "langsamer Netzbetreiber" können Sie     ║
║    mit Rang 187/698 kontern                                  ║
║  → Projektierer: Ihr Ruf bei Solarfirmen und Planern         ║
║    ist gut – aktiv vermarkten                                ║
║                                                              ║
║  Nächster Schritt: Jahresbericht 2026                        ║
║  "Als einer der Top-27%-Netzbetreiber Deutschlands haben    ║
║   die Stadtwerke Frankenthal im Jahr 2025 jeden              ║
║   Netzanschlussantrag realisiert."                           ║
╚══════════════════════════════════════════════════════════════╝
```

---

## CR-90 · P0 · Report-Architektur: Neue Seitenstruktur für Note 1

### Die neue Seitenreihenfolge (von 8 Abschnitten zu 10 + Rahmen):

```
DECKBLATT (unverändert)
  ↓
MANAGEMENT BRIEFING [NEU: ersetzt "Summary"]
  • Struktur: SOFORT | DIESES QUARTAL | IHRE STÄRKEN
  • Keine Bulletpoints – kurze Sätze mit Verb
  • Max. 1 Seite
  ↓
SCHOCKER-SEITE [NEU]
  • 2–3 SCHOCKER-Blöcke wenn Schwellenwerte überschritten
  • Nur bei Compliance-Risiken / €-Hebel > 10k€
  ↓
[1] NETZBETRIEB (nach Dringlichkeit sortiert, mit €-Wert)
[2] EE-PORTFOLIO (mit Prognose + Prosumer-Potenzial)
[3] ENERGIEMARKT (mit Preis-Einspeise-Korrelation)
[4] GAS (mit EU-Vergleich + Krisenplan-Trigger)
[5] COMPLIANCE & NEST [ERWEITERT]
    → NEST-Erklärbaustein (CR-78)
    → Regulierungskausalitäts-Kette (CR-79)
    → Anschlussdauer-Matrix (alle 4 Segmente, CR-75)
    → DI-Radar mit echten Werten (CR-76/67)
    → Peer-Benchmark mit Namen (CR-83)
    → Zeitstrahl Regulierungsperiode (CR-88)
[6] KUNDENMGMT (mit §14a-Potenzialrechnung)
[7] INVESTITION (Business Cases)
[8] DIGITALISIERUNG (Systemstatus)
  ↓
CHALLENGE-FRAGEN [NEU] (CR-85)
  • 5 Fragen aus den Daten generiert
  ↓
AKTIONSPLAN 90 TAGE [NEU] (CR-81)
  • Woche 1–2: Compliance (ohne Budget)
  • Monat 1: Analyse (1–2 Arbeitstage)
  • Monat 2–3: Investitionsentscheidungen
  ↓
GLOSSAR [NEU] (CR-84)
  • 12 Pflichtbegriffe erklärt
```

---

## Implementierungs-Reihenfolge

### Diese Woche (Pflicht für Leipzig):
- CR-80 (SCHOCKER-Blöcke – HTML-Template erstellen) · 3h
- CR-81 (Aktionsplan-Modul – Template + Logik) · 2h
- CR-78 (NEST-Erklärbaustein – statischer Text) · 1h
- CR-82 (€-Übersetzungsformeln in Generator) · 4h
- CR-86 (Korrekturbefund Verbrauch MS in alle Datenquellen) · 1h
- CR-83 (Peer-Vergleich EWK automatisch) · 3h
- CR-79 (Kausalitätskette als Flowchart) · 3h
- CR-84 (Glossar-Hover HTML/CSS) · 2h
- CR-85 (Challenge-Fragen Generator-Logik) · 3h
- CR-90 (Neue Report-Seitenstruktur) · 6h
- CR-87 (Fotojahr-Domain-Knowledge im Generator) · 2h
- CR-88 (Zeitstrahl-Visualisierung) · 2h
- CR-89 (Stärken-Hervorhebungs-Block) · 1h

---

*Cernion · STROMDAO GmbH · Thorsten Zoerner · 7. März 2026*
*Datenvalidierung via MCP: ewk_benchmark_vnb, ewk_anschlussdauer, cernion_installations_local*
*BNr: 10000873 · MaStR: SNB961745390019 · BDEW: 9900191000003*
