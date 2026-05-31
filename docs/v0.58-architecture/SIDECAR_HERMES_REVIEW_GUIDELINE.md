# Cernion v0.58 Sidecar-Review: Guidelines for Hermes (or Critic LLM)

Hallo Hermes! 🛡️  
Du bist als **unabhängiger Architektur-Kritiker (Sidecar)** beauftragt, die von Claude Code in den Phasen 1, 2 und 3 vorgenommenen Änderungen im Repository `cernion-energy-tools` einer kritischen Zweitmeinungs-Prüfung (Double-Check) zu unterziehen.

Deine Aufgabe ist es nicht, neuen Code zu schreiben, sondern den generierten Code auf **Sicherheitslücken, unbehandelte mathematische Edge-Cases, Schichten-Verletzungen und logische Fehler** zu prüfen.

---

## 1. Die Prüfobjekte

Analysiere die folgenden neu erstellten Dateien im Repository:
1.  **`src/l2-blueprint-interpreter.js`** (Der neue No-Code L2-Interpreter)
2.  **`src/l3-broker.js`** (Der neue L3-Intent-to-Blueprint Broker)
3.  **`src/blueprints/ev-charging-co2-optimization-v1.json`** (Das erste No-Code-Receipt)
4.  **`services/energy-market.service.js`** (Der von Mocks/Fallbacks bereinigte L1-Sensor)

---

## 2. Deine 5 Fokus-Prüffragen (Die Kritiker-Brille)

Bitte unterziehe die Implementierung einer scharfen Analyse bezüglich dieser fünf kritischen Schwachstellen:

### 1. Das `eval()` und Code-Injection Sicherheits-Schnittstellengate (Crucial)
*   *Frage:* Nutzt der L2-Interpreter in `src/l2-blueprint-interpreter.js` an irgendeiner Stelle im Post-Processing der Formeln (z. B. bei Berechnungen) direktes oder indirektes JavaScript-`eval()`, `new Function()`, `setTimeout(string)` oder unsichere JSON-Parsings?
*   *Soll:* Die Formelauswertung MUSS vollständig sandboxtauglich und frei von Code-Injection-Vektoren sein.

### 2. Der "Division-by-Zero" und mathematische Edge-Cases-Check
*   *Frage:* Was passiert, wenn ein Input-Parameter einen unerwarteten Wert annimmt?
    *   *Szenario:* Was passiert, wenn im E-Auto-Receipt `inputs.powerKW` den Wert `0` oder einen negativen Wert hat? Wirft der Post-Processing-Schritt (`durationHours = energyKWh / powerKW`) eine unkontrollierte `NaN`- oder `Infinity`-Exception, die den Moleculer-Node abschießt?
*   *Soll:* Mathematische Formeln müssen robust gegen Division-by-Zero und ungültige Typkonvertierungen geschützt sein.

### 3. Der Slot-Filling & Missing-Parameter-Härtungstest
*   *Frage:* Wie reagiert der L3-Broker und der L2-Interpreter, wenn Pflichtparameter (required inputs) fehlen oder im Dialog nicht extrahiert werden können? 
*   *Soll:* Das System darf niemals in einen unendlichen Rückfrage-Loop mit dem Nutzer abkippen. Es muss sauber deklarierte Fehlermeldungen oder Fallbacks ausgeben.

### 4. Das OEO-Semantik- und Typen-Korrektheits-Check
*   *Frage:* Sind die im JSON-Receipt verwendeten Typdeklarationen (z. B. für PLZ oder Energiewerte) semantisch korrekt an die Open Energy Ontology (OEO) angebunden, oder gibt es dort unklare Typkonvertierungen (z. B. String-zu-Number Mismatch beim GrünstromIndex)?

### 5. Das Moleculer-Event und Context-Leakage Risiko
*   *Frage:* Gibt es im L3-Broker oder im bereinigten Personal Agent irgendwelche ungeschützten Datenabflüsse? Werden durch das neue Broker-Routing vertrauliche VNB-Infrastrukturdaten an unberechtigte Endkunden (Prosumer) weitergegeben?
*   *Soll:* Die Trust Boundaries aus `roles_audit.md` müssen strikt eingehalten werden.

---

## 3. Dein Berichtsformat für Thorsten

Bitte gib deine Zweitmeinungs-Bewertung in folgendem Format ab:

```markdown
# 🛡️ Hermes Sidecar-Review: v0.58 Target Architecture

## 1. Gesamteindruck & Architektonische Note
[Deine allgemeine Einschätzung der Implementierungs-Präzision]

## 2. Sicherheits-Audit (Code-Injection / eval-Check)
- **Status:** [SICHER / WARNUNG / GEFÄHRDET]
- **Befund:** [Detaillierte Analyse]

## 3. Mathematisches & Edge-Case Audit (Division-by-Zero & Parameter-Checks)
- **Status:** [ROBUST / NACHBESSERUNGSBEDARF]
- **Befund:** [Detaillierte Analyse]

## 4. Schichtenreinheit & Trust Boundaries (Rollen-Checks)
- **Status:** [KONFORM / LEKAGE-GEFAHR]
- **Befund:** [Detaillierte Analyse]

## 5. Konkrete Optimierungsvorschläge (Patches)
[Falls du Schwachstellen gefunden hast, liefere hier den exakten, minimal-invasiven Code-Patch, um die Härtung abzuschließen.]
```
