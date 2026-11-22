'use strict';

/**
 * Domain pack „Abrechnung und Netzentgelte" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */

module.exports = {
  pack: 'abrechnung',
  label: 'Abrechnung und Netzentgelte',
  description:
    'Netznutzungs- und Lieferantenabrechnung, Netzentgelte und Preisblätter, Messentgelte, Umlagen und Abgaben, EEG- und KWKG-Abrechnung, Rückforderungen, Abrechnungsabgleich und Rechnungsprüfung.',
  functionDomains: [
    'settlement',
    're4de-grid-fees',
    'regulatory-revenue',
    'metering-finance-governance',
    'water-pricing-governance',
  ],
  functionServices: [
    'settlement',
    'regulatorische-entgeltlogik',
    're4de-variable-grid-fee',
    'eeg-clawback-calculator',
    'eog-calculator',
  ],
  objectKinds: [
    {
      kind: 'billing.invoice',
      label: 'Rechnung',
      description: 'Eine Netznutzungs-, Liefer- oder Messrechnung',
    },
    {
      kind: 'billing.fee',
      label: 'Entgelt oder Preisposition',
      description: 'Ein Netzentgelt, Messentgelt, eine Umlage oder Preisblatt-Position',
    },
  ],
  expanders: {},
  playbooks: [],
};
