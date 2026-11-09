'use strict';

// Conversation scope (TWL CTX-01): other conversations and cases enter an answer only when the
// person asks for the tenant's knowledge or names a reference from that material.
const { scopeEvidence } = require('../src/workbench-context-scope');

const doc = (value, refs) => ({
  source: 'tenant-documents',
  retrievalSource: 'tenant-documents',
  value,
  metadata: { workbenchDocument: 'd', documentRefs: refs },
});
const here = { conversationId: 'chat-a', caseId: 'case-a' };
const evidence = [
  doc('Eigenes Protokoll MARKER-A-1001', [{ conversationId: 'chat-a' }]),
  doc('Fremdes Protokoll MARKER-B-2002', [{ conversationId: 'chat-b', caseId: 'case-b' }]),
  doc('Beiden Gesprächen bekannt', [{ conversationId: 'chat-b' }, { conversationId: 'chat-a' }]),
  doc('Fall-Unterlage', [{ conversationId: 'chat-c', caseId: 'case-a' }]),
  {
    source: 'related_case',
    value: 'Fall F-9: offen. MARKER-C-3003',
    metadata: { cetCaseId: 'case-c' },
  },
  {
    source: 'tenant-memory',
    retrievalSource: 'tenant-memory',
    value: 'anna hat festgehalten …',
    metadata: {},
  },
  { source: 'knowledge-rag', value: 'Regelwerk', metadata: {} },
  {
    source: 'Protokoll.txt',
    retrievalSource: 'documents',
    value: 'Vorheriger Turn',
    metadata: { conversationState: true },
  },
];
const values = (result) => result.evidence.map((hit) => hit.value);

test('by default only this conversation, its case and non-conversation sources remain', () => {
  const result = scopeEvidence(evidence, {
    ...here,
    message: 'Fasse den Stand zusammen.',
    situation: {},
  });
  expect(values(result)).toEqual([
    'Eigenes Protokoll MARKER-A-1001',
    'Beiden Gesprächen bekannt',
    'Fall-Unterlage',
    'anna hat festgehalten …',
    'Regelwerk',
    'Vorheriger Turn',
  ]);
  expect(result.withheld).toBe(2);
});

test('a named reference admits the matching foreign material with its origin', () => {
  const result = scopeEvidence(evidence, {
    ...here,
    message: 'Was steht zu MARKER-B-2002?',
    situation: {},
  });
  const foreign = result.evidence.find((hit) => hit.value.includes('MARKER-B-2002'));
  expect(foreign.source).toBe('tenant-documents');
  expect(foreign.value).toBe('Fremdes Protokoll MARKER-B-2002');
  expect(foreign.metadata.scopeOrigin).toBe('aus anderem Gespräch');
  expect(values(result)).not.toContain('Fall F-9: offen. MARKER-C-3003');
  const named = scopeEvidence(evidence, {
    ...here,
    message: 'Wie steht es dort?',
    situation: { identifiers: [{ kind: 'case', value: 'Fall F-9' }] },
  });
  expect(
    named.evidence.find((hit) => hit.metadata?.scopeOrigin === 'aus anderem Fall')
  ).toBeTruthy();
});

test('an explicit request for the tenant knowledge admits all foreign material, labelled', () => {
  for (const situation of [
    { selfKnowledge: { requested: true } },
    { caseSearch: { requested: true } },
    { contextScope: 'tenant' },
  ]) {
    const result = scopeEvidence(evidence, { ...here, message: 'Was wissen wir dazu?', situation });
    expect(result.withheld).toBe(0);
    expect(result.evidence.filter((hit) => hit.metadata?.scopeOrigin)).toHaveLength(2);
  }
});

test('without a conversation, stored documents with an origin count as foreign', () => {
  const result = scopeEvidence([doc('X', [{ conversationId: 'chat-b' }]), doc('Y', [])], {
    message: '',
    situation: {},
  });
  expect(values(result)).toEqual(['Y']);
});

test('a question about this conversation keeps to its own material, even as a knowledge question', () => {
  const result = scopeEvidence(evidence, {
    ...here,
    message: 'Fasse den Stand dieses Gesprächs zusammen und nenne alle Marker.',
    situation: {
      conversationShape: 'knowledge',
      turnKind: 'knowledge',
      contextScope: 'conversation',
    },
  });
  expect(result.withheld).toBe(2);
});

test('knowledge-search case hits from another case are foreign; the own case is not (CTX-01)', () => {
  const { scopeEvidence, OTHER_CASE } = require('../src/workbench-context-scope');
  const own = {
    source: 'cases',
    value: 'Fall F-1: eigener Stand',
    metadata: { caseId: 'case-own' },
  };
  const other = {
    source: 'cases',
    value: 'Fall F-2: anderer Stand',
    metadata: { caseId: 'case-other' },
  };
  const { evidence, withheld } = scopeEvidence([own, other], {
    conversationId: 'chat',
    caseId: 'case-own',
    message: 'Welche Angaben liegen dir zu diesem Fall vor?',
    situation: { selfKnowledge: { requested: true }, contextScope: 'tenant' },
  });
  expect(evidence[0]).toBe(own);
  expect(evidence[1].metadata.scopeOrigin).toBe(OTHER_CASE);
  expect(withheld).toBe(0);
});
