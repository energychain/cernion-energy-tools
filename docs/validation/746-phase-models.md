# Issue 746: Modell- und Denkbudget pro Phase

Gemessen am 2026-10-07 mit echten Gemini-Aufrufen ausschließlich über
`src/llm-client.js`. Anonymisierte Dreiturn-Anfrage; Quellendienste sind lokal
geprüfte Stubs, kein Produktions-Retrieval. Rohberichte enthalten Antworttexte,
Phasenzeiten, Quellen und Schema-Diagnostik; keine Schlüssel.

Empfohlene Konfiguration:

```dotenv
WORKBENCH_LLM_MODEL=gemini-3.5-flash-lite,gemini-3.5-flash
WORKBENCH_LLM_TIMEOUT_MS=4500,45000
WORKBENCH_LLM_THINKING=minimal,default
```

| Lauf | Erstturn | Inhaltlicher Folgeturn | Entwurfs-Folgeturn |
|---|---:|---:|---:|
| Ausgangsprompt, 3.5 Flash | 13,829 s | 16,474 s | 11,642 s |
| Kürzerer Folgeturn-Prompt, 3.5 Flash | 13,306 s | 12,997 s | 9,174 s |
| Vergleich, Antwortmodell 3.8 Flash | 20,915 s | 32,564 s | 23,863 s |

Im empfohlenen Lauf mit kürzerem Prompt: understand/retrieve/answer in ms:
Erstturn 2944/8/10254; Folgeturn 2810/2/10143; Entwurf 0/0/9130.
Alle drei Antworten bestanden die Schema-Validierung. Metadaten und Logs
enthalten die Phasenzeiten bereits seit PR #747.

**AC-02 unter 10 Sekunden ist nur beim Entwurfs-Folgeturn erreicht, beim
inhaltlichen Folgeturn noch offen.** Das Provider-Denkbudget wird beim Antworten
nicht künstlich abgesenkt; 45000 ms bleibt die tatsächliche Timeout-Obergrenze.
Die Empfehlung ist eine Qualitäts-/Budgetkonfiguration, keine Latenzgarantie.

Rubrik (1 schlecht, 5 gut), kürzerer 3.5-Lauf: verstanden 4; nützlich 3;
Ton 4; Entwurf brauchbar 3; ehrlich bei Unsicherheit 3. Die Antworten übernehmen
bekannte Kennungen und erfinden keinen Bearbeitungsstand. Der Entwurf benötigt
den tatsächlichen Status als Platzhalter. Der inhaltliche Folgeturn wurde nach
Claim-Filterung aus vorhandenem Lagebild/Quellen gerendert und wiederholt zu viel
Kontext. Modell-Selbstauszeichnung von Claims bleibt eine Qualitätsgrenze.

Validierung: 695 Workbench-Tests; gezielte Phasen- und Speicherfehler-Tests;
HTTP-e2e 20,00 s; Harness 86 Tests in 28,37 s (<60 s); Lint (0 Fehler, eine
bestehende Warnung), check:domain-free-core, check:llm, audit:openapi (0 Fehler,
474 bestehende Warnungen), git diff --check. Der veraltete Folgeturn-Assert aus
Maintenance CI von PR #747 ist auf erhaltene nächste Schritte und Quellen
aktualisiert; die Speicherfehler-Prüfung bleibt bestehen.

Risiko: llmOptions GitNexus upstream HIGH (2 direkte Aufrufer, 5 betroffene
Symbole); answer LOW. detect_changes: nur erwartete Options-/Prompt-/Test- und
Dokumentationsänderungen, kein betroffener indexierter Ablauf. Technische
Außenwirkungs-Sperren bleiben erhalten. Höhere Antwortbudgets können Requests
länger binden; Proxy-Timeout mindestens 120 s. Reale Modelllatenz und Qualität
bleiben variabel. Der Dreiturn-Lauf ist kein Produktionslasttest.
