# Cernion v0.58 Sprint: Instructions for Claude, Hermes, & CoPilot

Hallo Kollege! 🤖  
Du bist als AI-Agent (Claude, Hermes, CoPilot oder Cursor) beauftragt, den **Sprint v0.58 ("Strict Layering & Kaskadierende Broker")** in Cernion Energy Tools zu planen und umzusetzen.

Dieses Dokument ist dein **Einstiegs-Wegweiser (Instructions)**. Es zeigt dir genau auf, welche Dokumente du lesen musst, wie du den Ist-Zustand erfasst und wie wir schrittweise den Code-Zuwachs stoppen, indem wir Heuristiken in No-Code-Receipts auslagern.

---

## 1. Deine Navigations-Karte (Lese-Reihenfolge)

Bevor du eine Zeile Code änderst, lies diese Dokumente in der exakten Reihenfolge:

1.  **`docs/v0.58-architecture/ADR_001_STRICT_LAYERS_AND_DECLARATIVE_ORCHESTRATION.md`**  
    *Zweck:* Verstehe das architektonische Kern-Prinzip. Warum wir in die "Legacy-Falle" gelaufen sind, wie wir das System in Layer 0 bis 3 unterteilen und was der selbstlernende "Hypothese-Modus" der Broker ist.
2.  **`docs/v0.58-architecture/DECLARATIVE_BLUEPRINT_AND_CASCADING_BROKER_SPEC.md`**  
    *Zweck:* Das ist deine Implementierungs-Bibel. Sie deklariert das exakte JSON-Schema für die No-Code-Receipts (Layer 2), die Broker-APIs und die mathematische Feedback-Schleife.
3.  **`docs/v0.58-architecture/TARGET_ARCHITECTURE_LAYER_PLAN.md`**  
    *Zweck:* Die Soll-Klassifizierung aller 76 Services im Repository. Hier siehst du, welcher Service in welche Schicht gehört.
4.  **`docs/v0.58-architecture/LAGEBILD_EXPLORATION_PROTOCOL.md`**  
    *Zweck:* Das Protokoll, wie wir das Lagebild erstellt haben, und wie du gezielt einzelne Slices auditieren kannst.

---

## 2. Der Umgang mit der `llm.txt` (Ist-Zustand vs. Soll-Zustand)

Im Hauptverzeichnis des Repositories liegt eine sehr große **`llm.txt`**.

*   **Nutze `llm.txt` als Ist-Zustand-Karte:**  
    In `llm.txt` findest du das vollständige, zusammenhängende Bild der aktuellen Codebase (einschließlich aller unaufgeräumten, hartcodierten Weichen). Nutze diese Datei, um das Zusammenspiel der Services, Actions und Event-Definitionen im Ganzen zu verstehen. Du musst nicht 76 einzelne Service-Dateien durchsuchen – alles Relevante steht hier.
*   **Nutze dieses Verzeichnis als Soll-Zustand-Kompass:**  
    Lass dich nicht vom aktuellen, unaufgeräumten Code in `llm.txt` dazu verleiten, weitere hartcodierte Weichen (z. B. `if-else` für neue Städte, Mappings oder Formeln) hinzuzufügen. Jede fachliche Logik gehört ab v0.58 deklarativ in ein L2-JSON-Receipt!

---

## 3. Die 4 fachlichen Audit-Berichte (Dein Arbeits-Backlog)

Im Unterverzeichnis `lagebild/` findest du die detaillierten, automatisiert generierten Berichte über den aktuellen Zustand aller Services:

*   **`lagebild/tranche_b.md` (Layer 0 - Infrastruktur):**  
    *Befund:* 100 % grün. Die technische Schleuse ist stabil. Hier musst du nichts tun.
*   **`lagebild/tranche_a.md` (Layer 1 - Datensensoren):**  
    *Befund:* Gelbe Ampeln. Hier müssen hartcodierte Default-Mocks (Mauer, Frankenthal etc.) als reine Eingabe-Parameter isoliert und entfernt werden, um die Sensoren zustandslos zu machen.
*   **`lagebild/tranche_c.md` (Layer 2 - Orchestrierung):**  
    *Befund:* Das Kern-Arbeitsfeld. Große Services wie `znp` und `cya` enthalten noch hartcodierte Berechnungslogiken, die wir in deklarative JSON-Receipts gießen müssen.
*   **`lagebild/tranche_d.md` (Layer 3 - Kognitive Cores):**  
    *Befund:* Der Flaschenhals. `personal-agent.service.js` (295 KB) trägt tonnenweise Legacy-Lasten. Sobald der L2-Broker fertig ist, filetieren wir diese Services und löschen bis zu 80 % des dortigen Codes.
*   **`lagebild/roles_audit.md` (Die Fachlichen Rollen / Trust Boundaries):**  
    *Befund:* Die Zuordnung aller 76 Services zu den 10 internen und externen Branchen-Rollen (Prosumer, VNB, Lieferant, Projektentwickler, Investor etc.). Nutze diese Tabelle, um die Datengrenzen (Trust Boundaries) für deine Blueprints festzulegen.

---

## 4. Taktische Umsetzungs-Reihenfolge für v0.58

Halte dich strikt an diese Reihenfolge, um regressionsfreie, saubere Übergänge zu garantieren:

### Phase 1: Der L2-Interpreter (Rein Additiver Core-Bau)
Bevor du bestehende Codezeilen löschst oder änderst, baue den **L2-Blueprint-Interpreter** in `services/agent-receipts.service.js` (oder als Helper-Klasse) auf. 
*   Er muss das JSON-Blueprint parsen, die geforderten L1-Sensoren über den L2-Broker triggern, und die mathematischen Berechnungen im Post-Processing deklarieren und ausführen.
*   Schreibe Unit-Tests, die beweisen, dass der Interpreter für ein Test-Receipt (z. B. das CO2-optimierte Laden) perfekt funktioniert.

### Phase 2: Die ersten deklarativen Blueprints & L1-Säuberung
*   Schreibe das erste schichtenreine JSON-Receipt für das CO2-optimierte E-Auto-Laden (`ev-charging-co2-optimization-v1.json`).
*   Entferne die hartcodierten default Ort- und PLZ-Fallbacks aus dem L1-Dienst `energy-market.service.js`.

### Phase 3: Die L3-Core Entschlackung (Der Schmelz-Schnitt)
*   Entferne die gigantischen, hartcodierten Prompt- und Syntheseweichen aus `personal-agent.service.js`.
*   Ersetze sie durch den Aufruf des L3-Brokers, der den Intent erkennt, das L2-Receipt aufruft, Slots füllt und das Ergebnis generisch präsentiert.

Viel Erfolg! Lass uns Cernion v1.0-ready machen! 🚀
