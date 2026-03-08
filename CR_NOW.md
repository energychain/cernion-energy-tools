# CR-CERNION-044 · Report Engine Quality
## Cernion 360° Management Report – Offene Qualitätspunkte

**Status:** OFFEN
**Priorität:** P0 (BUG-4/8) · P1 (BUG-10, BUG-11) · P2 (BUG-12, BUG-13)
**Demo-Frist:** 9. März 2026 · 23:59 Uhr (für Congress 10.03.2026)
**Verifikationsbasis:** Cernion MCP Live · 8. März 2026 · SNB961745390019

---

## 🔴 BUG-4 / BUG-8 · MaStR Prüfstatus: Falsche Zählung und falsches Beispiel
**Priorität: P0 · Blocker**

### Ist-Zustand
Die Report Engine zeigt in SCHOCKER, Sektion 1 und Aktionsplan konsistent **5.000 Anlagen in Netzbetreiberprüfung**. Dieser Wert entspricht nicht dem echten Bestand, sondern dem internen Query-Limit der MaStR-Abfrage.

Zusätzlich wird `SEE911965100844` als Beispielanlage für eine Prüfungsproblem-Lage genannt. Diese Anlage hat laut MCP-Live-Abfrage Status **Geprüft ✅** und befindet sich nicht in Prüfung.

| | Report-Ausgabe | MCP-Live (Wahrheit) |
|---|---|---|
| Anlagen in Prüfung | **5.000** | **41** |
| Beispielanlage Status | „in Prüfung" | SEE911965100844 = **Geprüft ✅** |
| Beispielanlage Quelle | ORDER BY capacity DESC | ORDER BY capacity DESC **ohne Prüfstatus-Filter** |

### Root Cause
```js
// FEHLERHAFT: zwei entkoppelte Queries
const count = await mastr.find(filter, { limit: 5000 }).then(r => r.length); // = 5000
const beispiel = await mastr.findOne({ gridOperatorId });                      // kein Prüfstatus-Filter
```

### Fix
```js
// FIX-1: echter COUNT
const count = await mastr.countDocuments({ gridOperatorId, pruefungStatus: 'InPruefung' });

// FIX-2: Beispiel aus gefiltertem Datensatz
const inPruefung = await mastr.find(
  { gridOperatorId, pruefungStatus: 'InPruefung' },
  { limit: 1, sort: { capacity: -1 } }
);
if (inPruefung.length === 0) return renderNoSchocker();
const beispiel = inPruefung[0].mastrId;
```

### Akzeptanzkriterien
- [ ] AC-1: Frankenthal-Report zeigt **41** Anlagen in Prüfung (MCP-verifiziert)
- [ ] AC-2: Beispiel-MaStR-ID ist nachweislich `InPruefung`-Status
- [ ] AC-3: Bei 0 Anlagen in Prüfung: SCHOCKER-Block wird nicht gerendert
- [ ] AC-4: Zähler in Sektion 1, Briefing und Aktionsplan identisch (single source of truth)
- [ ] AC-5: Regressionstest Gmünd-Report (SNB966216072913)

**Aufwand:** FIX-1: ~15 min · FIX-2: ~30 min · Tests: ~30 min · **Gesamt ≤ 2 h**

---

## 🟠 BUG-10 · PLZ-Ausreißer: Geobasierte Filterung statt Postleitzahl-Präfix
**Priorität: P1**

### Problem
Die Engine identifiziert ortsfremde Anlagen aktuell über einen PLZ-Präfix-Ausschluss (`≠ 672xx`). Diese Methode ist für kleine VNBs mit klar abgegrenzten Postleitzahlbereichen ausreichend, **aber bei größeren Stadtwerken strukturell falsch**:

- Großstädte überspannen mehrere PLZ-Präfixe (z.B. Mannheim: 68xxx, Frankfurt: 60xxx–65xxx)
- Netzgebiete folgen topografischen, nicht postalischen Grenzen
- Ein Netz kann PLZ-gebiete nur teilweise abdecken → falsch-positive Ausreißer
- Ein Nachbar-VNB kann im selben PLZ-Bereich operieren → falsch-negative Überschneidungen

**Im aktuellen Frankenthal-Fall funktioniert die PLZ-Methode**, weil das Kerngebiet exakt im 672xx-Bereich liegt. Als allgemeine Lösung ist sie jedoch nicht skalierbar.

### Verfügbare bessere Datenquelle
Die Cernion-Toolchain hat Zugriff auf **VNBDigital** (`vnbdigital_lookup`, `vnbdigital_search`), das die tatsächlichen Netzgebiets-Polygone nach Postleitzahl-ID und Gemeinde-ID enthält. Damit ist eine präzise geografische Abgrenzung möglich:

```
1. vnbdigital_lookup(coordinates oder postcode_id) → liefert exaktes VNB-Polygon
2. MaStR-Anlage.koordinaten → Punkt-in-Polygon-Test gegen VNB-Grenze
3. Abweichung > 0 km vom Polygon → echter Ausreißer
```

### Anforderung
Die ortsfremde-Anlagen-Erkennung soll VNBDigital-Geodaten als primäre Quelle verwenden. PLZ-Präfix bleibt als Fallback erhalten, wenn keine Geodaten verfügbar sind.

### Akzeptanzkriterien
- [ ] AC-1: Für VNBs mit VNBDigital-Deckung wird Polygon-Test verwendet
- [ ] AC-2: Korrekte Erkennung bei VNBs mit mehreren PLZ-Präfixen (Regressionstest mit Mannheim, Frankfurt)
- [ ] AC-3: Fallback auf PLZ-Methode mit explizitem Hinweis `(Methode: PLZ-Näherung)` wenn kein VNBDigital-Polygon verfügbar
- [ ] AC-4: Report-Text unterscheidet zwischen „außerhalb Netzgebiet (geo-verifiziert)" und „außerhalb PLZ-Bereich (Näherung)"

**Aufwand:** ~1 Tag (VNBDigital-Integration + Polygon-Test)

---

## 🟠 BUG-11 · "Analyse verfügbar" ohne Daten: Netzverluste und E-Mobilität
**Priorität: P1**

### Problem
Zwei Kennzahlen in Sektion 1 zeigen `✓ Analyse verfügbar` ohne irgendeinen Datenpunkt anzuzeigen:

| Kennzahl | Aktuell | Problem |
|---|---|---|
| Netzverluste (I²R) | `✓ Analyse verfügbar` | Führt sofort zu Nachfrage nach der Analyse |
| E-Mobilität Netzauswirkung | `✓ Analyse verfügbar` | Gleiche Problematik |

Der Text `✓ Analyse verfügbar` erzeugt beim Empfänger eine klare Erwartung: **Er möchte diese Analyse sehen.** Ohne Anzeige des Ergebnisses ist der Eintrag wertlos – und schlimmer: er provoziert eine Konversation über etwas, das nicht gezeigt wird.

### Anforderung
**Option A (bevorzugt):** Den Schlüsselkennwert der Analyse inline anzeigen.

Beispiele:
- Netzverluste: `✓ 2,3% der durchgeleiteten Energie (≈ 1,8 Mio. €/Jahr)`
- E-Mobilität: `✓ 3 kritische Straßenzüge identifiziert · §14a-Relevanz: 12 Anlagen`

**Option B (Fallback):** Wenn kein Inline-Wert verfügbar, keine Zeile anzeigen statt `✓ Analyse verfügbar`. Alternativ: Zeile bleibt, aber Text lautet `Analyse auf Anfrage` (kein Check-Emoji, das Verfügbarkeit suggeriert).

### Akzeptanzkriterien
- [ ] AC-1: Keine Zeile zeigt ausschließlich `✓ Analyse verfügbar` ohne Datenwert
- [ ] AC-2: Netzverluste zeigt mindestens Verlustquote in % oder deaktiviert die Zeile
- [ ] AC-3: E-Mobilität zeigt mindestens Anzahl kritischer Straßenzüge oder deaktiviert die Zeile

**Aufwand:** ~4 h (Template-Logik + Daten-Mapping)

---

## 🟡 BUG-12 · Residuallast-Kurve: 48h-Prognose unvollständig
**Priorität: P2**

### Problem
Die Kurve in Abbildung A zeigt den Titel **"Ist + 48h-Prognose"**, aber die Prognose-Datenpunkte (gepunktete Linie) sind leer – die Kurve fällt nach ~20:00 Uhr auf 0 MW und bleibt dort. Das sieht aus wie ein Datenfehler, nicht wie eine fehlende Funktion.

### Erwartetes Verhalten
- Wenn 48h-Prognosedaten vollständig verfügbar sind: vollständige Kurve anzeigen
- Wenn nur 24h-Daten verfügbar sind: Diagrammtitel auf **"Ist + 24h-Prognose"** ändern und 24h-Zeitfenster darstellen
- Wenn gar keine Prognosedaten verfügbar: nur Ist-Kurve mit Titel **"Ist (kein Prognose-Horizont verfügbar)"**

Das Diagramm soll immer konsistent mit den tatsächlich vorhandenen Daten betitelt sein. Ein leerer Prognoseteil ist schlimmer als kein Prognosetitel.

### Akzeptanzkriterien
- [ ] AC-1: Diagrammtitel entspricht immer dem tatsächlich dargestellten Zeithorizont
- [ ] AC-2: Keine "leere" Prognose-Kurve (Nulllinie) bei fehlendem Datenhorizont
- [ ] AC-3: Report-Zeitstempel und Prognosehorizont sind konsistent

**Aufwand:** ~2 h (Template-Logik)

---

## 🟡 BUG-13 · Echtzeit-Daten: "verfügbar" statt Wert anzeigen
**Priorität: P2**

### Problem
Mehrere Felder zeigen `✓ Echtzeit-Daten verfügbar` oder `✓ Daten verfügbar` ohne den tatsächlichen Wert zum Berichtszeitpunkt:

| Kennzahl | Aktuell | Sollte zeigen |
|---|---|---|
| Einspeisung Wind/Solar (Ist) | `✓ Echtzeit-Daten verfügbar` | z.B. `Solar: 9 MW · Wind: 2 MW (08.03.2026 10:55)` |
| Regionaler Energiemix | `✓ Analyse verfügbar` | Prozentualer Mix zum Berichtszeitpunkt |
| Tatsächliche Erzeugung (DE) | `✓ Daten verfügbar` | Aggregierter ENTSO-E-Wert in GW zum Berichtszeitpunkt |
| Lastprognose (ENTSO-E) | `✓ Daten verfügbar` | Prognosewert für nächste 24h (Peak in GW) |

### Hintergrund
Diese Felder liefern keinen Mehrwert, solange keine Zahl sichtbar ist. Schlimmer: Der Empfänger sieht, dass Daten „verfügbar" sind – und fragt, warum sie nicht gezeigt werden. Für einen Report, der die Analysekompetenz von Cernion demonstrieren soll, ist ein reiner Verfügbarkeitshinweis das schlechtestmögliche Ergebnis.

Der Wert zum **Berichtszeitstempel** dient gleichzeitig als Beleg dafür, dass die Datenquelle tatsächlich live abgefragt wurde – das ist ein Vertrauensbeweis gegenüber dem Kunden.

### Anforderung
Jede Zeile mit Live-Datenquelle zeigt den konkreten Wert zum Zeitpunkt der Report-Generierung, inklusive Zeitstempel in der Beschreibungsspalte.

Beispielformat:
```
Einspeisung Wind/Solar (Ist) | Solar: 9 MW · Wind: 2 MW | ENTSO-E · Stand: 08.03.2026 10:55
```

### Akzeptanzkriterien
- [ ] AC-1: Einspeisung Wind/Solar zeigt numerischen Wert (MW) + Zeitstempel
- [ ] AC-2: Regionaler Energiemix zeigt prozentualen Mix oder mindestens dominante Technologie + Wert
- [ ] AC-3: Tatsächliche Erzeugung (DE) zeigt ENTSO-E-Aggregatwert in GW
- [ ] AC-4: Lastprognose zeigt Peak-Prognosewert für nächste 24h
- [ ] AC-5: Alle Werte tragen Quellenangabe und Zeitstempel

**Aufwand:** ~1 Tag (Template-Binding für bereits abgerufene Daten – Daten sind vorhanden, nur nicht gemappt)

---

## Zusammenfassung

| CR | Titel | Prio | Aufwand | Demo-relevant |
|---|---|---|---|---|
| BUG-4/8 | MaStR Prüfstatus: falscher COUNT + falsches Beispiel | 🔴 P0 | ≤ 2 h | **JA** |
| BUG-10 | PLZ-Ausreißer: VNBDigital-Geodaten statt PLZ-Präfix | 🟠 P1 | ~1 Tag | Nein |
| BUG-11 | "Analyse verfügbar" ohne Datenwert | 🟠 P1 | ~4 h | **JA** |
| BUG-12 | Residuallast-Kurve: Titel ≠ tatsächlicher Horizont | 🟡 P2 | ~2 h | Ja |
| BUG-13 | Echtzeit-Felder zeigen Verfügbarkeit statt Wert | 🟡 P2 | ~1 Tag | Ja |

**Gesamtaufwand bis Congress (P0+P1+P2):** ca. 2–3 Tage

---

*CR-CERNION-044 · Cernion Energy Intelligence · 8. März 2026*
*Verifikation: MCP Live SNB961745390019 · Berichtsstand v4 (Report-ID d4902a95)*
