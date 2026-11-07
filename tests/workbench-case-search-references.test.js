'use strict';

// A stored case named by one of its references in the question is bound without an LLM call,
// with and without prompt scrubbing (LLM_PROMPT_SCRUBBING).
jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { selectSemanticCases } = require('../src/workbench-case-search');

const candidates = [
  { caseId: 'case-a', title: 'Klärung zu Referenz 020037232961', summary: 'offen' },
  { caseId: 'case-b', title: 'Anderer Vorgang 020040859279', summary: 'erledigt' },
];
const previous = process.env.LLM_PROMPT_SCRUBBING;
afterAll(() => {
  if (previous === undefined) delete process.env.LLM_PROMPT_SCRUBBING;
  else process.env.LLM_PROMPT_SCRUBBING = previous;
});

test.each([undefined, 'true'])('binds by reference with LLM_PROMPT_SCRUBBING=%s', async (value) => {
  if (value === undefined) delete process.env.LLM_PROMPT_SCRUBBING;
  else process.env.LLM_PROMPT_SCRUBBING = value;
  llm.generateStructured.mockReset();
  const selected = await selectSemanticCases('Wie steht es um 020040859279?', candidates, 't1');
  expect(selected.map((item) => item.caseId)).toEqual(['case-b']);
  expect(llm.generateStructured).not.toHaveBeenCalled();
});

test('without a named reference the cases are chosen semantically from unmasked text', async () => {
  delete process.env.LLM_PROMPT_SCRUBBING;
  llm.generateStructured.mockReset();
  llm.generateStructured.mockResolvedValue({ caseIds: ['case-a'] });
  const selected = await selectSemanticCases('Was ist noch offen?', candidates, 't1');
  expect(selected.map((item) => item.caseId)).toEqual(['case-a']);
  expect(llm.generateStructured.mock.calls[0][1]).toContain('020037232961');
});
