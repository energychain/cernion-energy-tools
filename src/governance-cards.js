'use strict';

const { randomUUID } = require('node:crypto');
const { Errors } = require('moleculer');

const GOVERNANCE_CARD_SCHEMA_VERSION = 'governance-cards.v1';
const STATUSES = ['draft', 'review', 'assigned', 'follow_up', 'completed', 'closed'];
const DECISION_SIGNALS = [
  'observe',
  'review',
  'assign',
  'implement',
  'escalate',
  'close-with-rationale',
];
const TRANSITIONS = {
  draft: ['review', 'assigned', 'closed'],
  review: ['assigned', 'follow_up', 'closed'],
  assigned: ['follow_up', 'completed', 'closed'],
  follow_up: ['assigned', 'completed', 'closed'],
  completed: ['closed'],
  closed: [],
};
const REGULATORY_RISK_TYPES = [
  'compliance',
  'penalty',
  'liability',
  'evidence-duty',
  'deadline',
  'operational-change',
  'investment-impact',
  'commercial-impact',
];
const REGULATORY_FIELD_BLOCKS = [
  {
    blockId: 'signal_finding',
    title: 'Signal / finding',
    fields: [
      'regulatoryImpulseSummary',
      'detectedAt',
      'sourceDescription',
      'affectedDomain',
      'possibleEffectiveDate',
      'initialAssessment',
    ],
  },
  {
    blockId: 'relevance_risk',
    title: 'Relevance / risk',
    fields: [
      'affectedProcess',
      'affectedAssetOrTopic',
      'riskTypes',
      'urgency',
      'openClarifications',
      'requiredExpertReview',
      'ownerRole',
    ],
  },
  {
    blockId: 'feedback_decision_signal',
    title: 'Feedback / decision signal',
    fields: [
      'workOrder',
      'deadline',
      'followUpDate',
      'managementRelevance',
      'commercialImpactToCheck',
      'status',
      'nextGate',
      'decisionSignal',
    ],
  },
];
const ASSET_INVESTMENT_FIELD_BLOCKS = [
  {
    blockId: 'technical_finding',
    title: 'Technical finding',
    fields: [
      'assetOrMeasure',
      'triggerSummary',
      'technicalFinding',
      'assumptions',
      'operationalRisk',
      'timeHorizon',
      'technicalRecommendation',
      'technicalOwnerRole',
    ],
  },
  {
    blockId: 'risk_clarification',
    title: 'Risk and clarification',
    fields: [
      'riskPicture',
      'openClarifications',
      'costEstimateStatus',
      'commitmentStatus',
      'requiredCommercialChecks',
      'ownerRole',
      'deadline',
    ],
  },
  {
    blockId: 'commercial_regulatory_steering',
    title: 'Commercial/regulatory steering signal',
    fields: [
      'budgetImpact',
      'liquidityImpact',
      'midTermPlanningImpact',
      'regulatoryReturnImpact',
      'portfolioPriority',
      'decisionSignal',
      'followUpDate',
    ],
  },
];
const ASSET_INVESTMENT_DECISION_SIGNALS = [
  'fund',
  'review',
  'return-to-line',
  'defer-with-risk',
  'escalate',
];
// One field contract drives persistence, reads and dossier projections.
const CARD_DETAIL_FIELDS = {
  regulatory_impulse: {
    text: ['affectedAssetOrTopic', 'urgency', 'commercialImpactToCheck'],
    lists: ['openClarifications'],
    dates: ['detectedAt'],
  },
  asset_investment_governance: {
    text: [
      'assetOrMeasure',
      'technicalFinding',
      'operationalRisk',
      'timeHorizon',
      'technicalRecommendation',
      'technicalOwnerRole',
      'riskPicture',
      'riskLevel',
      'costEstimateStatus',
      'commitmentStatus',
      'budgetImpact',
      'liquidityImpact',
      'midTermPlanningImpact',
      'regulatoryReturnImpact',
      'portfolioPriority',
    ],
    lists: ['assumptions', 'openClarifications', 'requiredCommercialChecks'],
    dates: [],
  },
};
const CARD_TYPES = [
  {
    cardType: 'generic_governance_signal',
    title: 'Generic governance signal',
    description: 'Reusable trigger-to-review governance card for regulated workbench processes.',
    requiredFields: ['title', 'triggerSummary', 'affectedDomain', 'ownerRole', 'nextGate'],
    allowedTransitions: TRANSITIONS,
  },
  {
    cardType: 'regulatory_impulse',
    title: 'Regulatory impulse',
    description:
      'Tracks a source-open regulatory impulse from signal to relevance/risk review and follow-up.',
    requiredFields: [
      'title',
      'triggerSummary',
      'affectedDomain',
      'affectedProcess',
      'ownerRole',
      'deadline',
      'nextGate',
    ],
    fieldBlocks: REGULATORY_FIELD_BLOCKS,
    processFlow: [
      'regulatory impulse',
      'relevance screen',
      'affected process/line',
      'risk and deadline effect',
      'owner and review task',
      'management/line feedback if relevant',
      'follow-up / close with rationale',
    ],
    allowedRiskTypes: REGULATORY_RISK_TYPES,
    examples: [
      'Create a regulatory impulse card for a deadline-relevant BNetzA note.',
      'Show regulatory impulse cards with management relevance.',
    ],
    allowedTransitions: TRANSITIONS,
  },
  {
    cardType: 'asset_investment_governance',
    title: 'Asset / investment governance',
    description:
      'Tracks asset or investment governance signals with technical, commercial and regulatory steering context.',
    requiredFields: ['title', 'triggerSummary', 'affectedDomain', 'ownerRole', 'nextGate'],
    fieldBlocks: ASSET_INVESTMENT_FIELD_BLOCKS,
    processFlow: [
      'asset or measure trigger',
      'technical finding',
      'risk and urgency review',
      'commercial/regulatory effect check',
      'owner/deadline',
      'decision signal or work order',
      'feedback to line',
    ],
    allowedDecisionSignals: ASSET_INVESTMENT_DECISION_SIGNALS,
    examples: [
      'Create an asset governance card for a network measure with unresolved budget and risk impact.',
      'Show investment governance cards that need commercial review.',
    ],
    allowedTransitions: TRANSITIONS,
  },
];
const CARD_TYPE_MAP = new Map(CARD_TYPES.map((type) => [type.cardType, type]));

function clientError(message, status = 422, code = 'GOVERNANCE_CARD_INVALID', data = {}) {
  throw new Errors.MoleculerClientError(message, status, code, data);
}
function now() {
  return new Date().toISOString();
}
function cleanString(value, { max = 500, required = false, field = 'value' } = {}) {
  if (value === undefined || value === null) {
    if (required)
      clientError(`${field} required`, 422, 'GOVERNANCE_CARD_REQUIRED_FIELD', { field });
    return null;
  }
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    if (required)
      clientError(`${field} required`, 422, 'GOVERNANCE_CARD_REQUIRED_FIELD', { field });
    return null;
  }
  return cleaned.slice(0, max);
}
function cleanList(value, { maxItems = 12, maxLength = 120 } = {}) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map((item) => cleanString(item, { max: maxLength })).filter(Boolean)),
  ].slice(0, maxItems);
}
function normalizeBoolean(value) {
  return value === true || value === 'true';
}
function normalizeDate(value, field) {
  const cleaned = cleanString(value, { max: 40, field });
  if (!cleaned) return null;
  const parsed = Date.parse(cleaned);
  if (Number.isNaN(parsed))
    clientError(`${field} must be an ISO date`, 422, 'GOVERNANCE_CARD_INVALID_DATE', { field });
  return cleaned;
}
function getCardType(cardType) {
  const type = CARD_TYPE_MAP.get(
    cleanString(cardType, { max: 80, required: true, field: 'cardType' })
  );
  if (!type) clientError('Unknown governance card type', 404, 'GOVERNANCE_CARD_TYPE_NOT_FOUND');
  return type;
}
function fieldLabel(field) {
  return String(field)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}
function missingFieldsForInput(input = {}) {
  const type = getCardType(input.cardType);
  const aliased = applyCardAliases(input, type.cardType);
  const missingFields = type.requiredFields.filter((field) => {
    const value = aliased[field];
    return value === undefined || value === null || String(value).trim() === '';
  });
  return {
    cardType: type.cardType,
    missingFields,
    missingFieldPrompts: missingFields.map((field) => ({
      field,
      label: fieldLabel(field),
      prompt: `Please provide ${fieldLabel(field)} for this ${type.title} card.`,
    })),
    guidance: missingFields.length
      ? `Provide ${missingFields.join(', ')} before creating this ${type.cardType} card.`
      : null,
  };
}
function safeCardType(type) {
  return {
    cardType: type.cardType,
    title: type.title,
    description: type.description,
    requiredFields: [...type.requiredFields],
    fieldBlocks: Array.isArray(type.fieldBlocks)
      ? type.fieldBlocks.map((block) => ({
          blockId: block.blockId,
          title: block.title,
          fields: [...block.fields],
        }))
      : [],
    processFlow: Array.isArray(type.processFlow) ? [...type.processFlow] : [],
    allowedRiskTypes: Array.isArray(type.allowedRiskTypes) ? [...type.allowedRiskTypes] : [],
    allowedDecisionSignals: Array.isArray(type.allowedDecisionSignals)
      ? [...type.allowedDecisionSignals]
      : [...DECISION_SIGNALS],
    examples: Array.isArray(type.examples) ? [...type.examples] : [],
    statuses: [...STATUSES],
    allowedTransitions: Object.fromEntries(
      Object.entries(type.allowedTransitions).map(([from, to]) => [from, [...to]])
    ),
  };
}
function applyCardAliases(input, cardType) {
  if (cardType === 'regulatory_impulse') {
    return {
      ...input,
      title: input.title ?? input.regulatoryImpulseSummary,
      triggerSummary: input.triggerSummary ?? input.regulatoryImpulseSummary,
      sourceKind: input.sourceKind ?? input.sourceDescription,
      effectiveDate: input.effectiveDate ?? input.possibleEffectiveDate,
      impactSummary: input.impactSummary ?? input.initialAssessment,
      nextGate: input.nextGate ?? input.workOrder,
      followUpRequired: input.followUpRequired ?? input.requiredExpertReview,
    };
  }
  if (cardType === 'asset_investment_governance') {
    return {
      ...input,
      title: input.title ?? input.assetOrMeasure,
      triggerSummary: input.triggerSummary ?? input.technicalFinding,
      assetOrMeasure: input.assetOrMeasure ?? input.title,
      technicalFinding: input.technicalFinding ?? input.triggerSummary,
      ownerRole: input.ownerRole ?? input.technicalOwnerRole,
      impactSummary: input.impactSummary ?? input.riskPicture ?? input.technicalFinding,
      nextGate: input.nextGate ?? input.technicalRecommendation,
      managementRelevance: input.managementRelevance ?? input.portfolioPriority,
    };
  }
  return input;
}
function normalizeCardDetails(cardType, input = {}, existing = null) {
  const fields = CARD_DETAIL_FIELDS[cardType];
  if (!fields) return {};
  const value = (field) => (input[field] === undefined ? existing?.[field] : input[field]);
  return Object.fromEntries([
    ...fields.text.map((field) => {
      const raw = value(field);
      if (raw !== undefined && raw !== null && typeof raw !== 'string')
        clientError(`${field} must be text`, 422, 'GOVERNANCE_CARD_INVALID_FIELD', { field });
      return [field, cleanString(raw, { max: 1200, field })];
    }),
    ...fields.lists.map((field) => {
      const raw = value(field);
      if (
        raw !== undefined &&
        raw !== null &&
        (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string'))
      )
        clientError(`${field} must be a list of text`, 422, 'GOVERNANCE_CARD_INVALID_FIELD', {
          field,
        });
      return [field, cleanList(raw, { maxItems: 12, maxLength: 500 })];
    }),
    ...fields.dates.map((field) => [field, normalizeDate(value(field), field)]),
  ]);
}
function normalizeCardInput(input = {}, principal, existing = null) {
  const type = getCardType(input.cardType || existing?.cardType);
  if (existing && type.cardType !== existing.cardType)
    clientError('Card type cannot be changed', 422, 'GOVERNANCE_CARD_TYPE_IMMUTABLE');
  input = applyCardAliases(input, type.cardType);
  const missing = [];
  for (const field of type.requiredFields) {
    const value = input[field] !== undefined ? input[field] : existing?.[field];
    if (value === undefined || value === null || String(value).trim() === '') missing.push(field);
  }
  if (missing.length) {
    clientError('Missing required governance card fields', 422, 'GOVERNANCE_CARD_MISSING_FIELDS', {
      missingFields: missing,
      guidance: `Provide ${missing.join(', ')} before creating this ${type.cardType} card.`,
    });
  }
  const status = cleanString(input.status || existing?.status || 'draft', { max: 40 });
  if (!STATUSES.includes(status)) clientError('Unsupported governance card status');
  if (
    existing &&
    status !== existing.status &&
    !(TRANSITIONS[existing.status] || []).includes(status)
  )
    clientError(
      'Governance card transition not allowed',
      422,
      'GOVERNANCE_CARD_TRANSITION_BLOCKED',
      {
        from: existing.status,
        to: status,
      }
    );
  const decisionSignal = cleanString(input.decisionSignal || existing?.decisionSignal || 'review', {
    max: 80,
  });
  const riskLevel = input.riskLevel === undefined ? existing?.riskLevel : input.riskLevel;
  if (riskLevel != null && !['low', 'medium', 'high', 'critical'].includes(riskLevel))
    clientError('Unsupported risk level', 422, 'GOVERNANCE_CARD_INVALID_FIELD', {
      field: 'riskLevel',
    });
  const allowedSignals = type.allowedDecisionSignals || DECISION_SIGNALS;
  if (!allowedSignals.includes(decisionSignal)) clientError('Unsupported decision signal');
  return {
    ...normalizeCardDetails(type.cardType, input, existing),
    cardType: type.cardType,
    title: cleanString(input.title ?? existing?.title, {
      max: 180,
      required: true,
      field: 'title',
    }),
    triggerSummary: cleanString(input.triggerSummary ?? existing?.triggerSummary, {
      max: 1200,
      required: true,
      field: 'triggerSummary',
    }),
    sourceKind: cleanString(input.sourceKind ?? existing?.sourceKind, { max: 80 }) || 'manual',
    triggerKind: cleanString(input.triggerKind ?? existing?.triggerKind, { max: 80 }) || 'signal',
    affectedDomain: cleanString(input.affectedDomain ?? existing?.affectedDomain, {
      max: 120,
      required: true,
      field: 'affectedDomain',
    }),
    affectedProcess: cleanString(input.affectedProcess ?? existing?.affectedProcess, { max: 180 }),
    riskTypes: cleanList(input.riskTypes ?? existing?.riskTypes),
    impactSummary: cleanString(input.impactSummary ?? existing?.impactSummary, { max: 1200 }),
    deadline: normalizeDate(input.deadline ?? existing?.deadline, 'deadline'),
    effectiveDate: normalizeDate(input.effectiveDate ?? existing?.effectiveDate, 'effectiveDate'),
    ownerRole: cleanString(input.ownerRole ?? existing?.ownerRole, {
      max: 120,
      required: true,
      field: 'ownerRole',
    }),
    ownerRef: cleanString(input.ownerRef ?? existing?.ownerRef, { max: 160 }),
    status,
    nextGate: cleanString(input.nextGate ?? existing?.nextGate, {
      max: 240,
      required: true,
      field: 'nextGate',
    }),
    followUpRequired:
      input.followUpRequired === undefined
        ? Boolean(existing?.followUpRequired)
        : normalizeBoolean(input.followUpRequired),
    followUpDate: normalizeDate(input.followUpDate ?? existing?.followUpDate, 'followUpDate'),
    ownerConfirmedAt: normalizeDate(
      input.ownerConfirmedAt ?? existing?.ownerConfirmedAt,
      'ownerConfirmedAt'
    ),
    ownerConfirmationStatus: cleanString(
      input.ownerConfirmationStatus ?? existing?.ownerConfirmationStatus,
      { max: 80 }
    ),
    blockedReason: cleanString(input.blockedReason ?? existing?.blockedReason, { max: 500 }),
    closureRationale: cleanString(input.closureRationale ?? existing?.closureRationale, {
      max: 1000,
    }),
    managementRelevance: cleanString(input.managementRelevance ?? existing?.managementRelevance, {
      max: 80,
    }),
    executiveVisibility: cleanString(input.executiveVisibility ?? existing?.executiveVisibility, {
      max: 80,
    }),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs ?? existing?.evidenceRefs),
    decisionSignal,
    updatedBy: principal.actorId,
  };
}
function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((ref) => {
      if (typeof ref === 'string') return { evidenceId: cleanString(ref, { max: 160 }) };
      if (!ref || typeof ref !== 'object') return null;
      return {
        evidenceId: cleanString(ref.evidenceId || ref.id || ref.ref, { max: 160 }),
        label: cleanString(ref.label, { max: 180 }),
        sourceType: cleanString(ref.sourceType, { max: 80 }),
      };
    })
    .filter((ref) => ref?.evidenceId)
    .slice(0, 50);
}
function createAuditEntry(action, actorId, details = {}) {
  return {
    action,
    actorId,
    at: now(),
    details: Object.fromEntries(
      Object.entries(details)
        .map(([k, v]) => [k, cleanString(v, { max: 240 })])
        .filter(([, v]) => v !== null)
    ),
  };
}
function safeCard(card) {
  return {
    ...normalizeCardDetails(card.cardType, card),
    commercialReviewNeeded: needsCommercialReview(card),
    schemaVersion: GOVERNANCE_CARD_SCHEMA_VERSION,
    cardId: card.cardId,
    tenantId: card.tenantId,
    cardType: card.cardType,
    title: card.title,
    triggerSummary: card.triggerSummary,
    sourceKind: card.sourceKind,
    triggerKind: card.triggerKind,
    affectedDomain: card.affectedDomain,
    affectedProcess: card.affectedProcess,
    riskTypes: card.riskTypes || [],
    impactSummary: card.impactSummary,
    deadline: card.deadline,
    effectiveDate: card.effectiveDate,
    ownerRole: card.ownerRole,
    ownerRef: card.ownerRef,
    status: card.status,
    nextGate: card.nextGate,
    followUpRequired: Boolean(card.followUpRequired),
    followUpDate: card.followUpDate,
    ownerConfirmedAt: card.ownerConfirmedAt,
    ownerConfirmationStatus: card.ownerConfirmationStatus,
    blockedReason: card.blockedReason,
    closureRationale: card.closureRationale,
    managementRelevance: card.managementRelevance,
    executiveVisibility: card.executiveVisibility,
    evidenceRefs: normalizeEvidenceRefs(card.evidenceRefs),
    decisionSignal: card.decisionSignal,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    createdBy: card.createdBy,
    updatedBy: card.updatedBy,
    auditTrail: Array.isArray(card.auditTrail) ? card.auditTrail.slice(-20) : [],
  };
}
function needsCommercialReview(card) {
  return (
    card.cardType === 'asset_investment_governance' &&
    !['completed', 'closed'].includes(card.status) &&
    (!card.budgetImpact ||
      !card.liquidityImpact ||
      !card.midTermPlanningImpact ||
      !card.regulatoryReturnImpact ||
      card.decisionSignal === 'review')
  );
}
function listMatches(card, filters = {}) {
  if (filters.cardType && card.cardType !== filters.cardType) return false;
  if (filters.decisionSignal && card.decisionSignal !== filters.decisionSignal) return false;
  if (
    filters.commercialReviewNeeded !== undefined &&
    needsCommercialReview(card) !== filters.commercialReviewNeeded
  )
    return false;
  if (filters.status && card.status !== filters.status) return false;
  if (filters.ownerRole && card.ownerRole !== filters.ownerRole) return false;
  if (filters.riskLevel && card.riskLevel !== filters.riskLevel) return false;
  if (filters.riskType && !(card.riskTypes || []).includes(filters.riskType)) return false;
  if (filters.managementRelevance && card.managementRelevance !== filters.managementRelevance)
    return false;
  if (filters.deadlineBefore && (!card.deadline || card.deadline > filters.deadlineBefore))
    return false;
  return true;
}
function summarizeCard(card) {
  return {
    ...normalizeCardDetails(card.cardType, card),
    commercialReviewNeeded: needsCommercialReview(card),
    schemaVersion: GOVERNANCE_CARD_SCHEMA_VERSION,
    cardId: card.cardId,
    cardType: card.cardType,
    title: card.title,
    status: card.status,
    affectedDomain: card.affectedDomain,
    affectedProcess: card.affectedProcess,
    riskTypes: card.riskTypes || [],
    ownerRole: card.ownerRole,
    deadline: card.deadline,
    nextGate: card.nextGate,
    followUpRequired: Boolean(card.followUpRequired),
    followUpDate: card.followUpDate,
    ownerConfirmedAt: card.ownerConfirmedAt,
    ownerConfirmationStatus: card.ownerConfirmationStatus,
    blockedReason: card.blockedReason,
    closureRationale: card.closureRationale,
    managementRelevance: card.managementRelevance,
    executiveVisibility: card.executiveVisibility,
    decisionSignal: card.decisionSignal,
    evidenceRefs: normalizeEvidenceRefs(card.evidenceRefs),
    summaryText: [
      card.title,
      card.affectedDomain && `Domain: ${card.affectedDomain}`,
      card.status && `Status: ${card.status}`,
      card.nextGate && `Next gate: ${card.nextGate}`,
    ]
      .filter(Boolean)
      .join(' | '),
    noCallGuards: [
      'Governance card summaries are advisory/internal and do not execute external filings, market messages, billing, dispatch, device control or production workflow actions.',
    ],
  };
}
function makeCardId() {
  return `gcard_${randomUUID()}`;
}

module.exports = {
  GOVERNANCE_CARD_SCHEMA_VERSION,
  CARD_TYPES,
  STATUSES,
  TRANSITIONS,
  getCardType,
  safeCardType,
  missingFieldsForInput,
  normalizeCardInput,
  safeCard,
  listMatches,
  summarizeCard,
  createAuditEntry,
  makeCardId,
  clientError,
};
