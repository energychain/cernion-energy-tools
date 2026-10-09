'use strict';
const {
  classifyWorkbenchIntent,
  renderWorkbenchResponse,
} = require('../src/workbench-intent-router');

const modes = [
  ['What is the status of case-1?', 'status_query'],
  ['What does APERAK Z18 mean?', 'knowledge_query'],
  ['Show open MaKo cases', 'data_lookup'],
  ['Start a new clarification case for MSCONS', 'case_start'],
  ['Start a new case for missing evidence', 'case_start'],
  ['Continue case-1 with this evidence', 'case_followup'],
  ['Compare the options and recommend a next step', 'decision_support'],
  ['Run the CET web fetch tool', 'tool_run_request'],
];
const policy =
  'Routing advice only. Knowledge hits are unverified routing hints. Obtain evidence and human review; never claim approval, booking or binding regulatory decisions.';

describe('Workbench intent routing', () => {
  test.each(modes)('%s -> %s', (message, mode) => {
    expect(classifyWorkbenchIntent(message)).toBe(mode);
  });
  test.each([
    ['Was bedeutet CONTRL?', 'knowledge_query'],
    ['Zeige offene Fälle', 'data_lookup'],
    ['Starte einen neuen Klärfall', 'case_start'],
    ['Hier sind weitere Belege für case-1', 'case_followup'],
    ['Führe das Mail Tool aus', 'tool_run_request'],
    ['Suche Mail Belege', 'tool_run_request'],
    ['Was ist der Bearbeitungsstand?', 'status_query'],
    ['Bewerte die Optionen', 'decision_support'],
    ['MSCONS fehlt, was ist der nächste sichere Schritt?', 'decision_support'],
    ['What is the recommended next step?', 'decision_support'],
    ['Lookup evidence in Willi-MaKo', 'tool_run_request'],
  ])('German: %s -> %s', (message, mode) => {
    expect(classifyWorkbenchIntent(message)).toBe(mode);
  });
  test('case metadata does not override explicit knowledge, status or assessment intent', () => {
    expect(classifyWorkbenchIntent('Here is the document', { cetCaseId: 'case-1' })).toBe(
      'case_followup'
    );
    expect(classifyWorkbenchIntent('What is MSCONS?', { cetCaseId: 'case-1' })).toBe(
      'knowledge_query'
    );
    expect(classifyWorkbenchIntent('Compare options', { cetCaseId: 'case-1' })).toBe(
      'decision_support'
    );
  });
  test.each(modes)('never renders internal routing guidance for %s', (_message, mode) => {
    const content = renderWorkbenchResponse(
      { responseText: policy, missingEvidence: [policy, { label: 'MSCONS' }] },
      mode
    );
    expect(content).not.toMatch(/Routing advice only|unverified routing hints/i);
    expect(content).toBeTruthy();
  });
  test('renders case status and safe action from structured fields', () => {
    const content = renderWorkbenchResponse(
      {
        cetCaseId: 'case-1',
        status: 'waiting',
        readinessState: 'evidence_required',
        eventSummary: { pending: 2 },
        missingEvidence: [{ label: 'MSCONS' }],
        allowedActions: ['provide_evidence'],
      },
      'status_query'
    );
    expect(content).toContain('Offene Ereignisse: 2');
    expect(content).toContain('Fehlende Nachweise: MSCONS');
    expect(content).toContain('Nächste Schritte: provide_evidence');
  });
  test('German status and colleague response guard keeps natural replies and German empty-state text', () => {
    expect(classifyWorkbenchIntent('Wer hat das bisher bearbeitet und was ist der Stand?')).toBe(
      'status_query'
    );
    expect(classifyWorkbenchIntent('Wer hat das angelegt?')).toBe('status_query');
    const reply =
      'Angelegt von actor-a, zuletzt bearbeitet am 01.01.2026. Stand: Die Bearbeitung ist offen.';
    expect(renderWorkbenchResponse({ responseText: reply }, 'status_query')).toBe(reply);
    for (const intent of ['status_query', 'knowledge_query', 'data_lookup', 'tool_run_request'])
      expect(renderWorkbenchResponse({}, intent)).not.toMatch(
        /Please|provide|No matching|Non-binding|Tool requests|verified explanation|Readiness|Missing evidence/u
      );
  });

  test('preserves finished Markdown replies', () => {
    expect(
      renderWorkbenchResponse(
        { responseText: '## Explanation\n\nAPERAK details.' },
        'knowledge_query'
      )
    ).toBe('## Explanation\n\nAPERAK details.');
  });
  test('does not expose policy embedded in list titles', () => {
    expect(
      renderWorkbenchResponse(
        { items: [{ title: policy }, { title: 'MaKo case', status: 'waiting' }] },
        'data_lookup'
      )
    ).toBe('- MaKo case (waiting)');
  });
});

test('renders case IDs when generated titles contain internal policy', () => {
  expect(
    renderWorkbenchResponse(
      { items: [{ title: policy, caseId: 'case-1', status: 'waiting' }] },
      'data_lookup'
    )
  ).toBe('- case-1 (waiting)');
});

const { resolveWorkbenchFollowup } = require('../src/workbench-intent-router');
const followups = [
  [
    'Was ist in der MaKo ein APERAK?',
    'Ich habe eine solche mit Z10 vom Marktpartner empfangen.',
    'AHB-Version',
  ],
  [
    'Was ist eine Ersatzwertbildung?',
    'Wir haben so einen Wert in der Zeitreihe.',
    'Qualitätskennzeichen',
  ],
  [
    'Was ist ein Evidence Gate in der Zielnetzplanung?',
    'Unser Ausbaupfad hängt dort.',
    'Gate-Kriterien',
  ],
  ['Was bedeutet N-1 verletzt?', 'Das steht bei einer Leitung im Bericht.', 'Ausfallszenario'],
];
describe('contextual knowledge follow-ups', () => {
  test.each(followups)('%s -> %s', (topic, message, detail) => {
    const recentMessages = [{ role: 'user', content: topic }];
    const context = resolveWorkbenchFollowup(message, { recentMessages });
    expect(classifyWorkbenchIntent(message, { recentMessages, cetCaseId: 'case-1' })).toBe(
      'knowledge_query'
    );
    for (const responseText of [policy, '', 'Case: case-1\nReadiness: evidence_required']) {
      const content = renderWorkbenchResponse({ responseText }, 'knowledge_query', context);
      expect(content).toContain(detail);
      expect(content).not.toMatch(/Routing advice only|Case:|Readiness:/);
    }
  });
  test.each([
    ['Lege einen Fall an', 'case_start'],
    ['Was soll ich tun?', 'decision_support'],
    ['Bewerte die Optionen', 'decision_support'],
    ['Prüfe den Case', 'case_followup'],
    ['Run the web fetch tool for that', 'tool_run_request'],
  ])('explicit action wins: %s', (message, intent) => {
    expect(
      classifyWorkbenchIntent(message, {
        recentMessages: [{ role: 'user', content: followups[0][0] }],
      })
    ).toBe(intent);
  });
  test('does not borrow system or assistant topics, stale topics or long messages', () => {
    const message = followups[0][1];
    expect(
      resolveWorkbenchFollowup(message, {
        recentMessages: [
          { role: 'system', content: followups[0][0] },
          { role: 'assistant', content: followups[0][0] },
        ],
      })
    ).toBeNull();
    expect(
      resolveWorkbenchFollowup(message, {
        recentMessages: [
          { role: 'user', content: followups[0][0] },
          { role: 'user', content: 'Compare grid options' },
        ],
      })
    ).toBeNull();
    expect(
      resolveWorkbenchFollowup(message.repeat(10), {
        recentMessages: [{ role: 'user', content: followups[0][0] }],
      })
    ).toBeNull();
    expect(classifyWorkbenchIntent(message)).toBe('decision_support');
  });
  test('carries the observation through a second anaphoric explanation', () => {
    const recentMessages = [
      { role: 'user', content: followups[0][0] },
      { role: 'user', content: followups[0][1] },
    ];
    const context = resolveWorkbenchFollowup('Was bedeutet das?', { recentMessages });
    expect(context.observations).toEqual([followups[0][1]]);
    expect(renderWorkbenchResponse({}, 'knowledge_query', context)).toContain('Z10');
  });
});

test('context does not override explicit continuation or a new named topic', () => {
  const recentMessages = [{ role: 'user', content: 'Was ist ein APERAK?' }];
  expect(classifyWorkbenchIntent('Continue that case', { recentMessages })).toBe('case_followup');
  expect(resolveWorkbenchFollowup('Was ist das Evidence Gate?', { recentMessages })).toBeNull();
  expect(classifyWorkbenchIntent('Was ist das Evidence Gate?', { recentMessages })).toBe(
    'knowledge_query'
  );
});
