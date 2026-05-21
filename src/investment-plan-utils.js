'use strict';

const INVESTMENT_TRIGGER_THRESHOLD_EUR = 1_000_000;

const PROVENANCE = Object.freeze({
  REDISPATCH_TARGET: 'redispatch_target',
  FINANCE_BUDGET: 'finance_budget',
});

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

function buildSollBaselines({ redispatchTargetEur, financeBudgetEur }) {
  const provenances = [];
  const redispatchValue = toNumber(redispatchTargetEur);
  if (redispatchValue !== null) {
    provenances.push({
      provenance: PROVENANCE.REDISPATCH_TARGET,
      valueEur: roundMoney(redispatchValue),
      reliability: 0.85,
    });
  }

  const financeValue = toNumber(financeBudgetEur);
  if (financeValue !== null) {
    provenances.push({
      provenance: PROVENANCE.FINANCE_BUDGET,
      valueEur: roundMoney(financeValue),
      reliability: 0.9,
    });
  }

  const values = provenances.map((item) => item.valueEur);
  const sollEur =
    values.length > 0 ? roundMoney(values.reduce((acc, val) => acc + val, 0) / values.length) : 0;

  return {
    sollEur,
    provenanceFlags: provenances,
  };
}

function buildSollIstComparison({ sollEur, istEur }) {
  const soll = roundMoney(sollEur);
  const ist = roundMoney(istEur);
  const deltaEur = roundMoney(ist - soll);
  const deltaPercent = soll > 0 ? roundMoney((deltaEur / soll) * 100) : 0;

  return {
    sollEur: soll,
    istEur: ist,
    deltaEur,
    deltaPercent,
  };
}

function detectInvestmentTriggers(measures = [], thresholdEur = INVESTMENT_TRIGGER_THRESHOLD_EUR) {
  const threshold = toNumber(thresholdEur) || INVESTMENT_TRIGGER_THRESHOLD_EUR;
  return (Array.isArray(measures) ? measures : [])
    .map((measure, index) => {
      const capexEur = roundMoney(measure?.capexEur || 0);
      const avoidedCostsEur = roundMoney(measure?.avoidedCostsEur || 0);
      const triggerAmountEur = Math.max(capexEur, avoidedCostsEur);
      return {
        measureId: measure?.measureId || `measure-${index + 1}`,
        name: measure?.name || `Measure ${index + 1}`,
        projectId: measure?.projectId || null,
        capexEur,
        avoidedCostsEur,
        triggerAmountEur,
        thresholdEur: threshold,
        requiresHitl: triggerAmountEur > threshold,
      };
    })
    .filter((item) => item.requiresHitl);
}

function detectMandateAlignment(vdmiMatrices = [], requiredRoles = []) {
  const roles = new Set();

  for (const matrix of Array.isArray(vdmiMatrices) ? vdmiMatrices : []) {
    for (const task of matrix?.tasks || []) {
      for (const roleGroup of [
        task?.verantwortlich,
        task?.durchfuehrend,
        task?.mitwirkend,
        task?.information,
      ]) {
        for (const actor of roleGroup || []) {
          const candidates = [actor?.actorId, actor?.role, actor?.roleId]
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
          for (const candidate of candidates) {
            roles.add(candidate);
          }
        }
      }
    }
  }

  const assignedRoles = Array.from(roles).sort();
  const missingRoles = (Array.isArray(requiredRoles) ? requiredRoles : []).filter(
    (role) => !roles.has(role)
  );

  return {
    requiredRoles,
    assignedRoles,
    missingRoles,
    aligned: missingRoles.length === 0,
  };
}

module.exports = {
  INVESTMENT_TRIGGER_THRESHOLD_EUR,
  PROVENANCE,
  buildSollBaselines,
  buildSollIstComparison,
  detectInvestmentTriggers,
  detectMandateAlignment,
  roundMoney,
};
