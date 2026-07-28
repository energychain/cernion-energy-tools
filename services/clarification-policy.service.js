'use strict';

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');

const { MoleculerClientError } = require('moleculer').Errors;
const {
  validateClarificationPolicy,
  setRuntimeClarificationPolicy,
} = require('../src/clarification-policy-registry');

function makeDraftId() {
  return crypto.randomBytes(8).toString('hex');
}

function draftDocId(policyId, draftId) {
  return `cp:draft:${policyId}:${draftId}`;
}

function activeDocId(policyId) {
  return `cp:active:${policyId}`;
}

function archiveDocId(policyId, version) {
  return `cp:archive:${policyId}:${version}`;
}

function toDraftPublic(doc) {
  return {
    draftId: doc.draftId,
    policyId: doc.policyId,
    version: doc.version,
    validationStatus: doc.validationStatus,
    validationErrors: doc.validationErrors || [],
    testStatus: doc.testStatus,
    title: doc.policy?.title || '',
    description: doc.policy?.description || '',
    createdBy: doc.createdBy || null,
    createdAt: doc.createdAt,
    promotedBy: doc.promotedBy || null,
    promotedAt: doc.promotedAt || null,
    _rev: doc._rev,
  };
}

function toActivePublic(doc) {
  return {
    policyId: doc.policyId,
    version: doc.version,
    activatedAt: doc.activatedAt,
    promotedBy: doc.promotedBy || null,
    previousVersion: doc.previousVersion || null,
    rollbackTarget: doc.rollbackTarget || null,
    title: doc.policy?.title || '',
    description: doc.policy?.description || '',
    source: 'runtime',
    _rev: doc._rev,
  };
}

module.exports = {
  name: 'clarification-policy',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'CLARIFICATION_POLICY_DB_PATH',
      defaultDbPath: './data/clarification-policies',
      indexes: [['type']],
    }),
  ],

  async started() {
    await this._restoreRuntimeOverlay();
  },

  actions: {
    createDraft: {
      rest: 'POST /drafts',
      params: {
        policy: { type: 'object' },
        createdBy: { type: 'string', optional: true },
        sourceConversationId: { type: 'string', optional: true },
        sourceAgent: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { policy, createdBy, sourceConversationId, sourceAgent } = ctx.params;
        const validation = validateClarificationPolicy(policy);
        const draftId = makeDraftId();
        const now = new Date().toISOString();
        const doc = {
          _id: draftDocId(policy.id || 'invalid', draftId),
          type: 'clarification-policy-draft',
          policyId: policy.id || null,
          draftId,
          version: policy.version || null,
          policy,
          validationStatus: validation.valid ? 'valid' : 'invalid',
          validationErrors: validation.errors,
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
          policyId: doc.policyId,
          validationStatus: doc.validationStatus,
          validationErrors: doc.validationErrors,
          data: toDraftPublic(doc),
        };
      },
    },

    list: {
      rest: 'GET /',
      params: {
        includeDrafts: { type: 'boolean', optional: true, default: true, convert: true },
        includeActive: { type: 'boolean', optional: true, default: true, convert: true },
        policyId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const selector = { $or: [] };
        if (ctx.params.includeDrafts) selector.$or.push({ type: 'clarification-policy-draft' });
        if (ctx.params.includeActive) selector.$or.push({ type: 'clarification-policy-active' });
        if (selector.$or.length === 0) return { success: true, data: [], total: 0 };
        const response = await this.db.find({
          selector: selector.$or.length === 1 ? selector.$or[0] : selector,
          limit: 500,
        });
        let docs = Array.isArray(response.docs) ? response.docs : [];
        if (ctx.params.policyId) {
          docs = docs.filter((doc) => doc.policyId === ctx.params.policyId);
        }
        docs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const data = docs.map((doc) =>
          doc.type === 'clarification-policy-active' ? toActivePublic(doc) : toDraftPublic(doc)
        );
        return { success: true, data, total: data.length };
      },
    },

    get: {
      rest: 'GET /:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const doc = await this._loadAny(ctx.params.id);
        return {
          success: true,
          data:
            doc.type === 'clarification-policy-active' ? toActivePublic(doc) : toDraftPublic(doc),
          policy: doc.policy,
        };
      },
    },

    validate: {
      rest: 'POST /:id/validate',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const doc = await this._loadDraft(ctx.params.id);
        const validation = validateClarificationPolicy(doc.policy);
        const updated = {
          ...doc,
          validationStatus: validation.valid ? 'valid' : 'invalid',
          validationErrors: validation.errors,
          updatedAt: new Date().toISOString(),
        };
        await this.db.put(updated);
        return {
          success: true,
          draftId: doc.draftId,
          policyId: doc.policyId,
          validationStatus: updated.validationStatus,
          validationErrors: updated.validationErrors,
        };
      },
    },

    test: {
      rest: 'POST /:id/test',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const doc = await this._loadDraft(ctx.params.id);
        const validation = validateClarificationPolicy(doc.policy);
        const testStatus = validation.valid ? 'passed' : 'failed';
        const updated = { ...doc, testStatus, updatedAt: new Date().toISOString() };
        await this.db.put(updated);
        return {
          success: testStatus === 'passed',
          draftId: doc.draftId,
          policyId: doc.policyId,
          testStatus,
          validationErrors: validation.errors,
          note: 'Schema dry-run complete.',
        };
      },
    },

    promote: {
      rest: 'POST /:id/promote',
      params: {
        id: { type: 'string' },
        promotedBy: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const doc = await this._loadDraft(ctx.params.id);
        if (doc.validationStatus !== 'valid') {
          throw new MoleculerClientError(
            'Only valid clarification-policy drafts can be promoted.',
            409,
            'CLARIFICATION_POLICY_NOT_VALID',
            { draftId: doc.draftId, validationStatus: doc.validationStatus }
          );
        }
        const now = new Date().toISOString();
        let previousVersion = null;
        let rollbackTarget = null;
        try {
          const prevActive = await this.db.get(activeDocId(doc.policyId));
          previousVersion = prevActive.version;
          const archiveId = archiveDocId(doc.policyId, prevActive.version || now);
          const archiveDoc = {
            ...prevActive,
            _id: archiveId,
            type: 'clarification-policy-archive',
            archivedAt: now,
          };
          delete archiveDoc._rev;
          try {
            await this.db.put(archiveDoc);
            rollbackTarget = archiveId;
          } catch (_error) {
            // Archive collisions are non-fatal for repeated same-version promotion.
          }
          await this.db.remove(prevActive);
        } catch (error) {
          if (error?.status !== 404) throw error;
        }
        const activeDoc = {
          _id: activeDocId(doc.policyId),
          type: 'clarification-policy-active',
          policyId: doc.policyId,
          version: doc.version,
          policy: { ...doc.policy, status: 'active' },
          activatedAt: now,
          promotedBy: ctx.params.promotedBy || null,
          previousVersion,
          rollbackTarget,
          draftId: doc.draftId,
          createdBy: doc.createdBy,
          sourceConversationId: doc.sourceConversationId,
          sourceAgent: doc.sourceAgent,
        };
        const result = await this.db.put(activeDoc);
        activeDoc._rev = result.rev;
        setRuntimeClarificationPolicy(doc.policyId, activeDoc.policy);
        return {
          success: true,
          policyId: doc.policyId,
          version: doc.version,
          previousVersion,
          data: toActivePublic(activeDoc),
        };
      },
    },
  },

  methods: {
    async _loadDraft(id) {
      const found = await this.db.find({
        selector: { type: 'clarification-policy-draft' },
        limit: 1000,
      });
      const doc = (found.docs || []).find((item) => item.draftId === id || item.policyId === id);
      if (!doc) {
        throw new MoleculerClientError(
          `Clarification policy draft not found: ${id}`,
          404,
          'CLARIFICATION_POLICY_DRAFT_NOT_FOUND',
          { id }
        );
      }
      return doc;
    },

    async _loadAny(id) {
      try {
        return await this.db.get(activeDocId(id));
      } catch (error) {
        if (error?.status !== 404) throw error;
      }
      const found = await this.db.find({
        selector: { type: 'clarification-policy-draft' },
        limit: 1000,
      });
      const doc = (found.docs || []).find((item) => item.draftId === id || item.policyId === id);
      if (!doc) {
        throw new MoleculerClientError(
          `Clarification policy not found: ${id}`,
          404,
          'CLARIFICATION_POLICY_NOT_FOUND',
          { id }
        );
      }
      return doc;
    },

    async _restoreRuntimeOverlay() {
      const response = await this.db.find({
        selector: { type: 'clarification-policy-active' },
        limit: 1000,
      });
      for (const doc of response.docs || []) {
        if (doc.policyId && doc.policy) {
          setRuntimeClarificationPolicy(doc.policyId, doc.policy);
        }
      }
    },
  },
};
