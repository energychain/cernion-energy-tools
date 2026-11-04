const CASE_TYPE_ROUTING_SCHEMA_VERSION = 'cernion.caseTypeRouting.v1';

const CASE_TYPES = [
  {
    id: 'stammdaten_marktrollen_klaerfall',
    title: 'Stammdaten-/Marktrollen-Klärfall',
    maturity: 'observed',
    priority: 1,
    searchTerms: [
      'stammdaten',
      'malo',
      'melo',
      'zählpunkt',
      'zaehlpunkt',
      'netzbetreiber',
      'vnb',
      'lieferant',
      'messstellenbetreiber',
      'msb',
      'bilanzkreis',
      'marktrolle',
      'adresse',
      'anschlussobjekt',
    ],
    signals: [
      'MaLo, MeLo, Zählpunkt, Adresse oder Kundendaten passen nicht zusammen',
      'Netzbetreiber, Lieferant, Messstellenbetreiber oder Bilanzkreis sind unklar',
      'Stammdaten aus verschiedenen Quellen widersprechen sich',
      'Ein Prozess scheitert, obwohl die fachliche Absicht erkennbar ist',
    ],
    clarificationQuestions: [
      'Welche MaLo, MeLo, Zählpunkt-ID oder Adresse ist betroffen?',
      'Welche Marktrolle oder welches führende System liefert den widersprüchlichen Datenstand?',
      'Welche Aussage soll nur intern eingeordnet und welche extern verbindlich werden?',
    ],
    evidenceRequirements: [
      'Quellenstand je Stammdatenaussage',
      'führendes System oder Marktpartnerantwort für finale Korrekturen',
      'HITL vor externer Marktkommunikation oder produktiver Stammdatenänderung',
    ],
    nextBestActions: [
      'energiewirtschaftliche Entitäten extrahieren',
      'Widersprüche zwischen Quellen markieren',
      'wahrscheinlichsten Klärpfad und Rückfrage vorbereiten',
    ],
    allowedAssistance: [
      'interne Einordnung',
      'Klärfallstrukturierung',
      'Hypothesenbildung',
      'Rückfrageentwurf',
    ],
  },
  {
    id: 'messwert_edm_plausibilitaetsfall',
    title: 'Messwert-/EDM-Plausibilitätsfall',
    maturity: 'observed',
    priority: 2,
    searchTerms: [
      'messwert',
      'zählerstand',
      'zaehlerstand',
      'meter',
      'metering',
      'edm',
      'lastgang',
      'verbrauch',
      'erzeugung',
      'zeitreihe',
      'ersatzwert',
      'istwert',
      'prognosewert',
      'plausibel',
      'plausibilisierung',
      'auffällig',
      'auffaellig',
      'ausreißer',
      'ausreisser',
      'datenlücke',
      'datenluecke',
      'anomaly',
      'forecast',
    ],
    signals: [
      'Verbrauch oder Erzeugung wirkt unplausibel',
      'Lastgang enthält Lücken, Ausreißer oder Sprünge',
      'Werte passen nicht zu Zeitraum, Wetter, Anlage, Vertrag oder Historie',
      'Messwerte fehlen oder sind verspätet',
    ],
    clarificationQuestions: [
      'Welches Messobjekt und welcher Zeitraum sind betroffen?',
      'Handelt es sich um Ist-Wert, Ersatzwert, Prognosewert oder eine vermischte Datenlage?',
      'Welche Handlung wäre extern oder abrechnungsrelevant?',
    ],
    evidenceRequirements: [
      'Messobjekt, Zeitraum und Wertstatus',
      'Vergleichszeitraum oder Referenzwert für Plausibilisierung',
      'HITL vor abrechnungsrelevanter Korrektur oder externer Reklamation',
    ],
    nextBestActions: [
      'Messobjekt und Zeitraum eindeutig bestimmen',
      'Auffälligkeit markieren, ohne Ursache final zu behaupten',
      'historischen Vergleich oder Rückfrage zum Messwertstatus vorbereiten',
    ],
    allowedAssistance: [
      'Auffälligkeit markieren',
      'Hypothesen formulieren',
      'Zeitraum eingrenzen',
      'Rückfrage formulieren',
    ],
  },
  {
    id: 'kunden_service_klaerfall',
    title: 'Kunden-/Service-Klärfall',
    maturity: 'routable',
    priority: 3,
    searchTerms: [
      'kunde',
      'kundin',
      'customer',
      'service',
      'anfrage',
      'ticket',
      'support',
      'vertrag',
      'rechnung',
      'abrechnung',
      'anschluss',
      'tarif',
      'störung',
      'stoerung',
      'wallbox',
      'pv',
      'speicher',
      'rückfrage',
      'rueckfrage',

      'vertragskonto',
      'kundennummer',
      'abschlag',
      'lieferstelle',
      'kundenservice',
      'zählerstand',
      'zaehlerstand',
      'rechnung hoch',
      'falscher zählerstand',
    ],
    signals: [
      'Kunde beschreibt Problem ohne klare Prozesszuordnung',
      'Anfrage betrifft mehrere Bereiche wie Vertrag, Netz, Messung, Abrechnung, Prognose oder Anlage',
      'wichtige Identifikatoren fehlen',
      'Zuständigkeit zwischen Marktrollen oder interner Sachbearbeitung ist unklar',
    ],
    clarificationQuestions: [
      'Welches Anliegen soll für den Menschen fachlich zusammengefasst werden?',
      'Welche Identifikatoren fehlen: Vertragskonto, Zählpunkt, Zeitraum oder Adresse?',
      'Ist eine externe Antwort geplant oder nur eine interne Klärnotiz?',
    ],
    evidenceRequirements: [
      'betroffener Kunde, Zeitraum und Anschluss-/Vertragsbezug',
      'Datenbasis für verbindliche Kundenantworten',
      'HITL vor externer Kommunikation oder Zusagen zu Vertrag, Preis, Frist oder Netzanschluss',
    ],
    nextBestActions: [
      'Anliegen fachlich zusammenfassen',
      'mögliche Unterfalltypen und Zuständigkeiten benennen',
      'Antwortentwurf oder interne Klärnotiz mit Unsicherheiten vorbereiten',
    ],
    allowedAssistance: [
      'Anliegen strukturieren',
      'mögliche Zuständigkeiten benennen',
      'fehlende Angaben anfordern',
      'Antwortentwurf vorbereiten',
    ],
  },
  {
    id: 'netzanschluss_kapazitaets_klaerfall',
    title: 'Netzanschluss-/Kapazitäts-Klärfall',
    maturity: 'observed',
    priority: 4,
    searchTerms: [
      'netzanschluss',
      'anschlussleistung',
      'kapazität',
      'kapazitaet',
      'einspeisung',
      'anschlusspunkt',
      'netzebene',
      'trafo',
      'nvp',
      'netzverknüpfungspunkt',
    ],
    signals: [
      'Welches Anschlussobjekt, welche Leistung und welcher Netzverknüpfungspunkt sind betroffen?',
      'Geht es um erste Einschätzung, Prüfauftrag oder externe Zusage?',
      'Welche Netzebene und welcher Zeitraum sind relevant?',
    ],
    clarificationQuestions: [
      'Welches Anschlussobjekt, welche Leistung und welcher Netzverknüpfungspunkt sind betroffen?',
      'Geht es um erste Einschätzung, Prüfauftrag oder externe Zusage?',
      'Welche Netzebene und welcher Zeitraum sind relevant?',
    ],
    evidenceRequirements: [
      'Anschlussobjekt, Leistung, Netzgebiet und Netzebene',
      'Netzbetreiber-/Planungsrückmeldung für verbindliche Zusagen',
      'HITL vor externer Machbarkeits- oder Anschlusszusage',
    ],
    nextBestActions: [
      'Anschlussobjekt und Leistungsbedarf strukturieren',
      'offene technische und planerische Klärpunkte benennen',
      'Readiness und nächsten Prüfauftrag vorbereiten',
    ],
    allowedAssistance: [
      'interne Einschätzung',
      'Klärpunktliste',
      'Rückfrageentwurf',
      'Readiness-Strukturierung',
    ],
  },
  {
    id: 'prognose_abweichungsfall',
    title: 'Prognose-/Abweichungsfall',
    maturity: 'observed',
    priority: 5,
    searchTerms: [
      'prognose',
      'forecast',
      'abweichung',
      'delta',
      'fahrplan',
      'lastprognose',
      'windprognose',
      'solarprognose',
      'day-ahead',
      'portfolio',
    ],
    signals: [
      'Welche Prognose, welcher Ist-Wert und welches Zeitfenster sind betroffen?',
      'Welche Abweichung ist fachlich oder wirtschaftlich handlungsrelevant?',
      'Geht es um Beobachtung, Korrektur oder Eskalation?',
    ],
    clarificationQuestions: [
      'Welche Prognose, welcher Ist-Wert und welches Zeitfenster sind betroffen?',
      'Welche Abweichung ist fachlich oder wirtschaftlich handlungsrelevant?',
      'Geht es um Beobachtung, Korrektur oder Eskalation?',
    ],
    evidenceRequirements: [
      'Prognoseobjekt, Ist-Wert, Zeitfenster und Referenz',
      'Kontextfaktoren für Ursachenhypothesen',
      'HITL vor markt- oder abrechnungsrelevanter Korrektur',
    ],
    nextBestActions: [
      'Abweichung und Zeitraum eingrenzen',
      'plausible Ursachen und Einflussfaktoren strukturieren',
      'Beobachten, Rückfragen, Korrigieren oder Eskalieren empfehlen',
    ],
    allowedAssistance: [
      'Abweichung einordnen',
      'Hypothesen bilden',
      'Sensitivitäten benennen',
      'Klärpfad vorbereiten',
    ],
  },
  {
    id: 'redispatch_steuerbarkeits_readiness',
    title: 'Redispatch-/Steuerbarkeits-Readiness',
    maturity: 'observed',
    priority: 6,
    searchTerms: [
      'redispatch',
      'steuerbarkeit',
      'steuerbar',
      'flex',
      'flexibilität',
      'anlage',
      'einspeisemanagement',
      'curtailment',
      'readiness',
      'fernschaltung',
    ],
    signals: [
      'Welche Anlage, Marktrolle und technische Steuerkette sind betroffen?',
      'Welche Nachweise zur Steuerbarkeit oder Kommunikation liegen vor?',
      'Geht es um Readiness, Befassung oder verbindliche Freigabe?',
    ],
    clarificationQuestions: [
      'Welche Anlage, Marktrolle und technische Steuerkette sind betroffen?',
      'Welche Nachweise zur Steuerbarkeit oder Kommunikation liegen vor?',
      'Geht es um Readiness, Befassung oder verbindliche Freigabe?',
    ],
    evidenceRequirements: [
      'Anlagenidentität, Betreiber, technische Steuerbarkeit und Kommunikationsweg',
      'Nachweise für prozessuale/vertragliche Voraussetzungen',
      'HITL vor Freigabe, externer Meldung oder produktiver Steuerhandlung',
    ],
    nextBestActions: [
      'Readiness als Arbeitszustand einordnen',
      'fehlende Voraussetzungen und Klärpunkte benennen',
      'nächste Befassung oder Prüfauftrag vorbereiten',
    ],
    allowedAssistance: [
      'Readiness-Strukturierung',
      'Klärpunktliste',
      'Nachweisbedarf benennen',
      'Befassung vorbereiten',
    ],
  },
  {
    id: 'waerme_gas_eog_szenariofall',
    title: 'Wärme-/Gas-/EOG-Szenariofall',
    maturity: 'observed',
    priority: 7,
    searchTerms: [
      'wärme',
      'waerme',
      'gas',
      'eog',
      'geg',
      'kommunale wärmeplanung',
      'waermeplanung',
      'transformationspfad',
      'szenario',
      'heizgebiet',
    ],
    signals: [
      'Welches Gebiet, welche Infrastruktur und welcher Betrachtungszeitraum sind betroffen?',
      'Welche Annahmen sind gesetzt und welche Klärpunkte offen?',
      'Geht es um Befassung, Szenariovergleich oder Beschlussvorbereitung?',
    ],
    clarificationQuestions: [
      'Welches Gebiet, welche Infrastruktur und welcher Betrachtungszeitraum sind betroffen?',
      'Welche Annahmen sind gesetzt und welche Klärpunkte offen?',
      'Geht es um Befassung, Szenariovergleich oder Beschlussvorbereitung?',
    ],
    evidenceRequirements: [
      'Gebiet, Annahmen, Infrastrukturstand und Szenariogrenzen',
      'Quellen für Kosten-/Risiko-/Zeitdimensionen',
      'HITL vor Beschluss-, Freigabe- oder Stilllegungswirkung',
    ],
    nextBestActions: [
      'Szenarioannahmen transparent machen',
      'Klärpunkte und Befassungsstand trennen',
      'nächste Befassung oder Workshop-Unterlage vorbereiten',
    ],
    allowedAssistance: [
      'Szenarien strukturieren',
      'Annahmen offenlegen',
      'Befassung vorbereiten',
      'Klärpunkte priorisieren',
    ],
  },
];

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function termHitCount(text, terms = []) {
  return terms.reduce((count, term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm && text.includes(normalizedTerm) ? count + 1 : count;
  }, 0);
}

function matchedSignals(text, caseType) {
  return caseType.signals.filter((signal) => {
    const signalTerms = normalizeText(signal)
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 5);
    return signalTerms.some((term) => text.includes(term));
  });
}

function classifyCaseTypes(taskText = '', knownContext = {}) {
  const contextText = Object.entries(knownContext || {})
    .map(([key, value]) => `${key} ${typeof value === 'string' ? value : ''}`)
    .join(' ');
  const haystack = normalizeText(`${taskText} ${contextText}`);

  const candidates = CASE_TYPES.map((caseType) => {
    const hits = termHitCount(haystack, caseType.searchTerms);
    const signals = matchedSignals(haystack, caseType);
    const rawScore = hits + signals.length * 2;
    return {
      id: caseType.id,
      title: caseType.title,
      maturity: caseType.maturity,
      priority: caseType.priority,
      confidence: Number(Math.min(0.94, 0.42 + rawScore * 0.08).toFixed(2)),
      rawScore,
      matchedSignals: signals,
      clarificationQuestions: caseType.clarificationQuestions,
      evidenceRequirements: caseType.evidenceRequirements,
      nextBestActions: caseType.nextBestActions,
      allowedAssistance: caseType.allowedAssistance,
    };
  })
    .filter((candidate) => candidate.rawScore > 0)
    .sort((a, b) => b.rawScore - a.rawScore || a.priority - b.priority);

  return {
    schemaVersion: CASE_TYPE_ROUTING_SCHEMA_VERSION,
    primary: candidates[0] || null,
    candidates,
    routingContract:
      'Usertext -> case_type_candidates[] -> clarification_questions[] -> evidence_requirements[] -> next_best_actions[] -> allowed_tools[]',
    assistancePrinciple:
      'Fehlende Evidenz blockiert finale Behauptungen, externe Wirkung und produktive Änderungen; sie blockiert nicht Fallstrukturierung, Hypothesenbildung, Plausibilisierung, Rückfragen oder Next Best Actions.',
  };
}

module.exports = {
  CASE_TYPE_ROUTING_SCHEMA_VERSION,
  CASE_TYPES,
  classifyCaseTypes,
};
