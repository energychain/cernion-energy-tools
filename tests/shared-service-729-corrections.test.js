'use strict';
const {
  classifyWorkbenchIntent,
  renderWorkbenchResponse,
} = require('../src/workbench-intent-router');
const { recognizeCorrection } = require('../src/workbench-corrections');
const { resolveFunctions } = require('../src/function-resolver');
const { getFunctionModel } = require('../src/function-model');
const { buildFunctionModel } = require('../scripts/generate-function-model');
const { presentDigest, renderSystemActivity } = require('../src/workbench-system-activity');
const { readableSharedServiceText } = require('../src/shared-service-display');
const model = {
  functions: [
    {
      functionId: 'fn-a',
      label: 'Function Alpha',
      displayLabel: 'Function Alpha (Distinctive)',
      keywords: ['distinctive'],
    },
  ],
};
test.each([
  ['Darum musst du dich nicht kümmern: Function Alpha', 'activation'],
  ['Das mache ich selbst: Function Alpha', 'coverage'],
  ['Nimm Function Alpha ins Inventar auf', 'agent'],
  ['Setze Function Alpha auf Inventar', 'agent'],
  ['Bitte nimm Function Alpha in dein Inventar auf.', 'agent'],
  ['Für Function Alpha brauchst du nichts zu tun.', 'activation'],
  ['Ich kümmere mich selbst um Function Alpha.', 'coverage'],
  ['Function Alpha übernehme ich selbst.', 'coverage'],
  ['Please leave Function Alpha to me', 'coverage'],
  ["I'll take care of Function Alpha myself", 'coverage'],
  ["You don't have to worry about Function Alpha", 'activation'],
  ['Add Function Alpha to the inventory.', 'agent'],
  ['Set Function Alpha to inventory', 'agent'],
  ['Put Function Alpha into the inventory', 'agent'],
])('%s resolves through the common resolver before assessment/case routing', (message, target) => {
  expect(classifyWorkbenchIntent(message)).toBe('correction');
  const correction = recognizeCorrection(message);
  expect(correction.target).toBe(target);
  expect(resolveFunctions(correction.phrase, { model }).status).toBe('resolved');
});
test.each([
  'Wie kann ich einen Fall erstellen?',
  'How do I create a case?',
  'Starte keinen Fall',
  'Please do not create a case',
  'Wenn nötig starte einen Fall',
  'Eine unklare Nachricht',
])('%s is not explicit case_start', (message) => {
  expect(classifyWorkbenchIntent(message)).not.toBe('case_start');
});
test('readable model output is deterministic, data-derived, resolvable and bounded to five candidates', () => {
  const generated = getFunctionModel();
  expect(generated.functions.every((fn) => fn.displayLabel && !fn.displayLabel.includes('_'))).toBe(
    true
  );
  const fixture = {
    functions: Array.from({ length: 25 }, (_, n) => ({
      functionId: `fn-${n}`,
      label: 'Shared label',
    })),
  };
  expect(
    resolveFunctions('Shared label', { model: fixture, maxCandidates: 5 }).matches
  ).toHaveLength(5);
  expect(
    renderWorkbenchResponse(
      { state: 'clarification_required', responseText: 'Bitte bestätige den Fallstart.' },
      'decision_support'
    )
  ).toBe('Bitte bestätige den Fallstart.');
  expect(buildFunctionModel().functions[0].displayLabel).toBe(generated.functions[0].displayLabel);
});
test('historical internal journal codes and push explanations are translated', () => {
  const text = readableSharedServiceText(
    'attention_transient attention_established attention_retained attention_inventory attention_retired allowance_exhausted Push source unavailable; scheduled observation is required.'
  );
  expect(text).not.toMatch(/attention_|allowance_exhausted|Push source unavailable/);
  expect(text).toContain('regelmäßig');
});

test('system answers translate raw journal codes without changing the digest contract', () => {
  const journal = presentDigest({
    lastDecisions: [{ summary: 'Funktion ist aktiv. attention_transient' }],
    openExpectations: [],
    openProposals: [],
  });
  expect(journal.lastDecisions[0].summary).toContain('attention_transient');
  const answer = renderSystemActivity({
    items: [{ label: 'Function Alpha', state: 'active_cet', journal }],
  });
  expect(answer).toContain('Die Aufmerksamkeit ist vorübergehend.');
  expect(answer).not.toContain('attention_transient');
  const result = renderSystemActivity({
    state: 'function_ambiguous',
    candidates: Array.from({ length: 25 }, (_, n) => ({ label: `Candidate ${n}` })),
  });
  expect(result.match(/Candidate /g)).toHaveLength(5);
});
