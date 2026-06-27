# No-Regret Measure Proof Gate

`no_regret_measure_proof_gate` bewertet No-Regret-Aussagen als read-only Szenario-, Budget- und Management-Gate-Evidenz. Die Capability hilft, Transformationsmassnahmen nachvollziehbar zu priorisieren, ohne daraus eine Investitionsfreigabe, Budgetreservierung oder regulatorische Entscheidung zu machen.

## Standardpfad

- Capability key: `no_regret_measure_proof_gate`
- Action: `dashboard-api.noRegretMeasureProofGateStatus`
- API: `GET /api/dashboard/no-regret-measure-proof-gate`
- Hydration: `dashboard-api.noRegretMeasureProofGateStatus`
- Safety: `read_only`

## Eingaben

Die erste Slice arbeitet mit skalaren, dossier-sicheren Eingaben:

- `measureName` / `measureType`
- `targetDomain`
- `scenarioCoverage`
- `budgetAnchor`
- `costRange`
- `expectedBenefitRange`
- `regulatoryFit`
- `decisionOwner`
- `objectionWindow`
- `evidenceSource`
- `nextManagementGate`
- `dueDate`
- optional `proofLabel` / `proofLink`

## Statuslogik

- `missing_measure_context`: Massnahme oder Zieldomaene fehlt.
- `needs_scenario_budget_evidence`: Szenarioabdeckung oder Budgetanker fehlt.
- `needs_cost_benefit_range`: Kosten- oder Nutzenband fehlt.
- `needs_regulatory_or_decision_rights_evidence`: regulatorischer Fit oder Decision Owner fehlt.
- `needs_management_gate_evidence`: Einspruchsfenster, naechstes Gate oder Termin fehlt.
- `measure_ready_for_management_prioritization_review`: alle Proof-Fakten liegen vor.

## Grenzen

Die Capability darf keine Investition freigeben, kein Budget reservieren, keine Finanzbuchung erzeugen, keine Rechtsauslegung automatisieren, keine Workflows/HITL-Items anlegen, keine externen Connectoren aufrufen und keine Billing-, Settlement-, Tarif-, MaKo- oder Device-Control-Mutation ausloesen. Personal-Agent-Routing erfolgt ausschliesslich ueber Capability Broker, Hydration Registry und Slim-Dossier-Formatter.
