'use strict';

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');

const { MoleculerClientError } = require('moleculer').Errors;
const {
  setRuntimeRule,
  removeRuntimeRule,
  reloadRegistry,
  getStaticRules,
  getRuntimeRules,
  getRuntimeRule,
  validateRule,
  compileRule,
} = require('../src/dossier-hydration-registry');

// ── ID helpers ─────────────────────────────────────────────────────────────────

function makeDraftId() {
  return `dh_${crypto.randomBytes(6).toString('hex')}`;
}

function draftDocId(ruleId, draftId) {
  return `dossier-hydration-draft:${ruleId}:${draftId}`;
}

function activeDocId(ruleId) {
  return `dossier-hydration-active:${ruleId}`;
}

function archiveDocId(ruleId, version, uniqueSuffix) {
  return `dossier-hydration-archive:${ruleId}:${version}:${uniqueSuffix}`;
}

// ── Shape helpers ──────────────────────────────────────────────────────────────

function toDraftPublic(doc) {
  return {
    draftId: doc.draftId,
    ruleId: doc.ruleId,
    version: doc.version,
    validationStatus: doc.validationStatus,
    validationErrors: doc.validationErrors || [],
    validationWarnings: doc.validationWarnings || [],
    testStatus: doc.testStatus,
    testResults: doc.testResults || [],
    createdBy: doc.createdBy || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    rule: doc.rule,
    _rev: doc._rev,
  };
}

function toActivePublic(doc) {
  return {
    ruleId: doc.ruleId,
    version: doc.version,
    promotedAt: doc.promotedAt,
    promotedBy: doc.promotedBy || null,
    previousVersion: doc.previousVersion || null,
    rollbackTarget: doc.rollbackTarget || null,
    source: 'runtime',
    rule: doc.rule,
    _rev: doc._rev,
  };
}

// ── Service ────────────────────────────────────────────────────────────────────

module.exports = {
  name: 'dossier-hydration',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'DOSSIER_HYDRATION_DB_PATH',
      defaultDbPath: './data/dossier-hydration-registry',
      indexes: [['type'], ['type', 'ruleId']],
    }),
  ],

  async started() {
    await this._restoreRuntimeOverlay();
  },

  actions: {
    // ── list ────────────────────────────────────────────────────────────────
    list: {
      rest: 'GET /',
      params: {
        includeStatic: { type: 'boolean', optional: true, default: true, convert: true },
        includeDrafts: { type: 'boolean', optional: true, default: false, convert: true },
        includeActive: { type: 'boolean', optional: true, default: true, convert: true },
      },
      async handler(ctx) {
        const { includeStatic, includeDrafts, includeActive } = ctx.params;
        const result = [];

        if (includeStatic) {
          const staticRules = getStaticRules();
          const runtimeIds = new Set(getRuntimeRules().map((r) => r.action || r.id));
          for (const rule of staticRules) {
            result.push({
              ...rule,
              source: runtimeIds.has(rule.action || rule.id) ? 'overridden' : 'static',
            });
          }
          for (const rule of getRuntimeRules()) {
            result.push({ ...rule, source: 'runtime' });
          }
        }

        if (includeDrafts || includeActive) {
          const selectorOr = [];
          if (includeDrafts) selectorOr.push({ type: 'dossier-hydration-draft' });
          if (includeActive) selectorOr.push({ type: 'dossier-hydration-active' });

          const response = await this.db.find({
            selector: selectorOr.length === 1 ? selectorOr[0] : { $or: selectorOr },
            limit: 500,
          });
          const docs = Array.isArray(response.docs) ? response.docs : [];
          docs.sort((a, b) =>
            String(b.createdAt || b.promotedAt || '').localeCompare(
              String(a.createdAt || a.promotedAt || '')
            )
          );
          for (const doc of docs) {
            result.push(
              doc.type === 'dossier-hydration-active' ? toActivePublic(doc) : toDraftPublic(doc)
            );
          }
        }

        return { success: true, data: result, total: result.length };
      },
    },

    // ── get ─────────────────────────────────────────────────────────────────
    get: {
      rest: 'GET /:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const { id } = ctx.params;

        let doc;
        try {
          doc = await this.db.get(activeDocId(id));
        } catch (e1) {
          if (e1?.status !== 404) throw e1;
          const found = await this.db.find({
            selector: { type: 'dossier-hydration-draft' },
            limit: 2000,
          });
          doc = (found.docs || []).find((d) => d.draftId === id || d.ruleId === id);
        }

        if (!doc) {
          const staticRule = getStaticRules().find((r) => r.id === id || r.action === id);
          if (staticRule) return { success: true, source: 'static', rule: staticRule };
        }

        if (!doc) {
          throw new MoleculerClientError(
            `Dossier hydration rule not found: ${id}`,
            404,
            'RULE_NOT_FOUND',
            { id }
          );
        }

        return {
          success: true,
          data: doc.type === 'dossier-hydration-active' ? toActivePublic(doc) : toDraftPublic(doc),
        };
      },
    },

    // ── createDraft ──────────────────────────────────────────────────────────
    createDraft: {
      rest: 'POST /drafts',
      params: {
        rule: { type: 'object' },
        testCases: { type: 'array', optional: true, default: [] },
        version: { type: 'string', optional: true },
        createdBy: { type: 'string', optional: true },
        notes: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { rule, testCases, version, createdBy, notes } = ctx.params;

        const validation = validateRule(rule);

        const actionExists = await this._checkActionExists(rule?.action);
        if (!actionExists) {
          validation.warnings.push({
            field: 'action',
            message:
              `Action "${rule?.action}" is not currently registered in the broker. ` +
              'Verify the service is running before relying on this rule.',
          });
        }

        const draftId = makeDraftId();
        const now = new Date().toISOString();
        const ruleId = rule.id || rule.action || 'unknown';

        const doc = {
          _id: draftDocId(ruleId, draftId),
          type: 'dossier-hydration-draft',
          ruleId,
          draftId,
          version: version || '1.0.0',
          rule,
          testCases: Array.isArray(testCases) ? testCases : [],
          notes: notes || null,
          validationStatus: validation.valid ? 'valid' : 'invalid',
          validationErrors: validation.errors,
          validationWarnings: validation.warnings,
          testStatus: 'pending',
          testResults: [],
          createdBy: createdBy || null,
          createdAt: now,
          updatedAt: now,
        };

        const result = await this.db.put(doc);
        doc._rev = result.rev;

        return {
          success: true,
          draftId,
          ruleId,
          validationStatus: doc.validationStatus,
          validationErrors: doc.validationErrors,
          validationWarnings: doc.validationWarnings,
          data: toDraftPublic(doc),
        };
      },
    },

    // ── validate ─────────────────────────────────────────────────────────────
    validate: {
      rest: 'POST /:id/validate',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const doc = await this._loadDraft(ctx.params.id);
        const validation = validateRule(doc.rule);

        // Warn when the target action is not currently registered in the broker.
        // Always a warning (not an error) because the service may not be deployed yet.
        const actionExists = await this._checkActionExists(doc.rule?.action);
        if (!actionExists) {
          validation.warnings.push({
            field: 'action',
            message:
              `Action "${doc.rule?.action}" is not currently registered in the broker. ` +
              'Verify the service is running before relying on this rule.',
          });
        }

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
          ruleId: doc.ruleId,
          validationStatus: updated.validationStatus,
          validationErrors: updated.validationErrors,
          validationWarnings: updated.validationWarnings,
        };
      },
    },

    // ── test ─────────────────────────────────────────────────────────────────
    test: {
      rest: 'POST /:id/test',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const doc = await this._loadDraft(ctx.params.id);

        if (doc.validationStatus !== 'valid') {
          return {
            success: false,
            testStatus: 'failed',
            reason: 'Draft has validation errors; run /:id/validate first.',
            validationErrors: doc.validationErrors,
          };
        }

        const compiled = compileRule(doc.rule);
        if (!compiled) {
          return {
            success: false,
            testStatus: 'failed',
            reason: 'Rule compiled to null (safety or extractor error).',
          };
        }

        const testCases = Array.isArray(doc.testCases) ? doc.testCases : [];
        const testResults = testCases.map((tc) => {
          if (!tc || typeof tc !== 'object')
            return { name: '(invalid)', passed: false, error: 'invalid test case' };
          const name = tc.name || String(tc.prompt || '').slice(0, 40);
          try {
            const params = compiled.extractParams(tc.userFacts || [], tc.prompt || '');
            const paramsOk = params !== null;
            const formatted =
              tc.fixtureResult != null ? compiled.formatEvidence(tc.fixtureResult) : null;

            const paramsPassed = tc.requireParams !== false ? paramsOk : true;
            const formatterPassed =
              tc.requireNonNullOutput !== false && tc.fixtureResult != null
                ? formatted != null
                : true;
            const expectedMatch =
              tc.expectedOutput != null ? formatted === tc.expectedOutput : true;

            const passed = paramsPassed && formatterPassed && expectedMatch;
            return {
              name,
              passed,
              params,
              paramsOk,
              formatted,
              expectedOutput: tc.expectedOutput || null,
            };
          } catch (err) {
            return { name, passed: false, error: err.message };
          }
        });

        const allPassed = testResults.length === 0 || testResults.every((r) => r.passed);
        const testStatus = allPassed ? 'passed' : 'failed';
        const now = new Date().toISOString();
        const updated = { ...doc, testStatus, testResults, updatedAt: now };
        await this.db.put(updated);

        return {
          success: allPassed,
          testStatus,
          draftId: doc.draftId,
          ruleId: doc.ruleId,
          testResults,
          testCasesRun: testResults.length,
          note: allPassed
            ? 'All test cases passed.'
            : `${testResults.filter((r) => !r.passed).length} test case(s) failed.`,
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

        if (doc.validationStatus !== 'valid') {
          throw new MoleculerClientError(
            'Only valid drafts can be promoted. Run /:id/validate first.',
            409,
            'RULE_NOT_VALID',
            { draftId: doc.draftId, validationStatus: doc.validationStatus }
          );
        }

        if (!allowWarnings && doc.validationWarnings?.length > 0) {
          throw new MoleculerClientError(
            'Draft has validation warnings and allowWarnings=false.',
            409,
            'RULE_HAS_WARNINGS',
            { draftId: doc.draftId, warnings: doc.validationWarnings }
          );
        }

        const ruleId = doc.ruleId;
        const action = doc.rule?.action || ruleId;
        const now = new Date().toISOString();

        // Archive previous active if exists
        let previousVersion = null;
        let rollbackTarget = null;
        try {
          const prevActive = await this.db.get(activeDocId(ruleId));
          previousVersion = prevActive.version;
          const archiveId = archiveDocId(
            ruleId,
            prevActive.version || 'unknown',
            Date.now().toString(36)
          );
          const archiveDoc = {
            ...prevActive,
            _id: archiveId,
            type: 'dossier-hydration-archive',
            archivedAt: now,
          };
          delete archiveDoc._rev;
          await this.db.put(archiveDoc);
          rollbackTarget = archiveId;
          await this.db.remove(prevActive);
        } catch (err) {
          if (err?.status !== 404) throw err;
        }

        const activeDoc = {
          _id: activeDocId(ruleId),
          type: 'dossier-hydration-active',
          ruleId,
          version: doc.version,
          rule: doc.rule,
          promotedAt: now,
          promotedBy: promotedBy || null,
          previousVersion,
          rollbackTarget,
          draftId: doc.draftId,
        };

        const res = await this.db.put(activeDoc);
        activeDoc._rev = res.rev;

        setRuntimeRule(action, doc.rule);

        await this.db.put({ ...doc, updatedAt: now });

        this.logger.info(
          `[dossier-hydration] Promoted rule ${ruleId} v${doc.version} by ${promotedBy || 'unknown'}`
        );

        return {
          success: true,
          ruleId,
          version: doc.version,
          promotedAt: now,
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

        let currentActive;
        try {
          currentActive = await this.db.get(activeDocId(id));
        } catch (err) {
          if (err?.status === 404) {
            throw new MoleculerClientError(
              `No active runtime rule found for: ${id}`,
              404,
              'RULE_NOT_FOUND',
              { ruleId: id }
            );
          }
          throw err;
        }

        if (!currentActive.rollbackTarget) {
          throw new MoleculerClientError(
            `Rule '${id}' has no rollback target (no previous version archived).`,
            409,
            'RULE_NO_ROLLBACK_TARGET',
            { ruleId: id }
          );
        }

        let archiveDoc;
        try {
          archiveDoc = await this.db.get(currentActive.rollbackTarget);
        } catch (err) {
          if (err?.status === 404) {
            throw new MoleculerClientError(
              `Rollback target not found: ${currentActive.rollbackTarget}`,
              404,
              'RULE_ROLLBACK_TARGET_MISSING',
              { ruleId: id }
            );
          }
          throw err;
        }

        const now = new Date().toISOString();
        await this.db.remove(currentActive);

        const restoredActive = {
          _id: activeDocId(id),
          type: 'dossier-hydration-active',
          ruleId: id,
          version: archiveDoc.version,
          rule: archiveDoc.rule,
          promotedAt: now,
          promotedBy: rolledBackBy || null,
          previousVersion: currentActive.version,
          rollbackTarget: archiveDoc.rollbackTarget || null,
          rolledBackAt: now,
          rolledBackBy: rolledBackBy || null,
        };

        const res = await this.db.put(restoredActive);
        restoredActive._rev = res.rev;

        const action = archiveDoc.rule?.action || id;
        setRuntimeRule(action, archiveDoc.rule);

        this.logger.info(
          `[dossier-hydration] Rolled back ${id} to v${archiveDoc.version} by ${rolledBackBy || 'unknown'}`
        );

        return {
          success: true,
          ruleId: id,
          version: restoredActive.version,
          rolledBackBy: rolledBackBy || null,
          data: toActivePublic(restoredActive),
        };
      },
    },

    // ── deactivate ────────────────────────────────────────────────────────────
    deactivate: {
      rest: 'POST /:id/deactivate',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const { id } = ctx.params;

        let activeDoc;
        try {
          activeDoc = await this.db.get(activeDocId(id));
        } catch (err) {
          if (err?.status === 404) {
            throw new MoleculerClientError(`No active runtime rule: ${id}`, 404, 'RULE_NOT_FOUND', {
              ruleId: id,
            });
          }
          throw err;
        }

        await this.db.remove(activeDoc);
        const action = activeDoc.rule?.action || id;
        const removed = removeRuntimeRule(action);

        this.logger.info(
          `[dossier-hydration] Deactivated ${id} (runtime rule removed: ${removed})`
        );

        return {
          success: true,
          ruleId: id,
          deactivatedAt: new Date().toISOString(),
          runtimeRuleRemoved: removed,
          note: getStaticRules().some((r) => r.id === id || r.action === id)
            ? 'Static baseline rule is still active via repo file.'
            : 'No static baseline; rule is now fully removed.',
        };
      },
    },

    // ── reload ────────────────────────────────────────────────────────────────
    reload: {
      rest: 'POST /reload',
      params: {},
      async handler() {
        await this._restoreRuntimeOverlay();
        const rules = reloadRegistry();
        this.logger.info(`[dossier-hydration] Reloaded registry (${rules.length} compiled rules)`);
        return {
          success: true,
          compiledRuleCount: rules.length,
          reloadedAt: new Date().toISOString(),
        };
      },
    },
  },

  methods: {
    async _loadDraft(draftId) {
      const response = await this.db.find({
        selector: { type: 'dossier-hydration-draft' },
        limit: 2000,
      });
      const docs = Array.isArray(response.docs) ? response.docs : [];
      const doc = docs.find((d) => d.draftId === draftId);
      if (!doc) {
        throw new MoleculerClientError(`Draft not found: ${draftId}`, 404, 'RULE_DRAFT_NOT_FOUND', {
          draftId,
        });
      }
      return doc;
    },

    async _checkActionExists(actionName) {
      if (!actionName) return false;
      try {
        const list = this.broker.registry.getActionList({ onlyAvailable: true });
        return list.some((a) => a.name === actionName);
      } catch (_err) {
        return true; // fail open — registry unavailable, don't block on this
      }
    },

    async _restoreRuntimeOverlay() {
      try {
        const response = await this.db.find({
          selector: { type: 'dossier-hydration-active' },
          limit: 1000,
        });
        const docs = Array.isArray(response.docs) ? response.docs : [];
        let count = 0;
        for (const doc of docs) {
          if (doc.rule && (doc.ruleId || doc.rule.action)) {
            const action = doc.rule.action || doc.ruleId;
            setRuntimeRule(action, doc.rule);
            count++;
          }
        }
        if (count > 0) {
          reloadRegistry();
          this.logger.info(`[dossier-hydration] Restored ${count} runtime rule(s) from store`);
        }
      } catch (err) {
        this.logger.warn(
          `[dossier-hydration] Could not restore runtime overlay: ${err.message} — falling back to static rules`
        );
      }
    },
  },
};
