/**
 * DataStatus Taxonomy (CR-11)
 *
 * Provides a unified classification for every KPI field in the 360° Management Report.
 * Enables precise distinction between:
 *   - Implementation gaps  (NOT_CALLED  → ⚠ n/v – actionable bug)
 *   - Licence gaps         (NOT_LICENSED → — (optional))
 *   - Real data absence    (NO_DATA     → — (keine Daten))
 *   - Tool errors          (TOOL_ERROR  → ✗ Fehler)
 *   - Estimates/heuristics (FALLBACK    → ~value ⓘ)
 *   - Confirmed values     (OK          → value)
 *
 * Usage (service / pipeline):
 *   const { ds } = require('../src/data-status');
 *   return ds(DataStatus.OK, 42.5);
 *   return ds(DataStatus.NOT_CALLED);
 *   return ds(DataStatus.FALLBACK, '6–12', '% Branchenspanne', 'BDEW Kundenstudie 2023');
 *
 * Usage (report-builder renderer):
 *   import { kpiRowDs } from helpers – reads .status and .value automatically.
 */

'use strict';

// ─── Enum ─────────────────────────────────────────────────────────────────────

const DataStatus = {
  OK: 'ok', // Real value, tool successful
  NOT_CALLED: 'not_called', // Tool exists but was not called (implementation gap)
  TOOL_ERROR: 'tool_error', // Tool was called but returned an error
  NOT_LICENSED: 'not_licensed', // Tool not in customer licence scope
  NO_DATA: 'no_data', // Tool OK but no data for this VNB
  FALLBACK: 'fallback', // Estimated value / industry heuristic – MUST be labelled
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a tagged KPI data object.
 *
 * @param {string}  status  - DataStatus constant
 * @param {*}       [value] - The actual value (null / undefined for non-OK statuses)
 * @param {string}  [unit]  - Optional unit string (e.g. '%', 'kWh', '% Branchenspanne')
 * @param {string}  [source]- Data source / reason (used by FALLBACK + NOT_CALLED)
 * @returns {{ value, unit, status, source }}
 */
function ds(status, value = null, unit = '', source = '') {
  return { value, unit, status, source };
}

// ─── Renderer helper ──────────────────────────────────────────────────────────

/**
 * Render a tagged KPI object to a display string + optional marker.
 * Intended for use in `kpiRow(label, renderDs(obj), ...)` calls.
 *
 * Returns:
 *   OK          → raw value (caller formats with fmtNum / fmtPct)
 *   NOT_CALLED  → null  (kpiRow receives null → shows ⚠ n/v via fallbackReason)
 *   TOOL_ERROR  → null
 *   NOT_LICENSED→ null
 *   NO_DATA     → null
 *   FALLBACK    → value (caller renders, kpiRow 5th-param used for ⓘ label)
 */
function dsValue(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return obj.value ?? null;
}

/**
 * Derive the appropriate kpiRow fallbackReason string from a DataStatus object.
 * Pass the result as the 5th argument to kpiRow().
 *
 * @param {object} obj  - DataStatus object created by ds()
 * @param {string} [defaultReason] - Overrides the auto-generated reason when non-empty
 */
function dsFallbackReason(obj, defaultReason = '') {
  if (defaultReason) return defaultReason;
  if (!obj || typeof obj !== 'object') return '';
  switch (obj.status) {
    case DataStatus.OK:
      return ''; // No fallback indicator needed
    case DataStatus.NOT_CALLED:
      return obj.source
        ? `⚠ n/v – ${obj.source}`
        : '⚠ n/v – Tool nicht aufgerufen (Implementierungslücke)';
    case DataStatus.TOOL_ERROR:
      return obj.source ? `✗ Fehler – ${obj.source}` : '✗ Fehler beim Tool-Aufruf';
    case DataStatus.NOT_LICENSED:
      return 'nicht lizenziert';
    case DataStatus.NO_DATA:
      return obj.source ? `keine Daten – ${obj.source}` : 'keine Daten für diesen VNB';
    case DataStatus.FALLBACK:
      return obj.source ? `Schätzwert (${obj.source})` : 'Branchenschätzung';
    default:
      return '';
  }
}

/**
 * Format a FALLBACK value with tilde prefix for display.
 * e.g. value=8.5, unit='%' → '~8,5 %'
 *
 * @param {object} obj - DataStatus object
 * @param {number} [decimals=1]
 */
function dsFallbackDisplay(obj, decimals = 1) {
  if (!obj || obj.status !== DataStatus.FALLBACK || obj.value === null || obj.value === undefined) {
    return null;
  }
  const numVal = Number(obj.value);
  const formatted = isNaN(numVal) ? String(obj.value) : numVal.toFixed(decimals);
  return obj.unit ? `~${formatted} ${obj.unit}` : `~${formatted}`;
}

/**
 * Derive render-ready [displayValue, fallbackReason] tuple from a DataStatus object.
 * Convenience wrapper used in kpiRow() calls in report-builder.
 *
 * Example:
 *   const [val, reason] = dsRender(kpi.churnScore);
 *   kpiRow('Churn-Score', val, '%', 'Wechselwahrscheinlichkeit', reason)
 *
 * @param {object} obj
 * @param {Function} [formatter] - Optional formatter applied to OK values, e.g. fmtPct
 * @returns {[*, string]}
 */
function dsRender(obj, formatter = null) {
  if (!obj || typeof obj !== 'object') return [null, ''];

  switch (obj.status) {
    case DataStatus.OK: {
      const v = obj.value;
      return [formatter ? formatter(v) : v, ''];
    }
    case DataStatus.FALLBACK: {
      const display = dsFallbackDisplay(obj);
      return [display ?? obj.value, dsFallbackReason(obj)];
    }
    default:
      return [null, dsFallbackReason(obj)];
  }
}

module.exports = { DataStatus, ds, dsValue, dsFallbackReason, dsFallbackDisplay, dsRender };
