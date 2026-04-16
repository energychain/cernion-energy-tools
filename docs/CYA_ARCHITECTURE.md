# CYA Agent Architecture: Phase Responsibility Contract

**Document Version:** 1.0
**Backend Version:** v0.26.7
**Last Updated:** 2026-04-16

---

## Overview

The CYA Agent is a **deterministic-evidence-to-narrative pipeline** with 4 sequential phases. Each phase has clear input/output contracts, known deviations from the design, and explicit responsibility boundaries.

```
Phase 1: RETRIEVAL          Phase 2: REGULATORY         Phase 3: GROUNDING         Phase 4: SYNTHESIS
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│ Data Collection  │──────→ │ Rule Evaluation  │──────→ │ Fact Extraction  │──────→ │ LLM Narrative    │
│                  │        │                  │        │                  │        │                  │
│ - query.ask      │        │ - 9 rules        │        │ - confidence     │        │ - Gemini call    │
│ - MaStR facts    │        │ - OEO mapping    │        │ - data gaps      │        │ - profile inject │
│ - OSM topology   │        │ - signal scores  │        │ - HITL override  │        │ - XAI guardrails │
│ - HITL merge     │        │                  │        │ - quality guard  │        │                  │
└──────────────────┘        └──────────────────┘        └──────────────────┘        └──────────────────┘
        ↓                           ↓                           ↓                          ↓
   evidence[]              signals[]                      facts[]                  narrative{}
   topologyHop{}           rulesMeta{}                    clarification?           metadata{}
   errors[]                                               regulations[]
```

---

## Phase 1: Data Retrieval

**Module:** `src/cya-data-retriever.js`
**Responsibility:** Locate context data, orchestrate external service calls, merge HITL overrides

### Input Contract

```typescript
{
  location: string                    // Required: location name (e.g., "Höheinöd", "Bautzen")
  profile: { id, targetAudience }    // Required: stakeholder profile
  context: {                          // Optional: pre-filled context
    capacity_mw?: number
    location?: string                 // Override location from parameter
  }
  focus_areas?: string[]              // Default: all 11 areas
  clarification_response?: {          // HITL override (refine only)
    provided_data: Record<string, unknown>
  }
}
```

### Output Contract

```typescript
{
  evidence: [
    {
      focus_area: "capacity" | "renewables" | ...
      location: string
      statement: string               // Standalone fact statement
      sources: string[]               // ["query.ask"] or ["cernion_installations_local", "osm"]
      dataProvenance: "llm" | "mastr_machine_verified" | "osm" | "user_asserted"
      confidence: "high" | "medium" | "low"
      trusted: boolean                // true if user-asserted
      ...details
    }
  ],
  topologyHop?: {
    needsHop: boolean
    targetVoltage?: "MS" | "HS" | "HöS"
    capacityMw: number
    physicalConnectionPoint?: object
    inferredOperator?: string | null
  },
  errors?: { service: string, reason: string }[]
}
```

### Retrieval Paths

**Path A (LLM-based, fallback):**
1. For each focus area in `FOCUS_AREA_QUERY_BUILDERS`
2. Call `query.ask(location + focus_area)` (MCP → Cernion backend)
3. Parse response, extract statement, assign `confidence: 'high' | 'medium' | 'low'`
4. Mark `dataProvenance: 'llm'`

**Path B (Deterministic MaStR, v0.26.7 new):**
1. If `focus_areas` includes `capacity` or `renewables` AND `location` known
2. Call `energy-market.installations` (MCP-backed, reuses `cernion_installations_local`)
3. Extract legacy PV/Wind (oldest by commissioning) + capacity kW
4. Check storage > 50 kW (utility-scale deficit)
5. Return structured items with `dataProvenance: 'mastr_machine_verified'`
6. Fall back to Path A if MCP call fails

**Path C (OSM Topology-Hop, v0.26.3 new):**
1. If `context.capacity_mw` and `location` provided
2. Call `osm-geo.substationFinder` (MCP → Overpass API)
3. Find nearest HS/MS substations (voltageLevel: 'HS', maxResults: 5)
4. Threshold logic: `capacity >= 10 MW` → `needsHop: true`
5. Return `topologyHop` object with nearest substation coords

### Known Deviations from Design

1. **LLM Statement Generation in Phase 1 (NOT Phase 3):**
   - **Design:** Phase 1 retrieves raw data; Phase 3 grounding constructs narrative facts
   - **Deviation:** LLM returns ready-to-use statement (e.g., "Die Netzkapazität ist aktuell gut")
   - **Rationale:** Query.ask backend returns formatted response; parsing would introduce complexity
   - **Impact:** Some evidence items skip Phase 3 fact-construction logic (use as-is)
   - **Mitigation:** Phase 3 still validates confidence + applies trusted-cap rules

2. **PLZ Alias Resolver Hardcoded:**
   - **Design:** Dynamic alias resolution via API
   - **Current:** Hardcoded in `LOCATION_POSTAL_CODE_ALIASES` map (Höheinöd → 66989 only)
   - **Rationale:** MVP scoping; full VNB data validation needed for production expansion
   - **Path Forward:** Centralize in `src/location-resolver.js` + expand with OSM/GIS data

3. **HITL Merge Applies to All Phases:**
   - **Design:** HITL override only in clarification_response (Phase 3 gate)
   - **Current:** `mergeProvidedData` in Phase 1 enables immediate re-grounding
   - **Rationale:** Faster feedback loop; re-materializing retrieved data
   - **Impact:** session.retrieval_history contains BOTH original + merged evidence

---

## Phase 2: Regulatory Graph

**Module:** `src/cya-regulatory-graph.js`
**Responsibility:** Deterministic rule evaluation, OEO-mapped signal generation

### Input Contract

```typescript
{
  evidence: evidence[]              // From Phase 1
  profile: { targetAudience }       // For rule context
}
```

### Output Contract

```typescript
{
  evaluatedRules: number            // 9 total
  triggeredRules: string[]          // ["NOVA_BLOCKED", "HIGH_RENEWABLE_SHARE"]
  signals: [
    {
      ruleId: string                // "HIGH_CURTAILMENT"
      severity: "critical" | "high" | "warning" | "info"
      oeoClass: string              // "OEO_00020151" (Curtailment)
      description: string           // German rule name
      statement: string             // Actionable summary
      confidence: "high" | "medium" | "low"
    }
  ],
  severityCount: {
    critical: number
    high: number
    warning: number
    info: number
  }
}
```

### Rules (v0.26.7)

| Rule | Trigger | Severity | OEO Class | v0.26.x |
|------|---------|----------|-----------|---------|
| NOVA_BLOCKED | evidence.nova.blocked | critical | OEO_00010503 | v0.26.0 |
| HIGH_CURTAILMENT | redispatch.frequency > 15% | high | OEO_00020151 | v0.26.0 |
| EWK_BELOW_MEDIAN | renewableShare < 35% | warning | OEO_00010201 | v0.26.0 |
| MISSING_NAP | asset.nap_id missing | warning | OEO_00020301 | v0.26.0 |
| SECTION14A_GAP | steerable_load < 20% target | info | OEO_00020101 | v0.26.0 |
| ENERGY_SHARING_DEADLINE | deadline 01.06.2026 | warning | OEO_00010202 | v0.26.0 |
| GRID_TOPOLOGY_RADIAL | topology.radial | high | OEO_00030101 | v0.26.0 |
| HIGH_RENEWABLE_SHARE | renewableShare > 80% | info | OEO_00010203 | v0.26.0 |
| VOLTAGE_HOP_REQUIRED | capacity ≥ 10 MW + OSM | warning/high | OEO_00020302 | v0.26.3 |

### Known Deviations from Design

1. **Rule Severity Not Context-Aware:**
   - **Design:** Severity adapts to profile (e.g., investor ≠ utility operator)
   - **Current:** Fixed severity per rule (warning = warning for all profiles)
   - **Rationale:** Profile tailoring deferred to Phase 4 (LLM narrative)
   - **Impact:** Phase 3 grounding doesn't re-score severity by profile
   - **v0.26.8 candidate:** Profile-based severity multiplier in grounding

2. **Topology-Hop Severity Hardcoded:**
   - **Design:** Voltage-level cascades (MS warning, HS high, HöS critical)
   - **Current:** Single threshold (10 MW = warning)
   - **Rationale:** Only HS (110 kV) implemented; HöS (220/380 kV) skipped in v0.26.7
   - **Path Forward:** v0.26.8 voltage-level generalization (VOLTAGE_THRESHOLDS array)

---

## Phase 3: Grounding

**Module:** `src/cya-grounding.js`
**Responsibility:** Fact construction, confidence scoring, quality guardrails, HITL clarification trigger

### Input Contract

```typescript
{
  evidence: evidence[]
  signals: signals[]
  profile: { targetAudience }
  clarification_response?: {
    provided_data: Record<string, unknown>    // HITL override
  }
}
```

### Output Contract

```typescript
{
  confidence: "high" | "medium" | "low"
  confidenceScore: number           // 0–100
  facts: [
    {
      statement: string
      category: "technical" | "regulatory" | "market"
      confidence: "high" | "medium" | "low"
      sources: string[]
      dataProvenance: "llm" | "mastr_machine_verified" | "osm" | "user_asserted"
      trusted: boolean              // true if user-asserted
      regulation?: string           // Citation (§14a EnWG, etc.)
    }
  ],
  regulations: [
    {
      citation: "§42c EnWG"
      name: string
      relevance: "critical" | "medium" | "low"
      deadline?: string
    }
  ],
  topologyHop?: topologyHop,        // From Phase 1
  dataGaps?: [
    {
      area: string
      reason: "insufficient_data" | "service_unavailable" | "user_clarification_needed"
      recommendation: string
    }
  ],
  requiresClarification: boolean    // true if needs_clarification in Phase 4
  clarificationReason?: string      // "insufficient_fact_quality" | "missing_location" | ...
}
```

### Grounding Steps

1. **Fact Construction:**
   - Convert evidence items to fact statements
   - Aggregate signals into regulatory recommendations
   - Apply confidence scoring (LLM ≤ 'high', mastr_verified = 'high', osm = 'medium')

2. **Trusted Fact Handling (v0.26.3):**
   - User-asserted facts capped at `confidence: 'medium'` (never 'high')
   - Marked `trusted: true, dataProvenance: 'user_asserted'`
   - Count in `confidenceScore` calculation

3. **Quality Guardrail (v0.26.6):**
   - If `facts[]` is empty → `requiresClarification: true`, reason: `insufficient_fact_quality`
   - If all facts are `confidence: 'low'` → `requiresClarification: true`
   - Halts pipeline before Phase 4 (LLM synthesis)
   - Returns `status: 'needs_clarification'` to client

4. **Data Gap Detection:**
   - If `topologyHop.reason = 'osm_unavailable'` → record data gap with mitigation
   - If `location` missing and deterministic MaStR path unavailable → record gap

5. **Regulation Mapping:**
   - Extract all applicable regulations from signals + facts
   - Map to OEO classes + citation format
   - Include deadline if known (e.g., Energy Sharing 01.06.2026)

### Known Deviations from Design

1. **No Confidence Recalibration by Profile:**
   - **Design:** Profile-dependent confidence (investor = risk-averse, lower thresholds)
   - **Current:** Fixed confidence rules per data source
   - **Rationale:** Profile-aware narrative generation deferred to Phase 4
   - **Impact:** Same grounding used for all profiles (cost optimization)

2. **Trusted-Fact Confidence Cap Not Tunable:**
   - **Design:** Configurable cap per profile (investor = 'low', utility = 'medium')
   - **Current:** Hardcoded `confidence: 'medium'` for all user-asserted facts
   - **Rationale:** Conservative approach prevents misleading synthesis from untrusted data
   - **Path Forward:** v0.27 feature flag (TRUSTED_FACT_CONFIDENCE_LEVELS env var)

3. **Quality Guardrail Binary:**
   - **Design:** Semi-quantitative threshold (e.g., avg confidence ≥ 0.65)
   - **Current:** Binary rules (empty = block, all-low = block, otherwise proceed)
   - **Rationale:** Edge-case protection; tunable threshold deferred to v0.26.8
   - **Impact:** Borderline sessions (70% confidence) rejected unnecessarily

---

## Phase 4: Synthesis

**Module:** `src/cya-synthesis.js`
**Responsibility:** LLM-based narrative generation, profile injection, XAI guardrails

### Input Contract

```typescript
{
  grounding: {
    facts: facts[]
    regulations: regulations[]
    confidence: "high" | "medium" | "low"
  },
  profile: {
    id: string
    targetAudience: "Aufsichtsrat" | "Investor" | "Community" | "Regulierung"
    tone: "formal" | "accessible" | "technical"
  }
}
```

### Output Contract

```typescript
{
  narrative: {
    title: string
    headline: string
    executiveSummary: string
    keyPoints: string[]             // 3–5 bullets
    recommendedActions: string[]    // Actionable next steps
    riskNotes: string[]             // Explicit caveats
    sources: string[]               // Data sources cited
  },
  metadata: {
    generatedAt: timestamp
    modelUsed: "gemini-1.5-pro"
    trustedFactCount: number
    synthesisLatencyMs: number
  }
}
```

### Synthesis Steps

1. **Prompt Construction:**
   - Inject profile context (audience, tone)
   - Structure facts + regulations as JSON array
   - Add XAI marker for trusted facts: `[Nutzerangabe – nicht maschinell verifiziert]`

2. **LLM Call (Gemini 1.5):**
   - System prompt: forbids presenting user-asserted facts as official findings
   - User prompt: grounded JSON payload (facts, regulations, profile)
   - Timeout: 30s
   - Retry: 1 attempt (fail open to fallback narrative)

3. **XAI Guardrail (v0.26.3):**
   - Detect if output contains user-asserted facts
   - Append disclaimer: "Die mit [Nutzerangabe] gekennzeichneten Punkte basieren auf benutzerdefinierten Eingaben."

4. **Narrative Validation:**
   - Check for minimum 3 key points
   - Check for at least 1 recommended action
   - If invalid, return degraded-quality marker

### Known Deviations from Design

1. **No Multi-Perspective Synthesis:**
   - **Design:** Generate 2–3 competing stakeholder narratives (investor vs. utility)
   - **Current:** Single narrative per profile
   - **Rationale:** Cost + complexity deferred to v0.27+
   - **Impact:** Polarizing views not surface in single call

2. **No Narrative Refinement Loop:**
   - **Design:** Synthesize → show to stakeholder → iterate (max 3x)
   - **Current:** Single synthesis (no post-generation refinement)
   - **Rationale:** Async pattern + session state not yet optimized for multi-cycle LLM
   - **Path Forward:** v0.26.8 candidate (sessionState tracking LLM call count)

3. **Profile Tone Not Enforced:**
   - **Design:** Formal for Board/Regulierung, accessible for Community
   - **Current:** Profile.tone injected but not validated in output
   - **Rationale:** LLM interpretation loose; validation adds complexity
   - **Impact:** Board narrative may be too technical, Community too jargon-heavy
   - **v0.27 candidate:** Tone-detection post-processing + regeneration flag

---

## Cross-Phase Contracts

### Token Propagation

**Requirement (v0.26.4):** Every MCP-backed service call must forward `ctx.meta.cernionToken` explicitly.

**Current Status (v0.26.7):**
- ✅ Phase 1: `query.ask` — explicit token forwarding (v0.26.4)
- ✅ Phase 1: `osm-geo.substationFinder` — explicit token forwarding (v0.26.4)
- ⚠️ Phase 1: `energy-market.installations` — **IMPLICIT token** (v0.26.7 gap, fix in v0.26.8)
- ✅ Phase 4: `gemini-embedding-001` — direct REST (no Moleculer forwarding)

**Fix (v0.26.8):**
```javascript
const result = await ctx.call('energy-market.installations', { ... }, {
  meta: { cernionToken: ctx.meta.cernionToken }
});
```

### Session Persistence

**Storage:** PouchDB namespace `cya_sessions`
**Documents:**
- `cya:<session_id>` — full session state (profile, evidence, grounding, narrative, refinement_history)
- **TTL:** 30 days (configurable via `CYA_SESSION_TTL_DAYS`)
- **Audit Trail:** Every phase result persisted; refinement_history tracks all clarification cycles

### Error Handling Strategy

| Phase | Error Type | Handling |
|-------|-----------|----------|
| 1 | MCP unavailable | Graceful degrade to fallback path |
| 1 | OSM unavailable | Set `topologyHop.reason = 'osm_unavailable'` |
| 2 | Rule eval fails | Skip rule, log warning, continue |
| 3 | Quality guardrail triggered | Return `needs_clarification`, halt |
| 4 | LLM timeout | Return degraded narrative (fallback template) |
| 4 | LLM error | Return degraded narrative + error metadata |

---

## v0.26.8+ Roadmap

| Item | Module | Estimated Scope |
|------|--------|-----------------|
| **Voltage-Level Generalization** | `cya-topology-hop.js` + `cya-regulatory-graph.js` | 2–3 days |
| **Token Propagation Hardening** | `cya-data-retriever.js` | <1 day |
| **Multi-Cycle Refinement** | `cya.service.js` + async job pattern | 3–4 days |
| **Profile-Aware Severity** | `cya-grounding.js` | 1–2 days |
| **Confidence Threshold Tuning** | `cya-grounding.js` + env vars | <1 day |

---

**Document Owner:** Backend Architect
**Last Reviewed:** 2026-04-16
**Next Review:** Post-v0.26.8 release
