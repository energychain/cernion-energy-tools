# Direktvermarkter Risikogate

## Zweck

Das Direktvermarkter Risikogate ist eine read-only Evidenzsicht fuer VNB-/EVU-nahe Energy-Sharing- oder Gemeinschaftsstrom-Modelle. Es zeigt, ob ein Handover-Paket fuer einen externen Direktvermarkter kalkulierbar ist, bevor Angebot oder Vertrag fachlich freigegeben werden.

## Evidenzumfang

- Prognosequalitaet und Prognoseabweichung
- Allokationsregeln fuer Erzeuger- und Verbrauchsmengen
- Bilanzkreis- und Fahrplanwirkung
- Abrechnungs- und Settlement-Status
- Rollen-Owner, Frist und offene Nachweise

## Grenzen

Die Capability fuehrt keine Direktvermarktung aus. Sie uebertraegt keinen Bilanzkreis, sendet keinen Fahrplan, genehmigt kein Angebot und keinen Vertrag, mutiert keine MaKo-, Billing-, Settlement-, Tarif-, Kundendaten- oder Geraetesteuerungsprozesse und ruft keine externen Direktvermarkter-Systeme auf.

## Consumption Contract

- API: `GET /api/dashboard/direct-marketer-risk-gate`
- Action: `dashboard-api.directMarketerRiskGateStatus`
- Capability: `direct_marketer_risk_gate`
- Safety: read-only, dossier-safe, non-consequential
- Dossier-Hydration: nur ueber die allowlistete Status-Action mit Slim Formatter
