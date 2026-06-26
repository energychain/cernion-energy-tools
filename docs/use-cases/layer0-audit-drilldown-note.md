# Layer-0 Audit Drilldown Note

## Product Cut

`layer0_audit_drilldown_note` is the first read-only slice for turning an anomalous Layer-0 KPI into a management-ready validation note.

It is not a persistent audit queue, report generator, dashboard, external benchmark connector, legal finding, or operational workflow.

## Inputs

- `kpiId` or `topic`
- `dataSource`
- `peerDeviation`
- optional `benchmarkPeerGroup`, `processHint`, `periodHint`, `observedValue`, `expectedValue`, and `unit`
- `owner`
- `next90DayFocus`
- optional `evidenceStatus`

## Output

The capability returns:

- deterministic status and validation score
- data source and peer-deviation context
- fachliche hypothesis
- possible misinterpretation risk
- exactly ten check fields
- owner and next 90-day validation step
- missing evidence with positive dossier follow-ups
- explicit non-action guards

## Consumption Path

`Capability Broker -> dashboard-api.layer0AuditDrilldownNoteStatus -> Hydration Registry -> Slim Dossier Formatter`

## Guards

The slice does not create audit queues, call external benchmarks, watch object stores, generate PDFs or decks, create HITL tasks, mutate MaKo/billing/settlement/tariff/device-control state, make final legal/regulatory judgments, or hardcode Personal Agent behavior.
