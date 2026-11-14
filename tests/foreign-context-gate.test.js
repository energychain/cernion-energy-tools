'use strict';

const { SUGGESTION, foreignItem, gateForeignEvidence } = require('../src/foreign-context-gate');

const own = { source: 'Upload', value: 'Eigener Befund', metadata: {} };
const foreign = (value) => ({
  source: 'Fall',
  value,
  metadata: { scopeOrigin: 'aus anderem Fall' },
});
const llmReturning = (items) => ({ generateStructured: jest.fn().mockResolvedValue({ items }) });

describe('foreign context gate', () => {
  test('recognises scoped and foreign tenant-memory items', () => {
    expect(foreignItem(own)).toBe(false);
    expect(foreignItem(foreign('x'))).toBe(true);
    expect(foreignItem({ retrievalSource: 'tenant-memory', metadata: {} })).toBe(true);
    expect(
      foreignItem({ retrievalSource: 'tenant-memory', metadata: { ownConversation: true } })
    ).toBe(false);
  });

  test('knowledge needs and failure records from other conversations are foreign', () => {
    expect(foreignItem({ retrievalSource: 'knowledge-register', metadata: {} })).toBe(true);
    expect(foreignItem({ source: 'self-improvement', metadata: {} })).toBe(true);
    expect(
      foreignItem({ retrievalSource: 'knowledge-register', metadata: { ownConversation: true } })
    ).toBe(false);
  });

  test('without foreign items no model call is made', async () => {
    const llm = llmReturning([]);
    const result = await gateForeignEvidence([own], { llm });
    expect(result).toEqual({
      evidence: [own],
      suggest: false,
      decisions: [],
      judgementFailed: false,
      overflowCount: 0,
    });
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  test('unrelated items are dropped, linked items kept with their origin', async () => {
    const linked = foreign('Vorgang A-1: Zählerwechsel offen');
    const unrelated = foreign('Vorgang B-2: Abrechnung strittig');
    const llm = llmReturning([
      { index: 0, decision: 'linked', lesson: '' },
      { index: 1, decision: 'unrelated', lesson: '' },
    ]);
    const result = await gateForeignEvidence([own, linked, unrelated], { llm });
    expect(result.evidence).toEqual([own, linked]);
    expect(result.suggest).toBe(false);
    expect(llm.generateStructured.mock.calls[0][2]).toMatchObject({ phase: 'context_gate' });
  });

  test('a pattern replaces case data by a labelled lesson without identifiers', async () => {
    const hit = foreign('Vorgang C-77: Messlokation DE0001 falsch zugeordnet');
    const llm = llmReturning([
      { index: 0, decision: 'pattern', lesson: 'Zuerst die Zuordnung der Messlokation prüfen.' },
    ]);
    const result = await gateForeignEvidence([hit], { llm });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      retrievalSource: 'experience',
      value: 'Zuerst die Zuordnung der Messlokation prüfen.',
    });
    expect(JSON.stringify(result.evidence)).not.toContain('C-77');
  });

  test('a lesson repeating a foreign identifier fails closed', async () => {
    const hit = foreign('Vorgang C-77: Messlokation DE0001 falsch zugeordnet');
    const llm = llmReturning([
      { index: 0, decision: 'pattern', lesson: 'Wie bei C-77 die Messlokation prüfen.' },
    ]);
    const result = await gateForeignEvidence([hit], { llm });
    expect(result.evidence).toEqual([]);
  });

  test('a case-search hit is judged, not linked by itself', async () => {
    const hit = {
      ...foreign('Vorgang S-9: Zielbild mit zwei Linien'),
      metadata: { scopeOrigin: 'aus anderem Fall', requestedSearch: true },
    };
    const llm = llmReturning([{ index: 0, decision: 'unrelated', lesson: '' }]);
    const result = await gateForeignEvidence([own, hit], {
      llm,
      message: 'Welche Angaben liegen dir zu diesem Fall vor?',
    });
    expect(result.evidence).toEqual([own]);
    const input = JSON.parse(llm.generateStructured.mock.calls[0][1]);
    expect(input.foreign[0].searched).toBe(true);
  });

  test('foreign items beyond the judged ones are dropped; a named case is judged first', async () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      foreign(`Vorgang X-${index}: Inhalt ${index}`)
    );
    const named = {
      ...foreign('Vorgang F-77: benannter Inhalt'),
      metadata: { scopeOrigin: 'aus anderem Fall', caseRef: 'F-77' },
    };
    const llm = llmReturning(
      Array.from({ length: 12 }, (_, index) => ({ index, decision: 'unrelated', lesson: '' }))
    );
    const logger = { info: jest.fn(), warn: jest.fn() };
    const result = await gateForeignEvidence([own, ...items, named], {
      llm,
      logger,
      message: 'Vergleiche bitte mit F-77.',
    });
    expect(result.evidence).toEqual([own, named]);
    expect(logger.info).toHaveBeenCalledWith('Foreign context gate overflow', { dropped: 9 });
    // Bounded diagnostics for the context-use summary (#1117).
    expect(result.overflowCount).toBe(9);
    expect(result.judgementFailed).toBe(false);
    expect(result.decisions).toHaveLength(12);
  });

  test('a lesson carrying a name of the foreign case fails closed', async () => {
    const hit = foreign(
      'Zielbild: Spur Kormoran für Nutzen, Strukturhalterin Ilvana hält das Thema.'
    );
    const llm = llmReturning([
      {
        index: 0,
        decision: 'pattern',
        lesson: 'Bewährt hat sich die Trennung in Spur Kormoran und eine Machbarkeitslinie.',
      },
    ]);
    const result = await gateForeignEvidence([own, hit], {
      llm,
      message: 'Wie trenne ich Linien?',
    });
    expect(result.evidence).toEqual([own]);
  });

  test('a lesson with general wording only is kept as experience', async () => {
    const hit = foreign(
      'Zielbild: Spur Kormoran für Nutzen, Strukturhalterin Ilvana hält das Thema.'
    );
    const llm = llmReturning([
      {
        index: 0,
        decision: 'pattern',
        lesson: 'Bewährt hat sich, Nutzen und Machbarkeit getrennt zu prüfen.',
      },
    ]);
    const result = await gateForeignEvidence([own, hit], {
      llm,
      message: 'Wie trenne ich Linien?',
    });
    expect(result.evidence[1]).toMatchObject({ retrievalSource: 'experience' });
  });

  test('a comparable case is offered, not disclosed', async () => {
    const llm = llmReturning([{ index: 0, decision: 'comparable', lesson: '' }]);
    const result = await gateForeignEvidence([own, foreign('Vorgang D-4 Details')], { llm });
    expect(result.evidence).toEqual([own]);
    expect(result.suggest).toBe(true);
    expect(SUGGESTION).toMatch(/vergleichbaren Vorgang/);
  });

  test('withheld items can never become linked', async () => {
    const withheld = foreign('Vorgang E-5 Rohdaten');
    const llm = llmReturning([{ index: 0, decision: 'linked', lesson: '' }]);
    const result = await gateForeignEvidence([own], { llm, withheld: [withheld] });
    expect(result.evidence).toEqual([own]);
    expect(result.suggest).toBe(true);
    expect(result.decisions).toEqual(['comparable']);
  });

  test('a case named by its display reference is linked without a judgement', async () => {
    const named = {
      ...foreign('Klärfall: Zählerstände fehlen seit Monat 3.'),
      metadata: { scopeOrigin: 'aus anderem Fall', caseRef: 'F-4711' },
    };
    const other = foreign('Klärfall: Vertragszuordnung fehlt.');
    const llm = llmReturning([{ index: 0, decision: 'comparable', lesson: '' }]);
    const result = await gateForeignEvidence([own, named, other], {
      llm,
      message: 'Vergleiche bitte den Fall F-4711 mit dieser Lage.',
    });
    expect(result.evidence).toEqual([own, named]);
    expect(result.decisions).toEqual(['linked', 'comparable']);
    const prompt = JSON.parse(llm.generateStructured.mock.calls[0][1]);
    expect(prompt.foreign).toHaveLength(1);
    expect(prompt.foreign[0].content).toContain('Vertragszuordnung');
  });

  test('other identifiers reach the model as hints with their role; its decision applies', async () => {
    const session = {
      source: 'Sitzung: Abrechnung',
      value: '{"title":"Sitzung: Abrechnung"}',
      metadata: {
        scopeOrigin: 'aus anderem Gespräch',
        identifiers: [{ value: 'SYN-OBJ-0042', type: 'object' }],
        contentRefs: ['SYN-CASE-7781', 'KRED-SYN-4712'],
      },
    };
    const llm = llmReturning([{ index: 0, decision: 'unrelated', lesson: '' }]);
    const result = await gateForeignEvidence([own, session], {
      llm,
      message:
        'Die Kreditorennummer lautet KRED-SYN-4712, Objekt SYN-OBJ-0042, Vorgang SYN-CASE-7781.',
    });
    const [item] = JSON.parse(llm.generateStructured.mock.calls[0][1]).foreign;
    expect(item.namedIdentifiers).toEqual(
      expect.arrayContaining([
        { value: 'SYN-OBJ-0042', role: 'subject' },
        { value: 'SYN-CASE-7781', role: 'content' },
        { value: 'KRED-SYN-4712', role: 'content' },
      ])
    );
    // A shared data value alone does not link: the model judged unrelated.
    expect(result.evidence).toEqual([own]);
  });

  test('withheld items stay unlinked even when named by their display reference', async () => {
    const withheld = {
      ...foreign('Rohdaten'),
      metadata: { scopeOrigin: 'aus anderem Fall', caseRef: 'F-9' },
    };
    const llm = llmReturning([{ index: 0, decision: 'linked', lesson: '' }]);
    const result = await gateForeignEvidence([own], {
      llm,
      withheld: [withheld],
      message: 'Was ist mit F-9?',
    });
    expect(result.evidence).toEqual([own]);
    expect(result.decisions).toEqual(['comparable']);
  });

  test('the gate knows the current case to judge references to this case', async () => {
    const llm = llmReturning([{ index: 0, decision: 'unrelated', lesson: '' }]);
    await gateForeignEvidence([foreign('Zielbild eines anderen Vorgangs')], {
      llm,
      message: 'Welche Angaben liegen dir zu diesem Fall vor?',
      currentCase: { concern: 'Arbeitsprozess aufsetzen', situation: 'Einzellösungen bisher' },
    });
    const prompt = JSON.parse(llm.generateStructured.mock.calls[0][1]);
    expect(prompt.currentCase).toEqual({
      concern: 'Arbeitsprozess aufsetzen',
      situation: 'Einzellösungen bisher',
    });
    expect(prompt.instruction).toContain('currentCase');
  });

  test('a failed judgement drops all foreign items', async () => {
    const llm = { generateStructured: jest.fn().mockRejectedValue(new Error('down')) };
    const logger = { warn: jest.fn() };
    const result = await gateForeignEvidence([own, foreign('Vorgang F-6')], { llm, logger });
    expect(result.evidence).toEqual([own]);
    expect(result.suggest).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(result.judgementFailed).toBe(true);
    expect(result.decisions).toEqual(['unrelated']);
  });

  test('a missing or unrecognised judgement row is reported as failed, still fail-closed', async () => {
    for (const items of [[], [{ index: 0, decision: 'SENTINEL-DECISION', lesson: '' }]]) {
      const result = await gateForeignEvidence([own, foreign('Vorgang G-7')], {
        llm: llmReturning(items),
      });
      expect(result.evidence).toEqual([own]);
      expect(result.decisions).toEqual(['unrelated']);
      expect(result.judgementFailed).toBe(true);
      expect(result.overflowCount).toBe(0);
    }
    const ordinary = await gateForeignEvidence([own, foreign('Vorgang G-8')], {
      llm: llmReturning([{ index: 0, decision: 'unrelated', lesson: '' }]),
    });
    expect(ordinary.decisions).toEqual(['unrelated']);
    expect(ordinary.judgementFailed).toBe(false);
  });
});
