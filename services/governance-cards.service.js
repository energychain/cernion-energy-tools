'use strict';

const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal } = require('../src/domain-router-policy');
const {
  GOVERNANCE_CARD_SCHEMA_VERSION,
  CARD_TYPES,
  TRANSITIONS,
  createAuditEntry,
  listMatches,
  makeCardId,
  normalizeCardInput,
  safeCard,
  safeCardType,
  summarizeCard,
  missingFieldsForInput,
  getCardType,
} = require('../src/governance-cards');

const MAX_LIMIT = 100;
function openApiParameters(rest, params = {}) {
  const [method, path] = rest.split(/\s+/, 2);
  if (method !== 'GET') return [];
  return Object.keys(params).map((name) => ({
    name,
    in: path.includes(`:${name}`) ? 'path' : 'query',
    required: path.includes(`:${name}`),
    schema: { type: params[name].type || 'string' },
    example: name,
  }));
}
const action = (rest, summary, handler, params = {}) => ({
  rest,
  params,
  openapi: {
    summary,
    description: summary,
    tags: ['Governance Cards'],
    parameters: openApiParameters(rest, params),
  },
  handler,
});
const caseParams = { cardId: { type: 'string', min: 1 } };
function cardDocId(tenantId, cardId) {
  return `governance-card:${encodeURIComponent(tenantId)}:${encodeURIComponent(cardId)}`;
}
function notFound() {
  throw new Errors.MoleculerClientError(
    'Governance card not found',
    404,
    'GOVERNANCE_CARD_NOT_FOUND'
  );
}
function transitionAllowed(card, nextStatus) {
  return (TRANSITIONS[card.status] || []).includes(nextStatus);
}
function cleanFilter(value, max = 120) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function isOverdue(card, nowIso) {
  return Boolean(
    card.deadline && card.deadline < nowIso && !['completed', 'closed'].includes(card.status)
  );
}
function attentionReasons(card, nowIso) {
  return [
    isOverdue(card, nowIso) && 'overdue_deadline',
    card.blockedReason && 'blocked',
    !card.ownerRole && 'owner_missing',
    (card.managementRelevance || card.executiveVisibility) && 'executive_visible',
  ].filter(Boolean);
}
function actionSummary(card) {
  return {
    cardId: card.cardId,
    cardType: card.cardType,
    title: card.title,
    status: card.status,
    ownerRole: card.ownerRole,
    deadline: card.deadline,
    followUpDate: card.followUpDate,
    nextGate: card.nextGate,
    blockedReason: card.blockedReason,
    evidenceRefs: card.evidenceRefs || [],
  };
}

module.exports = {
  name: 'governance-cards',
  mixins: [
    createPouchDbLifecycleMixin({
      defaultDbPath: './data/cet_governance_cards',
      dbPathEnvVar: 'CET_GOVERNANCE_CARDS_DB_PATH',
      indexes: [
        ['tenantId', 'type'],
        ['tenantId', 'cardType'],
        ['tenantId', 'status'],
        ['tenantId', 'ownerRole'],
      ],
    }),
  ],
  actions: {
    listTypes: action(
      'GET /types',
      'List UI-safe governance card type definitions',
      async function (ctx) {
        principal(ctx, ctx.params);
        return {
          schemaVersion: GOVERNANCE_CARD_SCHEMA_VERSION,
          items: CARD_TYPES.map(safeCardType),
        };
      }
    ),

    getType: action(
      'GET /types/:cardType',
      'Return one governance card type definition',
      async function (ctx) {
        principal(ctx, ctx.params);
        return {
          schemaVersion: GOVERNANCE_CARD_SCHEMA_VERSION,
          type: safeCardType(getCardType(ctx.params.cardType)),
        };
      },
      { cardType: { type: 'string', min: 1 } }
    ),

    createCardFromConversation: action(
      'POST /cards/conversation/create',
      'Create a governance card from conversational input or return missing-field prompts',
      async function (ctx) {
        principal(ctx, ctx.params);
        const missing = missingFieldsForInput(ctx.params);
        if (missing.missingFields.length) {
          return {
            schemaVersion: GOVERNANCE_CARD_SCHEMA_VERSION,
            created: false,
            cardType: missing.cardType,
            missingFields: missing.missingFields,
            missingFieldPrompts: missing.missingFieldPrompts,
            nextSafeAction: missing.guidance,
            noCallGuards: [
              'No governance card is created until required fields are provided through the curated create action.',
            ],
          };
        }
        const created = await ctx.call('governance-cards.createCard', ctx.params, {
          meta: ctx.meta,
        });
        return {
          schemaVersion: GOVERNANCE_CARD_SCHEMA_VERSION,
          created: true,
          card: created.card,
          nextSafeAction: created.card.nextGate,
        };
      }
    ),

    createCard: action(
      'POST /cards',
      'Create a tenant-scoped governance card draft',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const timestamp = new Date().toISOString();
        const cardId = makeCardId();
        const normalized = normalizeCardInput(ctx.params, p);
        const doc = {
          _id: cardDocId(p.tenantId, cardId),
          type: 'governance_card',
          schemaVersion: GOVERNANCE_CARD_SCHEMA_VERSION,
          tenantId: p.tenantId,
          cardId,
          ...normalized,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: p.actorId,
          updatedBy: p.actorId,
          auditTrail: [createAuditEntry('created', p.actorId, { status: normalized.status })],
        };
        const saved = await this.db.put(doc);
        return { card: safeCard({ ...doc, _rev: saved.rev }) };
      }
    ),

    getCard: action(
      'GET /cards/:cardId',
      'Return one tenant-scoped governance card',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        return { card: safeCard(await this.getCardForTenant(p.tenantId, ctx.params.cardId)) };
      },
      caseParams
    ),

    listCards: action('GET /cards', 'List tenant-scoped governance cards', async function (ctx) {
      const p = principal(ctx, ctx.params);
      const limit = Math.min(Number(ctx.params.limit) || 50, MAX_LIMIT);
      const filters = {
        cardType: cleanFilter(ctx.params.cardType),
        status: cleanFilter(ctx.params.status),
        ownerRole: cleanFilter(ctx.params.ownerRole),
        deadlineBefore: cleanFilter(ctx.params.deadlineBefore, 40),
        riskType: cleanFilter(ctx.params.riskType),
        managementRelevance: cleanFilter(ctx.params.managementRelevance),
      };
      const response = await this.db.find({
        selector: { type: 'governance_card', tenantId: p.tenantId },
        limit: 500,
      });
      const cards = response.docs
        .filter((card) => listMatches(card, filters))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, limit)
        .map(safeCard);
      return { schemaVersion: GOVERNANCE_CARD_SCHEMA_VERSION, items: cards, total: cards.length };
    }),

    updateCard: action(
      'PATCH /cards/:cardId',
      'Update bounded governance card fields',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const existing = await this.getCardForTenant(p.tenantId, ctx.params.cardId);
        const normalized = normalizeCardInput({ ...existing, ...ctx.params }, p, existing);
        const updated = {
          ...existing,
          ...normalized,
          updatedAt: new Date().toISOString(),
          updatedBy: p.actorId,
          auditTrail: [
            ...(existing.auditTrail || []),
            createAuditEntry('updated', p.actorId, { status: normalized.status }),
          ].slice(-50),
        };
        const saved = await this.db.put(updated);
        return { card: safeCard({ ...updated, _rev: saved.rev }) };
      },
      caseParams
    ),

    addEvidenceRef: action(
      'POST /cards/:cardId/evidence-refs',
      'Attach an existing EvidenceRef pointer to a governance card',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const existing = await this.getCardForTenant(p.tenantId, ctx.params.cardId);
        const evidenceRef = ctx.params.evidenceRef || ctx.params;
        const mergedRefs = [...(existing.evidenceRefs || []), evidenceRef];
        const normalized = normalizeCardInput(
          { ...existing, evidenceRefs: mergedRefs },
          p,
          existing
        );
        const updated = {
          ...existing,
          evidenceRefs: normalized.evidenceRefs,
          updatedAt: new Date().toISOString(),
          updatedBy: p.actorId,
          auditTrail: [
            ...(existing.auditTrail || []),
            createAuditEntry('evidence_ref_added', p.actorId, {
              evidenceId: evidenceRef.evidenceId,
            }),
          ].slice(-50),
        };
        const saved = await this.db.put(updated);
        return { card: safeCard({ ...updated, _rev: saved.rev }) };
      },
      caseParams
    ),

    addComment: action(
      'POST /cards/:cardId/comments',
      'Add bounded internal comment metadata to a governance card audit trail',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const existing = await this.getCardForTenant(p.tenantId, ctx.params.cardId);
        const comment = cleanFilter(ctx.params.comment, 500);
        if (!comment) {
          throw new Errors.MoleculerClientError(
            'comment required',
            422,
            'GOVERNANCE_CARD_COMMENT_REQUIRED'
          );
        }
        const updated = {
          ...existing,
          updatedAt: new Date().toISOString(),
          updatedBy: p.actorId,
          auditTrail: [
            ...(existing.auditTrail || []),
            createAuditEntry('comment_added', p.actorId, { comment }),
          ].slice(-50),
        };
        const saved = await this.db.put(updated);
        return { card: safeCard({ ...updated, _rev: saved.rev }) };
      },
      caseParams
    ),

    transition: action(
      'POST /cards/:cardId/transition',
      'Move a governance card through allowed lifecycle transitions',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const nextStatus = cleanFilter(ctx.params.status, 40);
        const existing = await this.getCardForTenant(p.tenantId, ctx.params.cardId);
        if (!transitionAllowed(existing, nextStatus)) {
          throw new Errors.MoleculerClientError(
            'Governance card transition not allowed',
            422,
            'GOVERNANCE_CARD_TRANSITION_BLOCKED',
            { from: existing.status, to: nextStatus }
          );
        }
        const updated = {
          ...existing,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
          updatedBy: p.actorId,
          auditTrail: [
            ...(existing.auditTrail || []),
            createAuditEntry('transitioned', p.actorId, {
              from: existing.status,
              to: nextStatus,
              rationale: ctx.params.rationale,
            }),
          ].slice(-50),
        };
        const saved = await this.db.put(updated);
        return { card: safeCard({ ...updated, _rev: saved.rev }) };
      },
      caseParams
    ),

    confirmOwner: action(
      'POST /cards/:cardId/owner-confirmation',
      'Confirm governance-card owner explicitly',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const existing = await this.getCardForTenant(p.tenantId, ctx.params.cardId);
        const timestamp = new Date().toISOString();
        const updated = {
          ...existing,
          ownerConfirmedAt: timestamp,
          ownerConfirmationStatus: 'confirmed',
          updatedAt: timestamp,
          updatedBy: p.actorId,
          auditTrail: [
            ...(existing.auditTrail || []),
            createAuditEntry('owner_confirmed', p.actorId, { ownerRole: existing.ownerRole }),
          ].slice(-50),
        };
        const saved = await this.db.put(updated);
        return { card: safeCard({ ...updated, _rev: saved.rev }) };
      },
      caseParams
    ),

    markBlocked: action(
      'POST /cards/:cardId/blocked',
      'Mark a governance card as blocked with bounded rationale',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const reason = cleanFilter(ctx.params.blockedReason || ctx.params.reason, 500);
        if (!reason) {
          throw new Errors.MoleculerClientError(
            'blockedReason required',
            422,
            'GOVERNANCE_CARD_BLOCKED_REASON_REQUIRED'
          );
        }
        const existing = await this.getCardForTenant(p.tenantId, ctx.params.cardId);
        const updated = {
          ...existing,
          status: existing.status === 'draft' ? 'review' : existing.status,
          blockedReason: reason,
          updatedAt: new Date().toISOString(),
          updatedBy: p.actorId,
          auditTrail: [
            ...(existing.auditTrail || []),
            createAuditEntry('blocked', p.actorId, { blockedReason: reason }),
          ].slice(-50),
        };
        const saved = await this.db.put(updated);
        return { card: safeCard({ ...updated, _rev: saved.rev }) };
      },
      caseParams
    ),

    setFollowUpDate: action(
      'POST /cards/:cardId/follow-up-date',
      'Set a bounded follow-up date for a governance card',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const existing = await this.getCardForTenant(p.tenantId, ctx.params.cardId);
        const normalized = normalizeCardInput(
          { ...existing, followUpDate: ctx.params.followUpDate, status: existing.status },
          p,
          existing
        );
        const updated = {
          ...existing,
          followUpDate: normalized.followUpDate,
          updatedAt: new Date().toISOString(),
          updatedBy: p.actorId,
          auditTrail: [
            ...(existing.auditTrail || []),
            createAuditEntry('follow_up_date_set', p.actorId, {
              followUpDate: normalized.followUpDate,
            }),
          ].slice(-50),
        };
        const saved = await this.db.put(updated);
        return { card: safeCard({ ...updated, _rev: saved.rev }) };
      },
      caseParams
    ),

    closeWithRationale: action(
      'POST /cards/:cardId/close-with-rationale',
      'Close a governance card with bounded internal rationale',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const rationale = cleanFilter(ctx.params.rationale || ctx.params.closureRationale, 1000);
        if (!rationale) {
          throw new Errors.MoleculerClientError(
            'rationale required',
            422,
            'GOVERNANCE_CARD_CLOSURE_RATIONALE_REQUIRED'
          );
        }
        const existing = await this.getCardForTenant(p.tenantId, ctx.params.cardId);
        const updated = {
          ...existing,
          status: 'closed',
          closureRationale: rationale,
          updatedAt: new Date().toISOString(),
          updatedBy: p.actorId,
          auditTrail: [
            ...(existing.auditTrail || []),
            createAuditEntry('closed_with_rationale', p.actorId, { rationale }),
          ].slice(-50),
        };
        const saved = await this.db.put(updated);
        return { card: safeCard({ ...updated, _rev: saved.rev }) };
      },
      caseParams
    ),

    getAttentionSnapshot: action(
      'GET /attention-snapshot',
      'Return read-only governance-card attention projection',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const nowIso = new Date().toISOString();
        const response = await this.db.find({
          selector: { type: 'governance_card', tenantId: p.tenantId },
          limit: 500,
        });
        const items = response.docs
          .map((card) => ({
            ...actionSummary(safeCard(card)),
            reasons: attentionReasons(card, nowIso),
          }))
          .filter((item) => item.reasons.length)
          .slice(0, Math.min(Number(ctx.params.limit) || 50, MAX_LIMIT));
        return {
          schemaVersion: GOVERNANCE_CARD_SCHEMA_VERSION,
          snapshotGeneratedAt: nowIso,
          items,
        };
      }
    ),

    summarizeForLineFeedback: action(
      'GET /cards/:cardId/line-feedback-summary',
      'Return action-oriented governance-card line feedback summary',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const card = safeCard(await this.getCardForTenant(p.tenantId, ctx.params.cardId));
        return {
          summary: {
            ...actionSummary(card),
            assignedWork: card.triggerSummary,
            missingOrBlocked: card.blockedReason || null,
            whatHappensNext: card.nextGate,
            noCallGuards: [
              'Line feedback summaries are internal/advisory and do not send external notifications.',
            ],
          },
        };
      },
      caseParams
    ),

    summarizeForExecutiveReview: action(
      'GET /cards/:cardId/executive-summary',
      'Return bounded executive governance-card summary',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const card = safeCard(await this.getCardForTenant(p.tenantId, ctx.params.cardId));
        return {
          summary: {
            ...actionSummary(card),
            trigger: card.triggerSummary,
            riskOrImpact: card.impactSummary,
            requestedAction: card.nextGate,
            noCallGuards: [
              'Executive summaries do not approve, file, notify, dispatch, bill or mutate external systems.',
            ],
          },
        };
      },
      caseParams
    ),

    summarizeForDossier: action(
      'GET /cards/:cardId/dossier-summary',
      'Return a scalar-safe governance card summary for dossiers',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        return {
          summary: summarizeCard(await this.getCardForTenant(p.tenantId, ctx.params.cardId)),
        };
      },
      caseParams
    ),
  },
  methods: {
    async getCardForTenant(tenantId, cardId) {
      try {
        const doc = await this.db.get(cardDocId(tenantId, cardId));
        if (doc.tenantId !== tenantId) notFound();
        return doc;
      } catch (e) {
        if (e.status === 404) notFound();
        throw e;
      }
    },
  },
};
