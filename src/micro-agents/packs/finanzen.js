'use strict';

/**
 * Domain pack „Finanzen und Controlling" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */

module.exports = {
  pack: 'finanzen',
  label: 'Finanzen und Controlling',
  description:
    'Finanzen und Controlling: Ergebnis- und Budgetwirkung, Planung, Investitionsfinanzierung, Kennzahlen, steuerliche Datenübergaben und Szenarien zur Unternehmenssteuerung.',
  functionDomains: [
    'finance',
    'finance-agent',
    'finance-governance',
    'investment-finance-governance',
    'transformation-finance-governance',
    'tax-finance-data-handover',
    'management-steering',
  ],
  functionServices: ['finance-agent', 'capex-prioritization', 'utility-report'],
  objectKinds: [
    {
      kind: 'finance.budget',
      label: 'Budget oder Kennzahl',
      description: 'Eine Budgetposition, Kennzahl oder Ergebnisgröße',
    },
  ],
  expanders: {},
  playbooks: [],
};
