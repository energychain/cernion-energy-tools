'use strict';

/**
 * Evidence Requirement Service — Multi-User Lifecycle (v0.63.2)
 *
 * Manages structured evidence requirements that arise from Answer Dossier
 * `missing_evidence_requirement` facts and VDMI evidence gaps.  Owns the
 * full requirement lifecycle:
 *
 *   open → answered (low, user-supplied) → validated (explicit markValidated)
 *
 * Security constraints:
 *   - ctx.meta.tenantId is always authoritative; payload tenantId is advisory.
 *   - Cross-tenant access is blocked unconditionally.
 *   - answerRequirement does NOT auto-promote to validated; only markValidated
 *     may do so (explicit, auditable step).
 *   - projectScope prevents project-mixing (Sinsheim / Mauer etc.).
 */

const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, validateTenantId } = require('../src/tenant-context');

const DOC_PREFIX = 'evreq:';

const STATUS_OPEN = 'open';
const STATUS_ANSWERED = 'answered';
const STATUS_VALIDATED = 'validated';

// Role heuristic — map evidence label keywords to responsible roles.
// Add/extend here; personal-agent routing and listOpenForRole both use this.
const ROLE_HEURISTIC_PATTERNS = [
  [/netzbetreiber|netzverkn[üu]pfungspunkt|umspannwerk|\btab\b|technische\s+anschlussbedingungen|netzkapazit[äa]t|spannungsebene|netzanschluss|netzanschlusszusage|anschlusszusage|netzanschlussprüfung|netzanschlusspr[üu]fung/i, 'netzplanung'],
  [/lastprofil|zeitreihe|viertelstunden|messung|smartmeter/i, 'messwesen'],
  [/genehmigung|baugenehmigung|recht|zulassung|behörde|beh[öo]rde|bebauungsplan/i, 'regulatory'],
  [/netzstudie|gutachten|machbarkeit/i, 'netzplanung'],
];

// Check both label and requestedFact so auto-synced dossier requirements with generic
// label ("Fehlende Evidence-Anforderung") can still be role-inferred from the concrete fact.
function inferResponsibleRole(label = '', requestedFact = '') {
  const combined = `${label} ${requestedFact}`;
  for (const [pattern, role] of ROLE_HEURISTIC_PATTERNS) {
    if (pattern.test(combined)) return role;
  }
  return null;
}

function trimString(value) {
  return String(value || '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeError(error) {
  const message = trimString(error?.message || 'evidence_requirement_failed');
  return message.replace(/\s+/g, ' ').slice(0, 240);
}

// Normalize projectScope to a stable string key for cross-project isolation.
function normalizeProjectScope(scope) {
  if (!scope || typeof scope !== 'object') return null;
  const parts = [];
  if (scope.scopeKey) return scope.scopeKey;
  if (scope.normalizedLocation) parts.push(scope.normalizedLocation);
  if (scope.normalizedPower) parts.push(scope.normalizedPower);
  if (scope.postalCode) parts.push(scope.postalCode);
  return parts.length > 0 ? parts.join('|') : null;
}

module.exports = {
  name: 'evidence-requirement',

  settings: {
    dbPath: process.env.EVIDENCE_REQUIREMENT_DB_PATH || './data/evidence-requirement',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    await this.db.createIndex({ index: { fields: ['responsibleRole'] } });
    await this.db.createIndex({ index: { fields: ['projectScopeKey'] } });
    this.logger.info(`Evidence Requirement DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * Create or upsert an evidence requirement.
     * Idempotent on (tenantId, requirementId).
     * Does NOT overwrite an existing requirement's status.
     */
    upsert: {
      params: {
        tenantId: { type: 'string', optional: true },
        requirementId: { type: 'string', min: 1 },
        label: { type: 'string', min: 1 },
        requestedFact: { type: 'string', min: 1 },
        originSessionId: { type: 'string', min: 1 },
        responsibleRole: { type: 'string', optional: true },
        projectScope: { type: 'object', optional: true },
        waitingSessions: { type: 'array', items: 'string', optional: true },
      },
      openapi: {
        summary: 'Create or upsert a structured evidence requirement',
        tags: ['evidence-requirement'],
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const { doc, deduplicated } = await this.persistRequirement(tenantId, ctx.params);
        return { success: true, deduplicated, requirement: this.toPublic(doc) };
      },
    },

    /**
     * List all open requirements assigned to a responsible role.
     * Tenant-scoped. Optionally filtered by projectScopeKey.
     */
    listOpenForRole: {
      params: {
        tenantId: { type: 'string', optional: true },
        role: { type: 'string', min: 1 },
        projectScopeKey: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List open evidence requirements for a given role',
        tags: ['evidence-requirement'],
        parameters: [
          { name: 'role', in: 'query', required: true, schema: { type: 'string', example: 'netzplanung' } },
          { name: 'projectScopeKey', in: 'query', schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const role = trimString(ctx.params.role);
        const projectScopeKey = trimString(ctx.params.projectScopeKey) || null;

        const docs = await this.getTenantRequirements(tenantId);
        let items = docs.filter((doc) => doc.status === STATUS_OPEN && doc.responsibleRole === role);

        if (projectScopeKey) {
          items = items.filter((doc) => doc.projectScopeKey === projectScopeKey);
        }

        return {
          success: true,
          role,
          tenantId,
          count: items.length,
          items: items.map((doc) => this.toPublic(doc)),
        };
      },
    },

    /**
     * Record an answer for an open requirement.
     * Status transitions: open → answered.
     * Does NOT auto-promote to validated.
     * Dispatches evidence_revalidated notification (revalidationStatus='answered').
     */
    answerRequirement: {
      params: {
        tenantId: { type: 'string', optional: true },
        requirementId: { type: 'string', min: 1 },
        answer: { type: 'string', min: 1 },
        sourceSessionId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Record an answer for an open evidence requirement (answered, not yet validated)',
        tags: ['evidence-requirement'],
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const requirementId = trimString(ctx.params.requirementId);
        const answer = trimString(ctx.params.answer);
        const sourceSessionId = trimString(ctx.params.sourceSessionId) || null;

        const docId = this.toDocId(tenantId, requirementId);
        const doc = await this.tryGetByDocId(docId);
        if (!doc) {
          throw new MoleculerClientError(
            `Evidence requirement not found: ${requirementId}`,
            404,
            'REQUIREMENT_NOT_FOUND'
          );
        }
        if (doc.status === STATUS_VALIDATED) {
          return { success: true, alreadyValidated: true, requirement: this.toPublic(doc) };
        }

        const now = nowIso();
        const updated = {
          ...doc,
          status: STATUS_ANSWERED,
          answer: { value: answer, sourceSessionId, answeredAt: now },
          updatedAt: now,
        };

        await this.db.put(updated);

        await this.dispatchRevalidation(ctx, tenantId, updated, 'answered');

        return { success: true, requirement: this.toPublic(updated) };
      },
    },

    /**
     * Promote an answered (or open) requirement to validated.
     * This is the only path to validated status.
     * Dispatches evidence_revalidated notification (revalidationStatus='validated').
     */
    markValidated: {
      params: {
        tenantId: { type: 'string', optional: true },
        requirementId: { type: 'string', min: 1 },
        validatedBy: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Explicitly validate an answered evidence requirement',
        tags: ['evidence-requirement'],
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const requirementId = trimString(ctx.params.requirementId);
        const validatedBy = trimString(ctx.params.validatedBy) || ctx.meta?.authUser?.userId || null;

        const docId = this.toDocId(tenantId, requirementId);
        const doc = await this.tryGetByDocId(docId);
        if (!doc) {
          throw new MoleculerClientError(
            `Evidence requirement not found: ${requirementId}`,
            404,
            'REQUIREMENT_NOT_FOUND'
          );
        }
        if (doc.status === STATUS_VALIDATED) {
          return { success: true, alreadyValidated: true, requirement: this.toPublic(doc) };
        }

        const now = nowIso();
        const updated = {
          ...doc,
          status: STATUS_VALIDATED,
          validatedAt: now,
          validatedBy,
          updatedAt: now,
        };

        await this.db.put(updated);

        await this.dispatchRevalidation(ctx, tenantId, updated, 'validated');

        return { success: true, requirement: this.toPublic(updated) };
      },
    },

    /**
     * List all sessions waiting on a given requirement.
     * Returns the originSessionId plus any additional waitingSessions.
     */
    listWaitingSessions: {
      params: {
        tenantId: { type: 'string', optional: true },
        requirementId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'List sessions waiting on an evidence requirement',
        tags: ['evidence-requirement'],
        parameters: [
          { name: 'requirementId', in: 'path', required: true, schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const requirementId = trimString(ctx.params.requirementId);

        const docId = this.toDocId(tenantId, requirementId);
        const doc = await this.tryGetByDocId(docId);
        if (!doc) {
          throw new MoleculerClientError(
            `Evidence requirement not found: ${requirementId}`,
            404,
            'REQUIREMENT_NOT_FOUND'
          );
        }

        const sessions = [
          doc.originSessionId,
          ...((Array.isArray(doc.waitingSessions) ? doc.waitingSessions : [])),
        ].filter(Boolean);

        return {
          success: true,
          requirementId,
          status: doc.status,
          sessions,
          count: sessions.length,
        };
      },
    },

    /**
     * Normalize VDMI dossier.evidenceGaps into open Requirements.
     * Creates a requirement for each gap not already present.
     * Origin session and projectScope are required for scoping.
     */
    fromVdmiEvidenceGaps: {
      params: {
        tenantId: { type: 'string', optional: true },
        evidenceGaps: { type: 'array', min: 0 },
        originSessionId: { type: 'string', min: 1 },
        projectScope: { type: 'object', optional: true },
        responsibleRole: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const { evidenceGaps = [], originSessionId, projectScope = null, responsibleRole = null } = ctx.params;

        const results = [];
        for (const gap of evidenceGaps) {
          const label = trimString(gap.label || gap.requirementId || 'unknown');
          const requestedFact = trimString(gap.requirementId || gap.reason || label);
          if (!label || !requestedFact) continue;

          const requirementId = `vdmi:${originSessionId}:${requestedFact}`;
          const role = responsibleRole || inferResponsibleRole(label, requestedFact);

          const { doc, deduplicated } = await this.persistRequirement(tenantId, {
            requirementId,
            label,
            requestedFact,
            originSessionId,
            responsibleRole: role,
            projectScope,
          });
          results.push({ requirementId, deduplicated, status: doc.status });
        }

        return { success: true, tenantId, created: results.filter((r) => !r.deduplicated).length, results };
      },
    },

    /**
     * Infer role for a requirement label without persisting anything.
     * Utility for caller-side role routing.
     */
    inferRole: {
      params: {
        label: { type: 'string', min: 1 },
        requestedFact: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const role = inferResponsibleRole(ctx.params.label, ctx.params.requestedFact || '');
        return { label: ctx.params.label, responsibleRole: role };
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
          'Cross-tenant evidence requirement access is not allowed',
          403,
          'EVIDENCE_REQUIREMENT_TENANT_FORBIDDEN'
        );
      }
      return tenantId;
    },

    toDocId(tenantId, requirementId) {
      return `${DOC_PREFIX}${tenantId}:${trimString(requirementId)}`;
    },

    toPublic(doc) {
      const copy = { ...doc };
      delete copy._id;
      delete copy._rev;
      return copy;
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
        endkey: `${DOC_PREFIX}${tenantId}:￰`,
      });
      return result.rows.map((row) => row.doc).filter(Boolean);
    },

    async persistRequirement(tenantId, params = {}) {
      const requirementId = trimString(params.requirementId);
      const label = trimString(params.label);
      const requestedFact = trimString(params.requestedFact);
      const originSessionId = trimString(params.originSessionId);
      const responsibleRole = trimString(params.responsibleRole) || inferResponsibleRole(label, requestedFact) || null;
      const projectScope = params.projectScope || null;
      const projectScopeKey = normalizeProjectScope(projectScope);
      const waitingSessions = Array.isArray(params.waitingSessions)
        ? params.waitingSessions.filter(Boolean)
        : [];

      const docId = this.toDocId(tenantId, requirementId);
      const existing = await this.tryGetByDocId(docId);
      if (existing) {
        // Merge new waiting sessions into existing doc without overwriting status.
        const merged = {
          ...existing,
          waitingSessions: Array.from(
            new Set([...(existing.waitingSessions || []), ...waitingSessions])
          ),
          updatedAt: nowIso(),
        };
        if (
          merged.waitingSessions.length !== (existing.waitingSessions || []).length
        ) {
          await this.db.put(merged);
          return { doc: merged, deduplicated: true };
        }
        return { doc: existing, deduplicated: true };
      }

      const now = nowIso();
      const doc = {
        _id: docId,
        type: 'evidence-requirement',
        tenantId,
        requirementId,
        label,
        requestedFact,
        originSessionId,
        responsibleRole,
        projectScope,
        projectScopeKey,
        waitingSessions,
        status: STATUS_OPEN,
        answer: null,
        validatedAt: null,
        validatedBy: null,
        createdAt: now,
        updatedAt: now,
      };

      try {
        const putResult = await this.db.put(doc);
        doc._rev = putResult.rev;
        return { doc, deduplicated: false };
      } catch (error) {
        if (error?.status === 409) {
          const latest = await this.tryGetByDocId(docId);
          if (latest) return { doc: latest, deduplicated: true };
        }
        throw error;
      }
    },

    async dispatchRevalidation(ctx, tenantId, requirement, revalidationStatus) {
      try {
        await ctx.call(
          'notification.dispatch',
          {
            tenantId,
            dispatchType: 'evidence_revalidated',
            evidenceRequirementId: requirement.requirementId,
            originSessionId: requirement.originSessionId,
            revalidationStatus,
            responsibleRole: requirement.responsibleRole || null,
            sourceService: 'evidence-requirement',
            sourceAction: revalidationStatus,
          },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );

        const waitingSessions = Array.isArray(requirement.waitingSessions)
          ? requirement.waitingSessions
          : [];
        for (const sessionId of waitingSessions) {
          if (sessionId === requirement.originSessionId) continue;
          try {
            await ctx.call(
              'notification.dispatch',
              {
                tenantId,
                dispatchType: 'evidence_revalidated',
                evidenceRequirementId: requirement.requirementId,
                originSessionId: sessionId,
                revalidationStatus,
                responsibleRole: requirement.responsibleRole || null,
                sourceService: 'evidence-requirement',
                sourceAction: `${revalidationStatus}:waiting`,
              },
              { meta: { ...ctx.meta, tenantId, $gateway: false } }
            );
          } catch (_err) {
            // non-blocking — waiting session notification failure is not fatal
          }
        }
      } catch (error) {
        // Notification is best-effort; requirement status has already been persisted.
        this.logger?.warn(
          `evidence-requirement: notification dispatch failed (non-blocking): ${sanitizeError(error)}`
        );
      }
    },
  },
};
