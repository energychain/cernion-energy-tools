'use strict';

/**
 * Domain pack „Vertrieb, Marketing und Kunde" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */

module.exports = {
  pack: 'vertrieb',
  label: 'Vertrieb, Marketing und Kunde',
  description:
    'Vertrieb und Marketing eines Stadtwerks: Tarife und Produkte, Preisanpassungen und Kundenkommunikation, Kundensegmente, Kundenservice, Energiegemeinschaften und Energy Sharing, Kampagnen und Marktanalysen.',
  functionDomains: ['energy-sharing', 'inhouse'],
  functionServices: [
    'customer-service',
    'community',
    'energy-sharing',
    'energy-sharing-allocation',
    'energy-sharing-community',
    'business-intelligence',
    'utility-report',
    'presentation',
  ],
  objectKinds: [
    {
      kind: 'customer.segment',
      label: 'Kundensegment',
      description: 'Eine Kundengruppe oder ein Segment',
    },
    {
      kind: 'customer.product',
      label: 'Tarif oder Produkt',
      description: 'Ein Tarif, Produkt oder Angebot für Kunden',
    },
  ],
  expanders: {},
  playbooks: [],
};
