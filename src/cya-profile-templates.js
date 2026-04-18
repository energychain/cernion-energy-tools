'use strict';

const PROFILE_TEMPLATES = {
  vnb_defensiv: {
    templateId: 'vnb_defensiv',
    name: 'VNB Defensiv',
    description: 'Verteilnetzbetreiber — CAPEX-Schutz, NOVA-Argumentation, Diskriminierungsabwehr',
    actor: {
      role: 'grid_operator',
      organization: null,
      department: 'Netzplanung / Regulierung',
    },
    strategic_goals: [
      'CAPEX-Schutz (Vermeidung von Kupferausbau)',
      'Abwehr von Diskriminierungsvorwürfen bei Netzanschluss',
      'Verweis auf NOVA-Prinzip und gesetzliche Blockaden (§14a/d EnWG)',
      'Nachweis regulierungskonformer Netzbetriebsführung',
    ],
    tone: 'diplomatisch, rechtssicher, defensiv',
    suggestedAudiences: ['Presse', 'Bürgermeister', 'BNetzA', 'Gemeinderat'],
    suggestedFocusAreas: ['capacity', 'renewables', 'grid_expansion', 'nova', 'compliance'],
  },

  projektierer_offensiv: {
    templateId: 'projektierer_offensiv',
    name: 'Projektierer Offensiv',
    description: 'EE-Projektierer — Diskriminierungsargumentation, Beschleunigung, Marktzugang',
    actor: {
      role: 'project_developer',
      organization: null,
      department: 'Projektentwicklung',
    },
    strategic_goals: [
      'Beschleunigung des Netzanschlussprozesses',
      'Nachweis von Diskriminierung oder Verzögerung durch VNB',
      'Öffentlicher Druck für schnelleren EE-Ausbau',
      'Regulatorische Eskalation bei Fristüberschreitung',
    ],
    tone: 'sachlich, bestimmt, faktenorientiert',
    suggestedAudiences: ['Presse', 'BNetzA', 'Landesregierung', 'Investor'],
    suggestedFocusAreas: ['capacity', 'renewables', 'digitalization', 'compliance'],
  },

  journalist_neutral: {
    templateId: 'journalist_neutral',
    name: 'Journalist Neutral',
    description: 'Medienvertreter — Faktenbasiert, ausgewogen, ohne Parteinahme',
    actor: {
      role: 'journalist',
      organization: null,
      department: 'Redaktion Energie/Umwelt',
    },
    strategic_goals: [
      'Faktentreue und Quellentransparenz',
      'Ausgewogene Darstellung aller Perspektiven',
      'Verständlichkeit für Laien-Leserschaft',
      'Einordnung in überregionalen Kontext',
    ],
    tone: 'neutral, faktenbasiert, verständlich',
    suggestedAudiences: ['Leserschaft', 'Redaktion'],
    suggestedFocusAreas: ['capacity', 'renewables', 'grid_expansion', 'energy_sharing'],
  },

  bnetz_compliant: {
    templateId: 'bnetz_compliant',
    name: 'BNetzA Compliance',
    description: 'Regulierungsbehörde — Strikt regulatorisch, §-Referenzen, Audit-Perspektive',
    actor: {
      role: 'regulator',
      organization: 'Bundesnetzagentur',
      department: 'Beschlusskammer Energie',
    },
    strategic_goals: [
      'Einhaltung aller regulatorischen Vorgaben prüfen',
      'Identifikation von Verstößen oder Lücken',
      'Vergleich mit Bundesmedian und Best-Practice',
      'Handlungsempfehlungen für regulatorische Maßnahmen',
    ],
    tone: 'formal, regulatorisch strikt, §-referenziert',
    suggestedAudiences: ['Beschlusskammer', 'Netzbetreiber', 'Gutachter'],
    suggestedFocusAreas: ['compliance', 'digitalization', 'section14a', 'redispatch'],
  },

  gemeinde_buergermeister: {
    templateId: 'gemeinde_buergermeister',
    name: 'Gemeinde / Bürgermeister',
    description: 'Kommunale Perspektive — Bürgerinteresse, lokale Wertschöpfung, Akzeptanz',
    actor: {
      role: 'municipality',
      organization: null,
      department: 'Bürgermeisterbüro / Bauamt',
    },
    strategic_goals: [
      'Sicherstellung der lokalen Energieversorgung',
      'Förderung lokaler Wertschöpfung durch EE',
      'Bürgerbeteiligung und Akzeptanzförderung',
      'Minimierung von Netzentgelt-Belastungen für Bürger',
    ],
    tone: 'bürgernah, verständlich, lösungsorientiert',
    suggestedAudiences: ['Gemeinderat', 'Bürgerversammlung', 'Lokalpresse'],
    suggestedFocusAreas: ['capacity', 'renewables', 'energy_sharing', 'investment'],
  },

  stadtwerk_vertrieb: {
    templateId: 'stadtwerk_vertrieb',
    name: 'Stadtwerk Vertrieb',
    description: 'Energievertrieb — Kundengewinnung, Marktpositionierung, Cross-Selling',
    actor: {
      role: 'supplier',
      organization: null,
      department: 'Vertrieb / Marketing',
    },
    strategic_goals: [
      'Identifikation von Vertriebschancen (PV, Speicher, Wallbox)',
      'Marktdurchdringung in Kerngebiet erhöhen',
      'Cross-Selling-Potenziale aufzeigen (Strom + EE + Mobilität)',
      'Wettbewerbspositionierung gegenüber Online-Anbietern',
    ],
    tone: 'kundenorientiert, überzeugend, lösungsorientiert',
    suggestedAudiences: ['Vertriebsleitung', 'Marketing', 'Geschäftsführung'],
    suggestedFocusAreas: ['customer', 'renewables', 'capacity', 'energy_sharing'],
  },
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getTemplate(templateId) {
  const template = PROFILE_TEMPLATES[templateId];
  return template ? deepClone(template) : null;
}

function listTemplates() {
  return Object.keys(PROFILE_TEMPLATES);
}

module.exports = {
  PROFILE_TEMPLATES,
  getTemplate,
  listTemplates,
};
