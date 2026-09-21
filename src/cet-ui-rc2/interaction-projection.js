'use strict';

const { validatePresentationContract } = require('./presentation-contract-validator');

const CRITERION_STATES = Object.freeze(['erfuellt', 'offen', 'nicht_anwendbar']);

function uniqueStrings(values = []) {
  return Array.from(
    new Set(values.filter((value) => typeof value === 'string' && value.length > 0))
  );
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function normalizeCriterion(criterion) {
  assertPlainObject(criterion, 'decision criterion');
  if (!criterion.id) throw new Error('decision criterion must declare id');
  if (!CRITERION_STATES.includes(criterion.state)) {
    throw new Error('decision criterion state must be erfuellt, offen or nicht_anwendbar');
  }
  return {
    id: criterion.id,
    state: criterion.state,
    beeinflussbarDurch: uniqueStrings(criterion.beeinflussbarDurch || []),
    textKey: criterion.textKey || `rc2.decisionCriterion.${criterion.id}`,
    nextContributionTextKey:
      criterion.nextContributionTextKey || `rc2.nextContribution.${criterion.id}`,
  };
}

function buildDecisionDistance(criteria = []) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new Error('interaction projection requires decisionCriteria');
  }
  return {
    criteria: criteria.map(normalizeCriterion),
  };
}

function roleCanInfluenceCriterion(roleId, criterion) {
  return criterion.state === 'offen' && criterion.beeinflussbarDurch.includes(roleId);
}

function buildNextContribution(activeRoleId, decisionDistance) {
  const openCriteria = decisionDistance.criteria.filter((criterion) => criterion.state === 'offen');
  const nextCriterion = openCriteria.find((criterion) =>
    roleCanInfluenceCriterion(activeRoleId, criterion)
  );

  if (nextCriterion) {
    return {
      kind: 'beitrag_erforderlich',
      criterionId: nextCriterion.id,
      erforderlichFuer: 'entscheidungsreife',
      textKey: nextCriterion.nextContributionTextKey || 'rc2.nextContribution.evidenceComplete',
    };
  }

  return {
    kind: 'keiner',
    reason: openCriteria.length > 0 ? 'role_has_no_open_influence' : 'no_open_criterion',
    beeinflussbarDurch: uniqueStrings(
      openCriteria.flatMap((criterion) => criterion.beeinflussbarDurch || [])
    ),
    textKey: 'rc2.nextContribution.noneForRole',
  };
}

function buildInteractionProjection(presentationContract, options = {}) {
  validatePresentationContract(presentationContract);

  const activeRoleId = options.activeRoleId;
  if (!activeRoleId) throw new Error('interaction projection requires activeRoleId');

  const decisionDistance = buildDecisionDistance(options.decisionCriteria);
  const statementRefs = presentationContract.aussagen.map((statement) => statement.id);

  return {
    schemaVersion: 'rc2.interaction-projection.v1',
    surface: options.surface || 'vorgangsansicht',
    activeRoleId,
    statementRefs,
    entscheidungsdistanz: decisionDistance,
    naechsterBeitrag: buildNextContribution(activeRoleId, decisionDistance),
  };
}

module.exports = {
  buildInteractionProjection,
};
