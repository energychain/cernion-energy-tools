'use strict';

/**
 * Evidence Revalidation Service — Origin Session Carry-Forward (v0.58)
 *
 * Persists structured evidence requirements that were left open by an earlier
 * dialog (e.g. "grid operator identity is missing"), correlates later
 * structured facts learned in other sessions to those open requirements, and
 * — on a match — signals the original session via `notification.dispatch`
 * (`dispatchType: 'evidence_revalidated'`).
 *
 * This service is a thin domain layer on top of the existing notification
 * transport (see services/notification.service.js and
 * src/notification-dispatch-types.json). It owns only the requirement model
 * and the correlation decision; message titles/summaries remain declared in
 * the dispatch-type registry.
 *
 * Privacy: only structured identifiers and field names are persisted or
 * forwarded — never raw prompts, chat transcripts, or learned fact values.
 */

const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, validateTenantId } = require('../src/tenant-context');

const DOC_PREFIX = 'evr:';

// Lifecycle of a persisted evidence requirement:
//   'missing' — evidence gap identified in the origin session, awaiting a fact
//   'updated' — a later structured fact correlated and the origin session was signalled
const REQUIREMENT_STATUS_MISSING = 'missing';
const REQUIREMENT_STATUS_UPDATED = 'updated';

// Identifiers that uniquely distinguish a metering-point / contract within a tenant.
// Used for object-scope correlation to prevent cross-contract false-positive matches
// (e.g. two moveOut flows for different meters sharing the same requestedFact).
const STRONG_SCOPE_IDENTIFIERS = ['meteringPointId', 'meterNumber', 'contractAccount', 'customerId'];

function nowIso() {
  return new Date().toISOString();
}

function trimString(value) {
  return String(value || '').trim();
}

function sanitizeError(error) {
  const message = trimString(error?.message || 'evidence_revalidation_failed');
  return message.replace(/\s+/g, ' ').slice(0, 240);
}

/**
 * Normalize a scope value into a canonical form.
 *
 * - null / undefined / empty string → null
 * - string → trimmed string (or null if blank)
 * - plain object → sorted keys, trimmed string values, empty/null entries removed
 *   (arrays and other non-plain-object types are rejected → null)
 */
function normalizeScope(scope) {
  if (scope === null || scope === undefined) return null;

  if (typeof scope === 'string') {
    const trimmed = scope.trim();
    return trimmed || null;
  }

  if (typeof scope === 'object' && !Array.isArray(scope)) {
    const normalized = {};
    for (const key of Object.keys(scope).sort()) {
      const val = scope[key];
      if (val === null || val === undefined) continue;
      const coerced = typeof val === 'string' ? val.trim() : val;
      if (typeof coerced === 'string' && coerced === '') continue;
      normalized[key] = coerced;
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  return null;
}

/**
 * A stable hash for fast equality checks.  String scopes are their own hash;
 * object scopes serialise to JSON (keys are already sorted by normalizeScope).
 */
function computeScopeHash(normalizedScope) {
  if (normalizedScope === null || normalizedScope === undefined) return null;
  if (typeof normalizedScope === 'string') return normalizedScope;
  return JSON.stringify(normalizedScope);
}

module.exports = {
  name: 'evidence-revalidation',

  settings: {
    dbPath: process.env.EVIDENCE_REVALIDATION_DB_PATH || './data/evidence-revalidation',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    await this.db.createIndex({ index: { fields: ['requestedFact'] } });
    this.logger.info(`Evidence Revalidation DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    /**
     * Persist a structured evidence requirement from an earlier (partial)
     * answer. Idempotent on (tenantId, evidenceRequirementId): re-recording
     * the same requirement returns the existing record unchanged.
     *
     * Only structured identifiers are accepted — there is intentionally no
     * field for prompt text, answer text, or chat transcripts.
     */
    recordRequirement: {
      params: {
        tenantId: { type: 'string', optional: true },
        evidenceRequirementId: { type: 'string', min: 1 },
        originSessionId: { type: 'string', min: 1 },
        originPersonaId: { type: 'string', optional: true },
        responsibleRole: { type: 'string', optional: true },
        requestedFact: { type: 'string', min: 1 },
        scope: { type: 'any', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const { doc, deduplicated } = await this.persistRequirement(tenantId, ctx.params);
        return { success: true, deduplicated, requirement: this.toPublic(doc) };
      },
    },

    /**
     * Correlation entry point: accepts a later structured fact (identified by
     * its field name, e.g. `gridOperatorBdew`) and looks for open ('missing')
     * requirements in the same tenant that were waiting on exactly that fact.
     *
     * On each match, the origin session is signalled through the existing
     * notification transport and the requirement is marked 'updated'. Once a
     * requirement is 'updated' it is no longer a correlation candidate, which
     * makes repeated correlation of the same fact idempotent at this layer —
     * on top of the dispatch-level idempotency already provided by
     * notification.dispatch.
     */
    correlateFact: {
      params: {
        tenantId: { type: 'string', optional: true },
        requestedFact: { type: 'string', min: 1 },
        scope: { type: 'any', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const requestedFact = trimString(ctx.params.requestedFact);
        // Normalize to null when not provided so scopeMatchesForCorrelation uses legacy path.
        const incomingScope = 'scope' in ctx.params ? normalizeScope(ctx.params.scope) : null;
        const correlated = await this.correlateLearnedFact(ctx, tenantId, requestedFact, incomingScope);
        return {
          success: true,
          tenantId,
          requestedFact,
          matchedCount: correlated.length,
          correlated,
        };
      },
    },
  },

  methods: {
    resolveTenantId(ctx, providedTenantId) {
      const metaTenantId = trimString(getTenantId(ctx));
      const tenantId = trimString(providedTenantId || metaTenantId || 'default');
      validateTenantId(tenantId);
      if (providedTenantId && metaTenantId && tenantId !== metaTenantId) {
        throw new MoleculerClientError(
          'Cross-tenant evidence revalidation access is not allowed',
          403,
          'EVIDENCE_REVALIDATION_TENANT_FORBIDDEN'
        );
      }
      return tenantId;
    },

    toPublic(doc) {
      const copy = { ...doc };
      delete copy._id;
      delete copy._rev;
      delete copy.scopeHash;
      return copy;
    },

    toDocId(tenantId, evidenceRequirementId) {
      return `${DOC_PREFIX}${tenantId}:${trimString(evidenceRequirementId)}`;
    },

    async tryGetByDocId(docId) {
      try {
        return await this.db.get(docId);
      } catch (error) {
        if (error?.status === 404) return null;
        throw error;
      }
    },

    async getTenantRequirements(tenantId) {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: `${DOC_PREFIX}${tenantId}:`,
        endkey: `${DOC_PREFIX}${tenantId}:\ufff0`,
      });
      return result.rows.map((row) => row.doc).filter(Boolean);
    },

    async persistRequirement(tenantId, params = {}) {
      const evidenceRequirementId = trimString(params.evidenceRequirementId);
      const originSessionId = trimString(params.originSessionId);
      const originPersonaId = trimString(params.originPersonaId) || null;
      const responsibleRole = trimString(params.responsibleRole) || null;
      const requestedFact = trimString(params.requestedFact);
      const scope = normalizeScope(params.scope);
      const scopeHash = computeScopeHash(scope);

      if (!originPersonaId && !responsibleRole) {
        throw new MoleculerClientError(
          'originPersonaId or responsibleRole is required',
          422,
          'VALIDATION_ERROR'
        );
      }

      const docId = this.toDocId(tenantId, evidenceRequirementId);
      const existing = await this.tryGetByDocId(docId);
      if (existing) {
        return { doc: existing, deduplicated: true };
      }

      const timestamp = nowIso();
      const doc = {
        _id: docId,
        type: 'evidence-requirement',
        tenantId,
        evidenceRequirementId,
        originSessionId,
        originPersonaId,
        responsibleRole,
        requestedFact,
        scope,
        scopeHash,
        status: REQUIREMENT_STATUS_MISSING,
        createdAt: timestamp,
        updatedAt: timestamp,
        revalidatedAt: null,
        lastDispatchId: null,
      };

      try {
        const putResult = await this.db.put(doc);
        doc._rev = putResult.rev;
        return { doc, deduplicated: false };
      } catch (error) {
        if (error?.status === 409) {
          const latest = await this.tryGetByDocId(docId);
          if (latest) {
            return { doc: latest, deduplicated: true };
          }
        }
        throw error;
      }
    },

    /**
     * Returns true when the requirement's stored scope is compatible with the
     * scope provided by the incoming correlateFact call.
     *
     * - incomingScope === null  → legacy mode: always match (old behaviour)
     * - incomingScope is string → must equal the requirement's scope exactly
     * - incomingScope is object → all STRONG_SCOPE_IDENTIFIERS present in
     *   incomingScope must be present AND equal in the requirement's scope;
     *   at least one strong identifier must be checked (prevents vacuous match)
     */
    scopeMatchesForCorrelation(requirementScope, incomingScope) {
      if (incomingScope === null || incomingScope === undefined) return true;

      if (typeof incomingScope === 'string') {
        return requirementScope === incomingScope;
      }

      if (typeof incomingScope === 'object') {
        if (!requirementScope || typeof requirementScope !== 'object') return false;
        let checkedAny = false;
        for (const key of STRONG_SCOPE_IDENTIFIERS) {
          const inVal = incomingScope[key];
          if (inVal !== undefined && inVal !== null) {
            checkedAny = true;
            if (requirementScope[key] !== inVal) return false;
          }
        }
        return checkedAny;
      }

      return false;
    },

    async correlateLearnedFact(ctx, tenantId, requestedFact, incomingScope) {
      const docs = await this.getTenantRequirements(tenantId);
      const candidates = docs.filter(
        (doc) =>
          doc.status === REQUIREMENT_STATUS_MISSING &&
          doc.requestedFact === requestedFact &&
          this.scopeMatchesForCorrelation(doc.scope, incomingScope)
      );

      const correlated = [];
      for (const requirement of candidates) {
        const dispatch = await this.dispatchRevalidationSignal(ctx, tenantId, requirement);
        const updated = await this.markRequirementUpdated(requirement, dispatch);
        correlated.push({
          evidenceRequirementId: updated.evidenceRequirementId,
          originSessionId: updated.originSessionId,
          status: updated.status,
          dispatch,
        });
      }
      return correlated;
    },

    async dispatchRevalidationSignal(ctx, tenantId, requirement) {
      try {
        const response = await ctx.call(
          'notification.dispatch',
          {
            tenantId,
            dispatchType: 'evidence_revalidated',
            evidenceRequirementId: requirement.evidenceRequirementId,
            originSessionId: requirement.originSessionId,
            revalidationStatus: REQUIREMENT_STATUS_UPDATED,
            personaId: requirement.originPersonaId || null,
            responsibleRole: requirement.responsibleRole || null,
            sourceService: 'evidence-revalidation',
            sourceAction: 'fact-linked',
          },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );

        return {
          dispatchId: response?.dispatch?.id || null,
          status: response?.dispatch?.status || null,
          deduplicated: Boolean(response?.deduplicated),
          warnings: [],
        };
      } catch (error) {
        if (
          error?.code === 404 ||
          error?.type === 'SERVICE_NOT_FOUND' ||
          error?.type === 'SERVICE_NOT_AVAILABLE'
        ) {
          return {
            dispatchId: null,
            status: 'failed',
            deduplicated: false,
            warnings: ['notification_dispatch_unavailable'],
          };
        }

        this.logger.warn(
          `[evidence-revalidation] notification dispatch failed for ${requirement.evidenceRequirementId}: ${sanitizeError(error)}`
        );
        return {
          dispatchId: null,
          status: 'failed',
          deduplicated: false,
          warnings: ['notification_dispatch_failed'],
        };
      }
    },

    async markRequirementUpdated(doc, dispatch) {
      const timestamp = nowIso();
      const updated = {
        ...doc,
        status: REQUIREMENT_STATUS_UPDATED,
        updatedAt: timestamp,
        revalidatedAt: timestamp,
        lastDispatchId: dispatch?.dispatchId || doc.lastDispatchId || null,
      };

      const putResult = await this.db.put(updated);
      updated._rev = putResult.rev;
      return updated;
    },
  },
};
