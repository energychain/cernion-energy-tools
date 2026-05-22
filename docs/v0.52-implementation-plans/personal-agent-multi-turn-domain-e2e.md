# Personal Agent — Multi-Turn Domain E2E Specification

**Meilenstein:** v0.53.x
**Status:** Implemented & opt-in
**Scope:** Blackbox E2E acceptance tests for multi-turn Personal Agent flows.
**Test file:** `tests/e2e/personal-agent/multi-turn-domain.e2e.test.js`

---

## 1. Purpose

Single-turn unit tests and the TDD matrix cannot verify session continuity,
context mutation correctness, or cross-turn reasoning quality. This spec defines
**multi-turn domain E2E scenarios** that call only `POST /api/personal-agent/chat`
and assert on the returned payload shape — no mock setup, no internal
service calls.

All scenarios are **opt-in** for CI stability. They must be executable against
a live dev server when needed.

---

## 2. Activation

```bash
# Activate all domain E2E scenarios
RUN_PERSONAL_AGENT_E2E=true npm test -- tests/e2e/personal-agent/multi-turn-domain.e2e.test.js

# Activate VDMI Step-3 scenarios additionally (heavier, require specific capabilities)
RUN_PERSONAL_AGENT_E2E=true RUN_PERSONAL_AGENT_E2E_VDMI_STEP3=true \
  npm test -- tests/e2e/personal-agent/multi-turn-domain.e2e.test.js

# Target a non-default server
PERSONAL_AGENT_E2E_BASE_URL=http://127.0.0.1:3901 RUN_PERSONAL_AGENT_E2E=true \
  npm test -- tests/e2e/personal-agent/multi-turn-domain.e2e.test.js
```

When `RUN_PERSONAL_AGENT_E2E` is not set to `true`, all scenarios are automatically
**skipped** — `jest.setTimeout` is still set, but all `it()` blocks are in a
`describe.skip`. No server is required for `npm run test:unit:ci`.

---

## 3. Context Mutation Discipline

Every turn applies `resolveContextMutation(prevResolvedParams, incomingKnownContext)`
from `src/personal-agent-context.js`:

| Mode | Trigger | Effect |
|------|---------|--------|
| **append** | No decisive param changed | Incoming keys merged on top of existing; all prior non-decisive params kept |
| **replace** | A decisive param changed value | Prior decisive params discarded; prior non-decisive params kept; incoming overlaid |

**Decisive params:** `location`, `municipality`, `city`, `postalCode`, `state`,
`bundesland`, `latitude`, `longitude`, `gridOperatorName`, `bdewCode`, `bdew`,
`gridOperatorId`, `projectId`, `scenarioId`, `tenantProjectId`.

The mutation mode is recorded in the TurnGraph `knowledge:orientation` node as
`contextMutationMode` and `contextReplacedKeys`. When mode is `replace`, the
`jobStore` log gets a `context_mutation` entry at step 12.

---

## 4. Scenario Catalogue

### PA-MT-001 — Journalist CYA-Fallback (4 turns)

| Turn | Message | Context Mutation | Expected Behaviour |
|------|---------|------------------|--------------------|
| 1 | „Ich recherchiere zur Versorgungssicherheit…" | — (new session) | `interface_placeholder` / `mark_unknown_execution_gap` in routing; reply mentions status/uncertainty without internal error codes |
| 2 | „Bitte nur belastbare Aussagen…" | append | Unsicherheiten transparent; reply does not leak routing tokens |
| 3 | „Fasse die Kernaussagen in drei Punkten zusammen." | append | Enumerated structure (1. / - / •) in reply |
| 4 | „Gib ein journalistisches Fazit ohne Spekulationen." | append | No absolute certainty language (`garantiert`, `ohne Zweifel`) |

**Context mutation check:** All four turns refine the same advisory topic → mode
must stay `append` throughout.

---

### PA-MT-002 — VNB Benchmark Comparison (4 turns)

| Turn | Message | Context Mutation | Expected Behaviour |
|------|---------|------------------|--------------------|
| 1 | „Vergleiche zwei VNB…" | — (new session, knownContext: vnb1Name + vnb2Name) | `vnb_kpi_benchmark_comparison` in routing body |
| 2 | „Ergänze Digitalisierung und Umsetzungsquote…" | append | Reply extends comparison; digitalization mentioned |
| 3 | „Gewichte Anschlussgeschwindigkeit höchst…" | append | Turn-2 dimensions still referenced in reply (carry-over check) |
| 4 | „Erstelle eine Rangliste…" | append | Reply contains ranking language (rang/platz/begründung) |

**Context mutation check:** Same VNBs across all turns → `municipality`/`gridOperatorName`
do not change → mode always `append`.

---

### PA-MT-003 — Vorstand: Rechenzentrum N-1 fNAV (4 turns, includes replace)

| Turn | Message | Context Mutation | Expected Behaviour |
|------|---------|------------------|--------------------|
| 1 | „Wir prüfen ein Anschlussbegehren für ein Rechenzentrum mit fNAV…" | — (new session, gridOperatorName: TWL Netze) | `netzfahrplan_fnav_assessment` + `assess_fnav_as_kupferalternative` in routing |
| 2 | „Was bedeutet das für unsere N-1-Reserve?" | append | N-1/reserve mentioned; no invented % if Turn 1 had none |
| 3 | „Projiziere den fNAV für die nächsten 5 Jahre." | append | Year range 2026–2031 only; digits present |
| 4 | „Wir verlagern das Projekt nach München." | **replace** (location changed) | Reply mentions München; no Frankfurt; fNAV context present |

**Context mutation check (PA-MT-003 Turn 4):**
Turn 4 introduces a new decisive location. `resolveContextMutation` must detect
`gridOperatorName` or implicit location change, set mode=`replace`, and ensure the
reply does NOT reference the prior Frankfurt context.

---

### PA-MT-004 — Conversational Onboarding Flow (2 turns)

| Turn | Message | Expected Behaviour |
|------|---------|-------------------|
| 1 | „Bitte Mieterstrom mit ZNP für Rheinallee prüfen" | `execution.status = awaiting-onboarding`; `presentationType = conversational_onboarding`; reply asks for project-ID |
| 2 | „Projekt-ID znp-rheinallee-01" | `execution.status ≠ skipped`; no internal error codes |

---

### PA-MT-005 — VDMI Step-3 Grid-Connection Decision Governance (1 turn)

Requires `RUN_PERSONAL_AGENT_E2E_VDMI_STEP3=true`.

| Turn | Message | Expected Behaviour |
|------|---------|-------------------|
| 1 | „Kann der Netzbetreiber ohne formales §17-EnWG-Netzanschlussbegehren eine Kapazitätszusage geben?" | Routes to `vdmi_grid_connection_decision_governance` (not asset validation); dossier/trace/agentRole all completed; reply does NOT claim Netzanschlusszusage possible |

---

### PA-MT-006 — CETRed Working Assumptions / Due Diligence (4 turns)

| Turn | Message | Expected Behaviour |
|------|---------|-------------------|
| 1 | „Projekt in Frankenthal, Netzbetreiber soll TWL Netze sein, 12 MW" | Reply contains due-diligence/Netzanschlusszusage/assumption language |
| 2 | „Arbeite mit der vorläufigen Annahme weiter…" | Does NOT repeat the VNB-uncertainty question from Turn 1 |
| 3 | „Welche Markt- und Regulatorik-Methodik würdest du anwenden?" | Methodology/data-source language; no stale turn-1 disclaimer |
| 4 | „Erstelle ein vorläufiges Risk Assessment für den Kreditausschuss." | Risk Assessment / Condition Precedent / Risikoampel language |

---

### PA-MT-007 — Multimodal Inhouse Data Upload (2 turns)

| Turn | Message | Expected Behaviour |
|------|---------|-------------------|
| 1 | CSV upload with assets list | `fileProcessing[0].status = ok`; no raw content in reply |
| 2 | „Wie viele Assets haben wir laut der hochgeladenen Liste?" | `sessionId` stable; raw CSV content NOT in payload JSON |

---

### PA-MT-008 — Bank Analyst Due Diligence Flow (4 turns)

| Turn | Message | Expected Behaviour |
|------|---------|-------------------|
| 1 | Vague start as bank analyst | `execution.status = awaiting-onboarding`; `presentationType = conversational_onboarding` |
| 2 | „Standort Frankenthal, 12 MW, TWL Netze…" | `execution.status = completed`; Betreiber-Mismatch (Stadtwerke Frankenthal vs TWL) surfaced |
| 3 | „Was ist der nächste formale EnWG-Schritt?" | `presentationType = vdmi_matrix_table`; RACI (Verantwortlich/Durchführend/Mitwirkend/Informiert) in reply |
| 4 | „One-Pager Risk Assessment für den Kreditausschuss" | `presentationType = decision_brief`; Condition Precedent / BKZ in reply |

---

## 5. Test Architecture Rules

- All scenarios call **only** `POST /api/personal-agent/chat` (no direct service calls).
- Session continuity is ensured by reusing `sessionId` returned from Turn 1.
- Cookie jar is maintained per scenario (separate `createChatClient()` instance).
- Async jobs (202 responses) are polled until 200 with `JOB_RESULT_TIMEOUT_MS` budget.
- **No server mocks.** If the dev server is not running, tests skip with a clear message.
- Multi-turn scenarios use `jest.setTimeout(E2E_TURN_TIMEOUT_MS)` (default 120s per test).

---

## 6. Context Mutation Unit Tests

Location: `tests/personal-agent-context.test.js` → `describe('resolveContextMutation')`

| ID | Scenario | Assert |
|----|----------|--------|
| PA-CM-001 | Non-decisive param added | mode=append; prev params preserved |
| PA-CM-002 | Location changes (Frankfurt→München) | mode=replace; replacedKeys=[municipality]; prev decisive params dropped; non-decisive params (powerMW etc.) retained |
| PA-CM-003 | Same decisive param re-sent | mode=append (refinement) |
| PA-CM-004 | gridOperatorName changes | mode=replace |
| PA-CM-005 | Empty incoming | mode=append; params unchanged |
| PA-CM-006 | null/undefined inputs | no throw; graceful fallback |
| PA-CM-007 | append preserves non-decisive prev params | customerId et al. survive |
