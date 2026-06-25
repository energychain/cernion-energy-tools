'use strict';

const DEFAULT_EVIDENCE_REQUIREMENTS = Object.freeze([
  {
    id: 'technical_controllability_evidence',
    label: 'Technischer Nachweis der Steuerbarkeit',
    required: true,
  },
  {
    id: 'redispatch_scope_assessment',
    label: 'Redispatch-/Steuerbarkeitscheck-Fallabgrenzung',
    required: true,
  },
  {
    id: 'grid_operations_decision_basis',
    label: 'Netzbetriebliche Entscheidungsgrundlage',
    required: true,
  },
]);

const SOURCE_ACTIONS_NOT_CALLED = Object.freeze([
  'hitl.create',
  'grid-operations.executeControl',
  'redispatch.dispatch',
  'device-control.execute',
  'settlement.exportA96',
  'settlement.prepareBilling',
  'market-communication.send',
  'tariff.apply',
  'external.connector.call',
  'personal-agent.execute',
]);

function asNonEmptyString(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === 'string' ? item.trim() : item?.id || item?.name || item?.label || item?.type
    )
    .filter(Boolean);
}

function buildRedispatchReferenceRow(input = {}) {
  const responsibleRole = asNonEmptyString(input.responsibleRole, 'ROLE_NETZBETRIEB');
  const contributorRole = asNonEmptyString(input.contributorRole, 'ROLE_NETZPLANUNG');
  const rowId = asNonEmptyString(input.rowId, 'redispatch-steuerbarkeitscheck-reference');

  return {
    taskId: rowId,
    taskName: 'Technischer Steuerbarkeits-/Redispatch-Referenzprozess',
    controlCase: asNonEmptyString(input.controlCase, 'redispatch'),
    verantwortlich: [{ actorType: 'role', actorId: responsibleRole }],
    durchfuehrend: [{ actorType: 'role', actorId: 'ROLE_GRID_OPERATIONS' }],
    mitwirkend: [{ actorType: 'role', actorId: contributorRole }],
    information: [{ actorType: 'role', actorId: 'ROLE_ASSET_MANAGEMENT' }],
    evidenceRequirements: DEFAULT_EVIDENCE_REQUIREMENTS.map((requirement) => ({ ...requirement })),
    decisionPolicy: {
      onMissingEvidence: 'mandatory_human_decision',
      onConflictingSources: 'mandatory_human_decision',
    },
  };
}

function buildPositiveFollowUps({ evidenceGaps = [], missingAuditActor = false } = {}) {
  const fromGaps = evidenceGaps.map((gap) => ({
    missingDataPoint: gap.name,
    enablesDossierAddition:
      gap.positiveFollowUp?.enablesDossierAddition ||
      `Supplied ${gap.label || gap.name} can be added to the Redispatch reference evidence.`,
  }));

  if (missingAuditActor) {
    fromGaps.push({
      missingDataPoint: 'auditActor',
      enablesDossierAddition: 'Audit provenance can name the reference-process actor explicitly.',
    });
  }

  return fromGaps;
}

function buildEvidenceState(providedEvidence = []) {
  const provided = new Set(normalizeEvidence(providedEvidence));
  return DEFAULT_EVIDENCE_REQUIREMENTS.reduce((state, requirement) => {
    state[requirement.id] = provided.has(requirement.id) ? 'present' : 'missing';
    return state;
  }, {});
}

function buildRedispatchReferenceProcessInput(input = {}) {
  const row = buildRedispatchReferenceRow(input);
  const evidence = normalizeEvidence(input.evidence);
  const actor = asNonEmptyString(input.actor, null);
  const context = {
    evidence,
    referenceProcess: 'technical_redispatch_steuerbarkeitscheck',
    source: 'governance.redispatchReferenceProcess',
  };

  return {
    tenantId: asNonEmptyString(input.tenantId, 'public'),
    matrixId: asNonEmptyString(input.matrixId, 'redispatch-reference-matrix'),
    caseId: asNonEmptyString(input.caseId, 'redispatch-reference-case'),
    row,
    context,
    evidenceState: buildEvidenceState(evidence),
    actor,
    actorRole: asNonEmptyString(input.actorRole, 'ROLE_GOVERNANCE_REFERENCE_PROCESS'),
  };
}

function summarizeRedispatchReferenceProcess({ input, policyDecision, roleDerivation, auditRecord, verification }) {
  const requiresHumanDecision = Boolean(policyDecision?.requiresHumanDecision);
  const missingAuditActor = !input.actor;
  const positiveFollowUps = buildPositiveFollowUps({
    evidenceGaps: policyDecision?.evidenceGaps || [],
    missingAuditActor,
  });

  return {
    success: true,
    referenceProcess: 'technical_redispatch_steuerbarkeitscheck',
    safety: 'controlled_reference_write',
    sideEffects: 'local_audit_append_only',
    controlCase: input.row.controlCase,
    tenantId: input.tenantId,
    matrixId: input.matrixId,
    caseId: input.caseId,
    rowId: input.row.taskId,
    policyDecision,
    resolverRoles: {
      requiredResolverRoles: roleDerivation.requiredResolverRoles || [],
      contributorApprovalRoles: roleDerivation.contributorApprovalRoles || [],
      missingRoleMetadata: Boolean(roleDerivation.missingRoleMetadata),
      evidenceGaps: roleDerivation.evidenceGaps || [],
    },
    audit: {
      entry: auditRecord?.entry || null,
      verification: verification || null,
    },
    evidenceState: input.evidenceState,
    positiveFollowUps,
    nextReferenceAction: requiresHumanDecision
      ? 'create_hitl_item_for_derived_roles_reference_only'
      : 'continue_technical_reference_process',
    sourceActions: {
      notCalled: [...SOURCE_ACTIONS_NOT_CALLED],
    },
  };
}

module.exports = {
  DEFAULT_EVIDENCE_REQUIREMENTS,
  SOURCE_ACTIONS_NOT_CALLED,
  buildRedispatchReferenceProcessInput,
  buildRedispatchReferenceRow,
  summarizeRedispatchReferenceProcess,
  _private: {
    buildEvidenceState,
    buildPositiveFollowUps,
    normalizeEvidence,
  },
};
