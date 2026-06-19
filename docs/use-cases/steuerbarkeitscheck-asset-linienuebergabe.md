# Steuerbarkeitscheck Asset-Linienuebergabe

## Ziel

Die Asset-Linienuebergabe macht nach einem Steuerbarkeitscheck sichtbar, ob ein steuerbares Asset mit belastbarer Evidenz in die Linienverantwortung uebergeben werden kann. Der erste Schnitt ist ein read-only Evidence/Handover Contract fuer Answer Dossier, Capability Broker und Dashboard API.

## Datenvertrag

`controllability_asset_handover` beschreibt:

- Asset- und Anschlussbezug: `assetId`, `mastrId`, `napId`, `meloId`, `technologyType`, `capacityKW`.
- Steuerbarkeitsbezug: `controllabilityScope`, `technicalStatus`, `feedbackCapability`, `checkStatus`, `evidenceStatus`.
- Quellenbezug: `dataSourceRefs`, `sourceSnapshotId`.
- Linienuebergabe: `lineOwnerRole`, `handoverDecision`, `nextReportingCycle`, `nonExecutionReason`.

Fehlende Felder bleiben explizite Evidence Gaps. Sie werden nicht aus anderen Aussagen abgeleitet.

## Source-Action-Grenzen

Der read-only Status referenziert vorhandene Quellen wie `assets.effective`, `mastr-quality.audit`, `redispatch-expost.audit`, `datapoint.health`, `vdmi.dossier` und `interface-placeholder.requestEvidence`. Die erste Umsetzung ruft diese Aktionen nicht mutierend auf, sondern dokumentiert sie als Herkunfts- und Folgepfad.

Nicht aufgerufen werden `hitl.create`, `assets.applyOverride`, `grid-operations.executeControl`, `settlement.exportA96`, `settlement.prepareBilling` und externe Connectoren.

## API-Smoke

Sicherer DevServer-Smoke:

```bash
curl -sS -H 'X-Tenant-Id: public' \
  'http://localhost:3900/api/dashboard/controllability-asset-handover?caseId=case-194-smoke&assetId=asset-194&technicalStatus=checked&lineOwnerRole=assetmanagement'
```

Erwartung: HTTP 200, `safety=read_only`, explizite fehlende Evidenz fuer Rueckmeldefaehigkeit, Quellenbezug, Meldezyklus und Uebergabeentscheidung, keine HITL-, Settlement- oder Device-Control-Aktion.

## Nicht-Ziele

Kein neues Asset-MDM, keine neue Steuerbarkeitsregelengine, keine MaStR-/Redispatch-/SMGW-/CLS-/Device-Control-Mutation, keine MaKo-, Billing-, Settlement- oder Tarifwirkung, keine HITL-Queue, keine externen Connectoren und kein Personal-Agent-Sonderpfad.
