# Consultation Mode: Evidence Hydration for Read-Only Blueprint Requests

**Rule:** Consultation Mode may hydrate read-only evidence for concrete, deterministic, blueprint-backed requests.

## Motivation

In consultation mode the Personal Agent is expected to advise rather than execute.
However, when a user's multi-turn conversation accumulates enough inputs to answer a
concrete, data-backed question (e.g. "which 4-hour window tonight has the lowest CO₂
intensity for my EV in 69256 Mauer?"), staying advisory and replying generically
("typically midday or at night...") is a category error — the agent *has* the data.

This rule defines when and how consultation mode is permitted to hydrate evidence.

## Scope

Applies to requests that satisfy all three of:

1. **Read-only action** — no writes, no HITL flows, no BDEW submissions.
2. **Blueprint-backed** — a registered blueprint (`src/blueprints/*.json`) covers the intent.
3. **Sufficient inputs available** — required blueprint inputs are resolvable from the
   current message, the current `knownContext`, or recent session history.

Examples that qualify:

| User intent | Blueprint | Required inputs |
|-------------|-----------|-----------------|
| EV CO₂ charging window | `ev-charging-co2-optimization-v1` | postalCode, (duration defaults to 4 h) |
| Messkonzept conflict | `messkonzept-conflict-validation-v1` | postalCode, reportedMeteringConcept, legacyPvStatus |
| Grid connection capacity check | grid-connection blueprints | postalCode or gridOperatorId |

Examples that do NOT qualify (stay purely advisory):

- Strategic governance questions ("What are the benefits of a Redispatch Readiness Map?")
- Questions that require a HITL step or a write action
- Questions where required inputs are absent *and* cannot be inferred from history

## Implementation

### Multi-turn context accumulation

`extractMultiTurnContextHints(session)` (personal-agent.service.js) scans the last 8
user turns in `session.l3.history` and extracts postal codes and city names via regex.
The extracted hints are merged into `brokerKnownContext` *before* receipt selection,
making them available to the blueprint evaluator even when they were mentioned two turns ago.

### Multi-turn intent detection

`isEvCo2ChargingRequest(message, knownContext, session)` combines the current message
with up to 6 recent user turns to detect whether an EV charging + CO₂ optimization
intent spans multiple turns. The result feeds into `buildPreferredReceiptsForTurn`,
which injects the matching blueprint receipt as the preferred receipt for that turn.

### Receipt selection → bypass of pure consultation

When a blueprint receipt is selected *and* its evaluation marks it as `executable: true`,
`shouldPreferReceiptExecution` is set to `true`. This causes the routing decision to
bypass the pure-consultation LLM loop and proceed to receipt execution instead — even
when the session's persisted `chatMode` is `consultation`.

The receipt executes only the read-only evidence actions declared in
`blueprint.execution.steps` (e.g. `energy-market.co2Intensity`). No write actions are
triggered.

### Evidence policy: optional vs. required

The evidence registry (`src/evidence-registry.js`) entry `ev_charging_co2_optimization`
defines:

| Source | Required |
|--------|----------|
| `location` (postalCode / city) | **yes** |
| `charging_duration` (defaulted to 4 h) | **yes** |
| `co2_forecast` (`energy-market.co2Intensity`) | **yes** |
| `day_ahead_prices` (`energy-market.prices`) | no (optional) |
| `vnb_identity` (VNB / grid operator) | no (optional) |

Missing optional evidence must appear only as a *caveat* after the concrete recommendation.
It must never replace the recommendation or reduce the answer to generic advice.

## Invariants preserved

- **Writing actions remain HITL/execution mode only.** The consultation bridge only
  auto-fires read-only `energy-market.*` and similar actions.
- **Governance and strategic advisory queries are unaffected.** They continue to produce
  purely advisory consultation output.
- **Existing blueprint and routing tests are unbroken.** The fix is additive:
  new context hydration + broadened intent detection.

## Extending this pattern

To add a new blueprint to the consultation bridge:

1. Add the blueprint JSON to `src/blueprints/`.
2. Register it in `src/blueprint-registry.js` (or ensure auto-discovery picks it up).
3. Add an evidence entry in `src/evidence-registry.js` marking which sources are
   required vs. optional.
4. Ensure `detectBlueprintIntent` in `src/l3-broker.js` scores ≥ 2 signals from the
   blueprint's `routing.intentSignals` for the relevant message patterns.

The consultation bridge then picks it up automatically: no changes to the Personal Agent
service are required for purely read-only, blueprint-backed use cases.
