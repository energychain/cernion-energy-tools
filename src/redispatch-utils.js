'use strict';

/**
 * Normalise mixed boolean encodings from MaStR-derived payloads.
 * Accepts booleans, 1/0, "1"/"0", and common yes/no strings.
 *
 * @param {any} value
 * @returns {boolean}
 */
function normaliseBoolFlag(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'ja', 'y'].includes(normalized)) return true;
    if (['false', 'no', 'nein', 'n', ''].includes(normalized)) return false;
  }
  return false;
}

/**
 * Best-effort energy type normalisation for Layer 0 graph assets.
 *
 * @param {object} attrs
 * @returns {string}
 */
function normaliseAssetType(attrs = {}) {
  const raw = String(
    attrs.assetType ||
      attrs.technology ||
      attrs.technologie ||
      attrs.energietraeger ||
      attrs.Energietraeger ||
      ''
  ).toLowerCase();

  if (/(solar|pv|photovoltaik)/.test(raw)) return 'solar';
  if (/(wind|windkraft)/.test(raw)) return 'wind';
  if (/(biomasse|biogas|biomass)/.test(raw)) return 'biomass';
  if (/(storage|speicher|battery|batterie|bess)/.test(raw)) return 'storage';
  return raw || 'unknown';
}

/**
 * Capacity-only Redispatch eligibility rule for NOVA MVP.
 *
 * Rule: ANY graph asset with capacity >= 100 kW and assetType in
 * ['solar', 'wind', 'biomass'] is treated as redispatch-eligible.
 *
 * @param {object} attrs
 * @returns {boolean}
 */
function isRedispatchEligibleCapacityOnly(attrs = {}) {
  const type = normaliseAssetType(attrs);
  const capacity = Number.isFinite(attrs.capacity_kw)
    ? attrs.capacity_kw
    : Number(attrs.capacity || 0);

  return capacity >= 100 && ['solar', 'wind', 'biomass'].includes(type);
}

module.exports = {
  normaliseBoolFlag,
  normaliseAssetType,
  isRedispatchEligibleCapacityOnly,
};
