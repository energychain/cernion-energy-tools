'use strict';

const PouchDB = require('pouchdb');
// Legacy DB-backed RC2 service prototype kept for later A13-A17 REST gateway migration.
// The canonical A7-A10 state reducer is src/cet-ui-rc2/run-card-state.js; do not
// treat this service path as the accepted Laufkarten state boundary until that migration.
const { createUiStateStore, defaultCaseId, defaultTenantId } = require('../src/cet-rc2-ui-state');
const { toOperationResultRenderModel } = require('../src/cet-rc2-ui-contracts');

const DB_NAME = process.env.CET_UI_STATE_DB || 'cet-rc2-ui-state';

function tenantFrom(ctx) {
  return ctx?.params?.tenantId || ctx?.meta?.tenantId || ctx?.meta?.tenant?.id || defaultTenantId;
}

function actorFrom(ctx) {
  return {
    id:
      ctx?.params?.actorId ||
      ctx?.meta?.user?.id ||
      ctx?.meta?.userId ||
      'u-rc2-reference-market-ops-1',
    displayName:
      ctx?.params?.actorDisplayName ||
      ctx?.meta?.user?.displayName ||
      ctx?.meta?.displayName ||
      'RC2 Marktkommunikation',
  };
}

module.exports = {
  name: 'cet-ui',
  settings: {
    rest: '/ui/v0',
  },

  created() {
    this.db = new PouchDB(DB_NAME);
    this.store = createUiStateStore({ db: this.db });
  },

  stopped() {
    if (this.db?.close) return this.db.close();
    return null;
  },

  actions: {
    session: {
      rest: 'GET /session',
      openapi: {
        summary: 'Get CET RC2 UI session contract',
        tags: ['CET UI RC2'],
      },
      async handler(ctx) {
        return this.store.getSession({ tenantId: tenantFrom(ctx) });
      },
    },

    daily: {
      rest: 'GET /daily',
      openapi: {
        summary: 'Get CET RC2 daily surface',
        tags: ['CET UI RC2'],
      },
      async handler(ctx) {
        return this.store.getDailySurface({ tenantId: tenantFrom(ctx) });
      },
    },

    getCase: {
      rest: 'GET /cases/:caseId',
      params: {
        caseId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get fixed CET RC2 Vorgang view model',
        tags: ['CET UI RC2'],
      },
      async handler(ctx) {
        return this.store.getCase({
          tenantId: tenantFrom(ctx),
          caseId: ctx.params.caseId || defaultCaseId,
        });
      },
    },

    evidence: {
      rest: 'GET /cases/:caseId/evidence',
      params: {
        caseId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get CET RC2 evidence view model',
        tags: ['CET UI RC2'],
      },
      async handler(ctx) {
        return this.store.getEvidence({
          tenantId: tenantFrom(ctx),
          caseId: ctx.params.caseId || defaultCaseId,
        });
      },
    },

    takeOver: {
      rest: 'POST /cases/:caseId/takeover',
      params: {
        caseId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Persist CET-internal takeover for a Vorgang',
        tags: ['CET UI RC2'],
      },
      async handler(ctx) {
        return this.store.takeOver({
          tenantId: tenantFrom(ctx),
          caseId: ctx.params.caseId || defaultCaseId,
          actor: actorFrom(ctx),
        });
      },
    },

    freeze: {
      rest: 'POST /cases/:caseId/freeze',
      params: {
        caseId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Persist CET-internal freeze for a Vorgang',
        tags: ['CET UI RC2'],
      },
      async handler(ctx) {
        return this.store.freezeCase({
          tenantId: tenantFrom(ctx),
          caseId: ctx.params.caseId || defaultCaseId,
          actor: actorFrom(ctx),
        });
      },
    },

    requestApproval: {
      rest: 'POST /cases/:caseId/approval-requests',
      params: {
        caseId: { type: 'string', optional: true },
        roleId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Persist CET-internal approval request for a Vorgang',
        tags: ['CET UI RC2'],
      },
      async handler(ctx) {
        return this.store.requestApproval({
          tenantId: tenantFrom(ctx),
          caseId: ctx.params.caseId || defaultCaseId,
          roleId: ctx.params.roleId || 'ROLE_DEPARTMENT_HEAD',
          actor: actorFrom(ctx),
        });
      },
    },

    operations: {
      rest: 'GET /operations',
      openapi: {
        summary: 'List CET RC2 Operationskonsole capabilities',
        tags: ['CET UI RC2'],
      },
      async handler(ctx) {
        return this.store.listOperations({ tenantId: tenantFrom(ctx) });
      },
    },

    prepareOperation: {
      rest: 'POST /operations/:operationId/prepare',
      params: {
        operationId: { type: 'string' },
      },
      openapi: {
        summary: 'Prepare Operationskonsole capability without Fachsystem execute',
        tags: ['CET UI RC2'],
      },
      async handler(ctx) {
        const result = await this.store.prepareOperation({
          tenantId: tenantFrom(ctx),
          operationId: ctx.params.operationId,
          actor: actorFrom(ctx),
        });
        return toOperationResultRenderModel(result);
      },
    },
  },
};
