'use strict';

// personal-agent methods chunk 11/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: buildOperatorEvidenceQuestion, hasStructuredExecutionResult, extractDomainResultFromExecution, hasStructuredData, loadUserProfile, loadSession, assertSessionOwnerAccess, assertStoredSessionOwnerAccess, toPublicProactiveMessage, resolvePersonaForSession, fetchPendingPersonaInboxMessages, persistSession

const {
  MoleculerClientError,
  tenantNamespace,
  assertNoL4RawInPersistedState,
  sanitizeBootstrapContext,
  sanitizeScopedDatapoints,
  CHAT_MODES,
  normalizeChatMode,
  SESSION_NAMESPACE,
  PROFILE_NAMESPACE,
  isNotFound,
  buildSessionNotFoundError,
  hasFullAccessPrincipal,
  isActionUnavailable,
} = require('./shared');

module.exports = {
  buildOperatorEvidenceQuestion(consistency = {}) {
    const hint = consistency?.hints || {};
    const locationText = hint.projectLocation ? ` für den Standort ${hint.projectLocation}` : '';
    return `Ich kann die Zuständigkeit${locationText} noch nicht belastbar bestätigen. Für die Due Diligence brauche ich bitte Netzanschlusszusage/BKZ, Marktlokation, Netzanschlusspunkt oder den zuständigen BDEW-Code.`;
  },

  hasStructuredExecutionResult(execution = {}) {
    if (!execution || !Array.isArray(execution.steps)) {
      return false;
    }

    // Check if any step result has structured data
    for (const step of execution.steps) {
      const result = step.result || {};
      if (this.hasStructuredData(result)) {
        return true;
      }

      const dossier = result?.dossier;
      if (
        dossier &&
        typeof dossier === 'object' &&
        ((dossier.task && typeof dossier.task === 'object') ||
          Array.isArray(dossier.evidenceGaps) ||
          Array.isArray(dossier.forbiddenAssumptions) ||
          Array.isArray(dossier.nextActions))
      ) {
        return true;
      }
    }

    return false;
  },

  extractDomainResultFromExecution(execution = {}) {
    if (!Array.isArray(execution.steps) || execution.steps.length === 0) {
      return null;
    }

    const merged = {};
    const vdmiTasksById = new Map();
    const vdmiEvidenceGaps = [];
    const vdmiEvidenceRequirements = [];
    const vdmiForbiddenAssumptions = [];
    const vdmiNextActions = [];
    const vdmiRisks = [];
    let vdmiExpectedStatus;
    let vdmiDecisionStatus;
    let vdmiMatrixId;
    let vdmiMatrixName;
    let vdmiMatrixStatus;

    const allowedScalarKeys = [
      'count',
      'value',
      'metric',
      'unit',
      'answer',
      'source',
      'asOf',
      'expectedStatus',
      'decisionStatus',
      'highestRole',
    ];

    const allowedArrayKeys = [
      'sources',
      'warnings',
      'roles',
      'rolesByTask',
      'peers',
      'items',
      'rows',
      'variants',
      'evidenceGaps',
      'evidenceRequirements',
      'forbiddenAssumptions',
      'nextActions',
      'assetRisks',
      'risks',
      'tasks',
    ];

    const addUnique = (target, values) => {
      if (!Array.isArray(values)) return;
      for (const value of values) {
        const key = JSON.stringify(value);
        if (!target.some((item) => JSON.stringify(item) === key)) {
          target.push(value);
        }
      }
    };

    const mergeSafeResult = (result = {}) => {
      for (const key of allowedScalarKeys) {
        if (result[key] !== undefined && result[key] !== null && result[key] !== '') {
          merged[key] = result[key];
        }
      }

      for (const key of allowedArrayKeys) {
        if (Array.isArray(result[key])) {
          if (!Array.isArray(merged[key])) {
            merged[key] = [];
          }
          addUnique(merged[key], result[key]);
        }
      }

      if (result.matrix && typeof result.matrix === 'object') {
        if (!merged.matrix || typeof merged.matrix !== 'object') {
          merged.matrix = {};
        }
        if (result.matrix.id && !merged.matrix.id) {
          merged.matrix.id = result.matrix.id;
        }
        if (result.matrix.name && !merged.matrix.name) {
          merged.matrix.name = result.matrix.name;
        }
        if (result.matrix.status && !merged.matrix.status) {
          merged.matrix.status = result.matrix.status;
        }
        if (Array.isArray(result.matrix.tasks)) {
          if (!Array.isArray(merged.matrix.tasks)) {
            merged.matrix.tasks = [];
          }
          addUnique(merged.matrix.tasks, result.matrix.tasks);
        }
      }
    };

    for (const step of execution.steps) {
      const result = step.result || {};
      mergeSafeResult(result);

      const dossier = result?.dossier;
      if (!dossier || typeof dossier !== 'object') {
        continue;
      }

      const task = dossier.task && typeof dossier.task === 'object' ? dossier.task : null;
      if (!task) {
        continue;
      }

      const taskId = task.taskId || result.taskId || `vdmi_task_${vdmiTasksById.size + 1}`;
      const existingTask = vdmiTasksById.get(taskId) || {};

      const mappedTask = {
        ...existingTask,
        taskId,
      };

      const maybeAssign = (key, value) => {
        if (value !== undefined && value !== null && value !== '') {
          mappedTask[key] = value;
        }
      };

      maybeAssign('taskName', task.taskName || task.description);
      maybeAssign('phase', task.phase);
      maybeAssign(
        'verantwortlich',
        Array.isArray(task.verantwortlich) ? task.verantwortlich : undefined
      );
      maybeAssign(
        'durchfuehrend',
        Array.isArray(task.durchfuehrend) ? task.durchfuehrend : undefined
      );
      maybeAssign('mitwirkend', Array.isArray(task.mitwirkend) ? task.mitwirkend : undefined);
      maybeAssign('information', Array.isArray(task.information) ? task.information : undefined);
      maybeAssign('expectedStatus', dossier.expectedStatus || task.expectedStatus);
      maybeAssign('decisionStatus', dossier.decisionStatus || task.decisionStatus);
      maybeAssign('roles', Array.isArray(task.roles) ? task.roles : undefined);
      maybeAssign('rolesByTask', Array.isArray(task.rolesByTask) ? task.rolesByTask : undefined);
      maybeAssign('highestRole', task.highestRole);

      const evidenceRequirements = Array.isArray(dossier?.evidence?.requirements)
        ? dossier.evidence.requirements
        : Array.isArray(task.evidenceRequirements)
          ? task.evidenceRequirements
          : undefined;
      maybeAssign('evidenceRequirements', evidenceRequirements);

      const evidenceGaps = Array.isArray(dossier.evidenceGaps)
        ? dossier.evidenceGaps
        : Array.isArray(task.evidenceGaps)
          ? task.evidenceGaps
          : undefined;
      maybeAssign('evidenceGaps', evidenceGaps);

      const forbiddenAssumptions = Array.isArray(dossier.forbiddenAssumptions)
        ? dossier.forbiddenAssumptions
        : Array.isArray(task.forbiddenAssumptions)
          ? task.forbiddenAssumptions
          : undefined;
      maybeAssign('forbiddenAssumptions', forbiddenAssumptions);

      const nextActions = Array.isArray(dossier.nextActions)
        ? dossier.nextActions
        : Array.isArray(task.nextActions)
          ? task.nextActions
          : undefined;
      maybeAssign('nextActions', nextActions);

      const taskRisks = Array.isArray(dossier.assetRisks)
        ? dossier.assetRisks
        : Array.isArray(task.assetRisks)
          ? task.assetRisks
          : undefined;
      maybeAssign('assetRisks', taskRisks);
      maybeAssign('risks', Array.isArray(dossier.risks) ? dossier.risks : task.risks);

      vdmiTasksById.set(taskId, mappedTask);

      addUnique(vdmiEvidenceGaps, evidenceGaps);
      addUnique(vdmiEvidenceRequirements, evidenceRequirements);
      addUnique(vdmiForbiddenAssumptions, forbiddenAssumptions);
      addUnique(vdmiNextActions, nextActions);
      addUnique(vdmiRisks, taskRisks || []);
      addUnique(vdmiRisks, Array.isArray(dossier.risks) ? dossier.risks : []);

      if (vdmiExpectedStatus === undefined && mappedTask.expectedStatus !== undefined) {
        vdmiExpectedStatus = mappedTask.expectedStatus;
      }
      if (vdmiDecisionStatus === undefined && mappedTask.decisionStatus !== undefined) {
        vdmiDecisionStatus = mappedTask.decisionStatus;
      }
      if (!vdmiMatrixId) {
        vdmiMatrixId = result.matrixId || task.matrixId;
      }
      if (!vdmiMatrixName) {
        vdmiMatrixName = result.matrixName || dossier.matrixName || task.matrixName;
      }
      if (!vdmiMatrixStatus) {
        vdmiMatrixStatus = result.matrixStatus || dossier.matrixStatus || task.matrixStatus;
      }
    }

    const vdmiTasks = Array.from(vdmiTasksById.values());
    if (vdmiTasks.length > 0) {
      const matrix = {
        tasks: vdmiTasks,
      };

      if (vdmiMatrixId) matrix.id = vdmiMatrixId;
      if (vdmiMatrixName) matrix.name = vdmiMatrixName;
      if (vdmiMatrixStatus) matrix.status = vdmiMatrixStatus;

      const vdmiDomainResult = {
        ...merged,
        matrix,
      };

      if (vdmiEvidenceGaps.length > 0) {
        vdmiDomainResult.evidenceGaps = vdmiEvidenceGaps;
      }
      if (vdmiEvidenceRequirements.length > 0) {
        vdmiDomainResult.evidenceRequirements = vdmiEvidenceRequirements;
      }
      if (vdmiForbiddenAssumptions.length > 0) {
        vdmiDomainResult.forbiddenAssumptions = vdmiForbiddenAssumptions;
      }
      if (vdmiNextActions.length > 0) {
        vdmiDomainResult.nextActions = vdmiNextActions;
      }
      if (vdmiRisks.length > 0) {
        vdmiDomainResult.risks = vdmiRisks;
      }
      if (vdmiExpectedStatus !== undefined) {
        vdmiDomainResult.expectedStatus = vdmiExpectedStatus;
      }
      if (vdmiDecisionStatus !== undefined) {
        vdmiDomainResult.decisionStatus = vdmiDecisionStatus;
      }

      return vdmiDomainResult;
    }

    return Object.keys(merged).length > 0 ? merged : null;
  },

  hasStructuredData(obj = {}) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return false;
    }

    const dossier = obj?.dossier;
    if (
      dossier &&
      typeof dossier === 'object' &&
      ((dossier.task && typeof dossier.task === 'object') ||
        Array.isArray(dossier.evidenceGaps) ||
        Array.isArray(dossier.forbiddenAssumptions) ||
        Array.isArray(dossier.nextActions))
    ) {
      return true;
    }

    const structuredKeys = [
      'matrix',
      'tasks',
      'roles',
      'rolesByTask',
      'highestRole',
      'evidenceGaps',
      'evidenceRequirements',
      'assetRisks',
      'risks',
      'items',
      'rows',
      'peers',
      'variants',
      'count',
      'value',
      'metric',
      'answer',
      'source',
      'sources',
      'asOf',
      'forbiddenAssumptions',
      'expectedStatus',
      'decisionStatus',
      'nextActions',
      'status',
    ];

    return structuredKeys.some((key) => {
      const val = obj[key];
      return val !== undefined && val !== null && val !== '';
    });
  },

  async loadUserProfile(ctx, tenantId, userId) {
    try {
      const namespace = tenantNamespace(PROFILE_NAMESPACE, tenantId);
      const doc = await ctx.call(
        'object-store.get',
        { namespace, key: userId },
        { meta: ctx.meta }
      );
      return doc?.payload || { userId, preferences: {} };
    } catch (error) {
      if (isNotFound(error)) {
        return { userId, preferences: {} };
      }
      throw error;
    }
  },

  async loadSession(ctx, tenantId, sessionId, userId, options = {}) {
    const namespace = tenantNamespace(SESSION_NAMESPACE, tenantId);
    const userProfile = await this.loadUserProfile(ctx, tenantId, userId);
    const createIfMissing = Boolean(options.createIfMissing);

    try {
      const doc = await ctx.call(
        'object-store.get',
        { namespace, key: sessionId },
        { meta: ctx.meta }
      );
      const payload = doc?.payload || {};
      this.assertSessionOwnerAccess(ctx, payload, sessionId, userId);
      assertNoL4RawInPersistedState(payload);
      return {
        id: sessionId,
        tenantId,
        userId: payload.userId || userId,
        chatMode: normalizeChatMode(payload?.l3?.chatMode) || CHAT_MODES.CONSULTATION,
        l1: payload.l1 || { tenantFacts: [] },
        l2: {
          ...(payload?.l2 && typeof payload.l2 === 'object' ? payload.l2 : {}),
          userProfile: {
            ...(payload?.l2?.userProfile && typeof payload.l2.userProfile === 'object'
              ? payload.l2.userProfile
              : userProfile),
            knowledgeScopeDataPoints: sanitizeScopedDatapoints(
              payload?.l2?.userProfile?.knowledgeScopeDataPoints ||
                userProfile?.knowledgeScopeDataPoints ||
                []
            ),
          },
        },
        l3: {
          history: Array.isArray(payload?.l3?.history) ? payload.l3.history : [],
          fileAttachments: Array.isArray(payload?.l3?.fileAttachments)
            ? payload.l3.fileAttachments
            : [],
          bootstrapContext: sanitizeBootstrapContext(payload?.l3?.bootstrapContext || null),
          knowledgeScopeDataPoints: sanitizeScopedDatapoints(
            payload?.l3?.knowledgeScopeDataPoints || []
          ),
          summary: payload?.l3?.summary || null,
          compressed: Boolean(payload?.l3?.compressed),
          chatMode: normalizeChatMode(payload?.l3?.chatMode) || CHAT_MODES.CONSULTATION,
          chatModeSource: payload?.l3?.chatModeSource || null,
          lastClassification:
            payload?.l3?.lastClassification && typeof payload.l3.lastClassification === 'object'
              ? payload.l3.lastClassification
              : null,
          consultationContext:
            payload?.l3?.consultationContext && typeof payload.l3.consultationContext === 'object'
              ? payload.l3.consultationContext
              : null,
          onboardingQuestions: Array.isArray(payload?.l3?.onboardingQuestions)
            ? payload.l3.onboardingQuestions
            : [],
          assumptions: Array.isArray(payload?.l3?.assumptions) ? payload.l3.assumptions : [],
          planStack: Array.isArray(payload?.l3?.planStack) ? payload.l3.planStack : [],
          resolvedParams:
            payload?.l3?.resolvedParams && typeof payload.l3.resolvedParams === 'object'
              ? payload.l3.resolvedParams
              : {},
          lastCompletedPlan:
            payload?.l3?.lastCompletedPlan && typeof payload.l3.lastCompletedPlan === 'object'
              ? payload.l3.lastCompletedPlan
              : null,
          stopPoint:
            payload?.l3?.stopPoint && typeof payload.l3.stopPoint === 'object'
              ? payload.l3.stopPoint
              : null,
          stateMachine:
            payload?.l3?.stateMachine && typeof payload.l3.stateMachine === 'object'
              ? payload.l3.stateMachine
              : null,
          executionStateGraph:
            payload?.l3?.executionStateGraph && typeof payload.l3.executionStateGraph === 'object'
              ? payload.l3.executionStateGraph
              : null,
          turnGraph:
            payload?.l3?.turnGraph && typeof payload.l3.turnGraph === 'object'
              ? payload.l3.turnGraph
              : null,
          activeRoutingPolicy:
            payload?.l3?.activeRoutingPolicy && typeof payload.l3.activeRoutingPolicy === 'object'
              ? payload.l3.activeRoutingPolicy
              : null,
          activeSynthesisPolicy:
            payload?.l3?.activeSynthesisPolicy &&
            typeof payload.l3.activeSynthesisPolicy === 'object'
              ? payload.l3.activeSynthesisPolicy
              : null,
          activeStickinessStartTurn:
            typeof payload?.l3?.activeStickinessStartTurn === 'number'
              ? payload.l3.activeStickinessStartTurn
              : null,
          criticalStepCheckpoints:
            payload?.l3?.criticalStepCheckpoints &&
            typeof payload.l3.criticalStepCheckpoints === 'object'
              ? payload.l3.criticalStepCheckpoints
              : {},
        },
        createdAt: payload.createdAt || new Date().toISOString(),
        updatedAt: payload.updatedAt || null,
      };
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }

      if (!createIfMissing) {
        throw buildSessionNotFoundError(sessionId);
      }

      return {
        id: sessionId,
        tenantId,
        userId,
        chatMode: CHAT_MODES.CONSULTATION,
        l1: { tenantFacts: [] },
        l2: {
          userProfile: {
            ...userProfile,
            knowledgeScopeDataPoints: sanitizeScopedDatapoints(
              userProfile?.knowledgeScopeDataPoints || []
            ),
          },
        },
        l3: {
          history: [],
          fileAttachments: [],
          bootstrapContext: sanitizeBootstrapContext(null),
          knowledgeScopeDataPoints: sanitizeScopedDatapoints([]),
          summary: null,
          compressed: false,
          chatMode: CHAT_MODES.CONSULTATION,
          chatModeSource: null,
          lastClassification: null,
          consultationContext: null,
          onboardingQuestions: [],
          assumptions: [],
          planStack: [],
          resolvedParams: {},
          lastCompletedPlan: null,
          stopPoint: null,
          stateMachine: null,
          executionStateGraph: null,
          turnGraph: null,
          activeRoutingPolicy: null,
          activeSynthesisPolicy: null,
          activeStickinessStartTurn: null,
          criticalStepCheckpoints: {},
        },
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };
    }
  },

  assertSessionOwnerAccess(ctx, payload, sessionId, userId) {
    const ownerUserId = String(payload?.userId || '').trim();
    if (!ownerUserId) {
      return;
    }

    const callerUserId = String(userId || '').trim();
    if (callerUserId && callerUserId === ownerUserId) {
      return;
    }

    if (hasFullAccessPrincipal(ctx)) {
      return;
    }

    throw buildSessionNotFoundError(sessionId);
  },

  async assertStoredSessionOwnerAccess(ctx, tenantId, sessionId, userId, options = {}) {
    const namespace = tenantNamespace(SESSION_NAMESPACE, tenantId);
    let doc;
    try {
      doc = await ctx.call('object-store.get', { namespace, key: sessionId }, { meta: ctx.meta });
    } catch (error) {
      if (isNotFound(error) && options.allowMissing) {
        return false;
      }
      throw error;
    }

    this.assertSessionOwnerAccess(ctx, doc?.payload || {}, sessionId, userId);
    return true;
  },

  toPublicProactiveMessage(item = {}) {
    return {
      id: item.id || null,
      type: item.type || null,
      hitlItemId: item.hitlItemId || null,
      embedRef: item.embedRef || null,
      title: item.title || null,
      summary: item.summary || null,
      status: item.status || null,
      createdAt: item.createdAt || null,
    };
  },

  async resolvePersonaForSession(ctx, { tenantId, sessionId, personaId }) {
    if (personaId) {
      try {
        const byId = await ctx.call(
          'agent-persona.get',
          {
            tenantId,
            id: personaId,
          },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );
        return byId?.item || null;
      } catch (error) {
        if (
          isActionUnavailable(error) ||
          isNotFound(error) ||
          error?.type === 'PERSONA_NOT_FOUND' ||
          error?.type === 'PERSONA_TENANT_FORBIDDEN'
        ) {
          return null;
        }
        throw error;
      }
    }

    try {
      const list = await ctx.call(
        'agent-persona.list',
        { tenantId },
        { meta: { ...ctx.meta, tenantId, $gateway: false } }
      );
      const items = Array.isArray(list?.items) ? list.items : [];
      const match = items
        .filter((item) => item?.status === 'active')
        .find((item) => String(item?.defaultPersonalAgentSessionId || '').trim() === sessionId);
      return match || null;
    } catch (error) {
      if (isActionUnavailable(error) || isNotFound(error)) {
        return null;
      }
      throw error;
    }
  },

  async fetchPendingPersonaInboxMessages(ctx, { tenantId, personaId, sessionId, limit = 20 }) {
    let pending = [];
    try {
      const list = await ctx.call(
        'persona-inbox.listPendingForPersona',
        {
          tenantId,
          personaId,
          sessionId,
          limit,
          offset: 0,
        },
        { meta: { ...ctx.meta, tenantId, $gateway: false } }
      );
      pending = Array.isArray(list?.items) ? list.items : [];
    } catch (error) {
      if (isActionUnavailable(error) || isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const ids = pending.map((item) => item?.id).filter(Boolean);
    if (ids.length === 0) return [];

    try {
      const visible = await ctx.call(
        'persona-inbox.markVisible',
        {
          tenantId,
          ids,
        },
        { meta: { ...ctx.meta, tenantId, $gateway: false } }
      );
      const updated = Array.isArray(visible?.items) ? visible.items : [];
      return updated.length > 0 ? updated : pending;
    } catch (error) {
      if (isActionUnavailable(error) || isNotFound(error)) {
        return pending;
      }
      throw error;
    }
  },

  async persistSession(ctx, tenantId, sessionId, payload) {
    const namespace = tenantNamespace(SESSION_NAMESPACE, tenantId);
    try {
      await ctx.call(
        'object-store.put',
        { namespace, key: sessionId, payload },
        { meta: ctx.meta }
      );
    } catch (error) {
      throw new MoleculerClientError(
        `Unable to persist personal-agent session: ${error.message}`,
        500,
        'PERSONAL_AGENT_PERSIST_FAILED'
      );
    }
  },
};
