'use strict';

const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;
const {
  RECEIPT_ID_PATTERN,
  RECEIPT_STATUSES,
  validateReceipt,
  isStatusTransitionAllowed,
} = require('../src/agent-receipts-schema');
const { buildActionRegistry } = require('../src/agent-receipts-registry');
const { evaluateReceiptPlan } = require('../src/agent-receipts-evaluation');

function toDocId(receiptId) {
  return `ar:${receiptId}`;
}

function normalizeRevToken(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || undefined;
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
    _rev: doc._rev,
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
            const actions = [step.action, ...(Array.isArray(step.fallbackActions) ? step.fallbackActions : [])];

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

        return {
          success: true,
          data: {
            receiptId: result.receiptId,
            matchScore: result.matchScore,
            matched: result.matched,
            requiredInputs: {
              declared: result.declaredRequiredInputs,
              missing: result.missingRequiredInputs,
            },
            plannedToolCalls: result.plannedToolCalls,
            evidenceRequirements: result.evidenceRequirements,
            warnings: result.warnings,
            errors: result.errors,
            executable: result.executable,
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

        return {
          success: true,
          data: {
            receiptId: result.receiptId,
            executable: result.executable,
            plan: {
              steps: result.plannedToolCalls,
              evidenceRequirements: result.evidenceRequirements,
            },
            missingRequiredInputs: result.missingRequiredInputs,
            warnings: result.warnings,
            errors: result.errors,
            diagnostics: {
              matchScore: result.matchScore,
              matched: result.matched,
              reasons: result.matchReasons,
              missingMatchEntities: result.missingMatchEntities,
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

        const summaryParts = [
          `matchScore=${result.matchScore}`,
          `matched=${result.matched}`,
          `executable=${result.executable}`,
          `missingRequiredInputs=${result.missingRequiredInputs.length}`,
          `plannedSteps=${result.plannedToolCalls.length}`,
        ];

        return {
          success: true,
          data: {
            receiptId: result.receiptId,
            summary: summaryParts.join(' | '),
            match: {
              score: result.matchScore,
              matched: result.matched,
              reasons: result.matchReasons,
              missingEntities: result.missingMatchEntities,
            },
            execution: {
              executable: result.executable,
              plannedToolCalls: result.plannedToolCalls,
              evidenceRequirements: result.evidenceRequirements,
              missingRequiredInputs: result.missingRequiredInputs,
            },
            warnings: result.warnings,
            errors: result.errors,
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
  },
};
