'use strict';

const {
  visibleProject,
  componentClearance,
  componentStats,
  projectPrincipal,
  projectPrefix,
  deletionEligibilities,
  deletionEligibility,
  administrationRow,
} = require('../src/project-file-policy');
const { auth } = require('./helpers/case-linking-broker');

test('visibility reuses tenant, member and independent evidence clearance gates', () => {
  const p = { tenantId: 'tenant-a', actorId: 'actor-a', clearance: [] };
  const project = { tenantId: 'tenant-a', requiredClearance: ['public', 'tenant_internal'] };
  expect(visibleProject(project, p)).toBe(true);
  expect(visibleProject({ ...project, tenantId: 'tenant-b' }, p)).toBe(false);
  expect(visibleProject({ ...project, members: ['actor-b'] }, p)).toBe(false);
  expect(visibleProject({ ...project, members: [] }, p)).toBe(true);
  expect(visibleProject({ ...project, requiredClearance: ['restricted'] }, p)).toBe(false);
  expect(
    visibleProject(
      { ...project, requiredClearance: ['restricted', 'highly_sensitive'] },
      { ...p, clearance: ['highly_sensitive'] }
    )
  ).toBe(false);
  expect(
    visibleProject(
      { ...project, requiredClearance: ['restricted', 'highly_sensitive'] },
      { ...p, clearance: ['restricted', 'highly_sensitive'] }
    )
  ).toBe(true);
});

test('component join retains every grant, validates levels and sums the data contract stats', () => {
  const p = { clearance: ['restricted', 'highly_sensitive'] };
  const components = {
    original: { sensitivityLevel: 'tenant_internal', stats: { files: 1, bytes: 20 } },
    derived: { sensitivityLevel: 'restricted', stats: { datasets: 1 } },
    manifest: {
      sensitivityLevel: 'highly_sensitive',
      requiredClearance: ['restricted'],
      stats: { nodes: 3, edges: 2 },
    },
  };
  expect(componentClearance(components, p)).toEqual([
    'tenant_internal',
    'restricted',
    'highly_sensitive',
  ]);
  expect(componentStats(components)).toEqual({
    files: 1,
    bytes: 20,
    datasets: 1,
    nodes: 3,
    edges: 2,
  });
  expect(componentClearance({}, p)).toEqual([]);
  expect(() => componentClearance(components, { clearance: [] })).toThrow();
  expect(() => componentClearance({ invalid: { sensitivityLevel: 'unknown' } }, p)).toThrow();
});

test('authenticated principal cannot be replaced by caller tenant or meta tenant', () => {
  expect(projectPrincipal({ meta: { ...auth(), tenantId: 'foreign' }, params: {} }).tenantId).toBe(
    'tenant-a'
  );
  expect(() => projectPrincipal({ meta: auth(), params: { tenantId: 'foreign' } })).toThrow(
    expect.objectContaining({ code: 404 })
  );
  expect(() => projectPrincipal({ meta: { tenantId: 'tenant-a' }, params: {} })).toThrow();
  expect(projectPrefix('tenant-a')).not.toBe(projectPrefix('tenant-b'));
  expect(projectPrefix('default')).not.toBe(projectPrefix('tenant:default'));
});

test('#898 advisory deletion eligibility fails closed and never reports a deletable state', () => {
  const cases = [
    [{ lifecycle: 'ready' }, 'policy_definition_required', []],
    [
      { lifecycle: 'archived' },
      'policy_definition_required',
      ['archived_retention_policy_missing'],
    ],
    [{ lifecycle: 'ingesting' }, 'not_eligible', ['ingest_in_progress']],
    [{ lifecycle: 'degraded' }, 'human_review_required', ['degraded_lifecycle']],
    [{ lifecycle: 'future' }, 'human_review_required', ['unknown_lifecycle']],
    [{}, 'human_review_required', ['unknown_lifecycle']],
    [
      { lifecycle: 'ready', deletion: { status: 'incomplete' } },
      'blocked_incomplete_cleanup',
      ['cleanup_incomplete'],
    ],
    [
      { lifecycle: 'archived', deletion: { status: 'pending' } },
      'blocked_incomplete_cleanup',
      ['cleanup_incomplete'],
    ],
    [
      { lifecycle: 'ready', deletion: { status: 'odd' } },
      'human_review_required',
      ['unknown_deletion_state'],
    ],
  ];
  for (const [project, eligibility, extra] of cases) {
    expect(deletionEligibility(project)).toEqual({
      eligibility,
      blockers: [...extra, 'responsibility_model_missing', 'legal_hold_model_missing'],
    });
  }
  expect(deletionEligibilities).toEqual([
    'not_eligible',
    'policy_definition_required',
    'blocked_incomplete_cleanup',
    'human_review_required',
  ]);
});

test('#898 administration row is scalar, labels legacy responsibility and drops payloads', () => {
  const row = administrationRow({
    _id: 'internal',
    _rev: '1-x',
    projectId: 'p-1',
    tenantId: 'tenant-a',
    title: 'Synthetic',
    lifecycle: 'ready',
    createdBy: 'actor-a',
    members: ['actor-a', 'actor-b'],
    requiredClearance: ['restricted'],
    projectRefs: [{ caseId: 'case-a' }, { caseId: 'case-a', conversationId: 'chat-a' }],
    stats: { files: 2, bytes: -5, datasets: 'x', nodes: 1 },
    components: { 'component:secret': { stats: { files: 2 }, cleanupAction: 'secret.cleanup' } },
    cleanupActions: ['secret.cleanup'],
    deletion: { status: 'incomplete', failedHandlers: ['secret.cleanup'] },
    updatedAt: '2026-10-21T00:00:00.000Z',
  });
  expect(row).toEqual({
    projectId: 'p-1',
    title: 'Synthetic',
    lifecycle: 'ready',
    updatedAt: '2026-10-21T00:00:00.000Z',
    responsibility: {
      projection: 'legacy_responsibility_projection',
      grantsAuthority: false,
      createdBy: 'actor-a',
      members: ['actor-a', 'actor-b'],
    },
    stats: { files: 2, bytes: 0, datasets: 0, nodes: 1, edges: 0 },
    requiredClearance: ['restricted'],
    linkedCaseCount: 1,
    linkedConversationCount: 1,
    deletionState: 'incomplete',
    failedCleanupCount: 1,
    deletionEligibility: 'blocked_incomplete_cleanup',
    blockers: ['cleanup_incomplete', 'responsibility_model_missing', 'legal_hold_model_missing'],
    nextGate: 'human_policy_design_review',
  });
  expect(JSON.stringify(row)).not.toMatch(/secret|internal|1-x|tenant-a/);
  expect(administrationRow({ projectId: 'p-2', lifecycle: 'weird' })).toMatchObject({
    lifecycle: 'unknown',
    deletionState: 'none',
    deletionEligibility: 'human_review_required',
    responsibility: { createdBy: '', members: [] },
  });
});
