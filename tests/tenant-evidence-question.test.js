'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { evidenceCandidate } = require('../src/tenant-evidence-descriptor');
const { selectProjectCandidates } = require('../src/project-manifest-routing');
const { contextualEvidenceQuestion } = require('../src/tenant-evidence-question');
const ctx = {
  params: { conversationId: 'new-chat' },
  meta: { apiToken: { tenantId: 'tenant-a', id: 'actor-a', roles: ['ROLE_ALPHA'] } },
};
const source = (extra = {}) =>
  evidenceCandidate(
    'case',
    {
      id: 'source-a',
      tenantId: 'tenant-a',
      title: 'Sitzung: Objekt Nord',
      sectionNames: ['Messreihe offen'],
      hash: 'source-content',
      semantic: { anchors: ['Objekt Nord'] },
      provenance: { conversationId: 'earlier-chat' },
      ...extra,
    },
    'actor-a'
  );
const question = 'Welche Bewertung zum Objekt Nord liegt vor?';
const resolve = (candidates, message = question) => {
  let assessments;
  selectProjectCandidates(candidates, message, {
    onRanked: (ranked) => {
      assessments = ranked;
    },
  });
  return contextualEvidenceQuestion(ctx, candidates, message, {}, assessments);
};
beforeEach(() => llm.generateStructured.mockReset());

test('a fully matched subject without lexical content reaches the existing semantic schema once', async () => {
  const candidate = source();
  expect(selectProjectCandidates([candidate], question)).toEqual([]);
  llm.generateStructured.mockResolvedValue({ sourceIds: [candidate.id, candidate.id] });
  expect(await resolve([candidate])).toMatchObject({ sourceIds: [candidate.id] });
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  const [schema, raw] = llm.generateStructured.mock.calls[0];
  expect(JSON.parse(raw)).toMatchObject({
    task: 'evidence_reference_resolution',
    previousSourceIds: [],
  });
  expect(JSON.stringify(schema)).not.toMatch(
    /additionalProperties|uniqueItems|const|\$ref|allOf|oneOf/u
  );
});

test('the same subject is insufficient when semantic resolution rejects the content', async () => {
  llm.generateStructured.mockResolvedValue({ sourceIds: [] });
  expect(await resolve([source()])).toBeNull();
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
});

test('unrelated subjects and corrected candidates never invoke semantic resolution', async () => {
  expect(await resolve([source()], 'Welche Bewertung zum Objekt West liegt vor?')).toBeNull();
  expect(
    await resolve([source({ evidenceCorrections: [{ actorId: 'actor-a', kind: 'reject' }] })])
  ).toBeNull();
  expect(llm.generateStructured).not.toHaveBeenCalled();
});

test('typed references match complete tokens even without digit or separator grammar', async () => {
  const candidate = source({
    semantic: {
      anchors: ['Objekt Nord', 'AbcdAbcd'],
      identifiers: [{ kind: 'reference', value: 'AbcdAbcd' }],
    },
  });
  for (const message of [question, `${question} AbcdAbc`, `${question} AbcdAbcdX`])
    expect(await resolve([candidate], message)).toBeNull();
  expect(llm.generateStructured).not.toHaveBeenCalled();
  llm.generateStructured.mockResolvedValue({ sourceIds: [candidate.id] });
  expect(await resolve([candidate], 'Welche Bewertung zu AbcdAbcd liegt vor?')).not.toBeNull();
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
});

test('candidate and byte limits prevent an oversized reference-resolution call', async () => {
  const candidates = Array.from({ length: 9 }, (_, i) => source({ id: `source-${i}` }));
  expect(await resolve(candidates)).toBeNull();
  const candidate = source();
  candidate.manifest.summary.text = 'x'.repeat(65000);
  expect(await resolve([candidate])).toBeNull();
  expect(llm.generateStructured).not.toHaveBeenCalled();
});

test('unknown source IDs and a failed model response fail closed', async () => {
  llm.generateStructured
    .mockResolvedValueOnce({ sourceIds: ['unknown'] })
    .mockRejectedValueOnce(new Error('offline resolution failure'));
  expect(await resolve([source()])).toBeNull();
  expect(await resolve([source()])).toBeNull();
});

test('deferred resolution reads only confirmed IDs after refreshing candidates', async () => {
  const candidates = [source(), source({ id: 'source-b' })];
  const catalog = jest
    .spyOn(require('../src/evidence-endpoint-catalog'), 'projectEvidenceCandidates')
    .mockResolvedValue(candidates);
  const read = jest
    .spyOn(require('../src/tenant-evidence-sources'), 'readEvidenceSource')
    .mockResolvedValue(null);
  llm.generateStructured.mockResolvedValue({ sourceIds: [candidates[0].id] });
  const { projectManifestAnswer } = require('../src/project-manifest-evidence');
  try {
    expect(await projectManifestAnswer(ctx, question, { contextual: 'skip' })).toBeNull();
    expect(llm.generateStructured).not.toHaveBeenCalled();
    expect(await projectManifestAnswer(ctx, question, { contextual: 'only' })).toBeNull();
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][1].id).toBe(candidates[0].id);
    expect(catalog).toHaveBeenCalledTimes(3);
  } finally {
    catalog.mockRestore();
    read.mockRestore();
  }
});

test('a previous user question binds the missing subject of a semantic follow-up', async () => {
  const candidate = source();
  llm.generateStructured.mockResolvedValue({ sourceIds: [candidate.id] });
  const result = await contextualEvidenceQuestion(
    ctx,
    [candidate],
    'Passen diese Angaben zusammen?',
    { question }
  );
  expect(result.sourceIds).toEqual([candidate.id]);
  expect(JSON.parse(llm.generateStructured.mock.calls[0][1]).previousQuestion).toBe(question);
});

test('previous subject context never bypasses a semantic rejection or exact identifier checks', async () => {
  llm.generateStructured.mockResolvedValue({ sourceIds: [] });
  expect(
    await contextualEvidenceQuestion(ctx, [source()], 'Welche Temperatur hat Objekt West?', {
      question,
    })
  ).toBeNull();
  llm.generateStructured.mockClear();
  expect(
    await contextualEvidenceQuestion(
      ctx,
      [
        source({
          semantic: {
            anchors: ['Objekt Nord'],
            identifiers: [{ kind: 'reference', value: 'AbcdAbcd' }],
          },
        }),
      ],
      'Passen diese Angaben zusammen?',
      { question: `${question} AbcdAbcdX` }
    )
  ).toBeNull();
  expect(llm.generateStructured).not.toHaveBeenCalled();
});

test('semantic source groups retain individual validation and execute the original question', async () => {
  const candidates = [
    source(),
    source({
      id: 'source-b',
      title: 'Tabelle West',
      semantic: { anchors: ['Tabelle West'] },
      provenance: { conversationId: 'new-chat' },
    }),
  ];
  const catalog = jest
    .spyOn(require('../src/evidence-endpoint-catalog'), 'projectEvidenceCandidates')
    .mockResolvedValue(candidates);
  const read = jest
    .spyOn(require('../src/tenant-evidence-sources'), 'readEvidenceSource')
    .mockResolvedValue(null);
  const message = 'Passen diese Angaben zu den vorhandenen Unterlagen?';
  llm.generateStructured.mockResolvedValue({ sourceIds: candidates.map((item) => item.id) });
  try {
    await require('../src/project-manifest-evidence').projectManifestAnswer(ctx, message, {
      contextual: 'only',
      previousEvidence: { question },
      currentConversationId: 'new-chat',
    });
    expect(read).toHaveBeenCalledTimes(2);
    for (const call of read.mock.calls) {
      expect(call[2]).toBe(message);
      expect(call[3].combinedEvidence).toBe(true);
    }
    expect(new Set(read.mock.calls.map((call) => call[1].id))).toEqual(
      new Set(candidates.map((item) => item.id))
    );
  } finally {
    catalog.mockRestore();
    read.mockRestore();
  }
});
