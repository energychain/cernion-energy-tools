'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;
const { validateBlueprint } = require('../src/l2-blueprint-interpreter');
const { buildActionRegistry } = require('../src/agent-receipts-registry');
const { setRuntimeBlueprint, clearRuntimeBlueprint } = require('../src/blueprint-registry');

// ─── ID Helpers ───────────────────────────────────────────────────────────────

const BLUEPRINT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function makeDraftId() {
  return crypto.randomBytes(8).toString('hex');
}

function draftDocId(blueprintId, draftId) {
  return `bp:draft:${blueprintId}:${draftId}`;
}

function activeDocId(blueprintId) {
  return `bp:active:${blueprintId}`;
}

function archiveDocId(blueprintId, version) {
  return `bp:archive:${blueprintId}:${version}`;
}

// ─── Injection Guard ──────────────────────────────────────────────────────────
// Reject blueprints whose field values attempt to inject shell commands or paths.

const INJECTION_PATTERNS = [
  /\.\.\//,
  /[;&|`$]/,
  /\beval\b/,
  /\bexec\b/,
  /\bspawn\b/,
  /\brequire\b/,
  /\bprocess\b/,
  /\b__dirname\b/,
];

function _checkInjection(value, path, errors) {
  if (typeof value === 'string') {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        errors.push({
          field: path,
          message: `Potential injection pattern detected in '${path}': ${value.slice(0, 60)}`,
        });
        return;
      }
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      _checkInjection(v, `${path}.${k}`, errors);
    }
  }
}

function validateInjection(blueprint) {
  const errors = [];
  _checkInjection(blueprint.meta, 'meta', errors);
  _checkInjection(blueprint.routing, 'routing', errors);
  _checkInjection(blueprint.inputs, 'inputs', errors);
  _checkInjection(blueprint.execution, 'execution', errors);
  _checkInjection(blueprint.postProcessing, 'postProcessing', errors);
  _checkInjection(blueprint.synthesis, 'synthesis', errors);
  _checkInjection(blueprint.routingPolicy, 'routingPolicy', errors);
  _checkInjection(blueprint.synthesisPolicy, 'synthesisPolicy', errors);
  return errors;
}

// ─── Evidence Path Validator ──────────────────────────────────────────────────

function validateEvidenceRefs(blueprint, errors) {
  const evidenceRequired = blueprint.synthesis?.evidenceRequired;
  if (!Array.isArray(evidenceRequired)) return;

  const stepIds = new Set((blueprint.execution?.steps || []).map((s) => s.id).filter(Boolean));

  for (const ref of evidenceRequired) {
    if (typeof ref !== 'string') continue;
    const m = ref.match(/^steps\.([^.]+)\./);
    if (m && !stepIds.has(m[1])) {
      errors.push({
        field: 'synthesis.evidenceRequired',
        message: `evidenceRequired references unknown step id '${m[1]}'. Declared steps: [${[...stepIds].join(', ')}].`,
      });
    }
  }
}

// ─── Action Availability Checker ─────────────────────────────────────────────

function checkActionAvailability(blueprint, broker) {
  const warnings = [];
  const unavailable = [];

  if (!broker?.registry) return { warnings, unavailable };

  const actionRegistry = buildActionRegistry(broker);
  const steps = blueprint.execution?.steps || [];

  for (const step of steps) {
    if (!step.action) continue;
    if (!actionRegistry[step.action]) {
      unavailable.push(step.action);
    }
  }

  if (unavailable.length > 0) {
    warnings.push({
      code: 'ACTION_UNAVAILABLE',
      message: `The following step actions are not currently registered in the broker: ${unavailable.join(', ')}. The blueprint may still be promoted, but execution will fail until those services are running.`,
      actions: unavailable,
    });
  }

  return { warnings, unavailable };
}

// ─── Full Validation Pipeline ─────────────────────────────────────────────────

function runFullValidation(blueprint, broker) {
  const errors = [];
  const warnings = [];

  // 1. Schema validation
  const schemaResult = validateBlueprint(blueprint);
  if (!schemaResult.valid) {
    errors.push(...schemaResult.errors);
  }

  // 2. Injection guard
  const injectionErrors = validateInjection(blueprint);
  errors.push(...injectionErrors);

  // 3. Evidence path integrity
  if (schemaResult.valid) {
    validateEvidenceRefs(blueprint, errors);
  }

  // 4. Action availability (non-blocking — returns warnings)
  if (broker && errors.length === 0) {
    const { warnings: actionWarnings } = checkActionAvailability(blueprint, broker);
    warnings.push(...actionWarnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Public Shape ─────────────────────────────────────────────────────────────

function toDraftPublic(doc) {
  return {
    draftId: doc.draftId,
    blueprintId: doc.blueprintId,
    version: doc.version,
    validationStatus: doc.validationStatus,
    validationErrors: doc.validationErrors || [],
    validationWarnings: doc.validationWarnings || [],
    testStatus: doc.testStatus,
    createdBy: doc.createdBy || null,
    createdAt: doc.createdAt,
    sourceConversationId: doc.sourceConversationId || null,
    sourceAgent: doc.sourceAgent || null,
    promotedBy: doc.promotedBy || null,
    promotedAt: doc.promotedAt || null,
    title: doc.blueprint?.meta?.title || '',
    description: doc.blueprint?.meta?.description || '',
    _rev: doc._rev,
  };
}

function toActivePublic(doc) {
  return {
    blueprintId: doc.blueprintId,
    version: doc.version,
    activatedAt: doc.activatedAt,
    promotedBy: doc.promotedBy || null,
    previousVersion: doc.previousVersion || null,
    rollbackTarget: doc.rollbackTarget || null,
    title: doc.blueprint?.meta?.title || '',
    description: doc.blueprint?.meta?.description || '',
    source: 'runtime',
    _rev: doc._rev,
  };
}

// ─── Service Definition ───────────────────────────────────────────────────────

module.exports = {
  name: 'blueprint-management',

  settings: {
    dbPath: process.env.BLUEPRINT_MGMT_DB_PATH || './data/blueprint-registry',
    allowPromoteWithWarnings: process.env.BLUEPRINT_MGMT_ALLOW_WARN_PROMOTE !== 'false',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['type'] } });
    await this.db.createIndex({ index: { fields: ['type', 'blueprintId'] } });
    await this.db.createIndex({ index: { fields: ['type', 'createdAt'] } });
    this.logger.info(`[blueprint-management] DB ready at ${this.settings.dbPath}`);

    // Restore runtime overlay from persisted active blueprints
    await this._restoreRuntimeOverlay();
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    // ── createDraft ──────────────────────────────────────────────────────────
    createDraft: {
      rest: 'POST /drafts',
      params: {
        blueprint: { type: 'object' },
        createdBy: { type: 'string', optional: true },
        sourceConversationId: { type: 'string', optional: true },
        sourceAgent: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { blueprint, createdBy, sourceConversationId, sourceAgent } = ctx.params;

        // Quick fail: id must be present and match slug pattern
        if (typeof blueprint?.id !== 'string' || !BLUEPRINT_ID_PATTERN.test(blueprint.id)) {
          throw new MoleculerClientError(
            'Blueprint id is missing or invalid (must be lowercase-slug, e.g. my-use-case-v1).',
            422,
            'BLUEPRINT_INVALID_ID',
            { id: blueprint?.id }
          );
        }

        const blueprintId = blueprint.id;
        const validation = runFullValidation(blueprint, this.broker);

        const draftId = makeDraftId();
        const now = new Date().toISOString();

        const doc = {
          _id: draftDocId(blueprintId, draftId),
          type: 'blueprint-draft',
          blueprintId,
          draftId,
          version: blueprint.version || null,
          blueprint,
          validationStatus: validation.valid ? 'valid' : 'invalid',
          validationErrors: validation.errors,
          validationWarnings: validation.warnings,
          testStatus: 'pending',
          createdBy: createdBy || null,
          createdAt: now,
          updatedAt: now,
          sourceConversationId: sourceConversationId || null,
          sourceAgent: sourceAgent || null,
          promotedBy: null,
          promotedAt: null,
        };

        const result = await this.db.put(doc);
        doc._rev = result.rev;

        return {
          success: true,
          draftId,
          blueprintId,
          validationStatus: doc.validationStatus,
          validationErrors: doc.validationErrors,
          validationWarnings: doc.validationWarnings,
          data: toDraftPublic(doc),
        };
      },
    },

    // ── list ─────────────────────────────────────────────────────────────────
    list: {
      rest: 'GET /',
      params: {
        includeDrafts: { type: 'boolean', optional: true, default: true, convert: true },
        includeActive: { type: 'boolean', optional: true, default: true, convert: true },
        blueprintId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { includeDrafts, includeActive, blueprintId } = ctx.params;

        const selector = {
          $or: [],
        };

        if (includeDrafts) selector.$or.push({ type: 'blueprint-draft' });
        if (includeActive) selector.$or.push({ type: 'blueprint-active' });

        if (selector.$or.length === 0) {
          return { success: true, data: [] };
        }

        const response = await this.db.find({
          selector: selector.$or.length === 1 ? selector.$or[0] : selector,
          limit: 500,
        });

        let docs = Array.isArray(response.docs) ? response.docs : [];

        if (blueprintId) {
          docs = docs.filter((d) => d.blueprintId === blueprintId);
        }

        docs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

        const data = docs.map((doc) =>
          doc.type === 'blueprint-active' ? toActivePublic(doc) : toDraftPublic(doc)
        );

        return { success: true, data, total: data.length };
      },
    },

    // ── get ──────────────────────────────────────────────────────────────────
    get: {
      rest: 'GET /:id',
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        const { id } = ctx.params;

        // Try as draftDocId by searching, or as activeDocId directly
        let doc;
        try {
          doc = await this.db.get(activeDocId(id));
        } catch (e1) {
          if (e1?.status !== 404) throw e1;
          // Try to find a draft with this draftId
          const found = await this.db.find({
            selector: { type: 'blueprint-draft' },
            limit: 1000,
          });
          doc = (found.docs || []).find((d) => d.draftId === id || d.blueprintId === id);
        }

        if (!doc) {
          throw new MoleculerClientError(
            `Blueprint or draft not found: ${id}`,
            404,
            'BLUEPRINT_NOT_FOUND',
            { id }
          );
        }

        return {
          success: true,
          data: doc.type === 'blueprint-active' ? toActivePublic(doc) : toDraftPublic(doc),
          blueprint: doc.blueprint,
        };
      },
    },

    // ── validate ─────────────────────────────────────────────────────────────
    validate: {
      rest: 'POST /:id/validate',
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        const doc = await this._loadDraft(ctx.params.id);
        const validation = runFullValidation(doc.blueprint, this.broker);

        const now = new Date().toISOString();
        const updated = {
          ...doc,
          validationStatus: validation.valid ? 'valid' : 'invalid',
          validationErrors: validation.errors,
          validationWarnings: validation.warnings,
          updatedAt: now,
        };

        await this.db.put(updated);

        return {
          success: true,
          draftId: doc.draftId,
          blueprintId: doc.blueprintId,
          validationStatus: updated.validationStatus,
          validationErrors: updated.validationErrors,
          validationWarnings: updated.validationWarnings,
        };
      },
    },

    // ── test ─────────────────────────────────────────────────────────────────
    test: {
      rest: 'POST /:id/test',
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        const doc = await this._loadDraft(ctx.params.id);

        if (doc.validationStatus !== 'valid') {
          return {
            success: false,
            testStatus: 'failed',
            reason: 'Blueprint has validation errors; fix them before running tests.',
            validationErrors: doc.validationErrors,
          };
        }

        // Dry-run: schema check + action registry + evidence path integrity
        const validation = runFullValidation(doc.blueprint, this.broker);
        const testStatus = validation.valid ? 'passed' : 'failed';

        const now = new Date().toISOString();
        const updated = { ...doc, testStatus, updatedAt: now };
        await this.db.put(updated);

        return {
          success: testStatus === 'passed',
          testStatus,
          draftId: doc.draftId,
          blueprintId: doc.blueprintId,
          validationErrors: validation.errors,
          validationWarnings: validation.warnings,
          note: 'Dry-run complete. Full Jest test execution is a separate CI step.',
        };
      },
    },

    // ── promote ───────────────────────────────────────────────────────────────
    promote: {
      rest: 'POST /:id/promote',
      params: {
        id: { type: 'string' },
        promotedBy: { type: 'string', optional: true },
        allowWarnings: { type: 'boolean', optional: true, default: true, convert: true },
      },
      async handler(ctx) {
        const { promotedBy, allowWarnings } = ctx.params;
        const doc = await this._loadDraft(ctx.params.id);

        // Must be valid before promoting
        if (doc.validationStatus !== 'valid') {
          throw new MoleculerClientError(
            'Only valid drafts can be promoted. Run /validate first.',
            409,
            'BLUEPRINT_NOT_VALID',
            { draftId: doc.draftId, validationStatus: doc.validationStatus }
          );
        }

        if (!allowWarnings && doc.validationWarnings?.length > 0) {
          throw new MoleculerClientError(
            'Blueprint has warnings and allowWarnings=false.',
            409,
            'BLUEPRINT_HAS_WARNINGS',
            { draftId: doc.draftId, warnings: doc.validationWarnings }
          );
        }

        const blueprintId = doc.blueprintId;
        const now = new Date().toISOString();

        // Archive previous active if it exists
        let previousVersion = null;
        let rollbackTarget = null;
        try {
          const prevActive = await this.db.get(activeDocId(blueprintId));
          previousVersion = prevActive.version;
          const archiveId = archiveDocId(blueprintId, prevActive.version || now);
          const archiveDoc = {
            ...prevActive,
            _id: archiveId,
            _rev: undefined,
            type: 'blueprint-archive',
            archivedAt: now,
          };
          delete archiveDoc._rev;
          try {
            await this.db.put(archiveDoc);
            rollbackTarget = archiveId;
          } catch (_archErr) {
            // Non-fatal: archive collision means same version archived twice
          }
          // Remove old active
          await this.db.remove(prevActive);
        } catch (err) {
          if (err?.status !== 404) throw err;
        }

        // Write new active document
        const activeDoc = {
          _id: activeDocId(blueprintId),
          type: 'blueprint-active',
          blueprintId,
          version: doc.version,
          blueprint: doc.blueprint,
          activatedAt: now,
          promotedBy: promotedBy || null,
          previousVersion,
          rollbackTarget,
          draftId: doc.draftId,
          createdBy: doc.createdBy,
          sourceConversationId: doc.sourceConversationId,
          sourceAgent: doc.sourceAgent,
        };

        const result = await this.db.put(activeDoc);
        activeDoc._rev = result.rev;

        // Update the in-memory runtime overlay
        setRuntimeBlueprint(blueprintId, doc.blueprint);

        // Mark draft as promoted
        const promotedDraft = {
          ...doc,
          promotedBy: promotedBy || null,
          promotedAt: now,
          updatedAt: now,
        };
        await this.db.put(promotedDraft);

        this.logger.info(
          `[blueprint-management] Promoted ${blueprintId} v${doc.version} by ${promotedBy || 'unknown'}`
        );

        return {
          success: true,
          blueprintId,
          version: doc.version,
          activatedAt: now,
          promotedBy: promotedBy || null,
          previousVersion,
          data: toActivePublic(activeDoc),
        };
      },
    },

    // ── rollback ──────────────────────────────────────────────────────────────
    rollback: {
      rest: 'POST /:id/rollback',
      params: {
        id: { type: 'string' },
        rolledBackBy: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { id, rolledBackBy } = ctx.params;

        // Load current active
        let currentActive;
        try {
          currentActive = await this.db.get(activeDocId(id));
        } catch (err) {
          if (err?.status === 404) {
            throw new MoleculerClientError(
              `No active runtime blueprint found for: ${id}`,
              404,
              'BLUEPRINT_NOT_FOUND',
              { blueprintId: id }
            );
          }
          throw err;
        }

        if (!currentActive.rollbackTarget) {
          throw new MoleculerClientError(
            `Blueprint '${id}' has no rollback target (no previous version archived).`,
            409,
            'BLUEPRINT_NO_ROLLBACK_TARGET',
            { blueprintId: id }
          );
        }

        // Load archive
        let archiveDoc;
        try {
          archiveDoc = await this.db.get(currentActive.rollbackTarget);
        } catch (err) {
          if (err?.status === 404) {
            throw new MoleculerClientError(
              `Rollback target not found: ${currentActive.rollbackTarget}`,
              404,
              'BLUEPRINT_ROLLBACK_TARGET_MISSING',
              { blueprintId: id, rollbackTarget: currentActive.rollbackTarget }
            );
          }
          throw err;
        }

        const now = new Date().toISOString();

        // Remove current active
        await this.db.remove(currentActive);

        // Restore archive as new active
        const restoredActive = {
          _id: activeDocId(id),
          type: 'blueprint-active',
          blueprintId: id,
          version: archiveDoc.version,
          blueprint: archiveDoc.blueprint,
          activatedAt: now,
          promotedBy: rolledBackBy || null,
          previousVersion: currentActive.version,
          rollbackTarget: archiveDoc.rollbackTarget || null,
          restoredFrom: currentActive.rollbackTarget,
          rolledBackAt: now,
          rolledBackBy: rolledBackBy || null,
        };

        const result = await this.db.put(restoredActive);
        restoredActive._rev = result.rev;

        // Update runtime overlay
        setRuntimeBlueprint(id, archiveDoc.blueprint);

        this.logger.info(
          `[blueprint-management] Rolled back ${id} to v${archiveDoc.version} by ${rolledBackBy || 'unknown'}`
        );

        return {
          success: true,
          blueprintId: id,
          version: restoredActive.version,
          activatedAt: now,
          rolledBackBy: rolledBackBy || null,
          restoredFrom: currentActive.rollbackTarget,
          data: toActivePublic(restoredActive),
        };
      },
    },

    // ── deactivate ────────────────────────────────────────────────────────────
    deactivate: {
      rest: 'DELETE /active/:id',
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        let activeDoc;
        try {
          activeDoc = await this.db.get(activeDocId(ctx.params.id));
        } catch (err) {
          if (err?.status === 404) {
            throw new MoleculerClientError(
              `No active runtime blueprint: ${ctx.params.id}`,
              404,
              'BLUEPRINT_NOT_FOUND',
              { blueprintId: ctx.params.id }
            );
          }
          throw err;
        }

        await this.db.remove(activeDoc);
        clearRuntimeBlueprint(ctx.params.id);

        return {
          success: true,
          blueprintId: ctx.params.id,
          deactivatedAt: new Date().toISOString(),
        };
      },
    },
  },

  methods: {
    async _loadDraft(draftId) {
      const response = await this.db.find({
        selector: { type: 'blueprint-draft' },
        limit: 2000,
      });

      const docs = Array.isArray(response.docs) ? response.docs : [];
      const doc = docs.find((d) => d.draftId === draftId);

      if (!doc) {
        throw new MoleculerClientError(
          `Draft not found: ${draftId}`,
          404,
          'BLUEPRINT_DRAFT_NOT_FOUND',
          { draftId }
        );
      }

      return doc;
    },

    async _restoreRuntimeOverlay() {
      try {
        const response = await this.db.find({
          selector: { type: 'blueprint-active' },
          limit: 1000,
        });

        const docs = Array.isArray(response.docs) ? response.docs : [];
        let count = 0;

        for (const doc of docs) {
          if (doc.blueprint && doc.blueprintId) {
            setRuntimeBlueprint(doc.blueprintId, doc.blueprint);
            count++;
          }
        }

        if (count > 0) {
          this.logger.info(
            `[blueprint-management] Restored ${count} runtime blueprint(s) from store`
          );
        }
      } catch (err) {
        this.logger.warn(
          `[blueprint-management] Could not restore runtime overlay: ${err.message}`
        );
      }
    },
  },
};
