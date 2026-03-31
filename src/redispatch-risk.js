'use strict';

/**
 * Redispatch Ex-Post Risk Module (v0.18)
 *
 * Pure calculation functions for settlement readiness and financial risk assessment.
 * No I/O, no Moleculer — identical inputs always produce identical outputs.
 * Follows the same stateless-module pattern as src/timeseries-allocation.js.
 */

/**
 * Rounds a number to 2 decimal places.
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Assesses settlement readiness for a Redispatch portfolio.
 *
 * An installation is considered "blocked" (not ready for A96 settlement) if any
 * error-severity finding references its MaStR number in the context object.
 * Warnings do not block settlement — they indicate sub-optimal but still
 * processable data quality.
 *
 * @param {object[]} installations  Full portfolio from stepPortfolio
 * @param {object[]} findings       All findings from stepMasterDataValidation
 * @returns {{
 *   totalInstallations: number,
 *   readyForSettlement: number,
 *   readinessPercent: number,
 *   blockedInstallations: number,
 *   blockedMastrNumbers: string[]
 * }}
 */
function assessSettlementReadiness(installations, findings) {
  const total = installations.length;

  if (total === 0) {
    return {
      totalInstallations: 0,
      readyForSettlement: 0,
      readinessPercent: 0,
      blockedInstallations: 0,
      blockedMastrNumbers: [],
    };
  }

  const blockedSet = new Set(
    findings
      .filter((f) => f.severity === 'error' && f.context?.mastrNummer)
      .map((f) => f.context.mastrNummer)
  );

  const ready = total - blockedSet.size;

  return {
    totalInstallations: total,
    readyForSettlement: ready,
    readinessPercent: round2((ready / total) * 100),
    blockedInstallations: blockedSet.size,
    blockedMastrNumbers: [...blockedSet],
  };
}

/**
 * Assesses the financial risk of un-settleable curtailment events.
 *
 * Formula: estimatedLostCompensationEur = curtailmentGWh × 1000 MWh/GWh × blockedFraction × avgEur/MWh
 * Risk levels: low (<10,000 €), medium (10,000–100,000 €), high (>100,000 €).
 *
 * @param {{
 *   readinessPercent: number,
 *   totalInstallations: number,
 *   blockedInstallations: number
 * }} readiness  Result from assessSettlementReadiness
 * @param {number} curtailmentGWh              Total curtailment volume in the audit period (GWh)
 * @param {number} [avgCompensationEurPerMWh=50] Average compensation rate €/MWh (default: 50)
 * @returns {{
 *   blockedFractionPercent: number,
 *   curtailmentGWh: number,
 *   avgCompensationEurPerMWh: number,
 *   estimatedLostCompensationEur: number,
 *   riskLevel: 'low'|'medium'|'high'
 * }}
 */
function assessRisk(readiness, curtailmentGWh, avgCompensationEurPerMWh = 50) {
  const blockedFraction = 1 - readiness.readinessPercent / 100;
  const estimatedLostCompensationEur =
    (curtailmentGWh || 0) * 1000 * blockedFraction * avgCompensationEurPerMWh;

  const riskLevel =
    estimatedLostCompensationEur > 100_000
      ? 'high'
      : estimatedLostCompensationEur > 10_000
        ? 'medium'
        : 'low';

  return {
    blockedFractionPercent: round2(blockedFraction * 100),
    curtailmentGWh: curtailmentGWh || 0,
    avgCompensationEurPerMWh,
    estimatedLostCompensationEur: Math.round(estimatedLostCompensationEur),
    riskLevel,
  };
}

module.exports = {
  round2,
  assessSettlementReadiness,
  assessRisk,
};
