# Wissensbedarfe – Lückenbericht

Generator: `scripts/generate-knowledge-needs.js` (Ableitung v1, Parameterliste v1).

## Umfang

- Bedarfe: 52
- Art contact: 29
- Art dataset: 13
- Art fact: 3
- Art identifier: 7
- Quelle capability: 39
- Quelle endpoint: 1
- Quelle function: 29
- Quelle semanticDomain: 13

## Höchste Priorität

| Bedarf | Art | Priorität | Funktionen | Erschließt |
|---|---|---|---|---|
| Netzbetreiber ID (`gridOperatorId`) | identifier | 1 | 29 | 139 |
| iMSys-/CLS-Messbereich (`meteringScope`) | fact | 0.6301 | 3 | 21 |
| Sparte (`division`) | fact | 0.5121 | 1 | 12 |
| ENTSO-E Region / Bidding Zone (`region`) | fact | 0.485 | 1 | 10 |
| Netzgebiet (`networkArea`) | identifier | 0.4534 | 1 | 8 |
| BDEW-Code (13-stellig) (`bdew`) | identifier | 0.368 | 1 | 4 |
| Grid area ID (`gridAreaId`) | identifier | 0.368 | 1 | 4 |
| Bilanzkreis (`balanceGroupId`) | identifier | 0.3388 | 1 | 3 |
| Steuerbarkeit · Anlagen · Übergabe (`contact:fn-controllability-asset-handover`) | contact | 0.3388 | 1 | 3 |
| Anlagen · Bewertung · Umbau · Freigabeprüfung (`contact:fn-investment-budget-cap-exception-governance`) | contact | 0.3388 | 1 | 3 |
| VNB Identifier (`vnbId`) | identifier | 0.3388 | 1 | 3 |
| Entscheidung · Gegenstand · Bedeutung · Erhalt (`contact:fn-a2mdm-decision-object-meaning-preservation`) | contact | 0.3043 | 1 | 2 |
| Finanzierung · Sorgfalt · Prüfung · Bewertung (`contact:fn-budget-waterfall-governance`) | contact | 0.3043 | 1 | 2 |
| Kommunikation · Unterbrechung · Ablauf · Risiken (`contact:fn-communication-break-process-risk`) | contact | 0.3043 | 1 | 2 |
| Steuerbarkeit · Einreichung · Übersicht (`contact:fn-controllability-submission-cockpit`) | contact | 0.3043 | 1 | 2 |
| Krise · Entscheidung · Routine (`contact:fn-crisis-decision-routine`) | contact | 0.3043 | 1 | 2 |
| Übergreifend · Fachbereiche · Sonderfälle · Themen · Aufgabenliste (`contact:fn-cross-domain-special-topics-queue`) | contact | 0.3043 | 1 | 2 |
| Entscheidung · Bereitschaft · Übersicht (`contact:fn-decision-readiness-matrix`) | contact | 0.3043 | 1 | 2 |
| Nachweise · Aktualität · Prüfung (`contact:fn-evidence-freshness-guard`) | contact | 0.3043 | 1 | 2 |
| Übergreifend · Kommunikationswege · Verteilnetz · Hinweise · Aufgabenliste (`contact:fn-fnav-fast-track-contract-gate`) | contact | 0.3043 | 1 | 2 |

## Lücken

- Bedarfe ohne fachliche Bezeichnung: keine
- Pflichteingaben ohne Bezeichnung oder Typ: project_skill_learning.projectId
- Verknüpfungsschlüssel ohne Wissensbedarf: `assetId`, `mastrNummer`
- Datenarten ohne erschlossene Quelle: `dataset:billing-overview`, `dataset:customer-projects`, `dataset:forecast-vs-actual`, `dataset:grid-incidents`, `dataset:mako-process-log`, `dataset:mastr-local`, `dataset:metering`, `dataset:metering-point-master`, `dataset:other`, `dataset:procurement`, `dataset:receivables`, `dataset:redispatch-queue`
- Eingaben als vorgangsbezogen eingeordnet (kein Bedarf): 308
