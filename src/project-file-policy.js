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
const deletionEligibilities = [
  'not_eligible',
  'policy_definition_required',
  'blocked_incomplete_cleanup',
  'human_review_required',
];

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

function deletionEligibility(project) {
  // Advisory only (#898): no owner or Legal-Hold model exists yet, so no state can
  // ever be reported as deletable. Unknown states fail closed to human review.
  const blockers = ['responsibility_model_missing', 'legal_hold_model_missing'];
  if (project.deletion) {
    const known = ['pending', 'incomplete'].includes(project.deletion.status);
    blockers.unshift(known ? 'cleanup_incomplete' : 'unknown_deletion_state');
    return {
      eligibility: known ? 'blocked_incomplete_cleanup' : 'human_review_required',
      blockers,
    };
  }
  if (project.lifecycle === 'ingesting') {
    blockers.unshift('ingest_in_progress');
    return { eligibility: 'not_eligible', blockers };
  }
  if (project.lifecycle === 'archived') {
    blockers.unshift('archived_retention_policy_missing');
    return { eligibility: 'policy_definition_required', blockers };
  }
  if (project.lifecycle === 'ready') return { eligibility: 'policy_definition_required', blockers };
  blockers.unshift(project.lifecycle === 'degraded' ? 'degraded_lifecycle' : 'unknown_lifecycle');
  return { eligibility: 'human_review_required', blockers };
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function administrationRow(project) {
  // Callers pass only projects already filtered by visibleProject; the row carries
  // scalar labels and counts, never component payloads, handler names or ref ids.
  const refs = Array.isArray(project.projectRefs) ? project.projectRefs : [];
  const members = Array.isArray(project.members) ? project.members.map(String) : [];
  const { eligibility, blockers } = deletionEligibility(project);
  return {
    projectId: String(project.projectId),
    title: String(project.title ?? ''),
    lifecycle: lifecycles.includes(project.lifecycle) ? project.lifecycle : 'unknown',
    updatedAt: String(project.updatedAt ?? ''),
    responsibility: {
      projection: 'legacy_responsibility_projection',
      grantsAuthority: false,
      createdBy: String(project.createdBy ?? ''),
      members,
    },
    stats: Object.fromEntries(statNames.map((name) => [name, count(project.stats?.[name])])),
    requiredClearance: (project.requiredClearance || []).map(String),
    linkedCaseCount: new Set(refs.map((ref) => ref.caseId).filter(Boolean)).size,
    linkedConversationCount: new Set(refs.map((ref) => ref.conversationId).filter(Boolean)).size,
    deletionState: project.deletion
      ? ['pending', 'incomplete'].includes(project.deletion.status)
        ? project.deletion.status
        : 'unknown'
      : 'none',
    failedCleanupCount: count(project.deletion?.failedHandlers?.length),
    deletionEligibility: eligibility,
    blockers,
    nextGate: 'human_policy_design_review',
  };
}

module.exports = {
  storeCapability,
  fileCapability,
  lifecycles,
  statNames,
  idParam,
  deletionEligibilities,
  projectPrefix,
  visibleProject,
  notFound,
  projectPrincipal,
  componentClearance,
  componentStats,
  publicProject,
  deletionEligibility,
  administrationRow,
};
