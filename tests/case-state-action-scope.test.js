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

test('an id reused for different work becomes a new task; the earlier one stays (REG-01 A1)', () => {
  let state = applyCaseUpdate(
    createCaseState(),
    {
      nextActions: [task({ action: 'Erstellung der Evidenzmatrix mit Transport und Fachantwort' })],
    },
    { turn: 1 }
  );
  state = applyCaseUpdate(
    state,
    {
      nextActions: [
        task({ actionId: 'A1', action: 'Gezielte Suche nach dem OCR-Kandidaten im Archiv' }),
      ],
    },
    { turn: 2 }
  );
  const actions = state.nextActions.map((row) => [row.actionId, row.action]);
  expect(actions).toEqual(
    expect.arrayContaining([
      ['A1', 'Erstellung der Evidenzmatrix mit Transport und Fachantwort'],
      ['A2', 'Gezielte Suche nach dem OCR-Kandidaten im Archiv'],
    ])
  );
  expect(state.violations.some((row) => row.rule === 'task_id_reused')).toBe(true);
});

test('a reworded but unchanged task keeps the turn it last changed', () => {
  let state = applyCaseUpdate(createCaseState(), { nextActions: [task()] }, { turn: 1 });
  state = applyCaseUpdate(
    state,
    {
      nextActions: [
        task({ actionId: 'A1', action: 'Getrennte Suche nach der Lesevariante durchführen' }),
      ],
    },
    { turn: 2 }
  );
  expect(state.nextActions[0].updatedAtTurn).toBe(1);
  state = applyCaseUpdate(
    state,
    {
      nextActions: [
        task({
          actionId: 'A1',
          period: '11.04.2026 bis 15.05.2026',
          scopeChangeReason: 'Die Person hat den Zeitraum erweitert.',
        }),
      ],
    },
    { turn: 3 }
  );
  expect(state.nextActions[0].updatedAtTurn).toBe(3);
});

describe('company method of the case (process card and station)', () => {
  const { updateCaseState } = require('../src/case-state');
  const llm = (methodUpdate) => ({
    generateStructured: jest.fn().mockResolvedValue({ nextActions: [], methodUpdate }),
  });
  const lastAnswer =
    'Nach der Arbeitsmethode TK-100 Prüfkarte Eingang stehen wir an Station S2 Zuordnung.';

  test('a card enters only with a literal quote from the sources that names it', async () => {
    const quoted = await updateCaseState(
      createCaseState(),
      { message: 'Weiter.', lastAnswer },
      {
        llm: llm({
          set: true,
          card: 'TK-100 Prüfkarte Eingang',
          station: 'S2 Zuordnung',
          quote: 'Arbeitsmethode TK-100 Prüfkarte Eingang',
          reason: '',
        }),
      }
    );
    expect(caseStateView(quoted).method).toMatchObject({
      card: 'TK-100 Prüfkarte Eingang',
      station: 'S2 Zuordnung',
    });
    const unquoted = await updateCaseState(
      createCaseState(),
      { message: 'Weiter.', lastAnswer },
      {
        llm: llm({
          set: true,
          card: 'TK-900 Erfundene Karte',
          station: 'S1',
          quote: 'TK-900 Erfundene Karte',
          reason: '',
        }),
      }
    );
    expect(caseStateView(unquoted).method).toBeNull();
  });

  test('the card stays unless a reason is given; the station moves on', () => {
    let state = applyCaseUpdate(
      createCaseState(),
      { methodUpdate: { set: true, card: 'TK-100 Prüfkarte', station: 'S1 Signal' } },
      { turn: 1 }
    );
    state = applyCaseUpdate(
      state,
      { methodUpdate: { set: true, card: 'TK-100 Prüfkarte', station: 'S3 Status' } },
      { turn: 2 }
    );
    expect(state.method).toMatchObject({
      card: 'TK-100 Prüfkarte',
      station: 'S3 Status',
      since: 1,
    });
    state = applyCaseUpdate(
      state,
      { methodUpdate: { set: true, card: 'TK-200 Andere Karte', station: 'S1' } },
      { turn: 3 }
    );
    expect(state.method.card).toBe('TK-100 Prüfkarte');
    expect(state.violations.some((row) => row.rule === 'silent_method_change')).toBe(true);
    state = applyCaseUpdate(
      state,
      {
        methodUpdate: {
          set: true,
          card: 'TK-200 Andere Karte',
          station: 'S1',
          reason: 'Die Person hat einen neuen Fallgegenstand genannt.',
        },
      },
      { turn: 4 }
    );
    expect(state.method).toMatchObject({ card: 'TK-200 Andere Karte', since: 4 });
  });
});

describe('artefact of the station and resolution value', () => {
  const { updateCaseState, artifactSection, resolutionSection } = require('../src/case-state');
  const evidence = [
    {
      source: 'Arbeitsmethode',
      content: 'Station S2 Zuordnung: Artefakt AF-7 Klärobjekt mit Befund, Optionen, Entscheider.',
    },
  ];
  const llm = (artifactUpdate) => ({
    generateStructured: jest.fn().mockResolvedValue({ nextActions: [], artifactUpdate }),
  });

  test('an artefact enters only when the sources name it, with its fields', async () => {
    const named = await updateCaseState(
      createCaseState(),
      { message: 'Weiter.', newEvidence: evidence },
      {
        llm: llm({
          set: true,
          artifact: 'AF-7 Klärobjekt',
          station: 'S2 Zuordnung',
          quote: 'Artefakt AF-7 Klärobjekt',
          fields: ['Befund', 'Optionen', 'Entscheider'],
        }),
      }
    );
    expect(caseStateView(named).artifact).toEqual({
      name: 'AF-7 Klärobjekt',
      station: 'S2 Zuordnung',
      fields: ['Befund', 'Optionen', 'Entscheider'],
    });
    const invented = await updateCaseState(
      createCaseState(),
      { message: 'Weiter.', newEvidence: evidence },
      {
        llm: llm({
          set: true,
          artifact: 'AF-9 Eigene Vorlage',
          station: 'S2',
          quote: 'AF-9 Eigene Vorlage',
          fields: [],
        }),
      }
    );
    expect(caseStateView(invented).artifact).toBeNull();
  });

  test('the resolution value needs both sides and is carried until stated anew', () => {
    let state = applyCaseUpdate(
      createCaseState(),
      { resolutionValue: { set: true, ifClarified: 'Vorgang läuft weiter', ifNotClarified: '' } },
      { turn: 1 }
    );
    expect(state.resolution).toBeNull();
    state = applyCaseUpdate(
      state,
      {
        resolutionValue: {
          set: true,
          ifClarified: 'Vorgang läuft weiter',
          ifNotClarified: 'Vorgang bleibt stehen',
          measuredBy: 'offenes Volumen, beziffert durch die zuständige Funktion',
        },
      },
      { turn: 2 }
    );
    state = applyCaseUpdate(state, { resolutionValue: { set: false } }, { turn: 3 });
    expect(caseStateView(state).resolution).toEqual({
      ifClarified: 'Vorgang läuft weiter',
      ifNotClarified: 'Vorgang bleibt stehen',
      measuredBy: 'offenes Volumen, beziffert durch die zuständige Funktion',
    });
    // Stated in the turn it changed (2), not repeated in turn 3.
    expect(resolutionSection(state)).toBe('');
    expect(resolutionSection({ ...state, turn: 2 })).toContain(
      '- Ohne Klärung: Vorgang bleibt stehen'
    );
    const reworded = applyCaseUpdate(
      state,
      {
        resolutionValue: {
          set: true,
          ifClarified: 'Der Vorgang läuft weiter',
          ifNotClarified: 'Der Vorgang bleibt stehen',
          measuredBy: '',
        },
      },
      { turn: 4 }
    );
    expect(reworded.resolution.changedAt).toBe(2);
  });

  test('the artefact is filled once per new station and rendered as a table', async () => {
    const state = applyCaseUpdate(
      createCaseState(),
      {
        artifactUpdate: {
          set: true,
          artifact: 'AF-7 Klärobjekt',
          station: 'S2',
          quote: '',
          fields: ['Befund', 'Optionen'],
        },
      },
      { turn: 1 }
    );
    const generateStructured = jest.fn().mockResolvedValue({
      rows: [
        { field: 'Befund', content: 'Ablehnung liegt vor', status: 'belegt', origin: 'Quittung' },
        { field: 'Optionen', content: 'Nachforderung | Eskalation', status: 'Annahme', origin: '' },
      ],
    });
    const section = await artifactSection(state, { llm: { generateStructured } });
    expect(section).toContain('### AF-7 Klärobjekt (S2)');
    expect(section).toContain('| Befund | Ablehnung liegt vor | belegt | Quittung |');
    expect(section).toContain('| Optionen | Nachforderung / Eskalation | Annahme | – |');
    expect(generateStructured.mock.calls[0][1]).toContain('"fields":["Befund","Optionen"]');
    // Same artefact and station in the next turn: nothing to deliver, no call.
    const next = applyCaseUpdate(
      state,
      { artifactUpdate: { set: true, artifact: 'AF-7 Klärobjekt', station: 'S2', fields: [] } },
      { turn: 2 }
    );
    expect(await artifactSection(next, { llm: { generateStructured } })).toBe('');
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });
});
