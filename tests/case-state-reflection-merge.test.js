'use strict';

const { applyCaseUpdate, createCaseState, mergeReflection } = require('../src/case-state');

const action = (period) => ({
  action: 'Separate Suche nach der OCR-Variante',
  kind: 'reversible_check',
  searchSpace: 'Archiv A und Archiv B',
  period,
});

test('a late reflection does not undo the next actions of a newer turn', () => {
  let state = createCaseState();
  for (let turn = 1; turn <= 9; turn++)
    state = applyCaseUpdate(
      state,
      {
        nextActions: [action(turn < 9 ? '11.04.2026 bis 15.04.2026' : '11.04.2026 bis 30.04.2026')],
      },
      { turn }
    );
  expect(state.turn).toBe(9);
  const late = mergeReflection(state, {
    turn: 7,
    delta: { nextActions: [action('11.04.2026 bis 15.04.2026')] },
  });
  expect(late.nextActions[0].period).toBe('11.04.2026 bis 30.04.2026');
});

test('a reflection of the current turn still updates the next actions', () => {
  let state = createCaseState();
  state = applyCaseUpdate(state, { nextActions: [action('offen')] }, { turn: 1 });
  const fresh = mergeReflection(state, {
    turn: state.turn,
    delta: { nextActions: [action('11.04.2026 bis 30.04.2026')] },
  });
  expect(fresh.nextActions[0].period).toBe('11.04.2026 bis 30.04.2026');
});
