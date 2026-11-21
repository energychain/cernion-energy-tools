'use strict';

const { applyCaseUpdate, createCaseState } = require('../src/case-state');

const task = (extra = {}) => ({
  action: 'Getrennte Suche nach der Lesevariante',
  kind: 'reversible_check',
  searchSpace: 'Archiv A',
  period: '11.04.2026 bis 30.04.2026',
  ...extra,
});

test('new tasks get stable ids', () => {
  const state = applyCaseUpdate(
    createCaseState(),
    { nextActions: [task(), task({ action: 'Abgleich' })] },
    { turn: 1 }
  );
  expect(state.nextActions.map((row) => row.actionId)).toEqual(['A1', 'A2']);
});

test('a continued task keeps its search space unless a reason is given', () => {
  let state = applyCaseUpdate(createCaseState(), { nextActions: [task()] }, { turn: 1 });
  state = applyCaseUpdate(
    state,
    { nextActions: [task({ actionId: 'A1', searchSpace: 'Archiv A und B' })] },
    { turn: 2 }
  );
  expect(state.nextActions[0].searchSpace).toBe('Archiv A');
  expect(state.violations.some((row) => row.rule === 'silent_scope_change')).toBe(true);
  state = applyCaseUpdate(
    state,
    {
      nextActions: [
        task({
          actionId: 'A1',
          searchSpace: 'Archiv A und B',
          scopeChangeReason: 'Die Person hat Archiv B als zusätzlichen Suchraum genannt.',
        }),
      ],
    },
    { turn: 3 }
  );
  expect(state.nextActions[0].searchSpace).toBe('Archiv A und B');
  expect(state.nextActions[0].actionId).toBe('A1');
});
