# Change Request: CYA Agent Post-v0.26.7 Roadmap

> **Type:** CR (Change Request / Feature Backlog)
> **Status:** open
> **Created:** 2026-04-16
> **Target Version:** v0.27–v0.28
> **Owner:** Backend Team

---

## Executive Summary

Post-v0.26.7 consolidation (4-phase pipeline stable, PoC validations passed), the CYA Agent requires **3 architecture refactors** (A1–A3) and **3 frontend features** (F1–F3) to move toward production readiness. This CR tracks design decisions, implementation scope, and known limitations that emerged during v0.26.0–v0.26.7 development.

---

## Architecture Refactors

### A1: Voltage-Level Generalization (Topology-Hop)

**Issue:** Hardcoded `MW_THRESHOLD_110KV = 10` prevents routing assets >150 MW to 380-kV HöS network.

**Current Behavior:**
- 5 MW asset → MS (niederspannung) ✅
- 15 MW asset → HS (mittelspannung) ✅
- 150 MW asset → HS (ERROR: should be HöS 220 kV) ❌
- 200 MW asset → HS (ERROR: should be HöS 380 kV) ❌

**Root Cause:**
- Single threshold (10 MW) maps only to HS (110 kV)
- No distinction between HS and HöS (220/380 kV)
- Regulatory severity doesn't scale: warning for all voltage levels

**Design Solution:**
```javascript
const VOLTAGE_THRESHOLDS = [
  { minMw: 0,   maxMw: 10,   voltageClass: 'MS',  voltageKv: '10 kV', severity: 'none' },
  { minMw: 10,  maxMw: 50,   voltageClass: 'MS',  voltageKv: '20 kV', severity: 'info' },
  { minMw: 50,  maxMw: 150,  voltageClass: 'HS',  voltageKv: '110 kV', severity: 'warning' },
  { minMw: 150, maxMw: Infinity, voltageClass: 'HöS', voltageKv: '220/380 kV', severity: 'critical' },
];

function determineRequiredVoltageLevel(capacityMw) {
  return VOLTAGE_THRESHOLDS.find(t => capacityMw >= t.minMw && capacityMw < t.maxMw);
}
```

**Implementation Scope:**
- [ ] Replace `MW_THRESHOLD_110KV` with `VOLTAGE_THRESHOLDS` array in `src/cya-topology-hop.js`
- [ ] Add `determineRequiredVoltageLevel(capacityMw)` helper
- [ ] Update `assessTopologyHop()` to use voltage class instead of boolean
- [ ] Update `VOLTAGE_HOP_REQUIRED` rule in `src/cya-regulatory-graph.js` to use voltage-specific severity
- [ ] Add 8 test cases: 5 MW, 15 MW, 60 MW, 200 MW, edge cases (10, 10.01, 150, 150.01)
- [ ] Update `docs/ui-contracts/20-cya.md` response shape for `topologyHop.voltageClass`

**Estimated Effort:** 2–3 days
**Blocked By:** None
**Blocks:** Multi-perspective synthesis (F2), PDF export (F3)

---

### A2: Token Propagation Hardening (Retriever)

**Issue:** `fetchInstallations()` call in Phase 1 missing explicit `ctx.meta.cernionToken` forwarding.

**Current Code:**
```javascript
const result = await ctx.call('energy-market.installations', { location, postCode, ... });
// Missing: { meta: { cernionToken: ctx.meta.cernionToken } } as 3rd arg
```

**Risk:** Under token-rotation scenarios or multi-tenant environments, authentication may fail silently and degrade to LLM fallback path (losing deterministic MaStR evidence).

**Design Solution:**
```javascript
async function fetchInstallations(ctx, { location, postCode, types }) {
  const withTokenMeta = { meta: { cernionToken: ctx.meta.cernionToken } };
  return await ctx.call('energy-market.installations',
    { location, postCode, types },
    withTokenMeta
  );
}
```

**Implementation Scope:**
- [ ] Add `withTokenMeta` helper in `src/cya-data-retriever.js`
- [ ] Apply to `fetchInstallations()` call (1 location)
- [ ] Verify `fetchInstallations()` already used in both `retrieveContextData` and `retrieveMastrSituation`
- [ ] Add test case: verify `ctx.call` 3rd argument contains `meta.cernionToken`
- [ ] Update CHANGELOG [0.26.8] section

**Estimated Effort:** <1 day
**Blocked By:** None
**Blocks:** None (orthogonal)

---

### A3: Multi-Cycle Refinement Loop

**Issue:** Only 1 refine cycle supported per session; stateful refinement chain not implemented.

**Current Flow:**
```
POST /api/cya/generate
  ├─ Phase 1–4 → needs_clarification
  └─ Return HTTP 200 with clarification prompt

POST /api/cya/refine (once)
  ├─ Load session
  ├─ Merge clarification_response.provided_data
  ├─ Phase 2–4 re-run
  └─ Return narrative

POST /api/cya/refine (second call - ???)
  └─ ERROR: No session refinement history tracking
```

**Design Goal:** Support up to 5 refine cycles per session (user provides clarification, reviews narrative, requests adjustment, provides more data, etc.).

**Design Solution:**
1. Track refinement iteration counter in session: `refinement_cycle: 0`
2. Each refine increments counter + appends to `refinement_history[]`
3. Async job progress logging includes cycle number: `phase_3_grounding (cycle 2/5)`
4. Max-cycle guard: return HTTP 429 (Too Many Requests) after 5 cycles
5. Preserve full audit trail: session.refinement_history[].provided_data, phase_progress, timestamp

**Implementation Scope:**
- [ ] Update session document schema: `refinement_cycle: number`, `refinement_history: RefineAction[]`
- [ ] Update `cya.refine` action to auto-increment cycle + append to history
- [ ] Update async job logger: include cycle in phase messages
- [ ] Update `POST /api/cya/refine` OpenAPI schema: document max 5 cycles, 429 response
- [ ] Add session-reset endpoint: `DELETE /api/cya/sessions/:session_id` to clear history
- [ ] Add tests: 3-cycle refinement sequence (clarification → response → adjustment)

**Estimated Effort:** 3–4 days
**Blocked By:** None (async pattern already in place)
**Blocks:** None

---

## Frontend Features

### F1: Profile Template Library

**User Story:** "As a grid operator, I want to select a pre-built persona (e.g., 'Board of Directors', 'Community') instead of manually configuring each stakeholder profile."

**Design:**
- Add `POST /api/cya/profiles/templates` → list pre-built templates
- Each template includes: `id`, `name`, `targetAudience`, `tone`, `description`, `sampleFocusAreas[]`
- Templates stored in source: `src/cya-profile-templates.js` (4 base personas)
- UI: profile creation wizard includes "Use Template" button

**Backend Scope:**
- [ ] Create `src/cya-profile-templates.js` with 4 personas:
  - `board-of-directors`: formal, regulatory focus, executives
  - `community`: accessible, technical level medium, local impact
  - `investor`: risk-focused, financial metrics, ROI
  - `grid-operator`: technical, operational constraints, grid stability
- [ ] Add `cya.listProfileTemplates` action
- [ ] Add OpenAPI endpoint: `GET /api/cya/profiles/templates`
- [ ] Update profile schema: optional `templateId` field

**Frontend Scope:**
- [ ] Profile creation modal: add "Select Template" radio group
- [ ] Auto-populate profile fields from template selection
- [ ] Manual override of template values

**Estimated Effort:** 2–3 days (backend: 0.5 days, frontend: 2 days)
**Blocked By:** None
**Blocks:** None

---

### F2: Multi-Perspective Synthesis

**User Story:** "As a board member, I want to see both the 'investor perspective' and the 'regulatory perspective' on the same asset so I can make a balanced decision."

**Design:**
- Single `POST /api/cya/generate` call generates 2–3 competing narratives
- Each narrative has different `targetAudience` (investor, regulator, community)
- Response includes all narratives + comparison summary (key differences)

**Backend Scope:**
- [ ] Update `generate` action to accept `perspectiveCount: 1 | 2 | 3` param (default: 1)
- [ ] Phase 4 synthesis loop: run Gemini N times (N = perspectiveCount) with different profiles
- [ ] Compile response: `narratives: [narrative1, narrative2, ...]`
- [ ] Add comparison summary (optional): highlight conflicting recommendations
- [ ] Update async job: phase_4_synthesis progress split among perspectives

**Frontend Scope:**
- [ ] Generate form: add "Compare Perspectives" checkbox
- [ ] Result display: tabs or side-by-side view of narratives
- [ ] Highlight conflicts in comparison view

**Estimated Effort:** 3–4 days (backend: 2 days, frontend: 1.5 days)
**Blocked By:** None (F1 independent)
**Blocks:** None

---

### F3: PDF Export with Provenance Annotations

**User Story:** "As a grid operator, I want to export a CYA narrative as a styled PDF that includes data sources, regulation citations, and trusted-fact warnings so I can share it with auditors."

**Design:**
- Add `POST /api/cya/sessions/:session_id/export/pdf` endpoint
- PDF includes:
  - Title + executive summary
  - Key points with source annotations (MaStR, LLM, OSM, user-asserted)
  - Regulation citations with links (if digital)
  - Trusted-fact disclaimer box
  - Appendix: full grounding JSON (optional)
- Use `pdfkit` or `puppeteer` for HTML→PDF conversion

**Backend Scope:**
- [ ] Create `src/cya-pdf-builder.js` with HTML template
- [ ] Add `cya.exportSessionPdf` action (returns Buffer)
- [ ] Add OpenAPI endpoint: `POST /api/cya/sessions/:session_id/export/pdf`
- [ ] Include response headers: `Content-Type: application/pdf`, `Content-Disposition: attachment`
- [ ] Add permission guard: Bearer token required (read-only sufficient)

**Frontend Scope:**
- [ ] Session detail view: add "Export as PDF" button
- [ ] File download handling (standard browser download)

**Estimated Effort:** 2–3 days (backend: 1.5 days, frontend: 0.5 days)
**Blocked By:** None
**Blocks:** None

---

## Known Limitations & Open Questions

### L1: LLM Hallucination Risk

**Status:** Mitigated but not eliminated (v0.26.7)
**Mitigation:** XAI guardrails (trusted-fact annotation), grounding quality guards
**Remaining Risk:** LLM may synthesize pseudo-authoritative statements that mix user-asserted data with factual claims
**Path Forward:** Add LLM output validation (keyword blacklist for "official", "confirmed", "measured" when applied to trusted facts)

### L2: OSM Data Staleness

**Status:** Known (v0.26.7)
**Risk:** OSM substation data may be outdated, routing topology decisions to stale coordinates
**Mitigation:** Fallback to `osm_unavailable` if no results; Phase 3 grounding records gap
**Path Forward:** Integrate with operator-supplied topology data (VNB data via ZNP project)

### L3: Confidence Scoring Underspecified

**Status:** Known (v0.26.7)
**Current Logic:** Source-based (LLM='high', mastr='high', osm='medium', user='medium')
**Gap:** No temporal decay (6-month-old data = high confidence❌), no cross-source correlation (conflicting facts = low❌)
**Path Forward:** v0.27 candidate—implement temporal decay + multi-source confidence aggregation

---

## Open Questions (Design Decisions Deferred)

### Q1: Session TTL and DSGVO Compliance

**Question:** How long should CYA session data persist?
- **Option A:** 30 days (current default, DSGVO-safe, short audit window)
- **Option B:** 90 days (auditor-friendly, longer privacy risk)
- **Option C:** Unlimited (audit archive, DSGVO requires explicit consent)

**Decision Needed:** Before v0.27 release
**Impact:** Session cleanup job, retention policy documentation

### Q2: Capacity_mw Semantics and Aggregation

**Question:** When filtering by location, should Phase 1 MaStR retrieval sum installation capacities or report single assets?
- **Option A:** Return largest asset only (current, simplest)
- **Option B:** Return top-3 assets by capacity + total aggregate
- **Option C:** Return full portfolio statistics (mean, median, std dev)

**Decision Needed:** Before F1 (Profile Templates) design
**Impact:** Phase 1 evidence structure, grounding confidence calculation

### Q3: Refinement Cycle Budget and Cost Management

**Question:** Current Gemini API cost ~$0.003 per synthesis; 5-cycle refinement = $0.015 per session. Should we implement per-user budget limits?
- **Option A:** No budget (current, user pays)
- **Option B:** Max 3 cycles per session (cost cap ~$0.01)
- **Option C:** Token quota system (admin configurable)

**Decision Needed:** Before A3 (Multi-Cycle Refinement) implementation
**Impact:** Session structure, rate-limit policy, billing integration

---

## Implementation Roadmap

### v0.26.8 (Immediate Hotfix, ~1 week)
- [ ] A2: Token Propagation Hardening

### v0.27 (Feature Release, ~2 weeks)
- [ ] A1: Voltage-Level Generalization
- [ ] A3: Multi-Cycle Refinement
- [ ] F1: Profile Template Library

### v0.28 (Extended Features, ~3 weeks)
- [ ] F2: Multi-Perspective Synthesis
- [ ] F3: PDF Export
- [ ] L3 Mitigation: Confidence scoring refinement

---

## Sign-Off & Review Checklist

- [ ] Backend architecture reviewed by lead architect
- [ ] Frontend impact assessed by UI lead
- [ ] DSGVO / privacy implications documented (Q1 decision)
- [ ] Cost/budget implications documented (Q3 decision)
- [ ] User acceptance testing planned (PoCs ready)
- [ ] Documentation roadmap updated

---

**Document Owner:** Backend Team
**Created:** 2026-04-16
**Next Review:** Post-v0.26.8 release
**Status:** open → in-progress (v0.27 kickoff)
