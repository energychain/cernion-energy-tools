'use strict';
// CTX-01 situation 4: a case the person brings in for comparison is answered as a comparison.
jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { projectManifestProse } = require('../src/project-manifest-prose');

const label = 'Sitzung: Klärfall SYN-C1';
const evidence = (metadata = {}) => [
  {
    source: 'workbench.turnMemory',
    value: 'Für Klärfall SYN-C1 fehlt seit Monat 3 die Abrechnung, weil Zählerstände fehlen.',
    metadata: { sourceLabel: label, ...metadata },
  },
];
const result = (metadata) => ({
  title: label,
  responseText: 'Deterministischer Auszug.',
  gaps: [],
  tenantSelection: [{ sourceType: 'case', sourceId: 'c1' }],
  evidence: evidence(metadata),
});
const question = 'Vergleiche bitte SYN-C1 mit dieser Lage: seit Monat 6 fehlt die Abrechnung.';
const answer = `Gemeinsam ist beiden Lagen die fehlende Abrechnung. Laut ${label} fehlt sie dort seit Monat 3; in deiner Lage fehlt sie seit Monat 6.`;

beforeEach(() => llm.generateStructured.mockResolvedValue({ answer }));

test("a comparison with another conversation's case may restate the person's own numbers", async () => {
  const reply = await projectManifestProse(result({ otherConversation: true }), question, {});
  expect(reply.responseText).toContain('seit Monat 6');
  const prompt = JSON.parse(llm.generateStructured.mock.calls[0][1]);
  expect(prompt.instruction).toContain('metadata.otherConversation');
  expect(prompt.untrustedEvidence[0].metadata.otherConversation).toBe(true);
});

test('without that comparison a number only in the question still falls back', async () => {
  const reply = await projectManifestProse(result({}), question, {});
  expect(reply.responseText).toBe('Deterministischer Auszug.');
});
