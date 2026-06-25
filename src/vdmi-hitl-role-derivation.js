'use strict';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRoleId(value) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (!isPlainObject(value)) {
    return '';
  }

  return String(
    value.actorId ||
      value.roleId ||
      value.role ||
      value.id ||
      value.personaId ||
      value.name ||
      value.displayName ||
      ''
  ).trim();
}

function uniqueRoleIds(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeRoleId(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function roleArray(row, fieldName) {
  const value = row?.[fieldName];
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function shouldRequireContributorApproval(decisionPolicy = {}) {
  if (!isPlainObject(decisionPolicy)) return false;
  return (
    decisionPolicy.requireContributorApproval === true ||
    decisionPolicy.requiresContributorApproval === true ||
    decisionPolicy.requireMitwirkendApproval === true ||
    decisionPolicy.requiresMitwirkendApproval === true ||
    decisionPolicy.multiPartyApproval === true ||
    decisionPolicy.approvalMode === 'responsible_and_contributors' ||
    decisionPolicy.approvalMode === 'multi_party'
  );
}

function deriveHitlResolverRoles(input = {}) {
  const row = isPlainObject(input.row) ? input.row : {};
  const hasExplicitDecisionPolicy =
    isPlainObject(input.decisionPolicy) && Object.keys(input.decisionPolicy).length > 0;
  const decisionPolicy = hasExplicitDecisionPolicy
    ? input.decisionPolicy
    : isPlainObject(row.decisionPolicy)
      ? row.decisionPolicy
      : {};
  const fallbackRoles = uniqueRoleIds(input.fallbackRoles || []);

  const responsibleRoles = uniqueRoleIds([
    ...roleArray(row, 'verantwortlich'),
    ...roleArray(row, 'responsible'),
    ...roleArray(row, 'accountable'),
  ]);
  const contributorRoles = uniqueRoleIds([
    ...roleArray(row, 'mitwirkend'),
    ...roleArray(row, 'contributors'),
    ...roleArray(row, 'contributing'),
  ]);
  const contributorApprovalRequired = shouldRequireContributorApproval(decisionPolicy);
  const contributorApprovalRoles = contributorApprovalRequired ? contributorRoles : [];
  const missingResponsibleRoles = responsibleRoles.length === 0;
  const fallbackUsed = missingResponsibleRoles && fallbackRoles.length > 0;
  const requiredResolverRoles = fallbackUsed ? fallbackRoles : responsibleRoles;
  const evidenceGaps = [];

  if (missingResponsibleRoles) {
    evidenceGaps.push({
      name: 'vdmi_row_verantwortlich',
      source: 'row.verantwortlich',
      reason: 'missing_responsible_role_metadata',
      positiveFollowUp: {
        missingDataPoint: 'row.verantwortlich',
        enablesDossierAddition: 'HITL resolver roles can be derived from VDMI row ownership',
      },
    });
  }

  if (contributorRoles.length > 0 && !contributorApprovalRequired) {
    evidenceGaps.push({
      name: 'vdmi_contributor_approval_policy',
      source: 'decisionPolicy',
      reason: 'contributors_present_without_multi_party_policy',
      positiveFollowUp: {
        missingDataPoint: 'decisionPolicy.multiPartyApproval',
        enablesDossierAddition:
          'Mitwirkend roles can be carried as contributor approval requirements',
      },
    });
  }

  let reason = 'vdmi_roles_derived';
  if (fallbackUsed) reason = 'fallback_roles_used';
  if (requiredResolverRoles.length === 0) reason = 'missing_vdmi_role_metadata';

  return {
    success: true,
    safety: 'read_only_role_derivation',
    sideEffects: 'none',
    requiredResolverRoles,
    contributorApprovalRoles,
    responsibleRoles,
    contributorRoles,
    contributorApprovalRequired,
    fallbackUsed,
    missingRoleMetadata: missingResponsibleRoles,
    reason,
    sourceFields: {
      responsible: responsibleRoles.length > 0 ? ['row.verantwortlich'] : [],
      contributors: contributorRoles.length > 0 ? ['row.mitwirkend'] : [],
      decisionPolicy: Object.keys(decisionPolicy).length > 0 ? ['decisionPolicy'] : [],
      fallback: fallbackUsed ? ['fallbackRoles'] : [],
    },
    evidenceGaps,
    context: isPlainObject(input.context) ? input.context : {},
  };
}

module.exports = {
  deriveHitlResolverRoles,
  shouldRequireContributorApproval,
};
