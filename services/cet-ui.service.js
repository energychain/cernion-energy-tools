'use strict';

const {
  REFERENCE_CASE_ID,
  buildReferenceUiGateway,
  buildReferenceUiGatewayContext,
} = require('../src/cet-ui-rc2/ui-gateway-adapter');
const { RC2_ROLE_IDS } = require('../src/cet-ui-rc2/fixtures/reference-tenant');

const caseIdPathParameter = {
  name: 'caseId',
  in: 'path',
  required: true,
  schema: { type: 'string', example: REFERENCE_CASE_ID },
  description: 'CET RC2 Vorgang identifier.',
};

const operationIdPathParameter = {
  name: 'operationId',
  in: 'path',
  required: true,
  schema: { type: 'string', example: 'mako.case.lookup' },
  description: 'Operationskonsole capability identifier.',
};

const jsonBody = (properties, required = []) => ({
  required: required.length > 0,
  content: {
    'application/json': {
      schema: { type: 'object', properties, required },
      examples: {
        reference: {
          value: Object.fromEntries(
            Object.entries(properties).map(([key, value]) => [key, value.example])
          ),
        },
      },
    },
  },
});

function requireAuthenticatedUiContext(ctx) {
  const tenantId = ctx?.meta?.authUser?.tenantId || ctx?.meta?.tenantId || ctx?.meta?.tenant?.id;
  const userId = ctx?.meta?.authUser?.userId || ctx?.meta?.user?.id || ctx?.meta?.userId;
  if (!tenantId || !userId) {
    throw new Error('CET RC2 UI requires authenticated tenant and user context.');
  }
  return { tenantId, userId };
}

function activeRoleFrom(ctx) {
  const requestedRoleId = ctx?.meta?.activeRoleId;
  const authenticatedRoles = Array.isArray(ctx?.meta?.authUser?.roles)
    ? ctx.meta.authUser.roles
    : [];
  if (requestedRoleId && authenticatedRoles.includes(requestedRoleId)) return requestedRoleId;
  const rc2RoleFromAuth = authenticatedRoles.find((role) => /^RC2_ROLE_/.test(String(role || '')));
  if (rc2RoleFromAuth) return rc2RoleFromAuth;
  return requestedRoleId || RC2_ROLE_IDS.MARKTKOMMUNIKATION;
}

function rc2GatewayContextFrom(ctx) {
  const { tenantId, userId } = requireAuthenticatedUiContext(ctx);
  return buildReferenceUiGatewayContext({
    tenantId,
    userId,
    activeRoleId: activeRoleFrom(ctx),
    now: ctx?.params?.now || ctx?.meta?.now || '2026-09-21T12:00:00Z',
  });
}

function gatewayFromRuntime(runtime) {
  if (!runtime.rc2Gateway) runtime.rc2Gateway = buildReferenceUiGateway();
  return runtime.rc2Gateway;
}

module.exports = {
  name: 'cet-ui',
  settings: {
    rest: '/ui/v0',
  },

  created() {
    this.rc2Gateway = buildReferenceUiGateway();
  },

  actions: {
    sessionContext: {
      rest: 'GET /session-context',
      openapi: {
        summary: 'Get CET RC2 UI session context',
        tags: ['CET UI RC2'],
      },
      handler(ctx) {
        return gatewayFromRuntime(this).getSessionContext(rc2GatewayContextFrom(ctx));
      },
    },

    dailySurface: {
      rest: 'GET /daily-surface',
      openapi: {
        summary: 'Get CET RC2 daily surface interaction projections',
        tags: ['CET UI RC2'],
      },
      handler(ctx) {
        return gatewayFromRuntime(this).getDailySurface(rc2GatewayContextFrom(ctx));
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
        parameters: [caseIdPathParameter],
      },
      handler(ctx) {
        return gatewayFromRuntime(this).getCase(rc2GatewayContextFrom(ctx), {
          caseId: ctx.params.caseId || REFERENCE_CASE_ID,
        });
      },
    },

    evidence: {
      rest: 'GET /cases/:caseId/evidence',
      params: {
        caseId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get CET RC2 evidence dossier view model',
        tags: ['CET UI RC2'],
        parameters: [caseIdPathParameter],
      },
      handler(ctx) {
        return gatewayFromRuntime(this).getEvidence(rc2GatewayContextFrom(ctx), {
          caseId: ctx.params.caseId || REFERENCE_CASE_ID,
        });
      },
    },

    claimCase: {
      rest: 'POST /cases/:caseId/claim',
      params: {
        caseId: { type: 'string', optional: true },
        basisRev: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Claim CET RC2 Vorgang through CET-owned state',
        tags: ['CET UI RC2'],
        parameters: [caseIdPathParameter],
        requestBody: jsonBody({ basisRev: { type: 'string', example: 'rev-1' } }, []),
      },
      handler(ctx) {
        return gatewayFromRuntime(this).claimCase(rc2GatewayContextFrom(ctx), {
          caseId: ctx.params.caseId || REFERENCE_CASE_ID,
          basisRev: ctx.params.basisRev,
        });
      },
    },

    freeze: {
      rest: 'POST /cases/:caseId/freeze',
      params: {
        caseId: { type: 'string', optional: true },
        basisRev: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Persist CET-internal freeze for a Vorgang',
        tags: ['CET UI RC2'],
        parameters: [caseIdPathParameter],
        requestBody: jsonBody({ basisRev: { type: 'string', example: 'rev-2' } }, []),
      },
      handler(ctx) {
        return gatewayFromRuntime(this).freezeCase(rc2GatewayContextFrom(ctx), {
          caseId: ctx.params.caseId || REFERENCE_CASE_ID,
          basisRev: ctx.params.basisRev,
        });
      },
    },

    requestApproval: {
      rest: 'POST /cases/:caseId/approval-requests',
      params: {
        caseId: { type: 'string', optional: true },
        basisRev: { type: 'string', optional: true },
        roleId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Persist CET-internal approval request for a Vorgang',
        tags: ['CET UI RC2'],
        parameters: [caseIdPathParameter],
        requestBody: jsonBody(
          {
            basisRev: { type: 'string', example: 'rev-3' },
            roleId: { type: 'string', example: RC2_ROLE_IDS.ABTEILUNGSLEITUNG },
          },
          []
        ),
      },
      handler(ctx) {
        return gatewayFromRuntime(this).requestApproval(rc2GatewayContextFrom(ctx), {
          caseId: ctx.params.caseId || REFERENCE_CASE_ID,
          basisRev: ctx.params.basisRev,
          roleId: ctx.params.roleId,
        });
      },
    },

    operations: {
      rest: 'GET /operations',
      openapi: {
        summary: 'List CET RC2 Operationskonsole capabilities',
        tags: ['CET UI RC2'],
      },
      handler(ctx) {
        return gatewayFromRuntime(this).listOperations(rc2GatewayContextFrom(ctx));
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
        parameters: [operationIdPathParameter],
        requestBody: jsonBody({}, []),
      },
      handler(ctx) {
        return gatewayFromRuntime(this).prepareOperation(rc2GatewayContextFrom(ctx), {
          operationId: ctx.params.operationId,
        });
      },
    },

    recordAudit: {
      rest: 'POST /audit-events',
      params: {
        event: { type: 'string' },
        transport: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Record CET RC2 UI audit event inside the UI gateway boundary',
        tags: ['CET UI RC2'],
        requestBody: jsonBody(
          {
            event: { type: 'string', example: 'view_opened' },
            transport: { type: 'string', example: 'ui_gateway' },
            view: { type: 'string', example: 'tagesflaeche' },
          },
          ['event']
        ),
      },
      handler(ctx) {
        const { tenantId, userId } = requireAuthenticatedUiContext(ctx);
        const auditEvent = {
          schemaVersion: 'rc2.ui-audit-event.v1',
          transport: 'ui_gateway',
          ...ctx.params,
          tenantId,
          userId,
          activeRoleId: activeRoleFrom(ctx),
          at: ctx.params.at || ctx.meta?.now || '2026-09-21T12:00:00Z',
        };
        auditEvent.transport = 'ui_gateway';
        if (!Array.isArray(this.auditEvents)) this.auditEvents = [];
        this.auditEvents.push(auditEvent);
        return { ok: true, stored: true, auditEvent };
      },
    },
  },
};
