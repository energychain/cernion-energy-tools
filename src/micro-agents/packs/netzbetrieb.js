'use strict';

/**
 * Domain pack „Netzbetrieb, Redispatch und Flexibilität" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */

module.exports = {
  pack: 'netzbetrieb',
  label: 'Netzbetrieb, Redispatch und Flexibilität',
  description:
    'Netzbetrieb und Netzführung, Redispatch 2.0, Einspeisemanagement, Steuerung nach § 14a EnWG, Flexibilität und Speicher, Engpassmanagement, Abrechnung von Redispatch-Maßnahmen und Sonderfälle.',
  functionDomains: [
    'grid-operations',
    'redispatch',
    'redispatch-governance',
    'redispatch-rcs',
    'flexibilitaet',
    'flex-governance',
    'vnb-operations',
    'steuerbarkeitscheck-governance',
    'cls-compliance-governance',
    'legacy-control-governance',
  ],
  functionServices: [
    'grid-operations',
    'redispatch-asset-register',
    'redispatch-data-governance',
    'redispatch-expost',
    'redispatch-readiness-gate',
    'redispatch-settlement-sandbox',
    'redispatch-special-case-gate',
    'battery-redispatch-special-gate',
    'flex',
    'flexibilitaetskosten-raster',
    'flexibility-conductor-role-model',
    'bess-screening',
    'rcs-rule-catalog',
    'rcs-simulation-run',
  ],
  objectKinds: [
    {
      kind: 'grid.measure',
      label: 'Netzmaßnahme',
      description: 'Eine Redispatch-, Steuerungs- oder Engpassmaßnahme',
    },
    {
      kind: 'flex.asset',
      label: 'Flexible Anlage',
      description: 'Ein Speicher, eine steuerbare Verbrauchseinrichtung oder flexible Erzeugung',
    },
  ],
  expanders: {},
  playbooks: [],
};
