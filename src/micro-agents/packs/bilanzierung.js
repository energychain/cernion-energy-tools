'use strict';

/**
 * Domain pack „Bilanzierung" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */
const detectors = require('./detectors');

module.exports = {
  pack: 'bilanzierung',
  label: 'Bilanzierung',
  description:
    'Bilanzkreise und Bilanzkreisverantwortung, Zuordnung von Marktlokationen, Standardlastprofile (SLP) und registrierende Leistungsmessung (RLM), Mehr- und Mindermengen, Ausgleichsenergie, MaBiS-Prozesse und Bilanzierungsfristen.',
  functionDomains: [],
  functionServices: ['bilanzkreis', 'slp', 'ewk-monitoring'],
  objectKinds: [
    {
      kind: 'balancing.group',
      label: 'Bilanzkreis',
      description: 'Ein Bilanzkreis, bezeichnet über EIC-Code oder Namen',
      detect: detectors.eicCodes,
    },
    {
      kind: 'balancing.profile',
      label: 'Lastprofil',
      description: 'Ein Standardlastprofil oder Messverfahren (SLP, RLM)',
    },
    {
      kind: 'balancing.deviation',
      label: 'Mehr-/Mindermenge',
      description: 'Eine Bilanzabweichung, Mehr- oder Mindermenge, Ausgleichsenergie',
    },
  ],
  expanders: {},
  playbooks: [],
};
