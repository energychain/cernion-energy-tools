'use strict';

/**
 * Domain pack „Marktkommunikation und EDM" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */
const detectors = require('./detectors');

module.exports = {
  pack: 'mako',
  label: 'Marktkommunikation und EDM',
  description:
    'Marktkommunikation zwischen Marktrollen (Lieferant, Netzbetreiber, Messstellenbetreiber, Bilanzkreisverantwortlicher): EDIFACT-Nachrichten wie UTILMD, MSCONS, APERAK, CONTRL, INVOIC, ORDERS, PRICAT; Prozesse der GPKE, WiM, MaBiS und GeLi Gas; Prüfidentifikatoren, Antwort- und Fehlercodes, Fristen der Prozesse, Marktlokation, Messlokation, Zählpunkt, Stammdaten und Energiedatenmanagement.',
  functionDomains: [
    'market-communication',
    'market-operations',
    'edm',
    'edm-customer-service',
    'edm-monitoring',
    'stammdaten',
    'imsys-cls-value-chain',
    'metering-governance',
    'metering-data-governance',
  ],
  functionServices: [
    'edm',
    'edm-validation',
    'edm-messkonzept',
    'edm-virtual',
    'mscons-import',
    'eic-codes',
    'willi-mako',
    'willi-federated',
    'connection-rejection-evidence',
    'mqtt-edm-ingest',
  ],
  objectKinds: [
    {
      kind: 'edifact.message',
      label: 'EDIFACT-Nachricht',
      description:
        'Eine EDIFACT-Nachricht (UTILMD, MSCONS, APERAK, CONTRL, INVOIC …) mit ihren Segmenten',
      detect: detectors.edifactMessages,
    },
    {
      kind: 'market.partner_code',
      label: 'Marktpartner-Codenummer',
      description: 'BDEW- oder DVGW-Codenummer eines Marktpartners (13 Ziffern)',
      detect: detectors.marketPartnerCodes,
    },
    {
      kind: 'mako.location_id',
      label: 'Markt- oder Messlokation',
      description: 'Marktlokations-ID, Messlokations-ID oder Zählpunktbezeichnung',
    },
    {
      kind: 'mako.process',
      label: 'Marktprozess',
      description:
        'Ein benannter Marktprozess oder Prozessschritt, etwa Lieferbeginn, Lieferende, Stammdatenänderung, Messwertübermittlung',
    },
    {
      kind: 'mako.response_code',
      label: 'Antwort- oder Fehlercode',
      description: 'Ein Antwort-, Prüf- oder Fehlercode einer Marktnachricht',
    },
  ],
  expanders: {},
  playbooks: [],
};
