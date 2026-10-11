# Domain Objects

Generated: 2026-10-11T01:32:48.510Z

## Stable objects for agentic development

- Case: fachlicher Vorgang mit Actor, Kontext, Zustand, offenen Punkten und nächster Handlung.
- Actor/Human: Rolle im Prozess, nicht nur User-ID; z.B. Sachbearbeitung, Assistenz, Netzplanung, Kunde, Marktpartner, Geschäftsführung.
- Capability: fachliches Können mit Intent, Eingangsbedingungen, Evidence Boundary, HITL Boundary und Antwortvertrag.
- Evidence Requirement: Nachweisbedarf, der Aussagekraft begrenzt, nicht jede Hilfestellung verhindert.
- Practice Hypothesis: begründete fachliche Arbeitshypothese, die als unsicher markiert bleibt.
- Process State: bekannt, plausibel, offen, blockiert, entscheidungsreif, HITL-pflichtig.
- Tool Contract: erlaubte technische Aktion in einem Prozesszustand.
- Decision Point: Stelle, an der CET vorbereitet, aber ein Mensch entscheidet oder handelt.
- Natural Workflow: fachliche Schrittfolge, die auch ohne vollständige formale Prozessdefinition bearbeitbar ist.

## Mapping expectation

Neue Services oder Actions sollen mindestens einem Domain Object und einem Process Pattern zugeordnet werden. Sonst bleiben sie für OpenWebUI/Agentic Core fachlich blind.
