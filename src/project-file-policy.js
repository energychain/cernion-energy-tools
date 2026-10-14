'use strict';

const { Errors } = require('moleculer');
const { principal, visible, deny } = require('./domain-router-policy');
const {
  canViewEvidence,
  assertSensitivityAllowed,
  SENSITIVITY_LEVELS,
} = require('./workbench-evidence');

const storeCapability = Symbol('project-file-store');
const fileCapability = Symbol('project-file-originals');
const lifecycles = ['ingesting', 'ready', 'degraded', 'archived'];
const statNames = ['files', 'bytes', 'datasets', 'nodes', 'edges'];
const idParam = { type: 'string', min: 1, max: 200 };

function projectPrefix(tenantId) {
  // The hyphenated root cannot be addressed by generic Object Store namespaces; encoding
  // keeps the tenant segment free of ':' so tenant ranges never overlap.
  return `project-file:${encodeURIComponent(tenantId)}:`;
}

function visibleProject(project, p) {
  return (
    visible(p, { tenantId: project.tenantId }) &&
    (!project.members?.length || project.members.includes(p.actorId)) &&
    (project.requiredClearance || []).every((sensitivityLevel) =>
      canViewEvidence({ tenantId: project.tenantId, sensitivityLevel }, p.clearance, p.tenantId)
    )
  );
}

function notFound() {
  throw new Errors.MoleculerClientError('Project not found', 404, 'PROJECT_NOT_FOUND');
}

function projectPrincipal(ctx) {
  const p = principal(ctx);
  if (ctx.params.tenantId && ctx.params.tenantId !== p.tenantId) notFound();
  return p;
}

function componentClearance(components, p) {
  const levels = new Set();
  for (const component of Object.values(components)) {
    for (const level of [component.sensitivityLevel, ...(component.requiredClearance || [])]) {
      if (!SENSITIVITY_LEVELS.has(level)) deny('Invalid component sensitivity');
      assertSensitivityAllowed(level, p.clearance);
      levels.add(level);
    }
  }
  // Clearances are independent grants in the existing policy, not an implied hierarchy.
  // Retain every constituent requirement so a higher label cannot erase a lower grant.
  return [...SENSITIVITY_LEVELS].filter((level) => levels.has(level));
}

function componentStats(components) {
  return Object.fromEntries(
    statNames.map((name) => [
      name,
      Object.values(components).reduce((sum, component) => sum + (component.stats?.[name] || 0), 0),
    ])
  );
}

function publicProject(project) {
  const { _id, _rev, components, cleanupActions, ...record } = project;
  return record;
}

module.exports = {
  storeCapability,
  fileCapability,
  lifecycles,
  statNames,
  idParam,
  projectPrefix,
  visibleProject,
  notFound,
  projectPrincipal,
  componentClearance,
  componentStats,
  publicProject,
};
