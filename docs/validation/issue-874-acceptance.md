# Abnahme #874

| Abnahmekriterium | umgesetzt in | Test |
| --- | --- | --- |
| A.1 | workbench-code-sources; EDIFACT-Adapter; vorhandene RAG-Adapter | 874: genaue Quelle/Familie/Fundstelle, Code-Präfixe; Szenarien 1–2 |
| A.2 | codeAnswer; aktueller schemagebundener Codevertrag | 874: je unbelegtem Wert ausdrücklicher Hinweis; Szenarien 1–2 |
| A.3 | docs/workbench-communication.md; leere kontrollierte Testwissensbasis | Live-Quellenspuren; dokumentierte fehlende Codelisten/AHB |
| B.1 | tenant-memory-schema/capture; workbench-tenant-glossary; auditierte GET-Route | 874: Schreiben, anderer Chat, Audit, Redaktion; Szenario 3 |
| B.2 | gemeinsames Lagebild, Tokenrollen und Artefaktvertrag | 874: unbekannter Gegenstand/Rückfrage, interne Form; Szenario 3 |
| C.1 | workbench-disclosure-review nach Entwurf; tatsächliche Evidenz und interne Systeme | 874: getrennte Prüfung, unvollständige Prüfung, fehlerhafte Freigabe; Szenario 4 |
| C.2 | Brief-Form getrennt von Zielgruppe; interne Absätze bleiben intern | 874: interne Briefe/Sachartefakte, getrennte Teile; Szenarien 4–5 |
| D.1 | Gesprächspräferenzen in Turn-/Fallgedächtnis, Quelle bei Fallsuche | 874: Register/Kürze/Sprachverbote, formale Bestätigung; Szenario 5 |
| D.2 | answerInstruction/validateCommunication; positive Befassungssprache | 874: ausgeschlossene Wortstämme und Artefaktteile; Szenario 5 |
| D.3 | qualifizierte Wissensfundstellen oder ausdrücklich zu prüfende Annahme | 874: normative Aussage ohne Fundstelle; Szenario 9 |
| E.1 | schemagebundene Präferenzextraktion; questionsFor | 874: Modus bleibt erhalten, 1–3 neue relevante Fragen; Szenario 6 |
| E.2 | bestehende #813-Regel und gespeicherte Frage-Keys | 813 + 874: übliche Rückfragepraxis, keine Wiederholung/unnötige Kennung |
| F.1 | Vorschlag im Gespräch; bestätigte Anlage über bestehenden Router | 874: kein vorzeitiger Fall, Leg an, Wiederholung/anderer Tenant; Szenario 7 |
| F.2 | caseWork in Fall/Turn; bestehende semantische Suche und Statusroute | 874: Arbeitsfelder, anderer Chat, schreibgeschützte Statussuche; Szenario 7 |
| G | wörtliche Beobachtung/Nutzerhypothese; vier getrennte Abschnitte | 874: keine neue eigene Annahme, keine unbelegte Beobachtung; Szenario 8 |
| 1 | communication-1; bestehende Praxis-Suite | workbench-874.test.js + mindestens drei echte lokale Live-Läufe |
| 2 | communication-2; bestehende Praxis-Suite | workbench-874.test.js + mindestens drei echte lokale Live-Läufe |
| 3 | communication-3; bestehende Praxis-Suite | workbench-874.test.js + mindestens drei echte lokale Live-Läufe |
| 4 | communication-4; bestehende Praxis-Suite | workbench-874.test.js + mindestens drei echte lokale Live-Läufe |
| 5 | communication-5; bestehende Praxis-Suite | workbench-874.test.js + mindestens drei echte lokale Live-Läufe |
| 6 | communication-6; bestehende Praxis-Suite | workbench-874.test.js + mindestens drei echte lokale Live-Läufe |
| 7 | communication-7; bestehende Praxis-Suite | workbench-874.test.js + mindestens drei echte lokale Live-Läufe |
| 8 | communication-8; bestehende Praxis-Suite | workbench-874.test.js + mindestens drei echte lokale Live-Läufe |
| 9 | communication-9; bestehende Praxis-Suite | workbench-874.test.js + mindestens drei echte lokale Live-Läufe |

Die endgültigen Live-Ergebnisse und der Vergleich mit der unveränderten Vorversion werden in den verlinkten Validierungsberichten dokumentiert. Eine reduzierte Szenarioauswahl setzt das vollständige Release-Gate nicht grün.

