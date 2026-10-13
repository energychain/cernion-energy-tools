'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const llm = require('../src/llm-client');
const {
  summarizeResult,
  resolveCapabilityNeed,
  toolReport,
} = require('../src/workbench-capability-loop');
const { answer } = require('../src/workbench-understanding');
const { llmErrorDetails, quotaMessage } = require('../src/workbench-llm-errors');
const { quotaQuery } = require('../src/workbench-quota');
const situation = {
  concern: 'Prüfe den eskalierten Lieferanten-Thread',
  situation: 'Neun Nachrichten mit ausstehender fachlicher Antwort',
  hypotheses: [],
  participants: [],
  identifiers: [],
  deadlines: [],
  retrievalTerms: [],
  missingInformation: [],
  requestedAction: { description: 'Analysieren', externalEffect: false, draftRequested: false },
  turnKind: 'work',
  conversationShape: 'task',
  outputKind: 'analysis',
  dataNeeds: '',
};
const claim = (text) => ({
  text,
  origin: 'input',
  supported: 'model',
  evidenceIds: [],
  completedAction: false,
  specific: false,
});

beforeEach(() => jest.clearAllMocks());

test('identifier extrema and sums are forbidden while measurement extrema remain available', () => {
  const rows = [
    {
      identity: 50800000001,
      MaLo: 50800000001,
      referenceNumber: 200,
      Referenz: 200,
      Referenznummer: 200,
      capacityKW: 6,
    },
    {
      identity: 50800000002,
      MaLo: 50800000002,
      referenceNumber: 300,
      Referenz: 300,
      Referenznummer: 300,
      capacityKW: 11,
    },
  ];
  expect(summarizeResult(rows, null, 'synthetic', []).statistics.map((item) => item.field)).toEqual(
    ['capacityKW']
  );
  for (const field of ['identity', 'MaLo', 'referenceNumber', 'Referenz', 'Referenznummer'])
    for (const fn of ['sum', 'min', 'max', 'avg'])
      expect(() =>
        summarizeResult(
          rows,
          {
            operations: [{ op: 'aggregate', groupBy: [], metrics: [{ fn, field, as: 'result' }] }],
          },
          'synthetic',
          []
        )
      ).toThrow('Kennungen');
});

test('correspondence never triggers tools from candidate datasets without an explicit data need', () => {
  const result = resolveCapabilityNeed(
    { ...situation, outputKind: 'correspondence' },
    'Welche Antwort empfiehlst du?',
    { datasetCandidates: [{ id: 'synthetic' }] }
  );
  expect(result.candidates).toEqual([]);
  expect(result.reason).toBe('no_data_need');
});

test('unrequested tool evidence is omitted while the full thread analysis remains intact', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      interpretation: [claim('Die fachliche Antwort steht nach neun Nachrichten weiterhin aus.')],
      nextSteps: [claim('Bitte das Gegenüber um eine belegte Prozessantwort.')],
      assumptions: [],
      draft: [],
    })
  );
  const result = await answer({
    situation,
    message: 'Analysiere den Thread und nenne den nächsten Schritt.',
    tenantId: 'synthetic',
    retrieval: {
      evidence: [
        {
          source: 'synthetic.read',
          retrievalSource: 'capability-read',
          value: JSON.stringify([{ identity: 50800000001 }]),
          metadata: {
            rowCount: 1,
            statistics: [
              { field: 'identity', max: 50800000001, min: 50800000001, maxRow: {}, minRow: {} },
            ],
          },
        },
      ],
    },
  });
  expect(result.responseText).toContain('fachliche Antwort');
  expect(result.responseText).toContain('Prozessantwort');
  expect(result.responseText).not.toContain('50.800.000.001');
  expect(result.responseText).not.toContain('Die vorhandene Abfrage');
  expect(llm.generateText.mock.calls[0][0]).not.toContain('50800000001');
});

test('untranslated source summaries and duplicate provenance are not rendered', () => {
  const hit = {
    source: 'synthetic.read',
    retrievalSource: 'capability-read',
    metadata: {
      sourceId: 'one',
      sourceLabel: 'Market communication evidence chain — read-only dossier-safe status',
    },
  };
  const entry = {
    name: 'synthetic.read',
    status: 'available',
    called: true,
    sourceId: 'one',
    at: '2026-10-11T10:00:00Z',
  };
  const result = toolReport([entry, entry], [hit]);
  expect(result).toContain('Herkunft: Abgefragte Datenquelle');
  expect(result).not.toContain('read-only');
  expect(result.match(/Herkunft:/g)).toHaveLength(1);
});

test('tenant quota diagnostics carry reset time without a provider status', () => {
  const error = {
    type: 'LLM_QUOTA_EXCEEDED',
    code: 429,
    message: 'quota',
    data: { resource: 'llm_tokens_per_day', resetAt: '2026-10-12T00:00:00Z' },
  };
  expect(llmErrorDetails(error)).toMatchObject({
    errorClass: 'tenant_quota_exceeded',
    providerStatus: null,
    resetAt: error.data.resetAt,
  });
  expect(quotaMessage(error)).toContain('02:00 Uhr');
  expect(quotaMessage(error)).not.toMatch(/LLM_|nicht verfügbar/);
  expect(llmErrorDetails({ status: 429, message: 'quota' })).toMatchObject({
    errorClass: 'provider_quota',
    providerStatus: 429,
  });
});

test('admin quota inquiry uses the authenticated tenant and no model', async () => {
  const ctx = {
    call: jest.fn(async () => ({
      data: {
        usage: {
          llm_tokens_per_day: { used: 800, limit: 1000, remaining: 200 },
          llm_tokens_per_month: { used: 800, limit: 10000 },
        },
      },
    })),
  };
  const result = await quotaQuery(
    ctx,
    { tenantId: 'synthetic', roles: ['ROLE_TENANT_ADMIN'] },
    'Wie viel Kontingent ist heute noch übrig?'
  );
  expect(result.responseText).toContain('200 sind noch übrig');
  expect(ctx.call).toHaveBeenCalledWith('tenant-quota.getQuotas', { id: 'synthetic' });
  expect(llm.generateText).not.toHaveBeenCalled();
  await expect(
    quotaQuery(ctx, { tenantId: 'synthetic', roles: [] }, 'Kontingent?')
  ).rejects.toMatchObject({ code: 403 });
});

test('chat-address guard rejects formal user address while retaining external drafts', () => {
  const parsed = {
    interpretation: [claim('Prüfen Sie den Stand.')],
    expectation: [],
    nextSteps: [],
    assumptions: [],
    draft: [claim('Guten Tag, bitte prüfen Sie die fachliche Antwort. Mit freundlichen Grüßen')],
  };
  const filtered = require('../src/workbench-answer-filter').filterAnswer(parsed, {
    evidence: [],
    answerEvidence: [],
    unresolved: [],
    message: '',
    normalizeCondition: (text) => text,
    counts: new Map(),
  });
  expect(filtered.interpretation).toEqual([]);
  expect(filtered.draft[0].text).toContain('prüfen Sie');
});

test('document review displays failed sections naturally without internal status or error codes', () => {
  const text = require('../src/workbench-document-flow').renderReview({
    status: 'partial_failed',
    reason: 'WORKBENCH_REVIEW_MAP_FAILED',
    limitations: ['Abschnitt nicht geprüft (LLM_QUOTA_EXCEEDED): Synthetischer Abschnitt A'],
    criteria: [],
    stats: { documentChars: 100, mapCalls: 1, reduceCalls: 0, elapsedMs: 20 },
  });
  expect(text).toContain('Modellengpass');
  expect(text).toContain('Synthetischer Abschnitt A');
  expect(text).not.toMatch(/partial_failed|[A-Z]+(?:_[A-Z]+)+/);
});

test('thread analysis is repaired when only next steps survive filtering', async () => {
  const empty = {
    expectation: [],
    interpretation: [],
    assumptions: [],
    draft: [],
    nextSteps: [claim('Prüfe den Prozessstatus.')],
  };
  llm.generateText.mockResolvedValueOnce(JSON.stringify(empty)).mockResolvedValueOnce(
    JSON.stringify({
      ...empty,
      interpretation: [claim('Die fachliche Antwort fehlt weiterhin trotz bestätigtem Empfang.')],
    })
  );
  const result = await answer({
    situation,
    retrieval: { evidence: [], trace: [], unavailable: false },
    tenantId: 'synthetic',
    asked: [],
    message:
      'Analysiere den Thread.\nVon: Lieferant\nGesendet: 01.10.2026\nDie fachliche Antwort fehlt weiterhin trotz bestätigtem Empfang.',
  });
  expect(result.responseText).toContain('fachliche Antwort fehlt');
  expect(llm.generateText).toHaveBeenCalledTimes(2);
});

test('a document review retains the tenant quota reset time in failed sections', async () => {
  const error = {
    type: 'LLM_QUOTA_EXCEEDED',
    code: 429,
    data: { resource: 'llm_tokens_per_day', resetAt: '2026-10-12T00:00:00Z' },
  };
  const review = await require('../src/workbench-review').reviewDocuments(
    {
      documents: [
        { name: 'Synthetischer Abschnitt', text: 'Eine synthetische Planung liegt vor.' },
      ],
      question: 'Prüfe den Plan.',
      situation: {},
    },
    { llm: { generateStructured: jest.fn().mockRejectedValue(error) } }
  );
  const rendered = require('../src/workbench-document-flow').renderReview(review);
  expect(rendered).toContain('Tageskontingent');
  expect(rendered).toContain('02:00 Uhr');
  expect(rendered).not.toContain('LLM_QUOTA_EXCEEDED');
});
