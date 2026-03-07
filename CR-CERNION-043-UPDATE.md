# CR-CERNION-043 (UPDATE) · 360° Report Qualität – Delta v1→v2 + offene Bugs

**Report:** Stadtwerke Frankenthal GmbH · BDEW 9900191000003 · MaStR SNB961745390019  
**Verglichene Versionen:**
- v1: Report-ID bf3ad501 · Zeitstempel 7.3.2026 16:02
- v2: Report-ID 83272090 · Zeitstempel 7.3.2026 18:10  
**Gemeldet:** 7. März 2026 · **Status:** PARTIALLY RESOLVED

> ⚠️ Live-Verifikation via Cernion MCP ausstehend – Powabase-Backend nicht erreichbar.  
> Analyse basiert auf Dokumentenvergleich v1 ↔ v2.

---

## ✅ Behobene Bugs (v1 → v2)

### ~~BUG-3~~ · Sektion 2 MaStR-Daten leer → BEHOBEN ✅
**v1:** Alle MaStR-Felder `n/v – MaStR-Abfrage nicht verfügbar`  
**v2:** Vollständige Daten vorhanden:
- Installierte PV-Leistung: **55.691 kWp**
- Anzahl PV-Anlagen: **4.372 Anlagen**
- Windleistung: **2.000 kW (1 Anlage)**
- Speicherleistung: **12.857 kW**
- Regionaler Energiemix: ✓ Analyse verfügbar

**Implementation:** Single-source-of-truth Strategie – prioritized local MaStR MongoDB queries (pvLocal, windLocal, speicherLocal) über Broker-Fallbacks in Section 2 KPI-Tabelle und Briefing.

---

### ~~BUG-4~~ · 500-Anlagen-Cap → BEHOBEN (Limit erhöht) ✅
**v1:** `500 Anlagen in Netzbetreiberprüfung` (= Abfragelimit)  
**v2:** `5.000 Anlagen in Netzbetreiberprüfung` (Limit auf 5.000 erhöht)  

**Implementation:** Limit für `anlagenInPruefung` und `ortsfremdeAnlagen` Queries von 500 → 5.000 erhöht in `utility-report.service.js`.

> ⚠️ **Restrisiko:** Ob 5.000 der echte Bestand oder das neue Limit ist, kann erst nach MCP-Verifikation bestätigt werden. Empfehlung: `COUNT(*)` statt `LIMIT`-Ausgabe für zukünftige Versionen.

---

### ~~BUG-5~~ · Day-Ahead-Preis fehlend → BEHOBEN ✅
**v1:** `– €/MWh`  
**v2:** `120,95 €/MWh` ✅ – inkl. vollständigem 24h-Kurven-Chart

**Implementation:** Integration des Tageskurses aus ENTSO-E/SMARD API in Section 3. Verwendbar für dynamische Formelberechnungen (siehe BUG-2).

> ℹ️ **Hinweis:** Post-Congress-Phase erfordert Retry-Logik mit exponentiellem Backoff + Last-Known-Value Fallback für ENTSO-E Market-Price Fetches (aktuell noch nicht implementiert).

---

### BUG-042 (VNB-Lookup Transparenz) → TEILWEISE BEHOBEN ✅
**v1:** Kein Hinweis auf verwendete MaStR-ID  
**v2:** Titelseite zeigt: `Datengrundlage: [BDEW 9900191000003] [MaStR SNB961745390019] · Bitte vor Weitergabe verifizieren.`  

**Implementation:** Transparenz-Anforderung aus BUG-042 Option C umgesetzt (Title-Seite ergänzt um Datengrundlage).

> ⚠️ **Verifikation ausstehend:** Ob BDEW 9900191000003 und MaStR-ID SNB961745390019 tatsächlich auf dasselbe Unternehmen zeigen, kann erst nach MCP-Verifikation bestätigt werden.

---

## 🔴 Weiterhin offen

### BUG-1 · Digitalisierungsindex intern widersprüchlich → NICHT BEHOBEN 🔴
**Status in v2: unverändert**

| Stelle | Wert | Quelle |
|---|---|---|
| Sektion 5 EWK-Kausalität | DI: **30 %** ✅ (Rang 452/740) | `ewk_benchmark_vnb` |
| Sektion 8 Digitalisierung | **–** (leer) | benchmark-Datenquelle offline? |
| Aktionsplan „Ihre Stärken" | **Datenmanagement 67,0 %** (Median 60,0 %) | Teilscore, nicht Gesamt-DI |

**Problem:** Drei verschiedene Aussagen, keine davon eindeutig als Gesamt-DI vs. Teilscore gekennzeichnet. Sektion 8 bleibt ohne DI-Gesamtscore.

**Auswirkung:** Vorstandsleser verwirrt: „Warum 30%, dann 67%, dann blank?"

**Gewünschtes Verhalten:** 
1. Sektion 8 erhält DI-Wert als Fallback aus Sektion-5-Datensatz (30%)
2. Aktionsplan kennzeichnet „67,0 % Datenmanagement-Teilscore" explizit als Teilscore, nicht als Gesamt-DI
3. OpenAPI-Doku klärt: `benchmarkVnb.digitalisierungsindex` = Gesamt-DI für VNB

**Fix-Komplexität:** Mittel (3–4 Zeilen im Report-Builder)

---

### ⚠️ BUG-2 · Residuallast-Formel nicht skaliert → NICHT BEHOBEN 🔴 **KRITISCH VOR DEMO**
**Status in v2: unverändert**

Sektion 1 zeigt Residuallast **54 MW**, darunter steht unverändernd:
```
„(1 MW × 120 €/MWh × 8.760 h ≈ 1,05 Mio. €/Jahr)"
```

**Korrekter Wert:**
```
54 MW × 120,95 €/MWh × 8.760 h ≈ 57,1 Mio. €/Jahr
```

**Auswirkung:** Beschaffungskosten um Faktor 54× unterschätzt. Für Vorstand absolut inakzeptabel.

**Root Cause:** Formel ist in Template hardkodiert, nutzt Day-Ahead-Preis nicht (obwohl dieser in v2 korrekt vorhanden: 120,95 €/MWh aus Sektion 3).

**Gewünschtes Verhalten:** Dynamische Formel mit echten Werten:
```
Beschaffungskosten ≈ {residuallast_mw} MW × {day_ahead_price_eur_mwh} €/MWh × 8.760 h ≈ {cost_mio} Mio. €/Jahr
```

**Fix (1 Template-Zeile):** In `src/report-builder.js` um `{residuallast_mw}` und `{day_ahead_price_eur_mwh}` Template-Variablen ergänzen.

**Fix-Komplexität:** 🟢 **EINFACH (15 min)** – Nur Template-String anpassen, Variablen stehen bereits zur Verfügung (residuallast aus Sektion 1, day_ahead_price aus Sektion 3).

**Priority:** 🔴 **KRITISCH – muss vor Demo 10.3.2026 erledigt sein**

---

## 🟡 Neu entdeckte Bugs in v2

### BUG-6 · Briefing-Anlagenzahl (6.476) passt nicht zu Sektion 2 (4.372 + 1 + Speicher)
**Schweregrad:** 🟡 **MITTEL**

Management Briefing Seite 2:
> „69,6 MW aus **6.476 Anlagen**"

Sektion 2 zeigt:
- PV: 4.372 Anlagen (55.691 kWp)
- Wind: 1 Anlage (2.000 kW)
- Speicher: 12.857 kW Leistung, Anzahl **nicht explizit**

**Rechnung:**
- Summe MW: 55,691 + 2,0 + 12,857 = **70,548 MW** (vs. Briefing 69,6 MW, Delta 0,9 MW)
- Summe Anlagen: 4.372 + 1 + X Speicher = **6.476** → impliziert ~2.103 Speicheranlagen

Das ist plausibel (viele Heimspeicher), aber die Anlagenzahl fehlt in Sektion 2 komplett für Speicher → Briefing-Summe nicht nachvollziehbar.

**Gewünschtes Verhalten:** Sektion 2 ergänzt **Anzahl Speicheranlagen** als eigene Kennzahl, damit die Briefing-Summe nachvollziehbar wird.

**Fix-Komplexität:** Mittel (Speicher-Anlagenzahl abfragen + in Section 2 Table einbinden)

---

### BUG-7 · Peer-Vergleich „Gemeindewerke Baiersbronn 5 Wo." als Benchmark für Verbrauch MS fragwürdig
**Schweregrad:** 🟡 **MITTEL** (Methodisch, aber angreifbar)

In Sektion 5 und im SCHOCKER-Abschnitt wird Gemeindewerke Baiersbronn (ein sehr kleiner ländlicher VNB in Baden-Württemberg) als Peer-Vergleich für Verbrauch MS herangezogen:
```
„Gemeindewerke Baiersbronn: 5 Wochen – das ist derselbe Auftrag, aber ein anderer Prozess."
```

**Vergleichbarkeit fragwürdig:**
- Frankenthal (Rheinland-Pfalz): ~50.000 EW, PLZ 672xx, 70 MW installiert
- Baiersbronn (Baden-Württemberg): ~15.000 EW, PLZ 725xx, 3× kleinere Struktur

Derselbe Peer (Baiersbronn) taucht identisch im Gmünd-Report auf → deutet auf hartkodierte Peer-Auswahl hin, keine VNB-größenklassenbezogene Selektion.

**Gewünschtes Verhalten:** 
1. Peer-Auswahl nach Größenklasse (Anzahl Anlagen, Netzlänge) und Bundesland filtern
2. Mindestens 2 Peers zeigen (für Benchmarking Robustheit)
3. Ähnliche Strukturen bevorzugen (15k–60k EW, ähnliche Energiemix)

**Fix-Komplexität:** Mittel–Hoch (Peer-Matching-Logik in `grid-operations.service.js` oder `cernion_grid_operator_analysis` MCP-Tool erforderlich)

---

## 🔵 Verifikationsausstände (MCP offline)

Folgende Prüfpunkte können erst nach MCP-Verfügbarkeit live bestätigt werden:

| Prüfpunkt | Tool | Erwarteter Befund | Status |
|---|---|---|---|
| MaStR-ID `SNB961745390019` gehört zu Frankenthal | `cernion_vnb_lookup` BDEW 9900191000003 | Muss SNB961745390019 zurückgeben | ⏳ Ausstehend |
| Echter Bestand InPrüfung ≠ 5.000 | `cernion_installations_local` netzbetreiberPruefungStatus=NetzbetreiberPruefung | Echtzahl, nicht Limit | ⏳ Ausstehend |
| PV 4.372 Anlagen / 55.691 kWp korrekt | `cernion_installations_local` type=solar status=InBetrieb | Soll-Ist-Vergleich v2-Daten | ⏳ Ausstehend |
| 2 PLZ-Ausreißer außerhalb 672xx | `cernion_installations_local` postleitzahlNot=672 | Genau 2 Treffer? | ⏳ Ausstehend |
| EWK DI-Gesamtscore für Frankenthal | `ewk_benchmark_vnb` BDEW 9900191000003 | Soll ≠ „–" sein | ⏳ Ausstehend |

---

## 📊 Zusammenfassung Bugs nach Version

| Bug | v1 | v2 | Priorität | Next Steps |
|---|---|---|---|---|
| **BUG-1** · DI widersprüchlich | 🔴 Offen | 🔴 Offen | **Hoch** | Fallback-Logik + Teilscore-Label |
| **BUG-2** · Formel nicht skaliert | 🔴 Offen | 🔴 Offen | **🔴 KRITISCH** | **Fix vor Demo 10.3.** |
| **BUG-3** · Sektion 2 leer | 🔴 Offen | ✅ Behoben | — | — |
| **BUG-4** · 500-Cap | 🔴 Offen | ⚠️ Limit erhöht | Mittel | MCP-Verif. + COUNT(*) |
| **BUG-5** · Preis fehlend | 🟡 Offen | ✅ Behoben | — | Retry-Logik post-Congress |
| **BUG-042** · Transparenz | 🔴 Offen | ✅ Umgesetzt | — | MCP-Verif. BDEW↔MaStR |
| **BUG-6** · Anlagenzahl Briefing | — | 🟡 Neu | Mittel | Speicher-Anlagen in Section 2 |
| **BUG-7** · Peer-Auswahl | — | 🟡 Neu | Mittel | Größenklassen-Matching |

---

## 🎯 Actionable Roadmap (bis Congress Demo 10.3.2026)

### SOFORT (nächste 2h)
- [ ] **BUG-2 FIXIEREN** – Template-String in `report-builder.js` mit echten Residuallast + Day-Ahead-Preis Variablen aktualisieren
  - File: [src/report-builder.js](src/report-builder.js)
  - Suchtext: `1 MW × 120 €/MWh`
  - Ersetzen durch: `{residuallast_mw} MW × {day_ahead_price_eur_mwh} €/MWh`
  - Test: Neuen Report für Frankenthal generieren, Sektion 1 prüfen

### VOR DEMO (bis 9.3. abends)
- [ ] **BUG-1 Fallback:** Section 8 DI-Fallback aus Section 5 einbauen
- [ ] **BUG-6 Speicher-Anlagen:** Storage-Anlagenzahl in Section 2 hinzufügen
- [ ] **Frankenthal + Gmünd v3-Reports** neu generieren und prüfen

### POST-CONGRESS (ab 10.3.)
- [ ] MCP-Backend-Verifikation aller Verifikationsausstände
- [ ] BUG-1: DI-Wert konsistent machen (3 Quellen → 1 Quelle)
- [ ] BUG-7: Peer-Matching-Logik implementieren (Größenklassen-Filter)
- [ ] BUG-5: Retry-Logik mit Backoff für Market-Prices

---

## 📝 Notizen für Development

**BUG-2 Fix – Code-Schnipsel:**

Aktuell in `src/report-builder.js`:
```javascript
// ❌ Hardcoded
"Beschaffungskosten ≈ 1 MW × 120 €/MWh × 8.760 h ≈ 1,05 Mio. €/Jahr"
```

Gewünscht:
```javascript
// ✅ Dynamisch
const residuallastMw = section1Data.residuallast_mw || 0;
const dayAheadPrice = section3Data.day_ahead_price_eur_mwh || 120;
const annualCost = (residuallastMw * dayAheadPrice * 8760) / 1_000_000;

`Beschaffungskosten ≈ ${residuallastMw} MW × ${dayAheadPrice} €/MWh × 8.760 h ≈ ${annualCost.toFixed(1)} Mio. €/Jahr`
```

---

*CR-CERNION-043 · Update nach Report v2 · 7. März 2026*  
*MCP Live-Verifikation ausstehend – wird nach Backend-Verfügbarkeit ergänzt*  
*Demo: Stadtwerke-Konferenz 10. März 2026 · KRITISCHER BLOCKER: BUG-2 Residuallast-Formel*
