# 🔴 CRITICAL FIX: BUG-2 Residuallast Formula – Pre-Demo Checklist

**Status:** BLOCKING Congress Demo (10.3.2026)
**Affected Component:** 360° Report Sektion 1 (Cost Analysis)
**Severity:** Critical – Vorstand-facing number is wrong by factor ~54×
**Complexity:** 🟢 **TRIVIAL (5 min fix)**

---

## The Problem

**Current Output (Hardcoded):**
```
Beschaffungskosten ≈ 1 MW × 120 €/MWh × 8.760 h ≈ 1,05 Mio. €/Jahr
```

**Actual Example (Frankenthal Report v2):**
- Residuallast shown: **54 MW** (computed correctly)
- But calculation uses: **1 MW** (hardcoded, wrong!)
- Result: **54× underestimate** (1 Mio. instead of 57 Mio.)

**Why this happened:**
- Template string in `src/report-builder.js` is hardcoded with literal values
- Day-Ahead price IS available in v2 (120.95 €/MWh)
- Residuallast capacity IS computed correctly in Section 1
- But the formula template doesn't use these values – uses old placeholder instead

---

## The Fix (5-Minute Change)

**File:** [src/report-builder.js](src/report-builder.js)

**Search for:**
```javascript
"1 MW × 120 €/MWh"
```

**Replace with:**
```javascript
"{residuallast_mw} MW × {day_ahead_price_eur_mwh} €/MWh"
```

**Validation:**
1. Find the line that constructs the cost formula string
2. Ensure template variables are available:
   - `residuallast_mw` comes from Section 1 data
   - `day_ahead_price_eur_mwh` comes from Section 3 data (energy-market.service.js)
3. Make sure both values are passed to the template renderer
4. If using `util.format()` or similar, replace `%s` placeholders accordingly

---

## Pre-Fix Verification

Run this command to find the exact location:

```bash
grep -n "1 MW × 120" src/report-builder.js
```

Expected output:
```
LINE_NUMBER: ... "1 MW × 120 €/MWh × 8.760 h ≈ 1,05 Mio. €/Jahr" ...
```

---

## Post-Fix Test

1. **Local test:** Generate a new 360° Report for Frankenthal (BDEW 9900191000003)
2. **Check Section 1:** Residuallast line should now show actual value, e.g., **54 Mio. €/Jahr** instead of 1 Mio.
3. **Formula validation:**
   - 54 MW × 120.95 €/MWh × 8.760 h / 1,000,000 = **57.1 Mio. €/Jahr** ✅
4. **Run test suite:** `npm test` must pass (797/797)
5. **Commit message:**
   ```
   fix: BUG-2 Scale residuallast formula with actual MW and day-ahead price

   Changed hardcoded "1 MW × 120 €/MWh" to dynamic "{residuallast_mw} MW ×
   {day_ahead_price_eur_mwh} €/MWh" formula in Section 1 cost analysis.

   Fixes critical calculation error where Frankenthal's 54 MW residuallast
   was displayed as 1 Mio. €/Jahr instead of ~57 Mio. €/Jahr.

   Test: Frankenthal v3 report Section 1 now shows 57.1 Mio. €/Jahr (54 MW ×
   120.95 €/MWh × 8.760 h).
   ```

---

## Why This is Trivial & Safe

- **No new dependencies** – template variables already exist
- **No logic changes** – just using existing data in formula
- **No breaking changes** – same output format, just correct numbers
- **Test coverage exists** – utility-report.service.test.js will validate
- **Reversible** – if needed, simple template string revert

---

## Deployment Checklist

- [ ] Fix implemented in `src/report-builder.js`
- [ ] Local test: Frankenthal report Section 1 shows ~57 Mio. €/Jahr
- [ ] Test suite passes: `npm test` (797/797)
- [ ] Commit created: `git add -A && git commit -m "fix: BUG-2 ..."`
- [ ] Push to main: `git push origin main`
- [ ] Frankenthal + Gmünd v3 reports generated and verified
- [ ] CEO briefing document updated with correct costs
- [ ] Demo materials ready (10.3.2026)

---

## Impact Summary

**Before Fix:**
- Vorstand sees: "Beschaffungskosten ≈ 1,05 Mio. €/Jahr" ❌
- Reality: 54-MW grid, ~57 Mio. €/Jahr cost burden
- Credibility impact: Formula looks arbitrary, not data-driven

**After Fix:**
- Vorstand sees: "Beschaffungskosten ≈ 57,1 Mio. €/Jahr" ✅
- Matches actual residuallast (54 MW) and real market price (120.95 €/MWh)
- Credibility impact: Professional, data-driven analysis

**Demo Readiness:** 🟢 **READY WHEN FIXED**

---

*CR-CERNION-043 BUG-2 · Critical Blocker · Pre-Congress Fix Checklist*
*Fix Deadline: 10.3.2026 before demo presentation*
