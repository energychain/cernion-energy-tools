'use strict';

/**
 * Domain pack „Regulierung" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */
const detectors = require('./detectors');

module.exports = {
  pack: 'regulierung',
  label: 'Regulierung',
  description:
    'Energierecht und Regulierung: EnWG, ARegV, StromNEV, MsbG, EEG, KWKG, Festlegungen der Bundesnetzagentur und ihrer Beschlusskammern, Anreizregulierung, Erlösobergrenze, Melde- und Veröffentlichungspflichten, regulatorische Fristen und Compliance.',
  functionDomains: [
    'regulatorik',
    'regulatory',
    'regulatory-readiness',
    'compliance',
    'cya',
    'gas-capacity-governance',
  ],
  functionServices: [
    'willi-regulatorik',
    'regulatorische-entgeltlogik',
    'cya',
    'governance',
    'gas-capacity-order-revision-gate',
  ],
  objectKinds: [
    {
      kind: 'reg.section',
      label: 'Normverweis',
      description: 'Ein Paragraph eines Gesetzes oder einer Verordnung',
      detect: detectors.sectionReferences,
    },
    {
      kind: 'reg.ruling',
      label: 'Festlegung',
      description: 'Eine Festlegung oder ein Beschluss der Bundesnetzagentur',
      detect: detectors.rulingNumbers,
    },
    {
      kind: 'reg.obligation',
      label: 'Pflicht oder Frist',
      description: 'Eine regulatorische Pflicht, Meldung oder Frist',
    },
  ],
  expanders: {},
  playbooks: [],
};
