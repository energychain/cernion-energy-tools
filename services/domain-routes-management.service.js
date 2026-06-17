'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;
const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
const {
  setRuntimeRoute,
  removeRuntimeRoute,
  reloadDomainRoutes,
  getStaticRoutes,
  getRuntimeRoutes,
  setRuntimeCapability,
  removeRuntimeCapability,
  buildGapMarkerCapability,
  isUnsafePattern,
} = require('../src/domain-routes-registry');

// ── ID helpers ────────────────────────────────────────────────────────────────

const ROUTE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

function makeDraftId() {
  return `dr_${crypto.randomBytes(6).toString('hex')}`;
}

function draftDocId(routeId, draftId) {
  return `domain-route-draft:${routeId}:${draftId}`;
}

function activeDocId(routeId) {
  return `domain-route-active:${routeId}`;
}

function archiveDocId(routeId, version) {
  return `domain-route-archive:${routeId}:${version}`;
}

// ── Validation ────────────────────────────────────────────────────────────────

const SCORE_MIN = 100;
const SCORE_MAX = 125;
const VDMI_GUARD_SCORE = 120;

const GENERIC_ONLY_TERMS = new Set([
  'evidence', 'governance', 'freigabe', 'validierung', 'nachweis',
  'prüfung', 'pruefung', 'beleg', 'entscheidung',
]);

function validateRoute(route) {
  const errors = [];
  const warnings = [];

  if (!route || typeof route !== 'object') {
    return { valid: false, errors: [{ field: 'route', message: 'route must be an object' }], warnings: [] };
  }

  // id
  if (!route.id || typeof route.id !== 'string') {
    errors.push({ field: 'id', message: 'id is required and must be a string' });
  } else if (!ROUTE_ID_PATTERN.test(route.id)) {
    errors.push({ field: 'id', message: 'id must be lowercase snake_case (a-z, 0-9, underscores; must start with a letter)' });
  }

  // label
  if (!route.label) {
    warnings.push({ field: 'label', message: 'label is empty; add a human-readable label' });
  }

  // capability
  if (!route.capability || typeof route.capability !== 'string') {
    errors.push({ field: 'capability', message: 'capability is required and must be a string' });
  }

  // score
  if (route.score == null) {
    errors.push({ field: 'score', message: 'score is required' });
  } else if (typeof route.score !== 'number' || !isFinite(route.score)) {
    errors.push({ field: 'score', message: 'score must be a finite number' });
  } else if (route.score < SCORE_MIN || route.score > SCORE_MAX) {
    errors.push({ field: 'score', message: `score must be between ${SCORE_MIN} and ${SCORE_MAX} (inclusive)` });
  } else if (route.score >= VDMI_GUARD_SCORE) {
    warnings.push({
      field: 'score',
      message: `score ${route.score} is at or above the VDMI guardrail threshold (${VDMI_GUARD_SCORE}). Run VDMI positive-control tests before promoting.`,
    });
  }

  // triggers / combos — at least one must be present and non-empty
  const hasTriggers = Array.isArray(route.triggers) && route.triggers.some((t) => typeof t === 'string' && t.length > 0);
  const hasCombos = Array.isArray(route.combos) && route.combos.length > 0;
  if (!hasTriggers && !hasCombos) {
    errors.push({ field: 'triggers', message: 'At least one non-empty trigger or combo entry is required' });
  }

  // validate combo regex patterns
  if (Array.isArray(route.combos)) {
    for (let i = 0; i < route.combos.length; i++) {
      const combo = route.combos[i];
      if (!combo || !Array.isArray(combo.all)) {
        errors.push({ field: `combos[${i}]`, message: 'each combo must have an "all" array of regex strings' });
        continue;
      }
      for (let j = 0; j < combo.all.length; j++) {
        const pattern = combo.all[j];
        if (isUnsafePattern(pattern)) {
          errors.push({ field: `combos[${i}].all[${j}]`, message: `Pattern "${pattern}" is too broad or empty` });
        } else {
          try {
            new RegExp(pattern, 'i'); // eslint-disable-line no-new
          } catch (e) {
            errors.push({ field: `combos[${i}].all[${j}]`, message: `Invalid regex: ${e.message}` });
          }
        }
      }
    }
  }

  // warn: all triggers are generic governance terms (no domain-specific signal)
  if (hasTriggers) {
    const allGeneric = route.triggers.every((t) => GENERIC_ONLY_TERMS.has(String(t).toLowerCase()));
    if (allGeneric) {
      warnings.push({
        field: 'triggers',
        message: 'All triggers are generic governance terms (evidence, nachweis, etc.); add domain-specific phrases',
      });
    }
  }

  // warn: no negativeTriggers for routes that may overlap VDMI-adjacent terms
  if (!Array.isArray(route.negativeTriggers) || route.negativeTriggers.length === 0) {
    const mayOverlapVdmi = (route.triggers || []).some((t) =>
      ['projektvalidierung', 'mastr-kandidat', 'netzasset', 'asset relation'].some(
        (v) => String(t).toLowerCase().includes(v)
      )
    );
    if (mayOverlapVdmi) {
      warnings.push({
        field: 'negativeTriggers',
        message: 'Route triggers may overlap VDMI-adjacent terms; consider adding negativeTriggers',
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Capability materialization check ─────────────────────────────────────────

function capabilityExistsInCatalog(capabilityName) {
  return CURATED_CAPABILITIES.some((c) => c.capability === capabilityName);
}

const RUNTIME_CAPABILITIES_ENABLED = process.env.DOMAIN_ROUTES_RUNTIME_CAPABILITIES !== 'false';

function maybeRegisterRuntimeCapability(route) {
  if (!RUNTIME_CAPABILITIES_ENABLED) return false;
  if (capabilityExistsInCatalog(route.capability)) return false;
  const gapCap = buildGapMarkerCapability(route);
  setRuntimeCapability(route.capability, gapCap);
  return true;
}

// ── Public shape helpers ──────────────────────────────────────────────────────

function toDraftPublic(doc) {
  return {
    draftId: doc.draftId,
    routeId: doc.routeId,
    version: doc.version,
    validationStatus: doc.validationStatus,
    validationErrors: doc.validationErrors || [],
    validationWarnings: doc.validationWarnings || [],
    testStatus: doc.testStatus,
    testResults: doc.testResults || [],
    createdBy: doc.createdBy || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    promotedBy: doc.promotedBy || null,
    promotedAt: doc.promotedAt || null,
    route: doc.route,
    _rev: doc._rev,
  };
}

function toActivePublic(doc) {
  return {
    routeId: doc.routeId,
    version: doc.version,
    promotedAt: doc.promotedAt,
    promotedBy: doc.promotedBy || null,
    previousVersion: doc.previousVersion || null,
    runtimeCapabilityMaterialized: doc.runtimeCapabilityMaterialized || false,
    source: 'runtime',
    route: doc.route,
    _rev: doc._rev,
  };
}

// ── Service definition ────────────────────────────────────────────────────────

module.exports = {
  name: 'domain-routes',

  settings: {
    dbPath: process.env.DOMAIN_ROUTES_DB_PATH || './data/domain-routes-registry',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['type'] } });
    await this.db.createIndex({ index: { fields: ['type', 'routeId'] } });
    this.logger.info(`[domain-routes] DB ready at ${this.settings.dbPath}`);
    await this._restoreRuntimeOverlay();
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    // ── list ──────────────────────────────────────────────────────────────────
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
          const staticRoutes = getStaticRoutes();
          const runtimeRoutes = getRuntimeRoutes();
          const runtimeIds = new Set(runtimeRoutes.map((r) => r.id));
          for (const route of staticRoutes) {
            result.push({ ...route, source: runtimeIds.has(route.id) ? 'overridden' : 'static' });
          }
          for (const route of runtimeRoutes) {
            result.push({ ...route, source: 'runtime' });
          }
        }

        if (includeDrafts || includeActive) {
          const selectorOr = [];
          if (includeDrafts) selectorOr.push({ type: 'domain-route-draft' });
          if (includeActive) selectorOr.push({ type: 'domain-route-active' });

          const response = await this.db.find({
            selector: selectorOr.length === 1 ? selectorOr[0] : { $or: selectorOr },
            limit: 500,
          });
          const docs = Array.isArray(response.docs) ? response.docs : [];
          docs.sort((a, b) => String(b.createdAt || b.promotedAt || '').localeCompare(String(a.createdAt || a.promotedAt || '')));
          for (const doc of docs) {
            result.push(doc.type === 'domain-route-active' ? toActivePublic(doc) : toDraftPublic(doc));
          }
        }

        return { success: true, data: result, total: result.length };
      },
    },

    // ── get ───────────────────────────────────────────────────────────────────
    get: {
      rest: 'GET /:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const { id } = ctx.params;

        // Try active first
        let doc;
        try {
          doc = await this.db.get(activeDocId(id));
        } catch (e1) {
          if (e1?.status !== 404) throw e1;
          // Then try as draftId
          const found = await this.db.find({
            selector: { type: 'domain-route-draft' },
            limit: 2000,
          });
          doc = (found.docs || []).find((d) => d.draftId === id || d.routeId === id);
        }

        // Fallback: check static routes
        if (!doc) {
          const staticRoute = getStaticRoutes().find((r) => r.id === id);
          if (staticRoute) {
            return { success: true, source: 'static', route: staticRoute };
          }
        }

        if (!doc) {
          throw new MoleculerClientError(
            `Domain route not found: ${id}`,
            404,
            'ROUTE_NOT_FOUND',
            { id }
          );
        }

        return {
          success: true,
          data: doc.type === 'domain-route-active' ? toActivePublic(doc) : toDraftPublic(doc),
        };
      },
    },

    // ── createDraft ───────────────────────────────────────────────────────────
    createDraft: {
      rest: 'POST /drafts',
      params: {
        route: { type: 'object' },
        testCases: { type: 'array', optional: true, default: [] },
        version: { type: 'string', optional: true },
        createdBy: { type: 'string', optional: true },
        notes: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { route, testCases, version, createdBy, notes } = ctx.params;

        const validation = validateRoute(route);
        const draftId = makeDraftId();
        const now = new Date().toISOString();

        const doc = {
          _id: draftDocId(route.id || 'unknown', draftId),
          type: 'domain-route-draft',
          routeId: route.id || null,
          draftId,
          version: version || '1.0.0',
          route,
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
          promotedBy: null,
          promotedAt: null,
        };

        const result = await this.db.put(doc);
        doc._rev = result.rev;

        return {
          success: true,
          draftId,
          routeId: route.id || null,
          validationStatus: doc.validationStatus,
          validationErrors: doc.validationErrors,
          validationWarnings: doc.validationWarnings,
          data: toDraftPublic(doc),
        };
      },
    },

    // ── validate ──────────────────────────────────────────────────────────────
    validate: {
      rest: 'POST /:id/validate',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const doc = await this._loadDraft(ctx.params.id);
        const validation = validateRoute(doc.route);
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
          routeId: doc.routeId,
          validationStatus: updated.validationStatus,
          validationErrors: updated.validationErrors,
          validationWarnings: updated.validationWarnings,
        };
      },
    },

    // ── test ──────────────────────────────────────────────────────────────────
    test: {
      rest: 'POST /:id/test',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        const doc = await this._loadDraft(ctx.params.id);

        if (doc.validationStatus !== 'valid') {
          return {
            success: false,
            testStatus: 'failed',
            reason: 'Draft has validation errors; run /validate first.',
            validationErrors: doc.validationErrors,
          };
        }

        const testCases = Array.isArray(doc.testCases) ? doc.testCases : [];
        const testResults = await this._runTestMatrix(testCases);

        const allPassed = testResults.length === 0 || testResults.every((r) => r.passed);
        const testStatus = allPassed ? 'passed' : 'failed';

        const now = new Date().toISOString();
        const updated = { ...doc, testStatus, testResults, updatedAt: now };
        await this.db.put(updated);

        return {
          success: allPassed,
          testStatus,
          draftId: doc.draftId,
          routeId: doc.routeId,
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
            'ROUTE_NOT_VALID',
            { draftId: doc.draftId, validationStatus: doc.validationStatus }
          );
        }

        if (!allowWarnings && doc.validationWarnings?.length > 0) {
          throw new MoleculerClientError(
            'Draft has validation warnings and allowWarnings=false.',
            409,
            'ROUTE_HAS_WARNINGS',
            { draftId: doc.draftId, warnings: doc.validationWarnings }
          );
        }

        const routeId = doc.routeId;
        const now = new Date().toISOString();

        // Archive previous active if exists
        let previousVersion = null;
        let rollbackTarget = null;
        try {
          const prevActive = await this.db.get(activeDocId(routeId));
          previousVersion = prevActive.version;
          const archiveId = archiveDocId(routeId, prevActive.version || now);
          const archiveDoc = { ...prevActive, _id: archiveId, type: 'domain-route-archive', archivedAt: now };
          delete archiveDoc._rev;
          try {
            await this.db.put(archiveDoc);
            rollbackTarget = archiveId;
          } catch (_archErr) {
            // Non-fatal: archive collision
          }
          await this.db.remove(prevActive);
        } catch (err) {
          if (err?.status !== 404) throw err;
        }

        // Materialize runtime capability if needed (Option B)
        const runtimeCapabilityMaterialized = maybeRegisterRuntimeCapability(doc.route);

        // Write active document
        const activeDoc = {
          _id: activeDocId(routeId),
          type: 'domain-route-active',
          routeId,
          version: doc.version,
          route: doc.route,
          promotedAt: now,
          promotedBy: promotedBy || null,
          previousVersion,
          rollbackTarget,
          draftId: doc.draftId,
          runtimeCapabilityMaterialized,
        };

        const result = await this.db.put(activeDoc);
        activeDoc._rev = result.rev;

        // Apply runtime route overlay
        setRuntimeRoute(routeId, doc.route);

        // Mark draft as promoted
        await this.db.put({ ...doc, promotedBy: promotedBy || null, promotedAt: now, updatedAt: now });

        this.logger.info(`[domain-routes] Promoted ${routeId} v${doc.version} by ${promotedBy || 'unknown'}${runtimeCapabilityMaterialized ? ' (runtime capability materialized)' : ''}`);

        return {
          success: true,
          routeId,
          version: doc.version,
          promotedAt: now,
          promotedBy: promotedBy || null,
          runtimeCapabilityMaterialized,
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
              `No active runtime route found for: ${id}`,
              404,
              'ROUTE_NOT_FOUND',
              { routeId: id }
            );
          }
          throw err;
        }

        if (!currentActive.rollbackTarget) {
          throw new MoleculerClientError(
            `Route '${id}' has no rollback target (no previous version archived).`,
            409,
            'ROUTE_NO_ROLLBACK_TARGET',
            { routeId: id }
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
              'ROUTE_ROLLBACK_TARGET_MISSING',
              { routeId: id, rollbackTarget: currentActive.rollbackTarget }
            );
          }
          throw err;
        }

        const now = new Date().toISOString();
        await this.db.remove(currentActive);

        const restoredActive = {
          _id: activeDocId(id),
          type: 'domain-route-active',
          routeId: id,
          version: archiveDoc.version,
          route: archiveDoc.route,
          promotedAt: now,
          promotedBy: rolledBackBy || null,
          previousVersion: currentActive.version,
          rollbackTarget: archiveDoc.rollbackTarget || null,
          rolledBackAt: now,
          rolledBackBy: rolledBackBy || null,
          runtimeCapabilityMaterialized: archiveDoc.runtimeCapabilityMaterialized || false,
        };

        const result = await this.db.put(restoredActive);
        restoredActive._rev = result.rev;

        setRuntimeRoute(id, archiveDoc.route);
        if (archiveDoc.runtimeCapabilityMaterialized) {
          setRuntimeCapability(archiveDoc.route.capability, buildGapMarkerCapability(archiveDoc.route));
        }

        this.logger.info(`[domain-routes] Rolled back ${id} to v${archiveDoc.version} by ${rolledBackBy || 'unknown'}`);

        return {
          success: true,
          routeId: id,
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
            throw new MoleculerClientError(
              `No active runtime route: ${id}`,
              404,
              'ROUTE_NOT_FOUND',
              { routeId: id }
            );
          }
          throw err;
        }

        await this.db.remove(activeDoc);

        const removed = removeRuntimeRoute(id);
        if (activeDoc.runtimeCapabilityMaterialized && activeDoc.route?.capability) {
          removeRuntimeCapability(activeDoc.route.capability);
        }

        this.logger.info(`[domain-routes] Deactivated ${id} (runtime route removed: ${removed})`);

        return {
          success: true,
          routeId: id,
          deactivatedAt: new Date().toISOString(),
          runtimeRouteRemoved: removed,
          note: getStaticRoutes().some((r) => r.id === id)
            ? 'Static baseline route is still active via repo file.'
            : 'No static baseline; route is now fully removed.',
        };
      },
    },

    // ── reload ────────────────────────────────────────────────────────────────
    reload: {
      rest: 'POST /reload',
      params: {},
      async handler() {
        await this._restoreRuntimeOverlay();
        const routes = reloadDomainRoutes();
        this.logger.info(`[domain-routes] Reloaded registry (${routes.length} compiled routes)`);
        return {
          success: true,
          compiledRouteCount: routes.length,
          reloadedAt: new Date().toISOString(),
        };
      },
    },
  },

  methods: {
    async _loadDraft(draftId) {
      const response = await this.db.find({
        selector: { type: 'domain-route-draft' },
        limit: 2000,
      });

      const docs = Array.isArray(response.docs) ? response.docs : [];
      const doc = docs.find((d) => d.draftId === draftId);

      if (!doc) {
        throw new MoleculerClientError(
          `Draft not found: ${draftId}`,
          404,
          'ROUTE_DRAFT_NOT_FOUND',
          { draftId }
        );
      }

      return doc;
    },

    async _runTestMatrix(testCases) {
      const results = [];
      for (const tc of testCases) {
        if (!tc || typeof tc.prompt !== 'string') continue;
        let result;
        try {
          result = await this.broker.call('capability-broker.recommend', {
            task: tc.prompt,
          });
        } catch (err) {
          results.push({ name: tc.name || tc.prompt.slice(0, 40), passed: false, error: err.message });
          continue;
        }
        const passed = result.capability === tc.expectedCapability;
        results.push({
          name: tc.name || tc.prompt.slice(0, 40),
          passed,
          actual: result.capability,
          expected: tc.expectedCapability,
        });
      }
      return results;
    },

    async _restoreRuntimeOverlay() {
      try {
        const response = await this.db.find({
          selector: { type: 'domain-route-active' },
          limit: 1000,
        });

        const docs = Array.isArray(response.docs) ? response.docs : [];
        let count = 0;

        for (const doc of docs) {
          if (doc.route && doc.routeId) {
            setRuntimeRoute(doc.routeId, doc.route);
            if (doc.runtimeCapabilityMaterialized && doc.route.capability) {
              setRuntimeCapability(doc.route.capability, buildGapMarkerCapability(doc.route));
            }
            count++;
          }
        }

        if (count > 0) {
          reloadDomainRoutes();
          this.logger.info(`[domain-routes] Restored ${count} runtime route(s) from store`);
        }
      } catch (err) {
        this.logger.warn(`[domain-routes] Could not restore runtime overlay: ${err.message} — falling back to static routes`);
      }
    },
  },
};
