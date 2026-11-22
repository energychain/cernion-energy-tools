'use strict';

/**
 * Domain pack „Assetmanagement und Investition" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */

module.exports = {
  pack: 'asset',
  label: 'Assetmanagement und Investition',
  description:
    'Betriebsmittel und Anlagen des Netzes, Zustand und Alter, Instandhaltung, Reinvestition, Investitionsplanung, CAPEX-Priorisierung, Datenqualität des Anlagenbestands und Altdaten.',
  functionDomains: [
    'asset-management',
    'asset-strategy',
    'assets',
    'asset-governance',
    'investment-governance',
  ],
  functionServices: [
    'assets',
    'investment-planning',
    'capex-prioritization',
    'reinvest-signal',
    'ghost-asset-alert',
    'altdaten-assessment',
    'investment-maturity-off-balance-gate',
  ],
  objectKinds: [
    {
      kind: 'asset.equipment',
      label: 'Betriebsmittel',
      description:
        'Ein Betriebsmittel oder eine Anlage des Netzes (Trafo, Leitung, Schaltanlage, Zähler)',
    },
    {
      kind: 'asset.investment',
      label: 'Investition',
      description: 'Eine Investitions- oder Reinvestitionsmaßnahme mit Budget',
    },
  ],
  expanders: {},
  playbooks: [],
};
