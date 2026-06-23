# Asset Valuation Transformation Gate

## Ziel

`asset_valuation_transformation_gate` ist eine read-only Management-Gate-Projektion fuer VNB-Assetentscheidungen. Der erste Slice fuehrt Buchwert, Assetzustand, Transformationsoption, Vertragsrisiko, regulatorische Unsicherheit, Datenqualitaet, Owner und naechste Entscheidung in einer dossier-faehigen Sicht zusammen.

## Nicht-Ziele

- Kein Bewertungs-, Treasury-, Accounting- oder Asset-Lifecycle-Backend.
- Keine neue Assetdatenbank und keine Asset-MDM-Mutation.
- Keine Investitionsfreigabe, Stilllegung, Umwidmung, Vertragsfreigabe, Billing-, Settlement-, Tarif-, MaKo- oder Device-Control-Aktion.
- Keine HITL-Erzeugung, kein externer Connector, keine Notification und kein Personal-Agent-Sonderweg.

## Datenvertrag

Eingaben sind caller-supplied Evidence- und Statusparameter:

- `assetId` oder `assetGroupId`
- `assetType`, `gridOperatorId`
- `bookValueStatus`, `bookValueSource`
- `assetConditionStatus`, `assetConditionSource`
- `transformationOption`, `transformationOptionBasis`
- `contractRisk`, `contractRiskBasis`
- `regulatoryUncertainty`, `regulatoryUncertaintyBasis`
- `dataQualityStatus`
- `decisionOwner`, `nextDecision`
- `sourceDatapoints`, `sourceRefs`

Der Output enthaelt `decisionReadiness`, `missingEvidence`, `positiveFollowUps`, `sourceActions.notCalled` und `dossierEvidence`.

## Gate-Stufen

- `ready_for_gate`: alle Kernnachweise sind vorhanden und Datenqualitaet ist nicht blockierend.
- `needs_book_value`: Buchwert- oder Restwertbasis fehlt.
- `needs_asset_condition`: technischer Zustand oder Zustandsquelle fehlt.
- `needs_contract_evidence`: Vertrags- oder Umsatzpfad-Risiko ist nicht belegt.
- `needs_transformation_option`: Stilllegung, Umwidmung, H2- oder Waermeoption ist nicht belegt.
- `needs_regulatory_assessment`: regulatorische Unsicherheit oder Entscheidungsgrenze fehlt.
- `blocked_by_low_data_quality`: Datenqualitaet ist niedrig, ungueltig oder blockierend.
- `needs_gate_metadata`: Owner, naechste Entscheidung oder Asset-Scope ist noch nicht vollstaendig.

## Evidenzgrenzen

Jede Bewertungsaussage bleibt Quelle oder Luecke. Unklare Annahmen werden nicht als Freigabe interpretiert. `sourceActions.notCalled` dokumentiert, dass keine Bewertungsbuchung, Asset-Mutation, Investmentfreigabe, Stilllegung, Umwidmung, Billing-, Settlement-, Tarif-, MaKo-, HITL-, Device-Control-, externe Connector- oder Personal-Agent-Aktion ausgefuehrt wurde.

## Dossier-Pfad

Der Slice ist fuer den Standardpfad gebaut:

`Capability Broker -> dashboard-api.assetValuationTransformationGateStatus -> Hydration Registry -> Slim Dossier`

Es gibt kein Personal-Agent-Hardcoding und keinen one-off n8n Branch.
