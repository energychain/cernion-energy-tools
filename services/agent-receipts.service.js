'use strict';

const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;
const {
  RECEIPT_ID_PATTERN,
  RECEIPT_STATUSES,
  CREATOR_SOURCES,
  validateReceipt,
  isStatusTransitionAllowed,
} = require('../src/agent-receipts-schema');
const { buildActionRegistry } = require('../src/agent-receipts-registry');
const { evaluateReceiptPlan } = require('../src/agent-receipts-evaluation');
const { queryKnowledgeEvidence } = require('../src/personal-agent-knowledge-rag');
const { hasFullAccessPrincipal, callerHasAnyRole } = require('../src/auth-role-helpers');

// Receipt-promotion authorization (#289, gap identified in #275's Bestandsanalyse):
// promotedBy was a free-text audit field, never an actual permission check — any
// caller could promote any draft. Unlike HITL (#288), a receipt carries no
// per-document role requirement, so this is a static action-level gate instead.
const RECEIPT_PROMOTION_ROLES = ['ROLE_RECEIPT_PROMOTER'];

function toDocId(receiptId) {
  return `ar:${receiptId}`;
}

function normalizeRevToken(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.map((entry) => String(entry || '').trim()).filter((entry) => entry.length > 0))
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstNonEmptyString(...values) {
  for (const candidate of values) {
    if (candidate == null) continue;
    const normalized = String(candidate).trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

const VNB_SELECTION_SIGNALS =
  /\b(vnb|netzbetreiber|zust[aä]ndig(?:e|er|es|en)?(?:\s+netzbetreiber)?|verteilnetz(?:betreiber)?|netzgebiet)\b/i;

function normalizeSelectionPayload(payload = {}) {
  const context = isPlainObject(payload.context) ? payload.context : {};
  const input = isPlainObject(payload.input) ? payload.input : {};

  const topKnownContext = isPlainObject(payload.knownContext) ? payload.knownContext : {};
  const contextKnownContext = isPlainObject(context.knownContext) ? context.knownContext : {};
  const inputKnownContext = isPlainObject(input.knownContext) ? input.knownContext : {};

  const mergedKnownContext = {
    ...topKnownContext,
    ...contextKnownContext,
    ...inputKnownContext,
  };

  const message =
    firstNonEmptyString(
      payload.message,
      payload.question,
      context.message,
      context.question,
      input.message,
      input.question
    ) || '';

  const question = firstNonEmptyString(payload.question, context.question, input.question, message);

  const city = firstNonEmptyString(
    payload.city,
    context.city,
    input.city,
    mergedKnownContext.city,
    mergedKnownContext.municipality,
    mergedKnownContext.location
  );

  const bdewCode = firstNonEmptyString(
    payload.bdewCode,
    payload.bdew,
    context.bdewCode,
    context.bdew,
    input.bdewCode,
    input.bdew,
    mergedKnownContext.bdewCode,
    mergedKnownContext.bdew
  );

  const vnbName = firstNonEmptyString(
    payload.vnbName,
    context.vnbName,
    input.vnbName,
    context.gridOperatorName,
    input.gridOperatorName,
    mergedKnownContext.vnbName,
    mergedKnownContext.gridOperatorName,
    mergedKnownContext.assertedGridOperatorName
  );

  const domainHint = firstNonEmptyString(
    payload.domain,
    context.domain,
    input.domain,
    mergedKnownContext.domain,
    mergedKnownContext.domainHint
  );
  const workflowHint = firstNonEmptyString(
    payload.workflowType,
    context.workflowType,
    input.workflowType,
    mergedKnownContext.workflowType
  );

  const inferredVnbSignal = VNB_SELECTION_SIGNALS.test(message);
  const normalizedDomain = domainHint || (inferredVnbSignal ? 'grid-operations' : null);
  const normalizedWorkflowType = workflowHint || (inferredVnbSignal ? 'vnb_identification' : null);

  const normalizedKnownContext = {
    ...mergedKnownContext,
    ...(city ? { city } : {}),
    ...(bdewCode ? { bdewCode, bdew: bdewCode } : {}),
    ...(vnbName ? { vnbName, gridOperatorName: vnbName } : {}),
    ...(normalizedDomain ? { domain: normalizedDomain } : {}),
    ...(normalizedWorkflowType ? { workflowType: normalizedWorkflowType } : {}),
  };

  const normalizedContext = {
    ...mergedKnownContext,
    ...context,
    knownContext: normalizedKnownContext,
    message,
    question: question || message,
    ...(city ? { city } : {}),
    ...(bdewCode ? { bdewCode, bdew: bdewCode } : {}),
    ...(vnbName ? { vnbName, gridOperatorName: vnbName } : {}),
    ...(normalizedDomain ? { domain: normalizedDomain } : {}),
    ...(normalizedWorkflowType ? { workflowType: normalizedWorkflowType } : {}),
  };

  const normalizedInput = {
    ...inputKnownContext,
    ...input,
    knownContext: normalizedKnownContext,
    message,
    question: question || message,
    ...(city ? { city } : {}),
    ...(bdewCode ? { bdewCode, bdew: bdewCode } : {}),
    ...(vnbName ? { vnbName, gridOperatorName: vnbName } : {}),
    ...(normalizedDomain ? { domain: normalizedDomain } : {}),
    ...(normalizedWorkflowType ? { workflowType: normalizedWorkflowType } : {}),
  };

  return {
    message,
    context: normalizedContext,
    input: normalizedInput,
    normalizedSignals: {
      inferredVnbSignal,
      city: city || null,
      bdewCode: bdewCode || null,
      vnbName: vnbName || null,
      domain: normalizedDomain || null,
      workflowType: normalizedWorkflowType || null,
    },
  };
}

function buildCandidateSelectionDiagnostic({
  receipt,
  evaluation,
  stage = 'automatic',
  selected = false,
} = {}) {
  const matchReasons = Array.isArray(evaluation?.matchReasons) ? evaluation.matchReasons : [];
  const missingMatchEntities = Array.isArray(evaluation?.missingMatchEntities)
    ? evaluation.missingMatchEntities
    : [];
  const missingRequiredInputs = Array.isArray(evaluation?.missingRequiredInputs)
    ? evaluation.missingRequiredInputs
    : [];
  const score = typeof evaluation?.matchScore === 'number' ? evaluation.matchScore : null;

  let rejectReason = null;
  if (!selected) {
    if (evaluation?.matched !== true && score !== null && score < 30) {
      rejectReason = 'score_below_threshold';
    } else if (evaluation?.matched !== true && matchReasons.length === 0) {
      rejectReason = 'missing_trigger';
    }

    if (!rejectReason && missingMatchEntities.length > 0) {
      rejectReason = 'missing_context';
    }
    if (!rejectReason && evaluation?.executable === false) {
      rejectReason = 'not_executable';
    }
    if (!rejectReason && evaluation?.matched !== true) {
      rejectReason = 'not_matched';
    }
  }

  return {
    receiptId: receipt?.receiptId || null,
    status: receipt?.status || null,
    stage,
    selected,
    matched: evaluation?.matched === true,
    executable: evaluation?.executable === true,
    score,
    rejectReason,
    matchReasons,
    missingMatchEntities,
    missingRequiredInputs,
  };
}

function toPublic(doc) {
  return {
    receiptId: doc.receiptId,
    title: doc.title,
    description: doc.description,
    domain: doc.domain,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    matching: doc.matching || {},
    requiredInputs: Array.isArray(doc.requiredInputs) ? doc.requiredInputs : [],
    toolPlan: doc.toolPlan || { steps: [] },
    knowledgePlan: doc.knowledgePlan,
    knowledgeQueries: Array.isArray(doc.knowledgeQueries) ? doc.knowledgeQueries : [],
    knowledgeEvidencePolicy: doc.knowledgeEvidencePolicy || { required: false },
    evidencePolicy: doc.evidencePolicy,
    forbiddenInferences: Array.isArray(doc.forbiddenInferences) ? doc.forbiddenInferences : [],
    responsePolicy: doc.responsePolicy,
    defaults: doc.defaults || {},
    metadata: doc.metadata || {},
    status: doc.status,
    version: doc.version || 1,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    activatedAt: doc.activatedAt || null,
    deprecatedAt: doc.deprecatedAt || null,
    archivedAt: doc.archivedAt || null,
    creatorId: doc.creatorId || null,
    creatorSource: doc.creatorSource || null,
    promotedAt: doc.promotedAt || null,
    promotedBy: doc.promotedBy || null,
    promotedFromDraftId: doc.promotedFromDraftId || null,
    changeReason: doc.changeReason || null,
    supersedes: doc.supersedes || null,
    _rev: doc._rev,
  };
}

function pruneSelectionResult(payload = {}) {
  return {
    selected: Boolean(payload.selected),
    receiptId: payload.receiptId || null,
    status: payload.status || null,
    mode: payload.mode || 'none',
    score: typeof payload.score === 'number' ? payload.score : null,
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    ...(payload.selectedReceipt && typeof payload.selectedReceipt === 'object'
      ? { selectedReceipt: payload.selectedReceipt }
      : {}),
    ...(payload.evaluation && typeof payload.evaluation === 'object'
      ? { evaluation: payload.evaluation }
      : {}),
    ...(payload.diagnostics && typeof payload.diagnostics === 'object'
      ? { diagnostics: payload.diagnostics }
      : {}),
  };
}

module.exports = {
  name: 'agent-receipts',

  settings: {
    dbPath: process.env.AGENT_RECEIPTS_DB_PATH || './data/agent-receipts',
    defaultLimit: 50,
    maxLimit: 200,
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['type'] } });
    await this.db.createIndex({ index: { fields: ['type', 'status'] } });
    await this.db.createIndex({ index: { fields: ['type', 'domain'] } });
    await this.db.createIndex({ index: { fields: ['type', 'updatedAt'] } });
    this.logger.info(`[agent-receipts] DB initialized at ${this.settings.dbPath}`);

    // v0.54.3: Seed vnb-lookup-v1 receipt
    await this._seedReceipts();
  },

  async stopped() {
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    create: {
      rest: 'POST /',
      params: {
        receiptId: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        title: { type: 'string', min: 3 },
        description: { type: 'string', min: 10 },
        domain: { type: 'string', min: 2 },
        tags: { type: 'array', items: 'string', optional: true, default: [] },
        matching: { type: 'object' },
        requiredInputs: { type: 'array', items: 'string', optional: true, default: [] },
        toolPlan: { type: 'object' },
        knowledgeQueries: { type: 'array', optional: true, default: [] },
        knowledgeEvidencePolicy: { type: 'object', optional: true },
        knowledgePlan: { type: 'object', optional: true },
        evidencePolicy: { type: 'object', optional: true },
        forbiddenInferences: { type: 'array', items: 'string', optional: true, default: [] },
        responsePolicy: { type: 'object', optional: true },
        defaults: { type: 'object', optional: true, default: {} },
        metadata: { type: 'object', optional: true, default: {} },
        status: { type: 'enum', values: RECEIPT_STATUSES, optional: true, default: 'draft' },
      },
      openapi: {
        summary: 'Create an agent receipt',
        tags: ['Agent Receipts'],
        description:
          'Creates a runtime-managed receipt with validated schema and auditable lifecycle metadata.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['receiptId', 'title', 'description', 'domain', 'matching', 'toolPlan'],
                properties: {
                  receiptId: { type: 'string', example: 'bess-screening-v1' },
                  title: { type: 'string', example: 'BESS Screening Baseline' },
                  description: { type: 'string' },
                  domain: { type: 'string', example: 'grid-operations' },
                  tags: { type: 'array', items: { type: 'string' } },
                  matching: { type: 'object' },
                  requiredInputs: { type: 'array', items: { type: 'string' } },
                  toolPlan: { type: 'object' },
                  knowledgeQueries: { type: 'array', items: { type: 'object' } },
                  knowledgeEvidencePolicy: { type: 'object' },
                  knowledgePlan: { type: 'object' },
                  evidencePolicy: { type: 'object' },
                  forbiddenInferences: { type: 'array', items: { type: 'string' } },
                  responsePolicy: { type: 'object' },
                  defaults: { type: 'object' },
                  metadata: { type: 'object' },
                  status: { type: 'string', enum: RECEIPT_STATUSES },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const candidate = {
          ...ctx.params,
          status: ctx.params.status || 'draft',
        };

        const validation = validateReceipt(candidate);
        if (!validation.valid) {
          throw new MoleculerClientError(
            'Receipt validation failed.',
            422,
            'AGENT_RECEIPT_VALIDATION_FAILED',
            { errors: validation.errors }
          );
        }

        if (validation.normalized.status === 'active') {
          this.ensureActivationAllowed(validation);
        }

        const receiptId = validation.normalized.receiptId;
        const id = toDocId(receiptId);

        try {
          await this.db.get(id);
          throw new MoleculerClientError(
            `Receipt already exists: ${receiptId}`,
            409,
            'AGENT_RECEIPT_EXISTS',
            { receiptId }
          );
        } catch (err) {
          if (err?.type === 'AGENT_RECEIPT_EXISTS') throw err;
          if (err?.status !== 404) throw err;
        }

        const now = new Date().toISOString();
        const doc = {
          _id: id,
          type: 'agent-receipt',
          ...validation.normalized,
          version: 1,
          createdAt: now,
          updatedAt: now,
          activatedAt: validation.normalized.status === 'active' ? now : null,
          deprecatedAt: validation.normalized.status === 'deprecated' ? now : null,
          archivedAt: validation.normalized.status === 'archived' ? now : null,
        };

        const result = await this.db.put(doc);
        doc._rev = result.rev;

        return {
          success: true,
          data: toPublic(doc),
        };
      },
    },

    list: {
      rest: 'GET /',
      params: {
        status: { type: 'enum', values: RECEIPT_STATUSES, optional: true },
        domain: { type: 'string', optional: true },
        tag: { type: 'string', optional: true },
        includeArchived: { type: 'boolean', optional: true, default: false, convert: true },
        limit: {
          type: 'number',
          integer: true,
          optional: true,
          default: 50,
          min: 1,
          max: 200,
          convert: true,
        },
        offset: {
          type: 'number',
          integer: true,
          optional: true,
          default: 0,
          min: 0,
          convert: true,
        },
      },
      openapi: {
        summary: 'List agent receipts',
        tags: ['Agent Receipts'],
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: RECEIPT_STATUSES },
          },
          {
            name: 'domain',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'tag',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'includeArchived',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0, default: 0 },
          },
        ],
      },
      async handler(ctx) {
        const { status, domain, tag, includeArchived, limit, offset } = ctx.params;
        const selector = { type: 'agent-receipt' };

        if (status) {
          selector.status = status;
        } else if (!includeArchived) {
          selector.status = { $ne: 'archived' };
        }

        if (domain) {
          selector.domain = String(domain).trim().toLowerCase();
        }

        const response = await this.db.find({
          selector,
          limit: 5000,
        });

        let docs = Array.isArray(response.docs) ? response.docs : [];

        if (tag) {
          const normalizedTag = String(tag).trim().toLowerCase();
          docs = docs.filter((doc) =>
            Array.isArray(doc.tags)
              ? doc.tags.some((entry) => String(entry).toLowerCase() === normalizedTag)
              : false
          );
        }

        docs.sort((a, b) => {
          if (a.updatedAt !== b.updatedAt) {
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
          }
          return String(a.receiptId || '').localeCompare(String(b.receiptId || ''));
        });

        const total = docs.length;
        const page = docs.slice(offset, offset + limit).map((doc) => toPublic(doc));

        return {
          success: true,
          data: page,
          metadata: {
            total,
            count: page.length,
            limit,
            offset,
          },
        };
      },
    },

    select: {
      rest: 'POST /select',
      params: {
        message: { type: 'string', optional: true, default: '' },
        question: { type: 'string', optional: true },
        knownContext: { type: 'object', optional: true, default: {} },
        context: { type: 'object', optional: true, default: {} },
        input: { type: 'object', optional: true, default: {} },
        city: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true },
        bdew: { type: 'string', optional: true },
        vnbName: { type: 'string', optional: true },
        forceReceipt: { type: 'string', optional: true, pattern: RECEIPT_ID_PATTERN },
        preferredReceipts: { type: 'array', optional: true, items: 'string', default: [] },
        allowDraftReceipts: { type: 'boolean', optional: true, default: false, convert: true },
        explainReceiptSelection: { type: 'boolean', optional: true, default: false, convert: true },
        disableReceiptSelection: { type: 'boolean', optional: true, default: false, convert: true },
        includeEvaluation: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Select a runtime receipt for Personal Agent orchestration',
        tags: ['Agent Receipts'],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string', example: 'Wer ist der zuständige VNB in Trier?' },
                  question: { type: 'string', example: 'Wer ist der zuständige Netzbetreiber?' },
                  knownContext: {
                    type: 'object',
                    default: {},
                    example: { city: 'Wiesloch' },
                  },
                  context: { type: 'object', default: {}, example: {} },
                  input: { type: 'object', default: {}, example: {} },
                  city: { type: 'string', example: 'Wiesloch' },
                  bdewCode: { type: 'string', example: '9900992720003' },
                  vnbName: { type: 'string', example: 'STROMDAO Netze GmbH' },
                  forceReceipt: { type: 'string', example: 'vnb-lookup-v1' },
                  preferredReceipts: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['vnb-lookup-v1', 'grid-ops-fallback-v1'],
                  },
                  allowDraftReceipts: { type: 'boolean', default: false },
                  explainReceiptSelection: { type: 'boolean', default: false },
                  disableReceiptSelection: { type: 'boolean', default: false },
                },
              },
              examples: {
                preferredMatching: {
                  summary: 'Prefer a list of receipts with diagnostics enabled',
                  value: {
                    message: 'Bitte finde den zuständigen VNB in Trier.',
                    preferredReceipts: ['vnb-lookup-v1', 'grid-ops-fallback-v1'],
                    explainReceiptSelection: true,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          forceReceipt,
          preferredReceipts,
          allowDraftReceipts,
          explainReceiptSelection,
          disableReceiptSelection,
          includeEvaluation,
        } = ctx.params;

        const normalizedSelectionInput = normalizeSelectionPayload(ctx.params);
        const message = normalizedSelectionInput.message;
        const context = normalizedSelectionInput.context;
        const input = normalizedSelectionInput.input;

        if (disableReceiptSelection) {
          return {
            success: true,
            data: {
              selected: false,
              receiptId: null,
              status: null,
              mode: 'disabled',
              score: null,
              warnings: [],
            },
          };
        }

        const warnings = [];
        const baseEvalInput = {
          broker: this.broker,
          context,
          input,
        };
        const candidateDiagnostics = [];

        const includeDiagnostics = explainReceiptSelection === true;

        if (forceReceipt) {
          let forcedDoc;
          try {
            forcedDoc = await this.loadReceipt(forceReceipt);
          } catch (error) {
            if (error?.type === 'AGENT_RECEIPT_NOT_FOUND') {
              throw new MoleculerClientError(
                `Forced receipt is not available: ${forceReceipt}`,
                422,
                'RECEIPT_NOT_FOUND_OR_INVALID',
                { receiptId: forceReceipt }
              );
            }
            throw error;
          }

          const forcedStatus = String(forcedDoc.status || 'draft');
          if (forcedStatus === 'draft' && !allowDraftReceipts) {
            throw new MoleculerClientError(
              `Draft receipt '${forceReceipt}' is not allowed without allowDraftReceipts=true.`,
              422,
              'RECEIPT_DRAFT_NOT_ALLOWED',
              { receiptId: forceReceipt, status: forcedStatus }
            );
          }

          if (forcedStatus !== 'active' && forcedStatus !== 'draft') {
            throw new MoleculerClientError(
              `Forced receipt '${forceReceipt}' is not selectable in status '${forcedStatus}'.`,
              422,
              'RECEIPT_NOT_ACTIVE',
              { receiptId: forceReceipt, status: forcedStatus }
            );
          }

          const forcedReceipt = toPublic(forcedDoc);
          let forcedEvaluation = evaluateReceiptPlan(forcedReceipt, baseEvalInput);
          candidateDiagnostics.push(
            buildCandidateSelectionDiagnostic({
              receipt: forcedReceipt,
              evaluation: forcedEvaluation,
              stage: 'forced',
              selected: true,
            })
          );
          if (includeEvaluation) {
            forcedEvaluation = await this.enrichEvaluationWithKnowledge(
              ctx,
              forcedReceipt,
              baseEvalInput,
              forcedEvaluation
            );
          }

          return {
            success: true,
            data: pruneSelectionResult({
              selected: true,
              receiptId: forcedReceipt.receiptId,
              status: forcedReceipt.status,
              mode: 'forced',
              ...(includeEvaluation
                ? {
                    selectedReceipt: forcedReceipt,
                    evaluation: forcedEvaluation,
                  }
                : {}),
              score:
                typeof forcedEvaluation?.matchScore === 'number'
                  ? forcedEvaluation.matchScore
                  : null,
              warnings,
              diagnostics: includeDiagnostics
                ? {
                    matched: forcedEvaluation?.matched === true,
                    executable: forcedEvaluation?.executable === true,
                    reasons: Array.isArray(forcedEvaluation?.matchReasons)
                      ? forcedEvaluation.matchReasons
                      : [],
                    missingMatchEntities: Array.isArray(forcedEvaluation?.missingMatchEntities)
                      ? forcedEvaluation.missingMatchEntities
                      : [],
                    selectionSignals: normalizedSelectionInput.normalizedSignals,
                    candidates: candidateDiagnostics,
                  }
                : null,
            }),
          };
        }

        const preferred = normalizeStringArray(preferredReceipts);
        const candidates = await this.loadSelectableReceipts({ allowDraftReceipts });
        const allDocsResponse = await this.db.find({
          selector: { type: 'agent-receipt' },
          limit: 5000,
        });
        const allReceipts = Array.isArray(allDocsResponse?.docs) ? allDocsResponse.docs : [];
        const allowedStatuses = allowDraftReceipts
          ? new Set(['active', 'draft'])
          : new Set(['active']);
        const excludedByStatus = allReceipts
          .filter((doc) => !allowedStatuses.has(String(doc?.status || '').toLowerCase()))
          .map((doc) => ({
            receiptId: doc?.receiptId || null,
            status: doc?.status || null,
          }));
        const byId = new Map(candidates.map((doc) => [doc.receiptId, doc]));

        let selected = null;

        for (const receiptId of preferred) {
          const candidateDoc = byId.get(receiptId);
          if (!candidateDoc) {
            warnings.push({
              code: 'PREFERRED_RECEIPT_NOT_FOUND_OR_NOT_ALLOWED',
              receiptId,
            });
            continue;
          }

          const candidate = toPublic(candidateDoc);
          const evaluation = evaluateReceiptPlan(candidate, baseEvalInput);
          candidateDiagnostics.push(
            buildCandidateSelectionDiagnostic({
              receipt: candidate,
              evaluation,
              stage: 'preferred',
              selected: evaluation?.matched === true,
            })
          );
          if (evaluation?.matched === true) {
            selected = {
              receipt: candidate,
              evaluation,
              mode: 'preferred',
            };
            break;
          }
        }

        if (!selected) {
          for (const candidateDoc of candidates) {
            if (preferred.includes(candidateDoc.receiptId)) {
              continue;
            }

            const candidate = toPublic(candidateDoc);
            const evaluation = evaluateReceiptPlan(candidate, baseEvalInput);
            candidateDiagnostics.push(
              buildCandidateSelectionDiagnostic({
                receipt: candidate,
                evaluation,
                stage: 'automatic',
                selected: evaluation?.matched === true,
              })
            );

            if (evaluation?.matched !== true) {
              continue;
            }

            if (
              !selected ||
              Number(evaluation.matchScore || 0) > Number(selected.evaluation.matchScore || 0)
            ) {
              selected = {
                receipt: candidate,
                evaluation,
                mode: 'matched',
              };
            }
          }
        }

        if (!selected) {
          return {
            success: true,
            data: pruneSelectionResult({
              selected: false,
              receiptId: null,
              status: null,
              mode: 'none',
              score: null,
              warnings,
              diagnostics: includeDiagnostics
                ? {
                    evaluatedCandidates: candidates.length,
                    preferredCandidates: preferred,
                    selectionSignals: normalizedSelectionInput.normalizedSignals,
                    candidates: candidateDiagnostics,
                    excludedByStatus,
                  }
                : null,
            }),
          };
        }

        return {
          success: true,
          data: pruneSelectionResult({
            selected: true,
            receiptId: selected.receipt.receiptId,
            status: selected.receipt.status,
            mode: selected.mode,
            ...(includeEvaluation
              ? {
                  selectedReceipt: selected.receipt,
                  evaluation: await this.enrichEvaluationWithKnowledge(
                    ctx,
                    selected.receipt,
                    baseEvalInput,
                    selected.evaluation
                  ),
                }
              : {}),
            score:
              typeof selected.evaluation?.matchScore === 'number'
                ? selected.evaluation.matchScore
                : null,
            warnings,
            diagnostics: includeDiagnostics
              ? {
                  matched: selected.evaluation?.matched === true,
                  executable: selected.evaluation?.executable === true,
                  reasons: Array.isArray(selected.evaluation?.matchReasons)
                    ? selected.evaluation.matchReasons
                    : [],
                  missingMatchEntities: Array.isArray(selected.evaluation?.missingMatchEntities)
                    ? selected.evaluation.missingMatchEntities
                    : [],
                  selectionSignals: normalizedSelectionInput.normalizedSignals,
                  candidates: candidateDiagnostics,
                }
              : null,
          }),
        };
      },
    },

    get: {
      rest: 'GET /:id',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN },
      },
      openapi: {
        summary: 'Get an agent receipt by id',
        tags: ['Agent Receipts'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'bess-screening-v1' },
          },
        ],
      },
      async handler(ctx) {
        const doc = await this.loadReceipt(ctx.params.id);
        return {
          success: true,
          data: toPublic(doc),
        };
      },
    },

    update: {
      rest: 'PUT /:id',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        patch: { type: 'object' },
        _rev: { type: 'string', optional: true, nullable: true },
      },
      openapi: {
        summary: 'Update an agent receipt',
        tags: ['Agent Receipts'],
      },
      async handler(ctx) {
        const { id, patch } = ctx.params;
        const doc = await this.loadReceipt(id);
        const requestedRev = normalizeRevToken(ctx.params._rev);

        this.assertCasRevision(doc, requestedRev, id);

        if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
          throw new MoleculerClientError(
            'Use setStatus for status transitions.',
            422,
            'AGENT_RECEIPT_VALIDATION_FAILED',
            {
              errors: [{ field: 'status', message: 'status is managed by setStatus.' }],
            }
          );
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'receiptId') && patch.receiptId !== id) {
          throw new MoleculerClientError(
            'receiptId is immutable.',
            422,
            'AGENT_RECEIPT_VALIDATION_FAILED',
            {
              errors: [{ field: 'receiptId', message: 'receiptId is immutable.' }],
            }
          );
        }

        const merged = {
          ...toPublic(doc),
          ...patch,
          receiptId: id,
          status: doc.status,
        };

        const validation = validateReceipt(merged);
        if (!validation.valid) {
          throw new MoleculerClientError(
            'Receipt validation failed.',
            422,
            'AGENT_RECEIPT_VALIDATION_FAILED',
            { errors: validation.errors }
          );
        }

        if (doc.status === 'active') {
          this.ensureActivationAllowed(validation);
        }

        const now = new Date().toISOString();
        const updatedDoc = {
          ...doc,
          ...validation.normalized,
          _id: doc._id,
          _rev: doc._rev,
          status: doc.status,
          version: (doc.version || 1) + 1,
          createdAt: doc.createdAt,
          updatedAt: now,
          activatedAt: doc.activatedAt || null,
          deprecatedAt: doc.deprecatedAt || null,
          archivedAt: doc.archivedAt || null,
        };

        const stored = await this.putWithConflictHandling(updatedDoc, requestedRev, id);

        return {
          success: true,
          data: toPublic(stored),
        };
      },
    },

    setStatus: {
      rest: 'POST /:id/status',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        status: { type: 'enum', values: RECEIPT_STATUSES },
        reason: { type: 'string', optional: true },
        _rev: { type: 'string', optional: true, nullable: true },
      },
      openapi: {
        summary: 'Set receipt lifecycle status',
        tags: ['Agent Receipts'],
        description:
          'Transitions a receipt between lifecycle statuses. Transitioning to active requires full-access scope or ROLE_RECEIPT_PROMOTER (#289), same as promote.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'bess-screening-v1' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: RECEIPT_STATUSES },
                  reason: { type: 'string' },
                  _rev: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { id, status, reason } = ctx.params;

        // #289: setStatus can also transition a receipt to 'active' (parallel
        // path to promote) — same authorization requirement applies whenever
        // the target status is 'active', regardless of which action got there.
        if (
          status === 'active' &&
          !hasFullAccessPrincipal(ctx) &&
          !callerHasAnyRole(ctx, RECEIPT_PROMOTION_ROLES)
        ) {
          throw new MoleculerClientError(
            'Caller is not authorized to set a receipt to active — requires full-access or ROLE_RECEIPT_PROMOTER.',
            403,
            'AGENT_RECEIPT_PROMOTE_FORBIDDEN'
          );
        }

        const doc = await this.loadReceipt(id);
        const requestedRev = normalizeRevToken(ctx.params._rev);

        this.assertCasRevision(doc, requestedRev, id);

        if (!isStatusTransitionAllowed(doc.status, status)) {
          throw new MoleculerClientError(
            `Invalid status transition from ${doc.status} to ${status}.`,
            409,
            'AGENT_RECEIPT_INVALID_STATUS_TRANSITION',
            {
              receiptId: id,
              from: doc.status,
              to: status,
            }
          );
        }

        const validation = validateReceipt({
          ...toPublic(doc),
          status,
        });
        if (!validation.valid) {
          throw new MoleculerClientError(
            'Receipt validation failed.',
            422,
            'AGENT_RECEIPT_VALIDATION_FAILED',
            { errors: validation.errors }
          );
        }

        if (status === 'active') {
          this.ensureActivationAllowed(validation);
        }

        const now = new Date().toISOString();
        const updatedDoc = {
          ...doc,
          status,
          updatedAt: now,
          version: (doc.version || 1) + 1,
          metadata: {
            ...(doc.metadata || {}),
            ...(reason ? { statusReason: reason } : {}),
          },
          activatedAt: status === 'active' ? now : doc.activatedAt || null,
          deprecatedAt: status === 'deprecated' ? now : doc.deprecatedAt || null,
          archivedAt: status === 'archived' ? now : doc.archivedAt || null,
        };

        const stored = await this.putWithConflictHandling(updatedDoc, requestedRev, id);

        return {
          success: true,
          data: toPublic(stored),
        };
      },
    },

    proposeDraft: {
      rest: 'POST /propose',
      params: {
        receiptId: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        title: { type: 'string', min: 3 },
        description: { type: 'string', min: 10 },
        domain: { type: 'string', min: 2 },
        tags: { type: 'array', items: 'string', optional: true, default: [] },
        matching: { type: 'object' },
        requiredInputs: { type: 'array', items: 'string', optional: true, default: [] },
        toolPlan: { type: 'object' },
        knowledgeQueries: { type: 'array', optional: true, default: [] },
        knowledgeEvidencePolicy: { type: 'object', optional: true },
        knowledgePlan: { type: 'object', optional: true },
        evidencePolicy: { type: 'object', optional: true },
        forbiddenInferences: { type: 'array', items: 'string', optional: true, default: [] },
        responsePolicy: { type: 'object', optional: true },
        defaults: { type: 'object', optional: true, default: {} },
        metadata: { type: 'object', optional: true, default: {} },
        creatorId: { type: 'string', optional: true, nullable: true },
        creatorSource: {
          type: 'enum',
          values: CREATOR_SOURCES,
          optional: true,
          default: 'api',
        },
        changeReason: { type: 'string', optional: true },
        supersedes: { type: 'string', optional: true, pattern: RECEIPT_ID_PATTERN },
      },
      openapi: {
        summary: 'Propose a new draft receipt (governed learning loop)',
        tags: ['Agent Receipts'],
        description:
          'Creates a receipt in draft status only. Chat and automated flows must use this path instead of create. The receipt is pending review and must be explicitly promoted before becoming active.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['receiptId', 'title', 'description', 'domain', 'matching', 'toolPlan'],
                properties: {
                  receiptId: { type: 'string', example: 'vnb-lookup-v2' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  domain: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  matching: { type: 'object' },
                  requiredInputs: { type: 'array', items: { type: 'string' } },
                  toolPlan: { type: 'object' },
                  creatorId: {
                    type: 'string',
                    nullable: true,
                    description: 'Identity of the creator (user id, agent name, etc).',
                  },
                  creatorSource: {
                    type: 'string',
                    enum: CREATOR_SOURCES,
                    default: 'api',
                    description: 'Origin of the proposal. Chat-originated proposals must use chat.',
                  },
                  changeReason: {
                    type: 'string',
                    description: 'Optional human-readable reason for this proposal.',
                  },
                  supersedes: {
                    type: 'string',
                    description:
                      'Optional receiptId of an active receipt this draft intends to supersede upon promotion.',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        // status must never be provided as non-draft by the caller
        if (
          Object.prototype.hasOwnProperty.call(ctx.params, 'status') &&
          ctx.params.status !== 'draft'
        ) {
          throw new MoleculerClientError(
            'proposeDraft only accepts status: draft. Use promote to activate a receipt.',
            422,
            'AGENT_RECEIPT_PROPOSE_STATUS_REJECTED',
            { field: 'status', provided: ctx.params.status }
          );
        }

        const candidate = {
          ...ctx.params,
          status: 'draft',
        };

        // Strip governance fields before schema validation
        delete candidate.creatorId;
        delete candidate.creatorSource;
        delete candidate.changeReason;
        delete candidate.supersedes;

        const validation = validateReceipt(candidate);
        if (!validation.valid) {
          throw new MoleculerClientError(
            'Receipt proposal validation failed.',
            422,
            'AGENT_RECEIPT_VALIDATION_FAILED',
            { errors: validation.errors }
          );
        }

        const receiptId = validation.normalized.receiptId;
        const id = toDocId(receiptId);

        try {
          await this.db.get(id);
          throw new MoleculerClientError(
            `Receipt already exists: ${receiptId}`,
            409,
            'AGENT_RECEIPT_EXISTS',
            { receiptId }
          );
        } catch (err) {
          if (err?.type === 'AGENT_RECEIPT_EXISTS') throw err;
          if (err?.status !== 404) throw err;
        }

        const rawSource = ctx.params.creatorSource;
        const creatorSource = CREATOR_SOURCES.includes(rawSource) ? rawSource : 'api';
        const rawCreatorId = ctx.params.creatorId;
        const creatorId =
          typeof rawCreatorId === 'string' && rawCreatorId.trim() ? rawCreatorId.trim() : null;
        const rawChangeReason = ctx.params.changeReason;
        const changeReason =
          typeof rawChangeReason === 'string' && rawChangeReason.trim()
            ? rawChangeReason.trim()
            : null;
        const rawSupersedes = ctx.params.supersedes;
        const supersedes =
          typeof rawSupersedes === 'string' && rawSupersedes.trim() ? rawSupersedes.trim() : null;

        const now = new Date().toISOString();
        const doc = {
          _id: id,
          type: 'agent-receipt',
          ...validation.normalized,
          status: 'draft',
          version: 1,
          createdAt: now,
          updatedAt: now,
          activatedAt: null,
          deprecatedAt: null,
          archivedAt: null,
          creatorId,
          creatorSource,
          promotedAt: null,
          promotedBy: null,
          promotedFromDraftId: null,
          ...(changeReason != null ? { changeReason } : {}),
          ...(supersedes != null ? { supersedes } : {}),
        };

        const result = await this.db.put(doc);
        doc._rev = result.rev;

        return {
          success: true,
          receiptId,
          status: 'draft',
          pendingReview: true,
          message: `Receipt '${receiptId}' stored as draft. It is pending review and must be explicitly promoted by a reviewer before it can be used in production.`,
          data: toPublic(doc),
        };
      },
    },

    promote: {
      rest: 'POST /:id/promote',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        promotedBy: { type: 'string', min: 1 },
        changeReason: { type: 'string', optional: true },
        supersedes: { type: 'string', optional: true, pattern: RECEIPT_ID_PATTERN },
        _rev: { type: 'string', optional: true, nullable: true },
      },
      openapi: {
        summary: 'Promote a draft receipt to active (explicit review gate)',
        tags: ['Agent Receipts'],
        description:
          'Transitions a draft receipt to active. Requires promotedBy identity. Validates the receipt fully before promotion. Optionally auto-deprecates a superseded active receipt. Requires _rev for CAS conflict protection. Caller must have full-access scope or ROLE_RECEIPT_PROMOTER (#289).',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'vnb-lookup-v2' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['promotedBy'],
                properties: {
                  promotedBy: {
                    type: 'string',
                    description: 'Identity of the reviewer who approved promotion.',
                    example: 'admin@example.com',
                  },
                  changeReason: { type: 'string' },
                  supersedes: {
                    type: 'string',
                    description:
                      'Optional receiptId of an active receipt to auto-deprecate on promotion. Falls back to supersedes field stored on the draft.',
                  },
                  _rev: {
                    type: 'string',
                    nullable: true,
                    description:
                      'CAS revision token. Prevents concurrent promotion race conditions.',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        if (!hasFullAccessPrincipal(ctx) && !callerHasAnyRole(ctx, RECEIPT_PROMOTION_ROLES)) {
          throw new MoleculerClientError(
            'Caller is not authorized to promote receipts — requires full-access or ROLE_RECEIPT_PROMOTER.',
            403,
            'AGENT_RECEIPT_PROMOTE_FORBIDDEN'
          );
        }

        const { id, promotedBy, changeReason, supersedes } = ctx.params;
        const doc = await this.loadReceipt(id);
        const requestedRev = normalizeRevToken(ctx.params._rev);

        this.assertCasRevision(doc, requestedRev, id);

        if (doc.status !== 'draft') {
          throw new MoleculerClientError(
            `Only draft receipts can be promoted. Current status: ${doc.status}.`,
            409,
            'AGENT_RECEIPT_PROMOTE_NOT_DRAFT',
            { receiptId: id, currentStatus: doc.status }
          );
        }

        // Full validation with target status active — blocks on any blocking error
        const validation = validateReceipt({ ...toPublic(doc), status: 'active' });
        this.ensureActivationAllowed(validation);

        const now = new Date().toISOString();
        const promotedByTrimmed = promotedBy.trim();
        const changeReasonTrimmed =
          typeof changeReason === 'string' && changeReason.trim()
            ? changeReason.trim()
            : doc.changeReason || null;

        const updatedDoc = {
          ...doc,
          status: 'active',
          updatedAt: now,
          version: (doc.version || 1) + 1,
          activatedAt: now,
          promotedAt: now,
          promotedBy: promotedByTrimmed,
          promotedFromDraftId: id,
          ...(changeReasonTrimmed != null ? { changeReason: changeReasonTrimmed } : {}),
        };

        const stored = await this.putWithConflictHandling(updatedDoc, requestedRev, id);

        // Auto-deprecate superseded receipt — prefer explicit param, fall back to draft's supersedes field
        const supersededId = supersedes || doc.supersedes || null;
        let supersededResult = null;

        if (supersededId && supersededId !== id) {
          try {
            const supersededDoc = await this.loadReceipt(supersededId);
            if (supersededDoc.status === 'active') {
              const deprecatedNow = new Date().toISOString();
              const deprecatedDoc = {
                ...supersededDoc,
                status: 'deprecated',
                updatedAt: deprecatedNow,
                version: (supersededDoc.version || 1) + 1,
                deprecatedAt: deprecatedNow,
                metadata: {
                  ...(supersededDoc.metadata || {}),
                  deprecatedBy: promotedByTrimmed,
                  supersededByReceiptId: id,
                  ...(changeReasonTrimmed != null ? { changeReason: changeReasonTrimmed } : {}),
                },
              };
              await this.db.put(deprecatedDoc);
              supersededResult = { receiptId: supersededId, status: 'deprecated' };
              this.logger.info(
                `[agent-receipts] Auto-deprecated ${supersededId} (superseded by ${id}, promotedBy=${promotedByTrimmed})`
              );
            }
          } catch (err) {
            if (err?.type !== 'AGENT_RECEIPT_NOT_FOUND') {
              this.logger.warn(
                `[agent-receipts] Could not auto-deprecate ${supersededId}: ${err.message}`
              );
            }
          }
        }

        return {
          success: true,
          data: toPublic(stored),
          ...(supersededResult != null ? { superseded: supersededResult } : {}),
        };
      },
    },

    archive: {
      rest: 'DELETE /:id',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        reason: { type: 'string', optional: true },
        _rev: { type: 'string', optional: true, nullable: true },
      },
      openapi: {
        summary: 'Archive an agent receipt (soft delete)',
        tags: ['Agent Receipts'],
      },
      async handler(ctx) {
        return ctx.call('agent-receipts.setStatus', {
          id: ctx.params.id,
          status: 'archived',
          reason: ctx.params.reason || 'archived via delete endpoint',
          _rev: ctx.params._rev,
        });
      },
    },

    validate: {
      rest: 'POST /validate',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN, optional: true },
        receipt: { type: 'object', optional: true },
        includeRegistryCheck: { type: 'boolean', optional: true, default: true, convert: true },
      },
      openapi: {
        summary: 'Validate receipt payload or persisted receipt',
        tags: ['Agent Receipts'],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'bess-screening-v1' },
                  receipt: { type: 'object' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { id, receipt, includeRegistryCheck } = ctx.params;

        if (!id && !receipt) {
          throw new MoleculerClientError(
            'Either id or receipt must be provided.',
            422,
            'AGENT_RECEIPT_VALIDATION_FAILED',
            {
              errors: [{ field: 'id|receipt', message: 'Provide either id or receipt.' }],
            }
          );
        }

        let candidate = receipt;
        if (id) {
          const doc = await this.loadReceipt(id);
          candidate = toPublic(doc);
        }

        const validation = validateReceipt(candidate);

        const warnings = Array.isArray(validation.warnings) ? validation.warnings.slice() : [];
        const toolChecks = [];

        if (includeRegistryCheck && validation.normalized?.toolPlan?.steps) {
          const actionRegistry = buildActionRegistry(this.broker);
          const receiptAudit = candidate?.metadata?.registryAudit;

          for (const step of validation.normalized.toolPlan.steps) {
            const actions = [
              step.action,
              ...(Array.isArray(step.fallbackActions) ? step.fallbackActions : []),
            ];

            for (const actionRef of actions) {
              const actionInfo = actionRegistry[actionRef] || null;
              const status = actionInfo ? 'available' : 'missing';
              const check = {
                action: actionRef,
                status,
                signature: actionInfo?.signature || null,
              };

              if (!actionInfo) {
                validation.errors.push({
                  field: 'toolPlan.steps.action',
                  message: `Referenced Moleculer action not found in live registry: ${actionRef}.`,
                });
              }

              if (receiptAudit?.actions?.[actionRef]?.signature && actionInfo?.signature) {
                if (receiptAudit.actions[actionRef].signature !== actionInfo.signature) {
                  warnings.push({
                    field: 'toolPlan.steps.action',
                    message:
                      'Action signature changed since receipt audit snapshot. Continuing because live action exists and can be evaluated.',
                    action: actionRef,
                  });
                }
              }

              toolChecks.push(check);
            }
          }
        }

        const finalValid = validation.errors.length === 0;

        return {
          success: true,
          data: {
            valid: finalValid,
            errors: validation.errors,
            warnings,
            toolChecks,
          },
        };
      },
    },

    validateStored: {
      rest: 'POST /:id/validate',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        includeRegistryCheck: { type: 'boolean', optional: true, default: true, convert: true },
      },
      openapi: {
        summary: 'Validate a persisted receipt with optional live registry checks',
        tags: ['Agent Receipts'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'mastr-asset-inventory-by-location' },
          },
        ],
      },
      async handler(ctx) {
        return ctx.call('agent-receipts.validate', {
          id: ctx.params.id,
          includeRegistryCheck: ctx.params.includeRegistryCheck,
        });
      },
    },

    evaluate: {
      rest: 'POST /evaluate',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN, optional: true },
        receipt: { type: 'object', optional: true },
        context: { type: 'object', optional: true, default: {} },
        input: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Evaluate receipt match and execution plan without running tools',
        tags: ['Agent Receipts'],
      },
      async handler(ctx) {
        const receipt = await this.resolveCandidateReceipt(ctx.params);
        const result = evaluateReceiptPlan(receipt, {
          broker: this.broker,
          context: ctx.params.context,
          input: ctx.params.input,
        });
        const resultWithKnowledge = await this.enrichEvaluationWithKnowledge(
          ctx,
          receipt,
          {
            context: ctx.params.context,
            input: ctx.params.input,
          },
          result
        );

        return {
          success: true,
          data: {
            receiptId: resultWithKnowledge.receiptId,
            matchScore: resultWithKnowledge.matchScore,
            matched: resultWithKnowledge.matched,
            requiredInputs: {
              declared: resultWithKnowledge.declaredRequiredInputs,
              missing: resultWithKnowledge.missingRequiredInputs,
            },
            plannedToolCalls: resultWithKnowledge.plannedToolCalls,
            evidenceRequirements: resultWithKnowledge.evidenceRequirements,
            knowledgeEvidenceStatus: resultWithKnowledge.knowledgeEvidenceStatus,
            knowledgeEvidence: resultWithKnowledge.knowledgeEvidence,
            knowledgeEvidencePolicy: resultWithKnowledge.knowledgeEvidencePolicy,
            knowledgeEvidenceRequired: resultWithKnowledge.knowledgeEvidenceRequired,
            knowledgeEvidenceSatisfied: resultWithKnowledge.knowledgeEvidenceSatisfied,
            knowledgeEvidenceTrace: resultWithKnowledge.knowledgeEvidenceTrace,
            warnings: resultWithKnowledge.warnings,
            errors: resultWithKnowledge.errors,
            executable: resultWithKnowledge.executable,
          },
        };
      },
    },

    evaluateStored: {
      rest: 'POST /:id/evaluate',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        context: { type: 'object', optional: true, default: {} },
        input: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Evaluate persisted receipt by id',
        tags: ['Agent Receipts'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'mastr-asset-inventory-by-location' },
          },
        ],
      },
      async handler(ctx) {
        return ctx.call('agent-receipts.evaluate', {
          id: ctx.params.id,
          context: ctx.params.context,
          input: ctx.params.input,
        });
      },
    },

    test: {
      rest: 'POST /test',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN, optional: true },
        receipt: { type: 'object', optional: true },
        context: { type: 'object', optional: true, default: {} },
        input: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Test receipt planning and return runnable execution details',
        tags: ['Agent Receipts'],
      },
      async handler(ctx) {
        const receipt = await this.resolveCandidateReceipt(ctx.params);
        const result = evaluateReceiptPlan(receipt, {
          broker: this.broker,
          context: ctx.params.context,
          input: ctx.params.input,
        });
        const resultWithKnowledge = await this.enrichEvaluationWithKnowledge(
          ctx,
          receipt,
          {
            context: ctx.params.context,
            input: ctx.params.input,
          },
          result
        );

        return {
          success: true,
          data: {
            receiptId: resultWithKnowledge.receiptId,
            executable: resultWithKnowledge.executable,
            plan: {
              steps: resultWithKnowledge.plannedToolCalls,
              evidenceRequirements: resultWithKnowledge.evidenceRequirements,
              knowledgeEvidenceStatus: resultWithKnowledge.knowledgeEvidenceStatus,
              knowledgeEvidence: resultWithKnowledge.knowledgeEvidence,
              knowledgeEvidencePolicy: resultWithKnowledge.knowledgeEvidencePolicy,
              knowledgeEvidenceRequired: resultWithKnowledge.knowledgeEvidenceRequired,
              knowledgeEvidenceSatisfied: resultWithKnowledge.knowledgeEvidenceSatisfied,
              knowledgeEvidenceTrace: resultWithKnowledge.knowledgeEvidenceTrace,
            },
            missingRequiredInputs: resultWithKnowledge.missingRequiredInputs,
            warnings: resultWithKnowledge.warnings,
            errors: resultWithKnowledge.errors,
            diagnostics: {
              matchScore: resultWithKnowledge.matchScore,
              matched: resultWithKnowledge.matched,
              reasons: resultWithKnowledge.matchReasons,
              missingMatchEntities: resultWithKnowledge.missingMatchEntities,
            },
          },
        };
      },
    },

    testStored: {
      rest: 'POST /:id/test',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        context: { type: 'object', optional: true, default: {} },
        input: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Test persisted receipt by id',
        tags: ['Agent Receipts'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'mastr-asset-inventory-by-location' },
          },
        ],
      },
      async handler(ctx) {
        return ctx.call('agent-receipts.test', {
          id: ctx.params.id,
          context: ctx.params.context,
          input: ctx.params.input,
        });
      },
    },

    explain: {
      rest: 'POST /explain',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN, optional: true },
        receipt: { type: 'object', optional: true },
        context: { type: 'object', optional: true, default: {} },
        input: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Explain why a receipt matched or failed and what would run',
        tags: ['Agent Receipts'],
      },
      async handler(ctx) {
        const receipt = await this.resolveCandidateReceipt(ctx.params);
        const result = evaluateReceiptPlan(receipt, {
          broker: this.broker,
          context: ctx.params.context,
          input: ctx.params.input,
        });
        const resultWithKnowledge = await this.enrichEvaluationWithKnowledge(
          ctx,
          receipt,
          {
            context: ctx.params.context,
            input: ctx.params.input,
          },
          result
        );

        const summaryParts = [
          `matchScore=${resultWithKnowledge.matchScore}`,
          `matched=${resultWithKnowledge.matched}`,
          `executable=${resultWithKnowledge.executable}`,
          `missingRequiredInputs=${resultWithKnowledge.missingRequiredInputs.length}`,
          `plannedSteps=${resultWithKnowledge.plannedToolCalls.length}`,
          `knowledgeEvidenceStatus=${resultWithKnowledge.knowledgeEvidenceStatus}`,
        ];

        return {
          success: true,
          data: {
            receiptId: result.receiptId,
            summary: summaryParts.join(' | '),
            match: {
              score: resultWithKnowledge.matchScore,
              matched: resultWithKnowledge.matched,
              reasons: resultWithKnowledge.matchReasons,
              missingEntities: resultWithKnowledge.missingMatchEntities,
            },
            execution: {
              executable: resultWithKnowledge.executable,
              plannedToolCalls: resultWithKnowledge.plannedToolCalls,
              evidenceRequirements: resultWithKnowledge.evidenceRequirements,
              knowledgeEvidenceStatus: resultWithKnowledge.knowledgeEvidenceStatus,
              knowledgeEvidence: resultWithKnowledge.knowledgeEvidence,
              knowledgeEvidencePolicy: resultWithKnowledge.knowledgeEvidencePolicy,
              knowledgeEvidenceRequired: resultWithKnowledge.knowledgeEvidenceRequired,
              knowledgeEvidenceSatisfied: resultWithKnowledge.knowledgeEvidenceSatisfied,
              knowledgeEvidenceTrace: resultWithKnowledge.knowledgeEvidenceTrace,
              missingRequiredInputs: resultWithKnowledge.missingRequiredInputs,
            },
            warnings: resultWithKnowledge.warnings,
            errors: resultWithKnowledge.errors,
          },
        };
      },
    },

    explainStored: {
      rest: 'POST /:id/explain',
      params: {
        id: { type: 'string', pattern: RECEIPT_ID_PATTERN },
        context: { type: 'object', optional: true, default: {} },
        input: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Explain persisted receipt by id',
        tags: ['Agent Receipts'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'mastr-asset-inventory-by-location' },
          },
        ],
      },
      async handler(ctx) {
        return ctx.call('agent-receipts.explain', {
          id: ctx.params.id,
          context: ctx.params.context,
          input: ctx.params.input,
        });
      },
    },
  },

  methods: {
    async _seedReceipts() {
      const { RECEIPT_SEEDS } = require('../src/agent-receipts-seeds');

      for (const seed of RECEIPT_SEEDS) {
        const docId = `ar:${seed.receiptId}`;
        try {
          const validation = validateReceipt(seed);
          if (!validation.valid) {
            this.logger.error(
              `[agent-receipts] Seed ${seed.receiptId} is invalid: ${JSON.stringify(validation.errors)}`
            );
            continue;
          }

          let existing;
          try {
            existing = await this.db.get(docId);
          } catch (err) {
            if (err.status !== 404) throw err;
            // Not found, proceed with create
          }

          const now = new Date().toISOString();
          const normalizedSeed = validation.normalized;

          if (!existing) {
            // Create new seed
            const doc = {
              _id: docId,
              type: 'agent-receipt',
              ...normalizedSeed,
              version: Number(seed.version || 1),
              createdAt: now,
              updatedAt: now,
              activatedAt: normalizedSeed.status === 'active' ? now : null,
              deprecatedAt: normalizedSeed.status === 'deprecated' ? now : null,
              archivedAt: normalizedSeed.status === 'archived' ? now : null,
            };
            await this.db.put(doc);
            this.logger.info(`[agent-receipts] Seeded receipt: ${seed.receiptId}`);
          } else if (
            existing.status !== normalizedSeed.status ||
            Number(existing.version || 1) !== Number(seed.version || 1)
          ) {
            // Check if manually edited
            const isManuallyEdited = existing.tags && existing.tags.includes('manually-edited');
            if (isManuallyEdited) {
              this.logger.warn(
                `[agent-receipts] Receipt ${seed.receiptId} has manual edits; skipping seed update. Review if version mismatch.`
              );
            } else {
              // Safe update if only version/status diff
              const updated = {
                ...existing,
                ...normalizedSeed,
                _id: docId,
                _rev: existing._rev,
                type: 'agent-receipt',
                version: Number(seed.version || existing.version || 1),
                createdAt: existing.createdAt || now,
                updatedAt: now,
                activatedAt:
                  normalizedSeed.status === 'active'
                    ? existing.activatedAt || now
                    : existing.activatedAt || null,
                deprecatedAt:
                  normalizedSeed.status === 'deprecated' ? now : existing.deprecatedAt || null,
                archivedAt:
                  normalizedSeed.status === 'archived' ? now : existing.archivedAt || null,
              };
              await this.db.put(updated);
              this.logger.info(
                `[agent-receipts] Updated receipt ${seed.receiptId} to version ${seed.version}`
              );
            }
          }
        } catch (err) {
          this.logger.error(`[agent-receipts] Failed to seed ${seed.receiptId}: ${err.message}`);
        }
      }
    },

    ensureActivationAllowed(validation) {
      const blockingErrors = Array.isArray(validation?.errors) ? validation.errors : [];
      if (blockingErrors.length > 0) {
        throw new MoleculerClientError(
          'Receipt cannot be activated because validation has blocking errors.',
          409,
          'AGENT_RECEIPT_BLOCKING_VALIDATION',
          {
            errors: blockingErrors,
          }
        );
      }
    },

    async loadReceipt(receiptId) {
      try {
        return await this.db.get(toDocId(receiptId));
      } catch (err) {
        if (err?.status === 404) {
          throw new MoleculerClientError(
            `Receipt not found: ${receiptId}`,
            404,
            'AGENT_RECEIPT_NOT_FOUND',
            { receiptId }
          );
        }
        throw err;
      }
    },

    assertCasRevision(doc, requestedRev, receiptId) {
      if (!requestedRev) return;
      if (requestedRev !== doc._rev) {
        throw new MoleculerClientError(
          `Revision conflict for receipt ${receiptId}.`,
          409,
          'AGENT_RECEIPT_CONFLICT',
          {
            receiptId,
            expectedRev: requestedRev,
            currentRev: doc._rev,
          }
        );
      }
    },

    async putWithConflictHandling(doc, requestedRev, receiptId) {
      try {
        const result = await this.db.put(doc);
        return {
          ...doc,
          _rev: result.rev,
        };
      } catch (err) {
        if (err?.status === 409) {
          let currentRev = null;
          try {
            const latest = await this.db.get(toDocId(receiptId));
            currentRev = latest?._rev || null;
          } catch (_loadErr) {
            currentRev = null;
          }

          throw new MoleculerClientError(
            `Revision conflict for receipt ${receiptId}.`,
            409,
            'AGENT_RECEIPT_CONFLICT',
            {
              receiptId,
              expectedRev: requestedRev || doc._rev || null,
              currentRev,
            }
          );
        }
        throw err;
      }
    },

    async resolveCandidateReceipt(params = {}) {
      if (params.id) {
        const doc = await this.loadReceipt(params.id);
        return toPublic(doc);
      }

      if (params.receipt && typeof params.receipt === 'object') {
        const validation = validateReceipt(params.receipt);
        if (!validation.valid) {
          throw new MoleculerClientError(
            'Receipt validation failed.',
            422,
            'AGENT_RECEIPT_VALIDATION_FAILED',
            { errors: validation.errors }
          );
        }
        return validation.normalized;
      }

      throw new MoleculerClientError(
        'Either id or receipt must be provided.',
        422,
        'AGENT_RECEIPT_VALIDATION_FAILED',
        {
          errors: [{ field: 'id|receipt', message: 'Provide either id or receipt.' }],
        }
      );
    },

    async loadSelectableReceipts({ allowDraftReceipts = false } = {}) {
      const response = await this.db.find({
        selector: { type: 'agent-receipt' },
        limit: 5000,
      });

      const allowedStatuses = allowDraftReceipts
        ? new Set(['active', 'draft'])
        : new Set(['active']);

      return (Array.isArray(response.docs) ? response.docs : [])
        .filter((doc) => allowedStatuses.has(String(doc?.status || '').toLowerCase()))
        .sort((a, b) => {
          if (a.status !== b.status) {
            if (a.status === 'active') return -1;
            if (b.status === 'active') return 1;
          }

          const aUpdated = String(a.updatedAt || '');
          const bUpdated = String(b.updatedAt || '');
          if (aUpdated !== bUpdated) {
            return bUpdated.localeCompare(aUpdated);
          }

          return String(a.receiptId || '').localeCompare(String(b.receiptId || ''));
        });
    },

    renderKnowledgeQueryTemplate(template = '', scope = {}) {
      const source = String(template || '').trim();
      if (!source) return '';

      return source.replace(/{{\s*([^}]+)\s*}}/g, (_full, rawPath) => {
        const path = String(rawPath || '').trim();
        if (!path) return '';
        const value = path.split('.').reduce((acc, segment) => {
          if (acc == null) return undefined;
          return acc[segment];
        }, scope);
        if (value == null) return '';
        return String(value);
      });
    },

    async collectKnowledgeEvidence(ctx, receipt, evalInput = {}) {
      const queries = Array.isArray(receipt?.knowledgeQueries)
        ? receipt.knowledgeQueries.filter((entry) => entry && typeof entry === 'object')
        : [];
      const policy =
        receipt?.knowledgeEvidencePolicy && typeof receipt.knowledgeEvidencePolicy === 'object'
          ? receipt.knowledgeEvidencePolicy
          : { required: false };

      if (queries.length === 0) {
        return {
          status: 'missing',
          hits: [],
          policy,
          trace: {
            queryCount: 0,
            queries: [],
          },
        };
      }

      const mergedScope = {
        message:
          evalInput?.input?.message || evalInput?.context?.message || evalInput?.message || '',
        context:
          evalInput?.context && typeof evalInput.context === 'object' ? evalInput.context : {},
        input: evalInput?.input && typeof evalInput.input === 'object' ? evalInput.input : {},
      };

      const queryResults = [];
      for (let index = 0; index < queries.length; index += 1) {
        const queryDef = queries[index];
        const queryText = this.renderKnowledgeQueryTemplate(queryDef.query, mergedScope);
        const result = await queryKnowledgeEvidence(ctx, {
          query: queryText,
          limit: queryDef.limit,
          summaryMaxChars: queryDef.summaryMaxChars,
          timeoutMs: queryDef.timeoutMs,
        });

        queryResults.push({
          id: queryDef.id || `q${index + 1}`,
          queryType: 'semantic',
          query: queryText,
          status: result.status,
          hitCount: Array.isArray(result.hits) ? result.hits.length : 0,
          hits: Array.isArray(result.hits) ? result.hits : [],
        });
      }

      const combinedHits = [];
      const seen = new Set();
      queryResults.forEach((entry) => {
        entry.hits.forEach((hit) => {
          const key = `${hit.hitId || ''}::${hit.source || ''}::${hit.summary || ''}`;
          if (seen.has(key)) return;
          seen.add(key);
          combinedHits.push(hit);
        });
      });

      const hasTimeout = queryResults.some((entry) => entry.status === 'timeout');
      const hasUnavailable = queryResults.some((entry) => entry.status === 'unavailable');

      const status =
        combinedHits.length > 0
          ? 'available'
          : hasTimeout
            ? 'timeout'
            : hasUnavailable
              ? 'unavailable'
              : 'missing';

      return {
        status,
        hits: combinedHits,
        policy,
        trace: {
          queryCount: queryResults.length,
          queries: queryResults.map((entry) => ({
            id: entry.id,
            queryType: entry.queryType,
            status: entry.status,
            hitCount: entry.hitCount,
          })),
        },
      };
    },

    async enrichEvaluationWithKnowledge(ctx, receipt, evalInput = {}, evaluation = {}) {
      const evidence = await this.collectKnowledgeEvidence(ctx, receipt, evalInput);
      return evaluateReceiptPlan(receipt, {
        broker: this.broker,
        context: evalInput.context || {},
        input: evalInput.input || {},
        actionRegistry: evalInput.actionRegistry,
        knowledgeEvidence: {
          status: evidence.status,
          hits: evidence.hits,
          trace: evidence.trace,
        },
      });
    },
  },
};
