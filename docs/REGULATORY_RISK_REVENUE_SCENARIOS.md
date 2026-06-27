# Regulatory Risk Revenue Scenarios

This contract defines the first Cernion slice for turning a regulatory signal into a
read-only revenue-risk briefing. It is a cookbook and capability-routing contract, not
a new legal-opinion engine, tariff decision flow or persistent risk platform.

## Product Boundary

`regulatory_risk_revenue_scenario` answers one management question:

> Which revenue or process risk follows from this regulatory signal, what data is
> needed, what bounded scenario range can be calculated, and which management gate
> should own the next decision?

The first implementation reuses existing surfaces:

- `cya.generate` for regulatory signal context and grounded uncertainty.
- `regulatorische-entgeltlogik.getActive` for active rule-set windows and legal-basis references.
- `eog-calculator.inputStatus` for revenue-cap data requirements.
- `eog-calculator.calculate` for baseline revenue-cap calculation when inputs are sufficient.
- `eog-calculator.scenario` for transient downside/upside assumptions.
- `finance-agent.analyze` for evidence-bound financial narrative.
- `decision-frame` for the management-gate contract.
- `datapoint.createSnapshot` for optional audit-stable evidence references.

## Output Contract

A briefing should expose answer-ready facts in this shape:

```json
{
  "capability": "regulatory_risk_revenue_scenario",
  "safety": "read_only_non_consequential",
  "signal": {
    "ruleId": "string|null",
    "source": "string",
    "severity": "low|medium|high|unknown",
    "confidence": "low|medium|high",
    "deadline": "YYYY-MM-DD|null"
  },
  "affectedProcesses": [
    "netzentgelt",
    "eog",
    "reporting",
    "section_14a",
    "redispatch"
  ],
  "dataRequirements": [
    {
      "key": "eog.quality_element",
      "status": "available|missing|assumed",
      "enablesDossierAddition": "baseline revenue-cap calculation"
    }
  ],
  "revenueScenario": {
    "calculationMode": "scenario",
    "persisted": false,
    "baseline": { "amountEur": null, "evidenceRef": "string|null" },
    "downside": { "amountEur": null, "assumptions": [] },
    "upside": { "amountEur": null, "assumptions": [] }
  },
  "riskRange": {
    "minEur": null,
    "baseEur": null,
    "maxEur": null,
    "confidence": "low|medium|high",
    "assumptions": []
  },
  "countermeasures": [
    {
      "type": "data|process|tariff-preparation|governance",
      "description": "string",
      "notAnApproval": true
    }
  ],
  "decisionGate": {
    "owner": "string|null",
    "dueDate": "YYYY-MM-DD|null",
    "threshold": "string|null",
    "recommendedStatus": "draft|needs_owner|ready_for_review|blocked",
    "decisionFrameId": "string|null"
  },
  "evidenceRefs": {
    "ruleSetId": "string|null",
    "datapointSnapshotId": "string|null",
    "financeTraceId": "string|null",
    "cyaSignalRefs": []
  }
}
```

## Positive Follow-Ups

Missing inputs are phrased as what they enable once supplied:

- Missing active rule set enables active legal-basis and rule-window classification.
- Missing EOG input status enables baseline revenue-cap calculation.
- Missing scenario assumptions enable bounded downside/upside range.
- Missing owner or deadline enables management-gate handover.
- Missing datapoint snapshot enables audit-stable evidence reference.

## Hydration And Dossier Boundary

This first slice does not add a Hydration Registry rule. It creates a planning and
briefing recipe over existing services. Dossiers must not directly hydrate
consequential or assumption-bearing actions such as `eog-calculator.scenario`.

A future read-only facade may add dossier hydration only if it returns a deterministic
briefing object and does not persist scenario overrides, create legal decisions or
execute tariff, billing, settlement or workflow actions.

## Explicit Non-Goals

- No new persistent regulatory-risk domain model.
- No second EOG or revenue formula outside `services/eog-calculator.service.js`.
- No second regulatory ruleset engine outside `services/regulatorische-entgeltlogik.service.js`.
- No LLM-generated legal interpretation or regulatory final judgment.
- No tariff mutation, billing release, settlement export, finance booking or production action.
- No external connector, workflow execution, HITL creation, secret handling or Personal-Agent shortcut.

