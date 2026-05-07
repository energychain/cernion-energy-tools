'use strict';

/**
 * A96 Field Validator (v0.47.0)
 *
 * Validates A96 settlement messages against the interim JSON Schema (Spec-Freeze 2026-06-15).
 * Fields still marked [BNetzA-OFFEN] are checked against defensive defaults and
 * reported as ES_A96_FIELD_DRIFT warnings when absent or non-conformant.
 *
 * Regulatory basis: § 42c EnWG, BNetzA A96 Mitteilungsprozess (interim spec, Q3 2026 final)
 * Spec-Freeze: 2026-06-15 — no new open fields after this date; v0.51 absorbs BNetzA finals.
 * Docs: docs/ENERGY_SHARING_A96_DEFAULTS.md
 */

// ---------------------------------------------------------------------------
// A96 interim JSON Schema (defensive defaults for [BNetzA-OFFEN] fields)
// ---------------------------------------------------------------------------

/** @type {Record<string, { required: boolean; defensiveDefault: unknown; bnetzaOffen: boolean; description: string }>} */
const A96_FIELD_SPEC = {
  // Stable fields (finalised)
  GemeinschaftsId: {
    required: true,
    defensiveDefault: null,
    bnetzaOffen: false,
    description: 'External community ID assigned by the VNB',
  },
  MaloIdVerbraucher: {
    required: true,
    defensiveDefault: null,
    bnetzaOffen: false,
    description: 'Marktlokations-ID (33-char DE-prefix)',
  },
  ZugeteilteEnergieMenge: {
    required: true,
    defensiveDefault: null,
    bnetzaOffen: false,
    description: 'Allocated energy in kWh for the settlement period',
  },
  AllokationsZeitraumVon: {
    required: true,
    defensiveDefault: null,
    bnetzaOffen: false,
    description: 'Allocation period start (ISO-8601)',
  },
  AllokationsZeitraumBis: {
    required: true,
    defensiveDefault: null,
    bnetzaOffen: false,
    description: 'Allocation period end (ISO-8601)',
  },

  // [BNetzA-OFFEN] fields — defensive defaults per docs/ENERGY_SHARING_A96_DEFAULTS.md
  ErzeugerMastrNummer: {
    required: false,
    defensiveDefault: null, // filled from generators[].mastrNummer
    bnetzaOffen: true,
    description: 'Generator MaStR number — mapping to A96 not yet final',
  },
  Bilanzierungsmonat: {
    required: false,
    defensiveDefault: null, // filled from allocation period month (YYYY-MM)
    bnetzaOffen: true,
    description: 'Settlement month (YYYY-MM) — granularity month vs. period open',
  },
  BdewCodeNetzbetreiber: {
    required: false,
    defensiveDefault: null, // filled from gridOperator.bdew
    bnetzaOffen: true,
    description: 'BDEW grid operator code — transmission path in A96 not yet defined',
  },
  QualitaetskennzeichenMscons: {
    required: false,
    defensiveDefault: 'E01',
    bnetzaOffen: true,
    description: 'MSCONS quality indicator E01 (measured) / E02 (substitute) — to be clarified',
  },
};

const OPEN_FIELDS = Object.entries(A96_FIELD_SPEC)
  .filter(([, spec]) => spec.bnetzaOffen)
  .map(([field]) => field);

const REQUIRED_FIELDS = Object.entries(A96_FIELD_SPEC)
  .filter(([, spec]) => spec.required)
  .map(([field]) => field);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates an A96 message object.
 *
 * @param {Record<string, unknown>} message - The A96 message to validate.
 * @returns {{ valid: boolean; errors: string[]; warnings: string[]; driftFields: string[] }}
 */
function validateA96Message(message) {
  const errors = [];
  const warnings = [];
  const driftFields = [];

  if (!message || typeof message !== 'object') {
    return { valid: false, errors: ['A96 message must be a non-null object'], warnings: [], driftFields: [] };
  }

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (message[field] == null || message[field] === '') {
      errors.push(`Required field missing or empty: ${field}`);
    }
  }

  // Check [BNetzA-OFFEN] fields — mark drift when using defensive default
  for (const field of OPEN_FIELDS) {
    const spec = A96_FIELD_SPEC[field];
    const value = message[field];

    if (value == null) {
      warnings.push(
        `[BNetzA-OFFEN] Field "${field}" absent — using defensive default: ${JSON.stringify(spec.defensiveDefault)}`
      );
      driftFields.push(field);
    } else if (spec.defensiveDefault !== null && value === spec.defensiveDefault) {
      warnings.push(
        `[BNetzA-OFFEN] Field "${field}" equals defensive default "${spec.defensiveDefault}" — spec not yet final`
      );
      driftFields.push(field);
    }
  }

  // MaLo format check (when present)
  const malo = message['MaloIdVerbraucher'];
  if (malo != null && !/^DE\d{31}$/.test(String(malo))) {
    errors.push(`MaloIdVerbraucher format invalid (expected DE + 31 digits): ${malo}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    driftFields,
  };
}

/**
 * Apply defensive defaults to a partial A96 message.
 * Fills [BNetzA-OFFEN] fields from context when absent.
 *
 * @param {Record<string, unknown>} message - Partial A96 message.
 * @param {{ mastrNummer?: string; bdew?: string; month?: string; msconsMissing?: number }} context
 * @returns {Record<string, unknown>} Filled A96 message.
 */
function applyA96Defaults(message, context = {}) {
  const out = { ...message };

  if (out['ErzeugerMastrNummer'] == null && context.mastrNummer) {
    out['ErzeugerMastrNummer'] = context.mastrNummer;
  }
  if (out['Bilanzierungsmonat'] == null && context.month) {
    out['Bilanzierungsmonat'] = context.month;
  }
  if (out['BdewCodeNetzbetreiber'] == null && context.bdew) {
    out['BdewCodeNetzbetreiber'] = context.bdew;
  }
  if (out['QualitaetskennzeichenMscons'] == null) {
    // E02 (substitute) when metering gaps present, otherwise E01 (measured)
    out['QualitaetskennzeichenMscons'] =
      context.msconsMissing != null && context.msconsMissing > 0 ? 'E02' : 'E01';
  }

  return out;
}

/**
 * Build an ES_A96_FIELD_DRIFT finding for use in the energy-sharing pipeline.
 *
 * @param {string[]} driftFields
 * @returns {{ finding: string; severity: string; fields: string[]; message: string } | null}
 */
function buildDriftFinding(driftFields) {
  if (!driftFields || driftFields.length === 0) return null;
  return {
    finding: 'ES_A96_FIELD_DRIFT',
    severity: 'warning',
    fields: driftFields,
    message: `A96 field(s) use defensive default — awaiting BNetzA final spec (v0.51): ${driftFields.join(', ')}`,
  };
}

module.exports = {
  A96_FIELD_SPEC,
  OPEN_FIELDS,
  REQUIRED_FIELDS,
  validateA96Message,
  applyA96Defaults,
  buildDriftFinding,
};
