'use strict';

/**
 * Market Role Classifier
 *
 * Shared module for classifying BDEW market partners by role.
 * Used by: company.service, utility-report.service, grid-operations.service.
 *
 * BDEW prefix heuristic (secondary fallback when roles[] is empty):
 *   990x → VNB (Verteilnetzbetreiber)
 *   991x → Lieferant / Vertrieb
 *   992x → MSB (Messstellenbetreiber)
 *   993x → BKV (Bilanzkreisverantwortlicher)
 *   994x → Direktvermarkter
 */

/**
 * Canonical market role enum values.
 * @type {string[]}
 */
const MARKET_ROLE_ENUM = ['VNB', 'ÜNB', 'MSB', 'Lieferant', 'BKV', 'Direktvermarkter', 'other'];

/**
 * Role classification rules: ordered from most-specific to least-specific.
 * Each rule has a regex tested against elements of roles[], and a BDEW prefix fallback.
 */
const ROLE_RULES = [
  { role: 'VNB', pattern: /VNB|Verteilnetz|Netzbetreiber/i, prefix: '990' },
  { role: 'ÜNB', pattern: /ÜNB|Übertragungsnetz/i, prefix: null },
  { role: 'MSB', pattern: /MSB|Messtellen/i, prefix: '992' },
  { role: 'Lieferant', pattern: /Lieferant|Vertrieb/i, prefix: '991' },
  { role: 'BKV', pattern: /BKV|Bilanzkreis/i, prefix: '993' },
  { role: 'Direktvermarkter', pattern: /Direktvermarkt|DV\b/i, prefix: '994' },
];

/**
 * Classify a single BDEW partner by market role.
 *
 * @param {object} opts
 * @param {string[]} [opts.roles]    - Explicit roles array from MCP result (primary signal)
 * @param {string}  [opts.bdewCode] - BDEW code (fallback heuristic)
 * @returns {string} One of MARKET_ROLE_ENUM values
 */
function classifyPartner({ roles = [], bdewCode = '' } = {}) {
  const rolesArr = Array.isArray(roles) ? roles : [];
  const bdew = String(bdewCode || '');

  for (const rule of ROLE_RULES) {
    if (rolesArr.some((r) => rule.pattern.test(r))) return rule.role;
    if (rule.prefix && bdew.startsWith(rule.prefix)) return rule.role;
  }
  return 'other';
}

/**
 * Normalize a raw MCP market-partner result to a canonical shape.
 * Handles all known MCP response variants.
 *
 * @param {object} raw - Raw candidate from cernion_market_partners
 * @returns {{ bdew: string|null, name: string, roles: string[], city: string, mastrId: string|null }}
 */
function normalizeMarketPartner(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const bdew = raw.bdewCode || raw.bdew || null;
  const roles = Array.isArray(raw.roles)
    ? raw.roles
    : Array.isArray(raw.marketRoles)
      ? raw.marketRoles
      : [];
  const mastrId =
    raw.mastrId || raw.gridOperatorMastrId || raw.mastrIds?.SNB || raw.mastrIds?.GNB || null;

  return {
    bdew: bdew ? String(bdew) : null,
    name: raw.name || raw.companyName || raw.displayName || '',
    roles,
    city: raw.city || raw.contacts?.[0]?.city || '',
    postalCode: raw.postalCode || null,
    mastrId,
  };
}

/**
 * Extract raw candidates from the various MCP response shapes.
 *
 * @param {object} mcpResponse - Raw MCP tool response
 * @returns {object[]}
 */
function extractCandidates(mcpResponse) {
  return (
    mcpResponse?.data?.results ||
    mcpResponse?.results ||
    mcpResponse?.data?.data?.results ||
    mcpResponse?.data?.partners ||
    []
  );
}

module.exports = {
  MARKET_ROLE_ENUM,
  ROLE_RULES,
  classifyPartner,
  normalizeMarketPartner,
  extractCandidates,
};
