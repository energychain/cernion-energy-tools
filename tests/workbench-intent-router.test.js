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
    expect(content).toContain('Pending events: 2');
    expect(content).toContain('Missing evidence: MSCONS');
    expect(content).toContain('Next safe actions: provide_evidence');
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
