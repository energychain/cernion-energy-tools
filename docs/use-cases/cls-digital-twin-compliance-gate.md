# CLS Digital Twin Compliance Gate

## Ziel

`cls_digital_twin_compliance_gate` ist ein read-only Evidence-Gate fuer CLS-Schnittstellen, digitale Zwillinge und steuerungsnahe Beschaffungsvorhaben. Die Capability macht sichtbar, ob ein Anbieter- oder Pilotentscheid governance-ready ist, bevor Beschaffung, Betrieb oder CLS-/SMGW-Aktivierung ausgefuehrt werden.

## Nicht-Ziele

- keine Procurement-, Legal-, DSFA- oder RBAC-Engine
- keine Anbieterfreigabe, Rechtsmeinung oder regulatorische Authority-Aussage
- keine HITL-, VDMI-, Billing-, Settlement-, MaKo-, CLS-, SMGW- oder Device-Control-Mutation
- kein externer Connector, keine Secret-/Key-Handhabung und kein Personal-Agent-Sonderweg

## Gate-Contract

Der erste Slice wird ueber `dashboard-api.clsDigitalTwinComplianceGateStatus` und `GET /api/dashboard/cls-digital-twin-compliance-gate` bereitgestellt. Inputs bleiben Anfrage-/Query-basiert und tenant-scoped:

- `procurementId`, `vendorId`
- `systemPurpose`, `digitalTwinScope`, `clsInterfaceScope`
- `dataFlowMap`, `personalDataCategories`
- `rolesAccessRights`, `rbacRefs`
- `avvStatus`, `ndaStatus`, `worksCouncilStatus`, `dsfaStatus`
- `billingModuleImpact`, `regulatoryEvidenceStatus`, `securityEvidenceRefs`
- `approvalStatus`, `sourceEvidenceRefs`, `sourceSnapshot`

## Statuslogik

- `needs_system_purpose`: Systemzweck fehlt.
- `needs_data_flow_map`: Datenflusskarte fehlt.
- `needs_rbac_decision`: Rollenrechte oder RBAC-Nachweise fehlen.
- `needs_contractual_evidence`: AVV oder NDA fehlen.
- `needs_dsfa`: Betriebsvereinbarungs-/BR- oder DSFA-Status fehlt.
- `needs_billing_review`: Abrechnungs-/Modulwirkung fehlt.
- `needs_regulatory_security_evidence`: regulatorischer oder Security-Nachweis fehlt.
- `needs_source_evidence`: Quellenreferenzen fehlen.
- `blocked_by_compliance`: geliefertes Approval-Signal blockiert die Beschaffung.
- `ready_for_procurement_review`: alle Evidenzfelder fuer den Review sind synthetisch vollstaendig.

## Dossier-Evidence

Die Slim-Dossier-Ausgabe enthaelt Status, Readiness Score, Gate-Kontext, Compliance-Evidence, Decision Steps, Missing Evidence, Positive Follow-ups, blockierte Entscheidungen und `sourceActions.notCalled` Guards. Hydration darf nur die read-only Status-Action ausfuehren.

## Side-Effect Guards

Das Gate ruft keine Freigaben oder Mutationen aus. Explizit nicht aufgerufen werden unter anderem `procurement.approve`, `legal.approve`, `dsfa.create`, `rbac.grant`, `hitl.create`, `billing.release`, `settlement.prepareBilling`, `mako.dispatch`, `cls.executeControl`, `smgw.switch`, `device-control.execute`, `external.connector.call` und `personal-agent.execute`.
