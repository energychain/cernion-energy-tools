'use strict';

const {
  RC2_ROLE_IDS,
  buildReferenceTenantFixture,
  resolvePlaceholderAgentForRole,
} = require('./fixtures/reference-tenant');
const { buildInteractionProjection } = require('./interaction-projection');
const { buildEvidenceDossier } = require('./evidence-dossier');
const {
  createReferenceRunCard,
  claimRunCard,
  freezeRunCard,
  requestApproval,
} = require('./run-card-state');
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
      riskClass: 'read',
      method: 'GET',
      governancePolicy: { id: 'rc2.mako.read', allowed: true, allowedMethods: ['GET'] },
    },
    {
      id: 'grid.raw.context',
      label: 'Netzkontext Rohdaten ansehen',
      tenantIds: ['rc2-stadtwerk-a'],
      roleIds: [RC2_ROLE_IDS.NETZPLANUNG],
      mode: 'unprojected',
      riskClass: 'read_raw',
      method: 'GET',
      governancePolicy: { id: 'rc2.grid.raw.read', allowed: true, allowedMethods: ['GET'] },
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

function buildReferenceUiGateway({
  fixture = buildReferenceTenantFixture(),
  initialCards = [],
} = {}) {
  const cards = new Map(initialCards.map((card) => [card.caseId, clone(card)]));

  function getOrCreateCard(context, { caseId = REFERENCE_CASE_ID, basisRev = 'rev-1' } = {}) {
    if (!cards.has(caseId)) {
      cards.set(caseId, createReferenceRunCard({ tenantId: context.tenantId, caseId, basisRev }));
    }
    return clone(cards.get(caseId));
  }

  function storeCard(card) {
    cards.set(card.caseId, clone(card));
    return clone(card);
  }

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
      const card = getOrCreateCard(context, { caseId });
      return {
        schemaVersion: 'rc2.ui-case-view.v1',
        tenantId: context.tenantId,
        caseId,
        label: 'Artikel-ID-Änderung prüfen',
        primaryRoleId: activeRoleId,
        basisRev: card.basisRev,
        assignment: clone(card.assignment),
        evidenceState: clone(card.evidenceState),
        approvalRequests: clone(card.hitlRequests || []),
        visibleStatus:
          card.assignment?.status === 'mir_zugewiesen'
            ? 'mir_zugewiesen'
            : activeRoleId === RC2_ROLE_IDS.MARKTKOMMUNIKATION
              ? 'offen'
              : 'in_bearbeitung_durch_Marktkommunikation',
        presentationContract: buildReferencePresentationContract(),
        interactionProjection: buildProjection(activeRoleId),
      };
    },

    getEvidence(context, { caseId = REFERENCE_CASE_ID } = {}) {
      const activeRoleId = resolveActiveRoleId(fixture, context);
      const card = getOrCreateCard(context, { caseId });
      if (card.evidenceState?.status !== 'eingefroren') {
        return {
          schemaVersion: 'rc2.evidence-dossier.v1',
          tenantId: context.tenantId,
          caseId,
          freezeStatus: 'nicht_eingefroren',
          materializedStatements: [],
          hashRefOnlyNotices: [],
          sourceRefs: [],
          approvalRequests: clone(card.hitlRequests || []),
        };
      }
      return {
        ...buildEvidenceDossier({
          presentationContract: buildReferencePresentationContract(),
          interactionProjection: buildProjection(activeRoleId),
          schnittplanVersion: 'rc2.schnittplan.v1',
          frozenAt: card.evidenceState.frozenAt,
        }),
        tenantId: context.tenantId,
        caseId,
        freezeStatus: 'eingefroren',
        actor: clone(card.evidenceState.actor),
        roleId: card.evidenceState.actor?.roleIds?.[0] || activeRoleId,
        approvalRequests: clone(card.hitlRequests || []),
      };
    },

    claimCase(context, { caseId = REFERENCE_CASE_ID, basisRev = 'rev-1' } = {}) {
      const user = findUser(fixture, context);
      const activeRoleId = resolveActiveRoleId(fixture, context);
      const card = getOrCreateCard(context, { caseId, basisRev });
      const result = claimRunCard(card, {
        basisRev: basisRev || card.basisRev,
        actor: user,
        roleId: activeRoleId,
        now: context.now,
      });
      if (result.ok) result.card = storeCard(result.card);
      return result;
    },

    freezeCase(context, { caseId = REFERENCE_CASE_ID, basisRev } = {}) {
      const user = findUser(fixture, context);
      const card = getOrCreateCard(context, { caseId });
      const result = freezeRunCard(card, {
        basisRev: basisRev || card.basisRev,
        actor: user,
        now: context.now,
      });
      if (result.ok) result.card = storeCard(result.card);
      return result;
    },

    requestApproval(context, { caseId = REFERENCE_CASE_ID, basisRev, roleId } = {}) {
      const user = findUser(fixture, context);
      const card = getOrCreateCard(context, { caseId });
      const result = requestApproval(card, {
        basisRev: basisRev || card.basisRev,
        roleId: roleId || RC2_ROLE_IDS.ABTEILUNGSLEITUNG,
        actor: user,
        now: context.now,
      });
      if (result.ok) result.card = storeCard(result.card);
      return result;
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
