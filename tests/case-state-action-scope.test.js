'use strict';

const { applyCaseUpdate, caseStateView, createCaseState } = require('../src/case-state');

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

describe('task register', () => {
  const base = () =>
    applyCaseUpdate(
      createCaseState(),
      { nextActions: [task(), task({ action: 'Abgleich mit dem Index', searchSpace: 'Index' })] },
      { turn: 1 }
    );

  test('a task left out stays active; one ended with a reason is closed', () => {
    let state = applyCaseUpdate(base(), { nextActions: [task({ actionId: 'A1' })] }, { turn: 2 });
    expect(state.nextActions.map((row) => row.actionId)).toEqual(['A1', 'A2']);
    state = applyCaseUpdate(
      state,
      {
        nextActions: [task({ actionId: 'A1' })],
        taskUpdates: [
          { actionId: 'A2', status: 'withdrawn', reason: 'Beleg gehört zu einem anderen Vorgang' },
        ],
      },
      { turn: 3 }
    );
    expect(state.nextActions.map((row) => row.actionId)).toEqual(['A1']);
    expect(caseStateView(state).closedTasks).toEqual([
      expect.objectContaining({ action: 'Abgleich mit dem Index', status: 'withdrawn' }),
    ]);
  });

  test('a closed task does not return without a reopen reason', () => {
    let state = applyCaseUpdate(
      base(),
      {
        nextActions: [task({ actionId: 'A1' })],
        taskUpdates: [{ actionId: 'A2', status: 'withdrawn', reason: 'gegenstandslos' }],
      },
      { turn: 2 }
    );
    state = applyCaseUpdate(
      state,
      { nextActions: [task({ actionId: 'A1' }), task({ action: 'Abgleich mit dem Index' })] },
      { turn: 3 }
    );
    expect(state.nextActions.map((row) => row.action)).toEqual([
      'Getrennte Suche nach der Lesevariante',
    ]);
    expect(state.violations.some((row) => row.rule === 'closed_task_reopened')).toBe(true);
    state = applyCaseUpdate(
      state,
      {
        nextActions: [
          task({ actionId: 'A1' }),
          task({
            action: 'Abgleich mit dem Index',
            reopenReason: 'Die Person beauftragt den Abgleich erneut.',
          }),
        ],
      },
      { turn: 4 }
    );
    expect(state.nextActions.map((row) => row.action)).toContain('Abgleich mit dem Index');
    expect(caseStateView(state).closedTasks).toEqual([]);
  });
});

test('a task records the turn it last changed', () => {
  let state = applyCaseUpdate(createCaseState(), { nextActions: [task()] }, { turn: 1 });
  expect(state.nextActions[0].updatedAtTurn).toBe(1);
  state = applyCaseUpdate(state, { nextActions: [task({ actionId: 'A1' })] }, { turn: 2 });
  expect(state.nextActions[0].updatedAtTurn).toBe(1);
  state = applyCaseUpdate(
    state,
    { nextActions: [task({ actionId: 'A1', method: 'Abfrage im Originalindex' })] },
    { turn: 3 }
  );
  expect(state.nextActions[0].updatedAtTurn).toBe(3);
});
