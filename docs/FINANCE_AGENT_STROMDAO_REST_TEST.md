# Finance Agent REST API Test – STROMDAO Netze TOTEX / fNAV / 81-MVA-Engpass

**Ziel:** Komplexer End-to-End-Test gegen die REST API des Finance Agent nach Integration von `agent.analyze` / Capability Broker.

**Kontext:** STROMDAO Netze GmbH, Zielnetzplanung / Anschlussbegehren / kaufmännische Bewertung von flexiblem Netzanschluss (fNAV) gegenüber klassischem Netzausbau.

---

## 1. Testidee

Der Finance Agent soll eine kaufmännisch-regulatorische Abwägung für STROMDAO Netze erstellen:

- Das 20-kV-Netz hat operativ eine N-1-sichere Grenze von ca. **81 MVA**.
- Aktueller Bezug liegt grob bei **77 MW**.
- Offene Anschlussbegehren summieren sich auf ca. **+33 MVA**.
- Ein relevanter Fall ist die Großwärmepumpe / WWVP mit **18 MW**, technisch/spitzenlastseitig durch flexible Netzanschlussvereinbarung auf ca. **9,5 MW** reduzierbar.
- Zusätzlich stehen Batteriespeicher / Rechenzentren / flexible Anschlüsse im Raum.
- Fachlicher Zielkonflikt: klassischer CAPEX-Kupferausbau vs. TOTEX-Ansatz mit fNAV, Flexibilität, OPEX/Prozesskosten und Vermeidung von Stranded Assets.

Der Test prüft, ob der Finance Agent:

1. die Frage als **TOTEX / CAPEX / OPEX / regulatorische Investitionsstrategie** erkennt,
2. die STROMDAO-spezifischen Zahlen im Kontext sauber verwendet,
3. keine unbewiesenen Rechtsaussagen behauptet,
4. hypothetische Annahmen klar von Evidenz trennt,
5. sinnvolle Empfehlungen für Management / Geschäftsführung ableitet,
6. relevante Begriffe und Wissensquellen nutzt, z. B. ARegV, EnWG, EOG/EUG, fNAV, §14a/§8a, Redispatch/ZNP.

---

## 2. Vorbereitung: optionale Session Memory setzen

Der Test funktioniert auch ohne Memory. Aussagekräftiger wird er, wenn vorher STROMDAO-Kontext als Finance-Memory hinterlegt wird.

```bash
curl -sS -X POST "$CET_BASE_URL/api/finance-agent/memory" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CET_TOKEN" \
  -d '{
    "sessionId": "stromdao-totex-fnav-81mva-test",
    "memory": {
      "organization": "STROMDAO Netze GmbH",
      "project": "Zielnetzplanung / Netzanschluss / kaufmännische Steuerung",
      "knownFacts": [
        "Operative N-1-sichere Grenze im 20-kV-Netz: ca. 81 MVA.",
        "Aktueller Bezug liegt grob bei 77 MW.",
        "Offene Anschlussbegehren summieren sich auf ca. +33 MVA.",
        "Großwärmepumpe / WWVP: 18 MW Anschlussleistung, durch flexible Netzanschlussvereinbarung in der Spitze auf ca. 9,5 MW reduzierbar.",
        "STROMDAO-Mandat fokussiert End-to-End-Bereinigung, Abbau von Schatten-IT, Vermeidung von Blindflügen und datengetriebene Investitionsentscheidungen.",
        "Strategischer Shift: weg von reinem CAPEX/Kupferausbau hin zu TOTEX-Bewertung mit Flexibilität und Vermeidung von Stranded Assets."
      ],
      "decisionContext": "Bewertung, ob fNAV/Flexibilität kaufmännisch und regulatorisch als Alternative oder Brücke zum Netzausbau argumentiert werden kann.",
      "desiredOutput": "Managementtaugliche, evidenzgebundene Abwägung mit klarer Trennung von Fakten, Annahmen und offenen Prüfbedarfen."
    }
  }' | jq .
```

---

## 3. Haupttest: komplexe Analyse auslösen

```bash
curl -sS -X POST "$CET_BASE_URL/api/finance-agent/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CET_TOKEN" \
  -d '{
    "sessionId": "stromdao-totex-fnav-81mva-test",
    "query": "STROMDAO Netze hat im 20-kV-Netz eine N-1-sichere operative Grenze von ca. 81 MVA und liegt bereits bei rund 77 MW Bezug. Gleichzeitig liegen Anschlussbegehren von ca. +33 MVA vor. Für die Großwärmepumpe / WWVP stehen 18 MW im Raum, die über eine flexible Netzanschlussvereinbarung in der Spitze auf ca. 9,5 MW reduziert werden könnten. Bitte bewerte aus Sicht des kaufmännischen Bereichs, ob ein fNAV-/Flexibilitätsansatz gegenüber klassischem Kupferausbau regulatorisch und wirtschaftlich tragfähig argumentiert werden kann. Berücksichtige CAPEX, OPEX, TOTEX, EOG/EUG-Risiken, Stranded-Asset-Risiko, ARegV-Anreizwirkung, §14a/§8a/flexible Netzanschlüsse und die Anforderungen an eine vorstandsfähige Entscheidungsvorlage. Trenne harte Evidenz, regulatorische Regeln, Hypothesen und konkrete nächste Prüfbedarfe.",
    "mode": "rule_plus_hyde",
    "profileId": "stromdao_netze_kaufmaennische_steuerung",
    "topK": 10,
    "minScore": 0.25,
    "includeTrace": true,
    "includeMemoryContext": true,
    "includeA2AContext": true,
    "includeDatapointsContext": true,
    "contextLimit": 10,
    "persistMemory": true,
    "persistDatapoints": true,
    "allowHypotheticals": true,
    "collection": "tenant:stromdao-netze:knowledge"
  }' | tee /tmp/stromdao-finance-agent-response.json | jq .
```

---

## 4. Erwartetes Ergebnis

Der Test ist erfolgreich, wenn die Antwort folgende Eigenschaften zeigt.

### 4.1 Struktur / Status

Erwartet:

- `success: true`
- `id` vorhanden
- `status` idealerweise einer der folgenden:
  - `evidence_bound`
  - `hypothetical_scenario`
  - `needs_clarification`
- `summary` vorhanden
- `findings` / `evidence` / `legalReferences` / `oeoTags` vorhanden oder nachvollziehbar leer mit Finding
- bei `allowHypotheticals: true`: Hypothesen müssen als solche gekennzeichnet sein

### 4.2 Inhaltliche Mindesttreffer

Die Antwort sollte mindestens mehrere der folgenden Begriffe / Konzepte enthalten:

- CAPEX
- OPEX
- TOTEX
- ARegV
- EOG oder Erlösobergrenze
- EUG oder Effizienz / Effizienzvergleich
- Stranded Asset(s)
- flexible Netzanschlussvereinbarung / fNAV
- §14a EnWG oder steuerbare Verbrauchseinrichtungen
- §8a EEG, falls als flexible Anschlusslogik für EE/Speicher herangezogen
- N-1 / 81 MVA / 77 MW / +33 MVA / 18 MW / 9,5 MW
- Prüfbedarf / Evidenzlücke / Annahme

### 4.3 Fachliche Erwartung

Die ideale Antwort sagt **nicht** einfach „fNAV ist immer besser“.

Sie sollte differenzieren:

1. **CAPEX-Sicht:**
   - Klassischer Netzausbau erhöht aktivierbare Investitionen, kann aber bei unsicherem Kundenbedarf Stranded-Asset-Risiko erzeugen.

2. **OPEX-/Prozesssicht:**
   - fNAV/Flexibilität erzeugt operative Steuerungs-, Monitoring-, Vertrags- und Nachweiskosten.

3. **TOTEX-Sicht:**
   - Kaufmännisch entscheidend ist nicht CAPEX-Minimierung allein, sondern risikoadjustierte Gesamtkosten- und Erlöswirkung.

4. **Regulatorische Sicht:**
   - ARegV-/EOG-/Effizienzlogik muss sauber geprüft werden.
   - Keine harten regulatorischen Claims ohne Evidenz.

5. **Management-Sicht:**
   - Empfehlung als Brückenstrategie / Optionswert: fNAV kann Netzausbau zeitlich strecken, Bedarf validieren und Fehlinvestitionen vermeiden.
   - Vorstandsvorlage braucht Sensitivitäten: Vollausbau vs. fNAV vs. stufenweiser Ausbau.

6. **STROMDAO-spezifische Plausibilität:**
   - 81-MVA-Grenze und +33-MVA-Anträge müssen als Engpass-/Priorisierungsproblem erscheinen.
   - 18 MW → 9,5 MW muss als konkreter Hebel der Spitzenlastreduktion erkannt werden.

---

## 5. Automatisierte Smoke-Checks mit jq

```bash
jq -e '.success == true' /tmp/stromdao-finance-agent-response.json
jq -e '.id | type == "string"' /tmp/stromdao-finance-agent-response.json
jq -e '.summary | type == "string" and length > 50' /tmp/stromdao-finance-agent-response.json
jq -e '(.findings // []) | type == "array"' /tmp/stromdao-finance-agent-response.json
jq -e '(.evidence // []) | type == "array"' /tmp/stromdao-finance-agent-response.json
jq -e '(.legalReferences // []) | type == "array"' /tmp/stromdao-finance-agent-response.json
```

Keyword-Check:

```bash
cat /tmp/stromdao-finance-agent-response.json | jq -r '[.summary, (.answer // ""), ((.findings // []) | tostring)] | join("\n")' \
  | grep -Eiq 'CAPEX|OPEX|TOTEX|ARegV|Erlösobergrenze|EOG|Stranded|fNAV|flexible Netzanschluss|14a|8a|81 MVA|77 MW|33 MVA|9,5 MW|18 MW'
```

---

## 6. Negativ-/Guardrail-Erwartung

Der Test sollte fehlschlagen bzw. manuell reviewed werden, wenn der Agent:

- harte regulatorische Aussagen ohne Evidenz macht,
- fNAV pauschal als regulatorisch immer zulässig darstellt,
- die 81-MVA-/77-MW-/+33-MVA-Konstellation ignoriert,
- die 18-MW-zu-9,5-MW-Spitzenreduktion nicht als kaufmännischen Hebel erkennt,
- CAPEX isoliert optimiert und OPEX/TOTEX/EOG/EUG nicht behandelt,
- keine offenen Prüfbedarfe für eine Vorstandsvorlage benennt,
- generische Energiewirtschaftsfloskeln liefert statt STROMDAO-spezifischer Abwägung.

---

## 7. Follow-up-Test

Nach erfolgreichem Haupttest kann dieselbe `sessionId` für eine Nachfrage genutzt werden:

```bash
curl -sS -X POST "$CET_BASE_URL/api/finance-agent/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CET_TOKEN" \
  -d '{
    "sessionId": "stromdao-totex-fnav-81mva-test",
    "query": "Formuliere daraus bitte drei belastbare Varianten für eine Vorstandsvorlage: 1) klassischer Vollausbau, 2) fNAV als Brückenlösung, 3) stufenweiser Ausbau mit Optionswert. Bewerte je Variante kaufmännisches Risiko, regulatorische Evidenzlage und nächsten Datenbedarf.",
    "mode": "rule_plus_hyde",
    "profileId": "stromdao_netze_kaufmaennische_steuerung",
    "topK": 10,
    "minScore": 0.25,
    "includeTrace": true,
    "includeMemoryContext": true,
    "includeA2AContext": true,
    "includeDatapointsContext": true,
    "contextLimit": 10,
    "persistMemory": true,
    "persistDatapoints": true,
    "allowHypotheticals": true,
    "collection": "tenant:stromdao-netze:knowledge"
  }' | jq .
```

Erwartung: Der Agent sollte auf dem vorherigen Kontext aufbauen und die Varianten nicht neu/generisch erfinden.
