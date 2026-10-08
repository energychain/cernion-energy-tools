'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Workbench = require('../services/workbench.service');
const Router = require('../services/domain-router.service');
const llm = require('../src/llm-client');
const understanding = require('../src/workbench-understanding');
const { resolveRecords } = require('../src/function-activation-records');
const originalEnv = { ...process.env };
const claim = (text, origin = 'input', specific = false) => ({
  text,
  origin,
  specific,
  supported: 'model',
  completedAction: false,
  evidenceIds: [],
});
const situation = {
  concern: 'Überfällige Netzanmeldung',
  situation: 'Lieferant wartet laut Mail auf Rückmeldung.',
  participants: ['Lieferant', 'Netzbetreiber'],
  identifiers: [],
  deadlines: [],
  hypotheses: [{ kind: 'domain', id: 'market_communication', confidence: 0.9 }],
  missingInformation: [],
  requestedAction: {
    description: 'Bearbeitungsstand zur Netzanmeldung klären.',
    externalEffect: false,
    draftRequested: true,
  },
  turnKind: 'work',
  retrievalTerms: ['Netzanmeldung'],
};
afterEach(() => {
  process.env = { ...originalEnv };
  jest.clearAllMocks();
});

test('three turns keep bounded incremental prompts, skip understanding for draft, preserve draft and case on timeout', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-746-turns-'));
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const settings = Object.assign(
    {},
    ...Workbench.mixins.map((m) => m.settings || {}),
    Workbench.settings
  );
  for (const name of Object.keys(settings)) {
    if (name.endsWith('DbPath') || name === 'dbPath') settings[name] = path.join(directory, name);
  }
  broker.createService({ ...Workbench, settings });
  broker.createService({
    ...Router,
    settings: {
      ...Router.settings,
      dbPath: path.join(directory, 'router'),
      eventsDbPath: path.join(directory, 'events'),
    },
  });
  const retrieval = jest.fn(() => ({
    evidence: [],
    trace: [{ source: 'knowledge-rag', status: 'empty', hitCount: 0, ms: 1 }],
  }));
  broker.createService({
    name: 'personal-agent',
    actions: { collectWorkbenchEvidence: retrieval },
  });
  broker.createService({
    name: 'capability-broker',
    actions: {
      recommend: () => ({
        uncertain: true,
        candidateCapabilities: [],
        recommendedCapabilities: [],
      }),
    },
  });
  broker.createService({
    name: 'agent-receipts',
    actions: { select: () => ({ data: { selected: false } }) },
  });
  llm.generateStructured.mockImplementation(async () => structuredClone(situation));
  llm.generateText.mockImplementation(async (prompt) => {
    const turn = JSON.parse(prompt);
    return JSON.stringify({
      expectation: [
        claim(
          turn.message.includes('Was jetzt')
            ? 'Prüfe jetzt den dokumentierten Eingang.'
            : 'Das Gegenüber erwartet den Bearbeitungsstand.'
        ),
      ],
      nextSteps: [],
      draft: [
        claim(
          'Betreff: Netzanmeldung\nGuten Tag,\nbitte teilen Sie uns den dokumentierten Stand der Netzanmeldung mit.\nMit freundlichen Grüßen'
        ),
      ],
    });
  });
  const meta = {
    apiToken: { tenantId: 'anonymous', id: 'colleague', roles: ['ROLE_GRID_OPERATOR'] },
  };
  const document = `FREMDTEXT-ORIGINAL ${'Anonymisierte Lieferantenmail. '.repeat(90)} Netzanmeldung überfällig.`;
  const messages = [];
  const turn = async (message) => {
    messages.push({ role: 'user', content: message });
    const result = await broker.call(
      'workbench.chat',
      { channel: 'open-webui', conversationId: 'three-turns', message, messages },
      { meta: structuredClone(meta) }
    );
    messages.push({ role: 'assistant', content: result.responseText });
    return result;
  };
  try {
    await broker.start();
    const first = await turn(document);
    const second = await turn('Referenz liegt vor. Was jetzt?');
    process.env.WORKBENCH_LLM_TIMEOUT_MS = '30';
    llm.generateText.mockImplementationOnce(() => new Promise(() => {}));
    const third = await turn('Mach mir die Antwort fertig');
    expect(llm.generateStructured).toHaveBeenCalledTimes(2);
    const incremental = JSON.parse(llm.generateStructured.mock.calls[1][1]);
    expect(incremental.messages).toEqual([
      document.slice(0, 1500),
      'Referenz liegt vor. Was jetzt?',
    ]);
    expect(incremental.previous.concern).toBe(situation.concern);
    expect(JSON.stringify(incremental)).not.toContain(document);
    expect(incremental.messages.every((entry) => entry.length <= 1500)).toBe(true);
    expect(second.responseText).toMatch(/^Prüfe jetzt/);
    expect(third.cetCaseId).toBe(first.cetCaseId);
    expect(third.draftId).toBeTruthy();
    expect(third.answerStatus).toBe('fallback');
    expect(third.responseText).toContain('Mit freundlichen Grüßen');
    expect(third.phaseTimes.understandMs).toBeLessThan(5);
    expect(third.phaseTimes.answerMs).toBeGreaterThanOrEqual(25);
    expect(retrieval).toHaveBeenCalledTimes(4);
    expect(third.sources).toEqual([{ name: 'knowledge-rag', status: 'empty', hitCount: 0, ms: 0 }]);
    const outputs = [first, second, third].map((r) => r.responseText).join('\n');
    expect(outputs).not.toMatch(
      /unverbindlich|versendet.{0,40}nichts|keine externe Handlung|Unverbindliche Einschätzung:/i
    );
    // Failed understanding must also keep the available complete draft.
    llm.generateStructured.mockRejectedValueOnce(new Error('provider timeout'));
    const fourth = await turn('Der Eingang wurde bestätigt. Was jetzt?');
    expect(fourth.responseText).toContain('Mit freundlichen Grüßen');
    expect(fourth.cetCaseId).toBe(first.cetCaseId);
  } finally {
    await broker.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('input DAR, MaLo and address stay unmarked; only specific model knowledge is marked', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [
        claim('DAR: DE000000000001', 'input', true),
        claim('MaLo: 99000000001', 'input', true),
      ],
      nextSteps: [
        claim('Adresse: Beispielstraße 1', 'input', true),
        claim('Fachliche Frist: 3 Werktage', 'model', true),
      ],
      draft: [],
    })
  );
  const result = await understanding.answer({ situation, retrieval: { evidence: [] } });
  expect(result.responseText).toContain(
    'DAR: DE000000000001\n\nMaLo: 99000000001\n\nAdresse: Beispielstraße 1'
  );
  expect(result.responseText.match(/bitte gegenprüfen/g)).toHaveLength(1);
  expect(result.responseText).toContain('3 Werktage (bitte gegenprüfen)');
});

test('changed model hash preserves identity, attention and costs for all resolveRecords consumers', () => {
  const record = {
    functionId: 'fn-current',
    modelSourceHash: 'old',
    attention: { tier: 'established' },
    stats: { consumedUnits: 3 },
    lifecycle: 'active',
  };
  const model = {
    sourceHash: 'new',
    functions: [
      { functionId: 'fn-current' },
      {
        functionId: 'fn-other',
        derivation: { lineage: [{ previousId: 'fn-current', relation: 'split' }] },
      },
    ],
  };
  expect(resolveRecords([record], model)).toEqual([{ ...record, modelSourceHash: 'new' }]);
});

test('a pasted supplier mail containing Bearbeitungsstand takes the content path, status commands still work', () => {
  const { classifyWorkbenchIntent } = require('../src/workbench-intent-router');
  expect(
    classifyWorkbenchIntent(
      'Anonymisierte Mail eines Lieferanten: Bitte Bearbeitungsstand mitteilen.'
    )
  ).toBe('decision_support');
  expect(classifyWorkbenchIntent('Bearbeitungsstand Fall F-1?')).toBe('status_query');
});
