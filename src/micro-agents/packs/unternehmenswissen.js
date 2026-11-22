'use strict';

/**
 * Domain pack „Unternehmenswissen" (micro-agent tier). Phase 0: description, link to the function
 * model and the object kinds with their format detectors. Expanders and playbooks follow in
 * Phase 1 and 2; until then the pack is recognized and selected but contributes no findings.
 */

module.exports = {
  pack: 'wissen',
  label: 'Unternehmenswissen',
  description:
    'Freigegebenes Wissen des eigenen Unternehmens: Prozessbeschreibungen, Zuständigkeiten und Rollen, Protokolle und Beschlüsse, frühere Fälle, interne Regeln und Glossar.',
  functionDomains: [
    'governance',
    'governance-management',
    'governance-decision-closure',
    'process-governance',
    'coordination-governance',
    'data-governance',
    'datasource-governance',
    'ki-governance',
    'audit-governance',
    'answer-evidence',
    'hitl',
  ],
  functionServices: [
    'knowledge-gateway',
    'knowledge-rag',
    'company',
    'governance-cards',
    'tenant-memory-policy',
  ],
  objectKinds: [
    {
      kind: 'org.role',
      label: 'Rolle oder Zuständigkeit',
      description: 'Eine Funktion, Abteilung, Rolle oder ein Gremium des Unternehmens',
    },
    {
      kind: 'org.document',
      label: 'Unterlage',
      description: 'Eine interne Unterlage, Richtlinie, ein Protokoll oder Beschluss',
    },
  ],
  expanders: {},
  playbooks: [],
};
