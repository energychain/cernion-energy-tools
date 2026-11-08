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

  test('without foreign items no model call is made', async () => {
    const llm = llmReturning([]);
    const result = await gateForeignEvidence([own], { llm });
    expect(result).toEqual({ evidence: [own], suggest: false, decisions: [] });
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

  test('a case the person names by its exact identifier is linked without a judgement', async () => {
    const named = foreign('Klärfall SYN-CASE-4711: Zählerstände fehlen seit Monat 3.');
    const other = foreign('Klärfall SYN-CASE-0815: Vertragszuordnung fehlt.');
    const llm = llmReturning([{ index: 0, decision: 'comparable', lesson: '' }]);
    const result = await gateForeignEvidence([own, named, other], {
      llm,
      message: 'Vergleiche bitte den Klärfall SYN-CASE-4711 mit dieser Lage.',
    });
    expect(result.evidence).toEqual([own, named]);
    expect(result.decisions).toEqual(['linked', 'comparable']);
    // Only the unnamed item reaches the model.
    const prompt = JSON.parse(llm.generateStructured.mock.calls[0][1]);
    expect(prompt.foreign).toHaveLength(1);
    expect(prompt.foreign[0].content).toContain('SYN-CASE-0815');
  });

  test('identifiers given as metadata count; withheld items stay unlinked even when named', async () => {
    const session = {
      source: 'Sitzung',
      value: '{"title":"Projekt"}',
      // Stored sessions carry typed identifiers.
      metadata: {
        scopeOrigin: 'aus anderem Gespräch',
        identifiers: [{ value: 'SYN-PRJ-0042', type: 'project' }],
      },
    };
    const withheld = foreign('Rohdaten zu SYN-PRJ-0042');
    const llm = llmReturning([{ index: 0, decision: 'unrelated', lesson: '' }]);
    const result = await gateForeignEvidence([session], {
      llm,
      withheld: [withheld],
      message: 'Was ist der Stand bei SYN-PRJ-0042?',
    });
    expect(result.evidence).toEqual([session]);
    expect(result.decisions).toEqual(['linked', 'unrelated']);
  });

  test('a failed judgement drops all foreign items', async () => {
    const llm = { generateStructured: jest.fn().mockRejectedValue(new Error('down')) };
    const logger = { warn: jest.fn() };
    const result = await gateForeignEvidence([own, foreign('Vorgang F-6')], { llm, logger });
    expect(result.evidence).toEqual([own]);
    expect(result.suggest).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});
