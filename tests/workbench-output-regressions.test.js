'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const llm = require('../src/llm-client');
const { documentTable, documentQuestion } = require('../src/workbench-document-question');
const { storedPassage } = require('../src/workbench-document-flow');
const { attachDocuments } = require('../src/workbench-document');
const { boundedJson, toolReport } = require('../src/workbench-capability-loop');
const { sourceLine, readableSourceTitle } = require('../src/workbench-answer-evidence');
const { answer } = require('../src/workbench-understanding');

afterEach(() => jest.resetAllMocks());

test('nested over-limit payload loses rows, never the payload field or count', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    name: `Synthetic ${50 - i}`,
    value: 50 - i,
  }));
  const result = boundedJson({ success: true, data: { payload: { entries: rows } } }, 200);
  const data = JSON.parse(result.value);
  expect(data.count).toBe(50);
  expect(data.data.success).toBe(true);
  expect(data.data.data.payload.entries[0]).toEqual(rows[0]);
  expect(data.data.data.payload.entries.length).toBeGreaterThan(0);
  expect(result.value.length).toBeLessThanOrEqual(200);
});

test('a single oversize row fails visibly rather than turning into an empty success', () => {
  expect(() =>
    boundedJson({ success: true, data: { rows: [{ text: 'x'.repeat(1000) }] } }, 80)
  ).toThrow('Datensatz');
});

test.each(['skipped', 'blocked', 'limited', 'unavailable', 'timeout', 'missing'])(
  'internal %s observations never render a source line',
  (status) => {
    expect(toolReport([{ status, error: 'Aufrufbudget (3) erreicht' }])).toBe('');
  }
);

test('metadata title takes precedence over a text fragment; absent true title gives no source', () => {
  const fragment = 'a) bei Letztverbrauchern, mit einer Leistung';
  expect(sourceLine([{ title: fragment, value: `${fragment} weitere Angaben` }])).toBe('');
  expect(
    readableSourceTitle({ title: fragment, metadata: { documentTitle: 'Synthetischer Leitfaden' } })
  ).toBe('Synthetischer Leitfaden');
  expect(sourceLine([{ value: 'Text ohne Titel', source: 'knowledge-rag' }])).toBe('');
});

test('document hash prevents even renamed duplicates from calling the evidence store again', async () => {
  const identity = { tenantId: 'synthetic', actorId: 'person', caseId: 'case' };
  const entries = [];
  const store = {
    listEvidence: jest.fn(async () => [...entries]),
    saveEvidence: jest.fn(async (entry) => {
      entries.push(entry);
      return entry;
    }),
  };
  const logger = { info: jest.fn() };
  const text = 'Spalte;Wert\nA;1\nB;2';
  await attachDocuments(store, identity, [{ name: 'Synthetic.csv', text }], { logger });
  const [duplicate] = await attachDocuments(store, identity, [{ name: 'Renamed.csv', text }], {
    logger,
  });
  expect(duplicate.duplicate).toBe(true);
  expect(store.saveEvidence).toHaveBeenCalledTimes(1);
  expect(logger.info).toHaveBeenCalledWith('Workbench document stored', {
    name: 'Synthetic.csv',
    chars: text.length,
    lines: 3,
    tabular: true,
  });
  expect(logger.info).toHaveBeenCalledTimes(1);
});

test.each([
  'Name;Wert\nA;1\nB;2',
  'Name\tWert\nA\t1\nB\t2',
  '| Name | Wert |\n| --- | --- |\n| A | 1 |\n| B | 2 |',
])('CSV, XLSX text and Markdown support first/last/count without an LLM', async (text) => {
  const documents = [{ name: 'Synthetic', text }];
  expect(documentTable(text).rows).toHaveLength(2);
  expect(
    (await documentQuestion(documents, 'Wie viele Zeilen sind enthalten?')).responseText
  ).toContain('2 Datenzeilen');
  expect(
    (await documentQuestion(documents, 'Was steht in der ersten Zeile?')).responseText
  ).toContain('Name: A');
  expect(
    (await documentQuestion(documents, 'Was steht in der letzten Zeile?')).responseText
  ).toContain('Name: B');
  expect((await documentQuestion(documents, 'Bitte auswerten')).responseText).toContain(
    'Datenkatalog'
  );
  expect(llm.generateStructured).not.toHaveBeenCalled();
});

test('beginning and end questions reach the actual edges of a long document', () => {
  const documents = [
    {
      name: 'Synthetic.txt',
      text: `Anfang-Marker\n${'Mittlerer Text.\n'.repeat(10000)}Ende-Marker`,
    },
  ];
  expect(storedPassage(documents, 'Was steht am Anfang?')).toContain('Anfang-Marker');
  expect(storedPassage(documents, 'Was steht ganz am Ende des Dokuments?')).toContain(
    'Ende-Marker'
  );
  expect(
    storedPassage(
      [{ name: 'Synthetic.txt', text: 'x'.repeat(6000) + 'Ende-Marker' }],
      'Was steht am Ende?'
    )
  ).toContain('Ende-Marker');
});

test('first document plus content question uses relevant sections and the sole LLM facade', async () => {
  llm.generateStructured.mockResolvedValue({
    answer: 'Das Abschlusskapitel nennt einen offenen Termin.',
  });
  const result = await documentQuestion(
    [
      {
        name: 'Synthetic.txt',
        text: `Kapitel 1: Beginn\n${'Allgemeine Angabe.\n'.repeat(2000)}Kapitel 9: Abschluss\nDer Termin ist offen.`,
      },
    ],
    'Was sagt das Abschlusskapitel zum Termin?',
    { tenantId: 'synthetic' }
  );
  expect(result.responseText).toContain('offenen Termin');
  const prompt = JSON.parse(llm.generateStructured.mock.calls[0][1]);
  expect(prompt.sections.some((section) => section.text.includes('Der Termin ist offen'))).toBe(
    true
  );
  expect(prompt.instruction).toContain('untrusted');
});

test('failed answer model still answers from available tool evidence without raw status or parameters', async () => {
  llm.generateText.mockRejectedValue(new Error('Synthetic unavailable'));
  const hit = {
    source: 'synthetic.read',
    retrievalSource: 'capability-read',
    value: JSON.stringify([{ name: 'Synthetic Large', valueKW: 900 }]),
    metadata: {
      rowCount: 30,
      statistics: [
        { field: 'valueKW', min: 1, max: 900, maxRow: { name: 'Synthetic Large', valueKW: 900 } },
      ],
    },
  };
  const result = await answer({
    situation: {
      concern: 'Largest',
      missingInformation: [],
      requestedAction: {},
      identifiers: [],
      outputKind: 'analysis',
    },
    retrieval: {
      evidence: [hit],
      toolTrace: [
        { name: 'Werkzeugbudget', status: 'limited', error: 'Aufrufbudget (3) erreicht' },
      ],
    },
    message: 'Welche davon ist die größte?',
  });
  expect(result.responseText).toContain('30 Datensätze');
  expect(result.responseText).toContain('Synthetic Large');
  expect(result.responseText).toContain('900 kW');
  expect(result.responseText).not.toMatch(
    /```|Aufrufbudget|Modell gerade nicht verfügbar|Datenabfrage: skipped/u
  );
});

test('table detection handles a worksheet preamble and quoted multiline CSV records', () => {
  expect(documentTable('Sheet: Synthetic\nName\tWert\nA\t1\nB\t2').rows).toHaveLength(2);
  const csv = documentTable('Name,Wert\n"Synthetic\nMultiline",1\nOther,2');
  expect(csv.rows).toHaveLength(2);
  expect(csv.rows[0][0]).toBe('Synthetic\nMultiline');
  expect(
    documentTable('Synthetische Angaben, weitere Erläuterung.\nEin Absatz ohne Tabelle.')
  ).toBeNull();
});

test('raw JSON, parameter codes and internal messages from a model are filtered at the answer boundary', async () => {
  const hit = {
    source: 'synthetic.read',
    retrievalSource: 'capability-read',
    value: JSON.stringify([{ name: 'Synthetic Result', capacityKW: 150 }]),
    metadata: {
      rowCount: 1,
      parameters: { operationalStatus: '35' },
      statistics: [
        {
          field: 'capacityKW',
          max: 150,
          min: 150,
          maxRow: { name: 'Synthetic Result', capacityKW: 150 },
        },
      ],
    },
  };
  const claim = (text) => ({
    text,
    origin: 'evidence',
    supported: 'evidence',
    completedAction: false,
    specific: false,
    evidenceIds: ['E1'],
  });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [
        claim('```json\n{"operationalStatus":"35"}\n```'),
        claim('Werkzeug außerhalb der Kandidatenliste'),
        claim('Aufrufbudget (3) erreicht. Datenabfrage: skipped'),
      ],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  const result = await answer({
    situation: {
      concern: 'Largest',
      missingInformation: [],
      requestedAction: {},
      identifiers: [],
      outputKind: 'analysis',
    },
    retrieval: { evidence: [hit], toolTrace: [] },
    message: 'Welche ist die größte?',
  });
  expect(result.responseText).toContain('150 kW');
  expect(result.responseText).not.toMatch(
    /```|operationalStatus|"35"|Kandidatenliste|Aufrufbudget|skipped/u
  );
});

test.each([
  'Okay, hier eine leicht verständliche Zusammenfassung von § 56',
  'Hier sind die wichtigsten Punkte',
  'Gerne erkläre ich den Abschnitt',
])('source title excludes generated introductory sentences: %s', (title) => {
  expect(sourceLine([{ title, value: 'anderer Inhalt', metadata: { title } }])).toBe('');
  const line = sourceLine([
    { title, metadata: { sourceTitle: 'Synthetisches Dokument', sectionTitle: 'Abschnitt 56' } },
  ]);
  expect(line).toBe('Quellen: Synthetisches Dokument · Abschnitt 56');
  expect(line).not.toMatch(/Okay|Hier|E[_-]\d|[0-9a-f]{8}-/i);
});
test('tool provenance uses executed filters and German retrieval time', () => {
  const hit = {
    retrievalSource: 'capability-read',
    metadata: {
      sourceId: 'read-1',
      sourceLabel: 'MaStR',
      parameters: {
        installationType: 'solar',
        operationalStatus: '35',
        minCapacityKW: 100,
        location: 'Uslar',
      },
    },
  };
  const text = toolReport(
    [
      {
        name: 'energy-market.installations',
        status: 'available',
        called: true,
        sourceId: 'read-1',
        at: '2026-10-10T08:28:00Z',
      },
    ],
    [hit],
    'Wieviele gibt es?'
  );
  expect(text).toContain('MaStR, Solar, in Betrieb, > 100 kW, Uslar');
  expect(text).toContain('10.10.2026, 10:28');
  expect(text).not.toMatch(/Wieviele|35|operationalStatus/);
});
test('register status config translates codes without modifying stored results', () => {
  const { readableToolData } = require('../src/tool-display');
  const data = { data: [{ einheitBetriebsstatus: 35 }] };
  expect(readableToolData('energy-market.installations', data)).toEqual({
    data: [{ einheitBetriebsstatus: 'in Betrieb' }],
  });
  expect(data.data[0].einheitBetriebsstatus).toBe(35);
  for (const value of [null, '', undefined]) {
    expect(
      readableToolData('energy-market.installations', { einheitBetriebsstatus: value })
    ).toEqual({ einheitBetriebsstatus: value });
  }
});

test('document filename metadata is a title with its section; text contents never substitute for metadata', () => {
  expect(
    sourceLine([
      {
        metadata: { documentName: 'Synthetischer Leitfaden.pdf', sectionTitle: 'Kapitel 3' },
        value: 'Okay, hier ist die Zusammenfassung.',
      },
    ])
  ).toBe('Quellen: Synthetischer Leitfaden.pdf · Kapitel 3');
  expect(sourceLine([{ value: 'Synthetischer Leitfaden ohne Titelmetadaten' }])).toBe('');
  for (const documentName of [
    '/uploads/tenant/report.pdf',
    'uploads\\report.pdf',
    'E-123',
    'E-123.pdf',
    '12345678-abcd-1234-abcd-123456789abc.pdf',
  ])
    expect(sourceLine([{ metadata: { documentName } }])).toBe('');
});
