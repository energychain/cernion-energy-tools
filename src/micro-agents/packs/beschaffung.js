'use strict';

/**
 * Domain pack „Energiebeschaffung und Portfolio" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */

module.exports = {
  pack: 'beschaffung',
  label: 'Energiebeschaffung und Portfolio',
  description:
    'Strom- und Gasbeschaffung, Großhandelspreise (Spot, Termin), Beschaffungsstrategie, offene Position, Hedging, Mengen- und Lastprognosen, Residuallast, Erzeugungsdaten, Gasspeicher und Portfolio-Bewertung.',
  functionDomains: ['forecast', 'energy-routing', 'gas', 'gas-strategy'],
  functionServices: [
    'energy-market',
    'entsoe',
    'forecast',
    'forecast-engine',
    'forecast-sandbox',
    'residual-load',
    'fnav-commercial-hedging',
    'gas-storage',
    'nbp-monitor',
  ],
  objectKinds: [
    {
      kind: 'market.price',
      label: 'Marktpreis',
      description: 'Ein Börsen- oder Großhandelspreis mit Produkt und Zeitraum',
    },
    {
      kind: 'portfolio.position',
      label: 'Portfolio-Position',
      description: 'Eine Beschaffungs- oder Absatzposition, offene Menge, Hedge',
    },
    {
      kind: 'forecast.series',
      label: 'Prognose',
      description: 'Eine Last-, Mengen- oder Erzeugungsprognose',
    },
  ],
  expanders: {},
  playbooks: [],
};
