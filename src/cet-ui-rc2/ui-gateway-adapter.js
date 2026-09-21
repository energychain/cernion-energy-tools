'use strict';

const {
  RC2_ROLE_IDS,
  buildReferenceTenantFixture,
  resolvePlaceholderAgentForRole,
} = require('./fixtures/reference-tenant');
const { buildInteractionProjection } = require('./interaction-projection');
const { buildEvidenceDossier } = require('./evidence-dossier');
const { createReferenceRunCard, claimRunCard } = require('./run-card-state');
const {
  buildOperationAuditPayload,
  filterOperationCatalog,
  classifyOperationResult,
} = require('./operation-console-contract');

const REFERENCE_CASE_ID = 'vorgang-cr-lka-rv-001-article-id-change';

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function buildReferencePresentationContract() {
  return {
    schemaVersion: 'rc2.presentation-contract.v1',
    form: 'gate',
    titel: 'Artikel-ID-Änderung prüfen',
    stand: '2026-09-21T12:00:00Z',
    aussagen: [
      {
        id: 'artikel_id_aenderung_betroffen',
        label: 'Artikel-ID-Änderung betroffen',
        wert: true,
        aggregatzustand: 'nachweisakte',
        granularitaet: 'aggregat',
        sicherheit: 'belegt',
        quelle: {
          klasse: 'system_of_record',
          ref: 'evidence://rc2/reference-case/article-id-change',
          stand: '2026-09-21T12:00:00Z',
        },
      },
    ],
    befunde: [],
    handlungen: [
      {
        ref: 'ui://cases/claim',
        riskClass: 'cet_state_write',
        erlaubtFuerRolle: true,
      },
    ],
    nichtHandlungen: [
      {
        was: 'Externes Fachsystem ausführen',
        grund: 'RC2 UI Gateway führt keine externen Writes aus',
      },
    ],
  };
}

function buildReferenceOperationCatalog() {
  return [
    {
      id: 'mako.case.lookup',
      label: 'MaKo Vorgang prüfen',
      tenantIds: ['rc2-stadtwerk-a'],
      roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
      mode: 'projected',
    },
    {
      id: 'grid.raw.context',
      label: 'Netzkontext Rohdaten ansehen',
      tenantIds: ['rc2-stadtwerk-a'],
      roleIds: [RC2_ROLE_IDS.NETZPLANUNG],
      mode: 'unprojected',
    },
  ];
}

function buildReferenceUiGatewayContext({
  tenantId = 'rc2-stadtwerk-a',
  userId = 'user-mako-1',
  activeRoleId = RC2_ROLE_IDS.MARKTKOMMUNIKATION,
  now = '2026-09-21T12:00:00Z',
} = {}) {
  return { tenantId, userId, activeRoleId, now };
}

function findUser(fixture, { tenantId, userId }) {
  return fixture.users.find((user) => user.tenantId === tenantId && user.id === userId) || null;
}

function activeRoleCandidates(fixture, tenantId, user) {
  const humanRoleIds = new Set((user && user.roleIds) || []);
  return fixture.roles.map((role) => {
    const placeholder = resolvePlaceholderAgentForRole(fixture, { tenantId, roleId: role.id });
    return {
      roleId: role.id,
      label: role.label,
      available: humanRoleIds.has(role.id) || Boolean(placeholder),
      placeholderAgent: !humanRoleIds.has(role.id) && Boolean(placeholder),
      actorId: humanRoleIds.has(role.id) ? user.id : placeholder && placeholder.id,
    };
  });
}

function resolveActiveRoleId(fixture, context) {
  const user = findUser(fixture, context);
  const requestedRoleId = context.activeRoleId;
  if (user && (user.roleIds || []).includes(requestedRoleId)) return requestedRoleId;
  if (user && user.roleIds && user.roleIds.length > 0) return user.roleIds[0];
  if (
    !user &&
    resolvePlaceholderAgentForRole(fixture, { tenantId: context.tenantId, roleId: requestedRoleId })
  ) {
    return requestedRoleId;
  }
  const placeholder = fixture.placeholderAgents.find(
    (agent) => agent.tenantId === context.tenantId
  );
  return placeholder ? placeholder.roleIds[0] : null;
}

function buildProjection(activeRoleId) {
  return buildInteractionProjection(buildReferencePresentationContract(), {
    activeRoleId,
    surface: 'tagesfläche',
    decisionCriteria: [
      {
        id: 'article_id_review_required',
        state: 'offen',
        beeinflussbarDurch: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
        nextContributionTextKey: 'rc2.nextContribution.articleIdReview',
      },
    ],
  });
}

function buildReferenceUiGateway({ fixture = buildReferenceTenantFixture() } = {}) {
  return {
    getSessionContext(context) {
      const user = findUser(fixture, context);
      return {
        schemaVersion: 'rc2.ui-session-context.v1',
        tenant: clone(fixture.tenant),
        user: clone(user),
        roles: clone(fixture.roles),
        activeRoleCandidates: activeRoleCandidates(fixture, context.tenantId, user),
      };
    },

    getDailySurface(context) {
      const activeRoleId = resolveActiveRoleId(fixture, context);
      return {
        schemaVersion: 'rc2.ui-daily-surface.v1',
        tenantId: context.tenantId,
        activeRoleId,
        items: [
          {
            caseId: REFERENCE_CASE_ID,
            title: 'Artikel-ID-Änderung prüfen',
            aufmerksamkeitsgrund: 'uebergabe_an_mich',
            rollenwirkung: '14 Klärfälle müssen fachlich zugeordnet werden',
            status: 'Mir zugewiesen',
            interactionProjection: buildProjection(activeRoleId),
          },
        ],
      };
    },

    getCase(context, { caseId = REFERENCE_CASE_ID } = {}) {
      const activeRoleId = resolveActiveRoleId(fixture, context);
      return {
        schemaVersion: 'rc2.ui-case-view.v1',
        tenantId: context.tenantId,
        caseId,
        label: 'Artikel-ID-Änderung prüfen',
        primaryRoleId: activeRoleId,
        visibleStatus:
          activeRoleId === RC2_ROLE_IDS.MARKTKOMMUNIKATION
            ? 'mir_zugewiesen'
            : 'in_bearbeitung_durch_Marktkommunikation',
        presentationContract: buildReferencePresentationContract(),
        interactionProjection: buildProjection(activeRoleId),
      };
    },

    getEvidence(context) {
      const activeRoleId = resolveActiveRoleId(fixture, context);
      return buildEvidenceDossier({
        presentationContract: buildReferencePresentationContract(),
        interactionProjection: buildProjection(activeRoleId),
        schnittplanVersion: 'rc2.schnittplan.v1',
        frozenAt: context.now,
      });
    },

    claimCase(context, { caseId = REFERENCE_CASE_ID, basisRev = 'rev-1' } = {}) {
      const user = findUser(fixture, context);
      const activeRoleId = resolveActiveRoleId(fixture, context);
      const card = createReferenceRunCard({ tenantId: context.tenantId, caseId, basisRev });
      return claimRunCard(card, {
        basisRev,
        actor: user,
        roleId: activeRoleId,
        now: context.now,
      });
    },

    listOperations(context) {
      const activeRoleId = resolveActiveRoleId(fixture, context);
      return {
        schemaVersion: 'rc2.ui-operations-catalog.v1',
        tenantId: context.tenantId,
        activeRoleId,
        ...filterOperationCatalog(buildReferenceOperationCatalog(), { ...context, activeRoleId }),
      };
    },

    prepareOperation(context, { operationId } = {}) {
      const catalog = this.listOperations(context);
      const operation = catalog.available.find((entry) => entry.id === operationId);
      if (!operation) return { ok: false, code: 'operation_not_available', operationId };
      const result = classifyOperationResult({
        operationId,
        raw: {
          operationId,
          preparedAt: context.now,
          tenantId: context.tenantId,
          activeRoleId: catalog.activeRoleId,
        },
      });
      return {
        ...result,
        audit: buildOperationAuditPayload({
          tenantId: context.tenantId,
          userId: context.userId,
          activeRoleId: catalog.activeRoleId,
          operationId,
          projectionStatus: result.projectionStatus,
          at: context.now,
        }),
      };
    },
  };
}

module.exports = {
  REFERENCE_CASE_ID,
  buildReferencePresentationContract,
  buildReferenceUiGateway,
  buildReferenceUiGatewayContext,
};
