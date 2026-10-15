'use strict';

const {
  visibleProject,
  componentClearance,
  componentStats,
  projectPrincipal,
  projectPrefix,
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
