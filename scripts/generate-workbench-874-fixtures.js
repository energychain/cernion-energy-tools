'use strict';

// Reuse the reviewed, synthetic practice catalog. No source scenario is imported.
function generateCommunicationScenarios(base, { anchor, actors }) {
  const existing = (id) => base.find((item) => item.id === id).turns;
  const auth = existing('mako-authorization');
  const old = existing('mako-old-supplier');
  const gov = existing('governance');
  const rlm = existing('mako-rlm');
  const step = (id, message, description, rules = {}, extra = {}) => ({
    id,
    actor: 'a',
    chat: 'main',
    message,
    expect: { description, rules, dependencies: ['874'] },
    ...extra,
  });
  const copy = (turn) => {
    const result = structuredClone(turn);
    delete result.expect.rules.sameCase;
    delete result.expect.rules.casePresent;
    return result;
  };
  const glossary = [
    step(
      'definition',
      'SYN-A ist bei uns System A. Halte den Begriff fest.',
      'Tenant-Glossar festhalten',
      { require: ['Hab ich festgehalten', 'SYN-A', 'System A'] }
    ),
    step(
      'order',
      'Schreibe einen internen Arbeitsauftrag für SYN-A. Nummerierte Schritte, mindestens drei: Prüfung des Vertragsstands, Objekte und Reihenfolge; keine Mail.',
      'Glossar nutzen; System als Gegenstand',
      { numberedSteps: 3, internalArtifact: true, require: ['SYN-A'] },
      { chat: 'fresh' }
    ),
  ];
  const linked = [
    copy(gov[2]),
    copy(gov[3]),
    step(
      'proposal',
      `Schlage einen verbundenen Vorgang für den Regulatorikimpuls zu ${anchor} vor: Titel, Typ, Bezug, Owner-Rolle, Frist, Wiedervorlage und nächste Befassung. Noch nicht anlegen.`,
      'Vorschlag vollständig, noch keine Anlage',
      {
        sections: ['Titel', 'Typ', 'Bezug', 'Owner', 'Frist', 'Wiedervorlage', 'nächste Befassung'],
        forbid: ['habe.*angelegt'],
      }
    ),
    step('confirm', 'Leg an', 'Anlage nur nach ausdrücklicher Bestätigung', {
      require: ['angelegt', 'Owner', 'Frist', 'Befassung', 'Wiedervorlage'],
    }),
    step(
      'find',
      `Was wissen wir zum Regulatorikimpuls zu ${anchor}? Nenne Owner, Frist, nächste Befassung und Wiedervorlage.`,
      'Verbundener Vorgang im neuen Chat mit Arbeitsfeldern sichtbar',
      { require: ['Owner', 'Frist', 'Befassung', 'Wiedervorlage'] },
      { chat: 'fresh' }
    ),
  ];
  const sequences = [
    [copy(auth[1])],
    [copy(auth[3])],
    glossary,
    [copy(old[0]), copy(old[2])],
    gov.slice(0, 9).map(copy),
    gov.slice(0, 2).map(copy),
    linked,
    [copy(gov[5])],
    [copy(rlm[1])],
  ];
  return sequences.map((turns, index) => ({
    id: `communication-${index + 1}`,
    group: '874',
    title: `Kommunikation ${index + 1}`,
    version: '1.0',
    actors,
    anchor,
    turns,
  }));
}

function generateCommunicationFixture(seed = 'unit874') {
  const { generatePracticeCatalog } = require('./generate-practice-evaluation-fixtures');
  const catalog = generatePracticeCatalog({ seed });
  const scenarios = catalog.scenarios.filter((item) => item.group === '874');
  const result = {
    scenarios,
    tenantId: `synthetic-${seed}`,
    actorId: `synthetic-author-${seed}`,
    codeSourceFixture: {
      code: { value: 'Q42', family: 'Prüfcode' },
      source: {
        title: 'Synthetische Quelle',
        sectionId: 'Abschnitt A',
        excerpt: 'Prüfcode Q42: synthetischer Prüfstatus.',
      },
      differentCode: 'Q420: Prüfcode',
      differentFamily: 'Andere Familie Q42',
    },
    term: 'SYN-A',
    compoundReference: '12345.67890 und ref12345@example.invalid',
    unknownTerm: 'SYN-B',
    unknownMessage: 'Schreibe einen internen Arbeitsauftrag für SYN-B. Der Begriff ist mehrdeutig.',
    meaning: 'System A',
    situation: (message, extra = {}) => ({
      concern: 'Prüfauftrag',
      situation: message,
      participants: [],
      identifiers: [],
      deadlines: [],
      hypotheses: [],
      missingInformation: [],
      retrievalTerms: [],
      turnKind: 'knowledge',
      conversationShape: 'knowledge',
      requestedAction: { description: '', externalEffect: false, draftRequested: false },
      ...extra,
    }),
    glossary: { term: 'SYN-A', meaning: 'System A', kind: 'system' },
    proposal: {
      requested: true,
      basis: 'Eigenständiges Thema',
      title: 'Prüfimpuls',
      type: 'Prüfung',
      reference: 'Prüfauftrag',
      ownerRole: 'Prüfrolle',
      deadline: 'zur Abstimmung',
      nextConsideration: 'Unterlagen einordnen',
      reminder: 'zur Abstimmung',
    },
    claim: (text, evidenceIds = []) => ({
      text,
      origin: evidenceIds.length ? 'evidence' : 'input',
      supported: evidenceIds.length ? 'evidence' : 'model',
      completedAction: false,
      specific: false,
      evidenceIds,
    }),
  };
  result.glossaryAssertion = {
    text: `${result.term} ist bei uns ${result.meaning}`,
    basis: scenarios[2].turns[0].message,
    commitment: 'assessment',
    anchors: [{ value: result.term, qualifier: '', aliases: [result.meaning] }],
    time: { from: '', until: '', latest: '', earliest: '', date: '' },
    expiresAt: '',
    scope: 'organization',
    glossary: result.glossary,
  };
  result.queryCaseMemory = {
    topic: result.proposal.title,
    situation: result.proposal.reference,
    openQuestions: [],
    workingAssumptions: [],
    risks: [],
    nextSteps: [],
    caseWork: Object.fromEntries(
      ['ownerRole', 'deadline', 'nextConsideration', 'reminder'].map((key) => [
        key,
        result.proposal[key],
      ])
    ),
  };
  result.statusQueryMessage = catalog.scenarios
    .find((item) => item.id === 'governance')
    .turns.at(-1).message;
  const correction = scenarios[4].turns.find((turn) => turn.id === 'correction');
  result.statusActorId = `${result.actorId}-${require('node:crypto').randomUUID()}`;
  result.statusRecallMemory = {
    ...result.queryCaseMemory,
    caseWork: {},
    lastSafeConclusion: result.proposal.nextConsideration,
    conversationPreferences: {
      basis: correction.message,
      register: 'unchanged',
      concise: 'unchanged',
      questions: 'usual',
      wording: [],
      forbiddenTerms: correction.expect.rules.forbid,
    },
  };
  result.matrix = {
    message: correction.message,
    columns: correction.expect.rules.tableColumns,
    cells: [
      result.term,
      result.proposal.reference,
      result.proposal.type,
      result.proposal.reference,
      result.proposal.ownerRole,
      result.proposal.deadline,
      result.proposal.nextConsideration,
    ],
  };
  const caseMessage = scenarios[4].turns.find((turn) => turn.id === 'case').message;
  const { glossary: _definition, ...assertion } = result.glossaryAssertion;
  result.caseAssertion = {
    ...assertion,
    text: caseMessage,
    basis: caseMessage,
    anchors: [{ value: caseMessage.split(':')[0], qualifier: '', aliases: [] }],
  };
  result.outputContract = (message, requested = 'ordinary_answer', parts = []) => ({
    requestedOutput: {
      requested,
      basis: requested === 'explicit_artifact' ? message : '',
      kind: 'other',
      parts,
      subjects: [],
      constraints: [],
      forbiddenTerms: [],
    },
  });
  result.unsupportedObservation = 'Die Rolle verfolgt eigene Ziele.';
  const pattern = catalog.scenarios
    .find((item) => item.id === 'mako-authorization')
    .turns.find((item) => item.id === 'pattern');
  result.literalSections = {
    message: pattern.message,
    sections: pattern.expect.rules.sections,
    altered: pattern.expect.rules.sections.map((heading) =>
      heading.normalize('NFKD').replace(/\p{M}/gu, '')
    ),
  };

  result.reportedFact = scenarios[0].turns[0].message.split('. ')[0] + '.';
  result.directQuestion = catalog.scenarios.find(
    (item) => item.id === 'mako-authorization'
  ).turns[2].message;
  const shared = catalog.scenarios.find((item) => item.id === 'memory');
  result.sharedContext = {
    message: shared.turns[0].message,
    assertion: {
      ...result.caseAssertion,
      text: shared.turns[0].message,
      basis: shared.turns[0].message,
      commitment: 'planned',
      scope: 'organization',
      anchors: [{ value: shared.anchor, qualifier: '', aliases: [] }],
      time: {
        from: '',
        until: /\b\d{4}\b/u.exec(shared.turns[0].message)[0],
        latest: '',
        earliest: '',
        date: '',
      },
    },
  };
  result.codeSourceFixture.compoundCodes = ['Q42_OTHER', 'Q42-1', 'Q42.1'];
  return result;
}

function generateEmbeddingDriftFixture(count = 25) {
  const capabilities = require('../src/capability-catalog').CURATED_CAPABILITIES;
  const operations = require('../operation-capability-index.json').operations;
  const semanticDomains = require('../src/semantic-domains').semanticDomains;
  const parameters = require('../function-model.parameters.json');
  const cache = structuredClone(require('../function-model.embeddings.json'));
  for (const id of Object.keys(cache.entries)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, count))
    cache.entries[id].textHash = require('node:crypto')
      .createHash('sha256')
      .update(`synthetic-stale-${id}`)
      .digest('hex');
  const resolved = require('./function-model-embeddings').resolveEmbeddings(
    capabilities,
    operations,
    semanticDomains,
    cache,
    parameters
  );
  const model = require('./function-model-projection').projectFunctionModel({
    capabilities,
    operations,
    semanticDomains,
    parameters,
    embeddingCache: cache,
    previousModel: require('../function-model.json'),
    sourceHash: 'synthetic-cache-drift',
  });
  for (const fn of model.functions)
    fn.displayLabel = require('../src/function-display-label').functionDisplayLabel(fn);
  return { cache, resolved, model };
}

module.exports = {
  generateCommunicationScenarios,
  generateCommunicationFixture,
  generateEmbeddingDriftFixture,
};
