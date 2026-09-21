'use strict';

const crypto = require('crypto');
const { formatVisibleNoAction, validatePresentationContract } = require('./cet-rc2-ui-contracts');

const defaultCaseId = 'vorgang-cr-lka-rv-001-article-id-change';
const defaultTenantId = 'stadtwerk-beispiel';

const defaultSession = Object.freeze({
  tenantId: defaultTenantId,
  userId: 'u-rc2-reference-market-ops-1',
  displayName: 'RC2 Marktkommunikation',
  activeRoleId: 'ROLE_MARKET_OPERATIONS',
  heldRoles: Object.freeze([
    { roleId: 'ROLE_MARKET_OPERATIONS', tenantId: defaultTenantId, label: 'Marktkommunikation' },
  ]),
  placeholderAgents: Object.freeze([
    {
      roleId: 'ROLE_TENANT_ADMIN',
      tenantId: defaultTenantId,
      displayName: 'Platzhalter-Agent Mandantenadministration',
      canHandleHitl: true,
    },
  ]),
});

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function nowIso(now) {
  return now || new Date().toISOString();
}

function stateDocId(tenantId, caseId) {
  return `cet-ui-state:${tenantId}:${caseId}`;
}

function usageDocId(tenantId, operationId, now) {
  const digest = crypto
    .createHash('sha256')
    .update(`${tenantId}:${operationId}:${now}`)
    .digest('hex');
  return `cet-ui-operation-usage:${digest.slice(0, 16)}`;
}

function buildPresentationContract() {
  return {
    version: 'rc2-v1',
    grammarParts: ['vorgang', 'quellen', 'pruefung', 'unsicherheit', 'freigabe'],
    elements: [
      {
        elementId: 'article-id-change-summary',
        title: 'Artikel-ID-Änderung prüfen',
        statements: [
          {
            id: 'affected-items-aggregate',
            label: 'Betroffene Klärfälle',
            value: 14,
            unit: 'Klärfälle',
            aggregationState: 'arbeitsstand',
            granularitaet: 'aggregat',
            sicherheit: 'klaerung',
            anschlussfrage:
              'Welche betroffenen Klärfälle müssen vor der Gremienbefassung erläutert werden?',
            source: {
              class: 'cet_projection',
              ref: 'presentation-contract://cr-lka-rv-001/affected-items',
              stand: '2026-09-21T09:40:00Z',
            },
          },
          {
            id: 'raw-items-not-materialized',
            label: 'Einzeldatensätze',
            value: 'nicht materialisiert',
            aggregationState: 'nicht_materialisiert',
            granularitaet: 'einzeldatensatz',
            sicherheit: 'grenze',
            anschlussfrage: 'Einzeldatensätze werden in RC2 nicht als Nachweisakte materialisiert.',
            source: {
              class: 'safety_boundary',
              ref: 'presentation-contract://cr-lka-rv-001/f3-boundary',
              stand: '2026-09-21T09:40:00Z',
            },
          },
        ],
        nichtHandlungen: [
          {
            was: 'Fachsystem execute',
            grund: 'RC2 führt keine externen Fachsystem-Schreibvorgänge aus.',
          },
        ],
      },
    ],
  };
}

function buildDefaultDoc({ tenantId = defaultTenantId, caseId = defaultCaseId } = {}) {
  const presentationContract = buildPresentationContract();
  validatePresentationContract(presentationContract);

  return {
    _id: stateDocId(tenantId, caseId),
    type: 'cet-ui-case-state',
    tenantId,
    caseId,
    label: 'Vorgang Artikel-ID-Änderung CR-LKA-RV-001',
    primaryRoleId: 'ROLE_MARKET_OPERATIONS',
    status: 'in_bearbeitung',
    sinceLastAccess: [
      {
        at: '2026-09-21T09:40:00Z',
        label: 'Präsentationsvertrag aus RC1-Projektion übernommen',
      },
    ],
    takeover: { status: 'offen', actor: null, at: null },
    freeze: { status: 'offen', actor: null, at: null, basisRev: null },
    approvalRequests: [],
    visibleNoAction: formatVisibleNoAction({ displayName: 'RC2 Marktkommunikation' }),
    presentationContract,
    nextContribution: {
      roleId: 'ROLE_MARKET_OPERATIONS',
      label: 'Reifegradcheck für Gremienbefassung vorbereiten',
      requiredInputs: { fachlich: true, finanziell: true, risiko: true, owner: true },
    },
    decisionDistance: [
      { criterionId: 'alternativen', label: 'Alternativen vorhanden', state: 'erfuellt' },
      { criterionId: 'kosten', label: 'Kosten- und Nutzenannahmen benannt', state: 'erfuellt' },
      { criterionId: 'owner', label: 'Owner benannt', state: 'offen' },
      {
        criterionId: 'finanzierung',
        label: 'Finanzierungsbedarf geklärt',
        state: 'nicht_anwendbar',
      },
    ],
    links: {
      self: `/api/ui/v0/cases/${caseId}`,
      evidence: `/api/ui/v0/cases/${caseId}/evidence`,
      takeover: `/api/ui/v0/cases/${caseId}/takeover`,
      freeze: `/api/ui/v0/cases/${caseId}/freeze`,
      approvalRequests: `/api/ui/v0/cases/${caseId}/approval-requests`,
    },
  };
}

function publicCase(doc) {
  const copy = clone(doc);
  delete copy._id;
  delete copy._rev;
  return copy;
}

function createUiStateStore({ db }) {
  if (!db) throw new Error('createUiStateStore requires db.');

  async function getOrCreateCase({ tenantId = defaultTenantId, caseId = defaultCaseId } = {}) {
    const id = stateDocId(tenantId, caseId);
    try {
      return await db.get(id);
    } catch (error) {
      if (error.status !== 404) throw error;
      const doc = buildDefaultDoc({ tenantId, caseId });
      const response = await db.put(doc);
      return { ...doc, _rev: response.rev };
    }
  }

  async function putCase(doc) {
    const response = await db.put(doc);
    return { ...doc, _rev: response.rev };
  }

  return {
    async getSession({ tenantId = defaultTenantId } = {}) {
      return { ...clone(defaultSession), tenantId };
    },

    async getDailySurface({ tenantId = defaultTenantId } = {}) {
      const doc = await getOrCreateCase({ tenantId, caseId: defaultCaseId });
      return {
        route: '/api/ui/v0/daily',
        tenantId,
        activeRoleId: defaultSession.activeRoleId,
        sinceLastAccess: doc.sinceLastAccess,
        vorgaenge: [
          {
            vorgangId: doc.caseId,
            label: doc.label,
            status: doc.status,
            primaryRoleId: doc.primaryRoleId,
            visibleNoAction: doc.visibleNoAction,
            nextContribution: doc.nextContribution,
            links: doc.links,
          },
        ],
      };
    },

    async getCase({ tenantId = defaultTenantId, caseId = defaultCaseId } = {}) {
      return publicCase(await getOrCreateCase({ tenantId, caseId }));
    },

    async getEvidence({ tenantId = defaultTenantId, caseId = defaultCaseId } = {}) {
      const doc = await getOrCreateCase({ tenantId, caseId });
      return {
        tenantId,
        caseId,
        freeze: doc.freeze,
        approvalRequests: doc.approvalRequests,
        materializedStatements: doc.presentationContract.elements.flatMap((element) =>
          element.statements.filter((statement) => statement.granularitaet === 'aggregat')
        ),
      };
    },

    async takeOver({ tenantId = defaultTenantId, caseId = defaultCaseId, actor, now } = {}) {
      const doc = await getOrCreateCase({ tenantId, caseId });
      doc.takeover = { status: 'mir_zugewiesen', actor, at: nowIso(now) };
      doc.visibleNoAction = formatVisibleNoAction(actor);
      return publicCase(await putCase(doc));
    },

    async freezeCase({ tenantId = defaultTenantId, caseId = defaultCaseId, actor, now } = {}) {
      const doc = await getOrCreateCase({ tenantId, caseId });
      doc.freeze = {
        status: 'eingefroren',
        actor,
        at: nowIso(now),
        basisRev: doc._rev || null,
      };
      return publicCase(await putCase(doc));
    },

    async requestApproval({
      tenantId = defaultTenantId,
      caseId = defaultCaseId,
      roleId,
      actor,
      now,
    } = {}) {
      const doc = await getOrCreateCase({ tenantId, caseId });
      const request = {
        id: `approval-${doc.approvalRequests.length + 1}`,
        roleId,
        status: 'angefordert',
        actor,
        at: nowIso(now),
        externalExecute: false,
      };
      doc.approvalRequests.push(request);
      await putCase(doc);
      return request;
    },

    async listOperations({ tenantId = defaultTenantId } = {}) {
      return {
        tenantId,
        operations: [
          {
            id: 'capability.openapi.lookup',
            label: 'API-Fähigkeit nachschlagen',
            method: 'GET',
            pathTemplate: '/api/openapi.json',
            requiresRole: 'ROLE_MARKET_OPERATIONS',
            projectionStatus: 'not_projected',
          },
        ],
      };
    },

    async prepareOperation({ tenantId = defaultTenantId, operationId, actor, now } = {}) {
      const at = nowIso(now);
      const id = usageDocId(tenantId, operationId, at);
      const doc = {
        _id: id,
        type: 'cet-ui-operation-usage',
        tenantId,
        operationId,
        actor,
        at,
        projectionStatus: 'not_projected',
      };
      await db.put(doc);
      return {
        projectionStatus: 'not_projected',
        rawPayloadNotice:
          'Dieses Operationsergebnis ist noch nicht in einen Präsentationsvertrag projiziert.',
        rawPayload: {
          operationId,
          preparedAt: at,
          canExecuteInExternalSystem: false,
        },
        usageLogRef: id,
      };
    },
  };
}

module.exports = {
  buildDefaultDoc,
  buildPresentationContract,
  createUiStateStore,
  defaultCaseId,
  defaultSession,
  defaultTenantId,
  stateDocId,
};
