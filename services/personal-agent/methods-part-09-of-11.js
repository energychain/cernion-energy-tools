'use strict';

// personal-agent methods chunk 9/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: toPublicStopPointHitlItem, buildStopPoint, hydrateKnownContextFromSession, findFirstMissingStep, buildOnboardingStopPoint, buildHitlOnboardingQuestion, buildHitlApprovalMarkdown, enrichPlanWithOnboardingHints, handleExecutionWithOnboarding, markRoutingGap, buildCriticalStepCheckpointKey, buildCriticalStepResumeSnapshot, findCriticalStepCheckpointContext, findCriticalStepPlanStackFrame

const {
  EXECUTION_MODES,
  ROUTING_CONTROL_ACTIONS,
  detectExplicitChatModeSwitch,
  fillTemplateWithContext,
  pruneUndefinedDeep,
  getMissingInputs,
  buildOnboardingQuestion,
  captureOnboardingAnswer,
  findPendingOnboardingQuestion,
  listAnsweredOnboardingFacts,
  markStaleQuestions,
  resolveParamKeyFromMissing,
  isNotFound,
  isActionUnavailable,
} = require('./shared');

module.exports = {
  toPublicStopPointHitlItem(hitlItem) {
    if (!hitlItem || typeof hitlItem !== 'object') {
      return null;
    }

    return {
      id: hitlItem.id || null,
      status: hitlItem.status || null,
      kind: hitlItem.kind || null,
      severity: hitlItem.severity || null,
      dueAt: hitlItem.dueAt || null,
      createdAt: hitlItem.createdAt || null,
      updatedAt: hitlItem.updatedAt || null,
      responsibleRole: hitlItem.responsibleRole || null,
      requiredResolverRoles: Array.isArray(hitlItem.requiredResolverRoles)
        ? hitlItem.requiredResolverRoles
        : [],
      personaId: hitlItem.personaId || null,
      personaName: hitlItem.personaName || null,
      personaType: hitlItem.personaType || null,
      personaResolution:
        hitlItem.personaResolution && typeof hitlItem.personaResolution === 'object'
          ? hitlItem.personaResolution
          : null,
      routingContext: this.normalizeRoutingContext(hitlItem.routingContext),
    };
  },

  buildStopPoint({ reasonCode, message, blockedStep, status, placeholder }) {
    const hitlItem = this.toPublicStopPointHitlItem(placeholder?.hitlItem || null);
    const personaId =
      placeholder?.personaId ||
      hitlItem?.personaId ||
      placeholder?.personaResolution?.personaId ||
      null;
    const personaName =
      placeholder?.personaName ||
      hitlItem?.personaName ||
      placeholder?.personaResolution?.personaName ||
      null;
    const personaType =
      placeholder?.personaType ||
      hitlItem?.personaType ||
      placeholder?.personaResolution?.personaType ||
      null;
    const responsibleRole =
      placeholder?.responsibleRole ||
      hitlItem?.responsibleRole ||
      placeholder?.personaResolution?.responsibleRole ||
      null;
    const requiredResolverRoles = Array.isArray(placeholder?.requiredResolverRoles)
      ? placeholder.requiredResolverRoles
      : Array.isArray(hitlItem?.requiredResolverRoles)
        ? hitlItem.requiredResolverRoles
        : Array.isArray(placeholder?.personaResolution?.requiredResolverRoles)
          ? placeholder.personaResolution.requiredResolverRoles
          : null;

    return {
      status,
      reasonCode,
      message,
      blockedStep,
      blockedAction: placeholder?.blockedAction || null,
      missingParams: Array.isArray(placeholder?.missingParams) ? placeholder.missingParams : null,
      onboardingQuestion: placeholder?.onboardingQuestion || null,
      onboardingHints: placeholder?.onboardingHints || null,
      placeholder: placeholder || null,
      placeholderId: placeholder?.placeholder?.placeholderId || null,
      placeholderMetadata: placeholder?.placeholderMetadata || null,
      hitlItem,
      hitlItemId: hitlItem?.id || null,
      responsibleRole,
      requiredResolverRoles,
      personaId,
      personaName,
      personaType,
      personaResolution: placeholder?.personaResolution || hitlItem?.personaResolution || null,
      routingContext: placeholder?.routingContext || hitlItem?.routingContext || null,
    };
  },

  hydrateKnownContextFromSession(knownContext = {}, session = {}) {
    const target = knownContext;
    const profileFacts = session?.l2?.userProfile?.onboardingFacts || {};
    const persistedResolved =
      session?.l3?.resolvedParams && typeof session.l3.resolvedParams === 'object'
        ? session.l3.resolvedParams
        : {};

    const normalizeOnboardingValue = (paramKey, rawValue) => {
      if (rawValue === undefined || rawValue === null) {
        return rawValue;
      }

      const text = String(rawValue).trim();
      if (!text) {
        return text;
      }

      if (paramKey === 'gridOperatorName' || paramKey === 'vnbName' || paramKey === 'query') {
        const fromPhrase = text.match(
          /(?:^|\b)(?:bei|f(?:ü|u)r|netzbetreiber(?:\s+ist)?|vnb(?:\s+ist)?)\s+(.+)$/i
        );
        const candidate = (fromPhrase?.[1] || text).replace(/^(?:den|dem|die|das)\s+/i, '').trim();
        return candidate || text;
      }

      if (paramKey === 'location' || paramKey === 'city') {
        const fromPhrase = text.match(/(?:^|\b)(?:in|bei|standort)\s+(.+)$/i);
        return (fromPhrase?.[1] || text).trim();
      }

      if (paramKey === 'postalCode' || paramKey === 'postleitzahl') {
        const plzMatch = text.match(/\b\d{5}\b/);
        return plzMatch ? plzMatch[0] : text;
      }

      if (paramKey === 'gridOperatorBdew' || paramKey === 'bdew') {
        const bdewMatch = text.match(/\b[0-9]{13}\b/) || text.match(/\b[A-Z0-9]{6,20}\b/i);
        return bdewMatch ? String(bdewMatch[0]).toUpperCase() : text;
      }

      return text;
    };

    const parseFnavProfileAnswer = (rawValue) => {
      if (!rawValue) return null;
      if (typeof rawValue === 'object') return rawValue;
      const text = String(rawValue).trim();
      if (!text) return null;

      const mwMatch = text.match(/(\d+(?:[.,]\d+)?)\s*mw\b/i);
      const kwMatch = text.match(/(\d+(?:[.,]\d+)?)\s*kw\b/i);

      let requestedCapacity = null;
      if (mwMatch) {
        requestedCapacity = Number(mwMatch[1].replace(',', '.')) * 1000;
      } else if (kwMatch) {
        requestedCapacity = Number(kwMatch[1].replace(',', '.'));
      }

      if (!Number.isFinite(requestedCapacity) || requestedCapacity <= 0) {
        return null;
      }

      return {
        requestedCapacity,
      };
    };

    for (const [key, value] of Object.entries(profileFacts)) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        continue;
      }
      const resolvedValue = normalizeOnboardingValue(key, value?.value);
      if (resolvedValue !== undefined && resolvedValue !== null) {
        target[key] = resolvedValue;
      }
    }

    for (const [key, value] of Object.entries(persistedResolved)) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        continue;
      }
      if (value === undefined || value === null) {
        continue;
      }
      target[key] = value;
    }

    const answeredFacts = listAnsweredOnboardingFacts(session?.l3 || {});
    for (const fact of answeredFacts) {
      if (!fact?.paramKey || Object.prototype.hasOwnProperty.call(target, fact.paramKey)) {
        continue;
      }
      if (fact.paramKey === 'fnavProfile') {
        target[fact.paramKey] = parseFnavProfileAnswer(fact.value) || fact.value;
        continue;
      }
      target[fact.paramKey] = normalizeOnboardingValue(fact.paramKey, fact.value);
    }

    return target;
  },

  findFirstMissingStep(plan = {}, knownContext = {}) {
    const executionState = { stepResults: {} };
    for (const plannedStep of plan.steps || []) {
      if (plannedStep?.action === ROUTING_CONTROL_ACTIONS.MISSING_CONTEXT) {
        continue;
      }
      const params = pruneUndefinedDeep(
        fillTemplateWithContext(
          plannedStep.paramsTemplate,
          plannedStep.action,
          knownContext,
          plan.promptHints,
          executionState
        )
      );
      const missingParams = getMissingInputs(plannedStep.action, params);
      if (missingParams.length > 0) {
        return {
          step: plannedStep,
          params,
          missingParams,
        };
      }
    }
    return null;
  },

  buildOnboardingStopPoint({
    plan,
    missingParams,
    blockedStep,
    blockedAction,
    questionTextOverride,
    locationOperatorConsistency,
    evidenceHints,
    responseStrategy = null,
  }) {
    const paramKey = resolveParamKeyFromMissing(missingParams);
    const onboardingQuestion = buildOnboardingQuestion({
      paramKey,
      action: blockedAction || plan?.steps?.[0]?.action,
      fallbackText: questionTextOverride,
      strategy: responseStrategy,
    });
    onboardingQuestion.planSnapshot = {
      source: plan?.source || 'onboarding-resume',
      routeKey: plan?.routeKey || null,
      routeLabel: plan?.routeLabel || null,
      primaryIntent: plan?.primaryIntent || blockedAction || null,
      secondaryIntents: plan?.secondaryIntents || [],
      requestedDomains: plan?.requestedDomains || [],
      unsupportedDomains: plan?.unsupportedDomains || [],
      warnings: plan?.warnings || [],
      promptHints: plan?.promptHints || {},
      status: plan?.status || 'ready',
      steps: Array.isArray(plan?.steps) ? plan.steps : [],
    };

    return {
      reasonCode: 'MISSING_INPUTS',
      status: 'awaiting-onboarding',
      blockedStep,
      blockedAction,
      missingParams,
      responseStrategy,
      locationOperatorConsistency: locationOperatorConsistency || null,
      evidenceHints: evidenceHints || null,
      message: onboardingQuestion.questionText,
      onboardingQuestion,
    };
  },

  buildHitlOnboardingQuestion(stopPoint = {}, plan = {}) {
    const placeholder =
      stopPoint?.placeholder && typeof stopPoint.placeholder === 'object'
        ? stopPoint.placeholder
        : {};
    const placeholderHitlItem = this.toPublicStopPointHitlItem(placeholder?.hitlItem || null);

    const personaId =
      stopPoint?.personaId || placeholder?.personaId || placeholderHitlItem?.personaId || null;
    const personaName =
      stopPoint?.personaName ||
      placeholder?.personaName ||
      placeholderHitlItem?.personaName ||
      null;
    const personaType =
      stopPoint?.personaType ||
      placeholder?.personaType ||
      placeholderHitlItem?.personaType ||
      null;
    const responsibleRole =
      stopPoint?.responsibleRole ||
      placeholder?.responsibleRole ||
      placeholderHitlItem?.responsibleRole ||
      null;
    const requiredResolverRoles = Array.isArray(stopPoint?.requiredResolverRoles)
      ? stopPoint.requiredResolverRoles
      : Array.isArray(placeholder?.requiredResolverRoles)
        ? placeholder.requiredResolverRoles
        : Array.isArray(placeholderHitlItem?.requiredResolverRoles)
          ? placeholderHitlItem.requiredResolverRoles
          : [];
    const routingContext =
      stopPoint?.routingContext ||
      placeholder?.routingContext ||
      placeholderHitlItem?.routingContext ||
      null;

    const hitlItem =
      placeholderHitlItem ||
      (stopPoint?.hitlItemId
        ? {
            id: stopPoint.hitlItemId,
            status: 'pending',
            personaId,
            personaName,
            personaType,
            responsibleRole,
            requiredResolverRoles,
            routingContext,
          }
        : null);

    const blockedAction = stopPoint?.blockedAction || placeholder?.blockedAction || null;
    const blockedStep = Number(stopPoint?.blockedStep || 0) || 1;
    const message =
      String(stopPoint?.message || '').trim() ||
      `Um den Schritt ${blockedStep}${blockedAction ? ` (${blockedAction})` : ''} auszuführen, ist eine Freigabe erforderlich.`;

    return {
      reasonCode: 'MANDATORY_HITL_APPROVAL',
      questionId: `hitl_approval_${hitlItem?.id || blockedStep}`,
      questionText: message,
      message,
      status: 'pending',
      blockedAction,
      blockedStep,
      action: blockedAction,
      missingParams: [],
      hitlItem,
      hitlItemId: hitlItem?.id || null,
      responsibleRole,
      requiredResolverRoles,
      personaId,
      personaName,
      personaType,
      personaResolution:
        stopPoint?.personaResolution ||
        placeholder?.personaResolution ||
        hitlItem?.personaResolution ||
        null,
      routingContext,
      placeholderId: stopPoint?.placeholderId || placeholder?.placeholder?.placeholderId || null,
      placeholderMetadata:
        stopPoint?.placeholderMetadata || placeholder?.placeholderMetadata || null,
      planSnapshot:
        plan && typeof plan === 'object'
          ? this.buildCriticalStepResumeSnapshot(plan, {
              action: blockedAction,
              step: blockedStep,
              responsibleRole,
              requiredResolverRoles,
              personaId,
              personaName,
              personaType,
              personaResolution:
                stopPoint?.personaResolution || placeholder?.personaResolution || null,
              routingContext,
            })
          : null,
    };
  },

  buildHitlApprovalMarkdown(onboardingQuestion = {}) {
    const hitlItemId = onboardingQuestion?.hitlItem?.id || onboardingQuestion?.hitlItemId || null;
    const baseMessage =
      String(onboardingQuestion?.message || onboardingQuestion?.questionText || '').trim() ||
      'Um diesen Schritt auszuführen, ist eine Freigabe erforderlich.';

    if (!hitlItemId) {
      return `${baseMessage}\n\nBitte bestätige die Freigabe, damit ich fortfahren kann.`;
    }

    return [
      baseMessage,
      '',
      `[embed ref="hitl_item_${hitlItemId}" title="Freigabe erforderlich" /]`,
      '',
      'Bitte bestätige oder lehne die Freigabe ab, damit ich den blockierten Schritt fortsetzen kann.',
    ].join('\n');
  },

  enrichPlanWithOnboardingHints(plan = {}, knownContext = {}) {
    const firstMissing = this.findFirstMissingStep(plan, knownContext);
    if (!firstMissing) {
      return { ...plan, onboardingHints: [] };
    }

    const paramKey = resolveParamKeyFromMissing(firstMissing.missingParams);
    return {
      ...plan,
      onboardingHints: [
        {
          blockedStep: firstMissing.step.step,
          blockedAction: firstMissing.step.action,
          missingParams: firstMissing.missingParams,
          suggestedParamKey: paramKey,
        },
      ],
    };
  },

  async handleExecutionWithOnboarding(
    ctx,
    {
      message,
      plan,
      knownContext,
      session,
      executionMode,
      executionTrace = null,
      toolCallTracker = null,
    }
  ) {
    if (executionMode === EXECUTION_MODES.HITL) {
      const hydratedContext = this.hydrateKnownContextFromSession(knownContext, session);
      const enrichedPlan = this.enrichPlanWithOnboardingHints(plan, hydratedContext);
      return {
        status: 'skipped',
        steps: [],
        stopPoint:
          plan.status === 'partial'
            ? this.buildStopPoint({
                reasonCode: 'UNSUPPORTED_CHAIN',
                message: plan.warnings[0] || 'Chain requires manual continuation.',
                blockedStep: (plan.steps?.length || 0) + 1,
                status: 'plan-only',
              })
            : null,
        plan: enrichedPlan,
      };
    }

    session.l3 = {
      history: [],
      summary: null,
      compressed: false,
      ...(session.l3 || {}),
    };
    session.l3.onboardingQuestions = markStaleQuestions(session.l3, 24);

    const pendingQuestion = findPendingOnboardingQuestion(session.l3);
    const existingAssumptions = Array.isArray(session?.l3?.assumptions)
      ? session.l3.assumptions
      : [];
    let effectivePlan = plan;
    let answer = null;
    if (pendingQuestion) {
      const explicitSwitch = detectExplicitChatModeSwitch(message);
      answer = explicitSwitch
        ? null
        : captureOnboardingAnswer({ question: pendingQuestion, message });
      if (!answer) {
        const planUsesPendingAction = Array.isArray(plan?.steps)
          ? plan.steps.some((step) => step?.action === pendingQuestion.action)
          : false;

        if (planUsesPendingAction) {
          return {
            status: 'awaiting-onboarding',
            completedSteps: 0,
            steps: [],
            assumptions: existingAssumptions,
            stopPoint: {
              reasonCode: 'MISSING_INPUTS',
              status: 'awaiting-onboarding',
              blockedStep: 1,
              blockedAction: pendingQuestion.action,
              missingParams: [pendingQuestion.paramKey],
              message: pendingQuestion.questionText,
              onboardingQuestion: pendingQuestion,
            },
          };
        }
      }

      if (answer) {
        session.l3.onboardingQuestions = (session.l3.onboardingQuestions || []).map((q) =>
          q.questionId === answer.questionId ? answer : q
        );

        const stepActions = Array.isArray(plan?.steps) ? plan.steps.map((step) => step.action) : [];
        if (
          !stepActions.includes(pendingQuestion.action) &&
          Array.isArray(pendingQuestion?.planSnapshot?.steps) &&
          pendingQuestion.planSnapshot.steps.length > 0
        ) {
          effectivePlan = pendingQuestion.planSnapshot;
        }
      }
    }

    const hydratedContext = this.hydrateKnownContextFromSession(knownContext, session);

    if (answer) {
      this.emitOnboardingWorkOutLoud(ctx, {
        answer,
        hydratedContext,
      });
    }

    const firstMissing = this.findFirstMissingStep(effectivePlan, hydratedContext);
    if (firstMissing) {
      const responseStrategy = this.buildResponseStrategy({
        message,
        plan: effectivePlan,
        knownContext: hydratedContext,
        missingParams: firstMissing.missingParams,
        existingAssumptions,
      });
      const stopPoint = this.buildOnboardingStopPoint({
        plan: effectivePlan,
        missingParams: firstMissing.missingParams,
        blockedStep: firstMissing.step.step,
        blockedAction: firstMissing.step.action,
        responseStrategy,
      });
      session.l3.onboardingQuestions = [
        ...(session.l3.onboardingQuestions || []),
        stopPoint.onboardingQuestion,
      ];
      session.l3.stopPoint = null;
      return {
        status: 'awaiting-onboarding',
        completedSteps: 0,
        steps: [],
        stopPoint,
      };
    }

    const execution = await this.executeDeterministicPlan(ctx, {
      message,
      plan: effectivePlan,
      knownContext: hydratedContext,
      executionMode,
      session,
      skipGapForMissingInputs: true,
      existingAssumptions,
      executionTrace,
      toolCallTracker,
    });

    if (execution?.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL') {
      const onboardingQuestion = this.buildHitlOnboardingQuestion(
        execution.stopPoint,
        effectivePlan
      );
      const stopPoint = {
        ...execution.stopPoint,
        onboardingQuestion,
        message: onboardingQuestion.message,
        blockedAction: onboardingQuestion.blockedAction || execution.stopPoint.blockedAction,
        blockedStep: onboardingQuestion.blockedStep || execution.stopPoint.blockedStep,
        hitlItemId: onboardingQuestion?.hitlItem?.id || execution?.stopPoint?.hitlItemId || null,
      };
      session.l3.stopPoint = stopPoint;

      return {
        ...execution,
        plan: effectivePlan,
        status: 'awaiting-onboarding',
        completedSteps: execution.completedSteps || 0,
        stopPoint,
        onboardingQuestion,
      };
    }

    if (execution?.stopPoint?.reasonCode === 'MISSING_INPUTS') {
      const responseStrategy = this.buildResponseStrategy({
        message,
        plan: effectivePlan,
        knownContext: hydratedContext,
        missingParams: execution.stopPoint?.missingParams || [],
        existingAssumptions,
        execution,
      });
      const stopPoint = this.buildOnboardingStopPoint({
        plan: effectivePlan,
        missingParams: execution.stopPoint?.missingParams || [],
        blockedStep: execution.stopPoint?.blockedStep || 1,
        blockedAction: execution.stopPoint?.blockedAction || effectivePlan?.steps?.[0]?.action,
        questionTextOverride: execution.stopPoint?.questionTextOverride,
        locationOperatorConsistency: execution.stopPoint?.locationOperatorConsistency,
        evidenceHints: execution.stopPoint?.evidenceHints,
        responseStrategy,
      });
      session.l3.onboardingQuestions = [
        ...(session.l3.onboardingQuestions || []),
        stopPoint.onboardingQuestion,
      ];
      session.l3.stopPoint = null;

      return {
        ...execution,
        plan: effectivePlan,
        status: 'awaiting-onboarding',
        completedSteps: execution.completedSteps || 0,
        stopPoint,
      };
    }

    session.l3.stopPoint = null;

    return {
      ...execution,
      plan: effectivePlan,
    };
  },

  async markRoutingGap(ctx, { reasonCode, blockedStep, blockingLevel = 'soft' }) {
    try {
      const placeholder = await ctx.call(
        'interface-placeholder.markGap',
        {
          role: 'personal_agent_orchestrator',
          reason:
            reasonCode === 'MANDATORY_HITL_APPROVAL'
              ? 'NEEDS_DECISION'
              : reasonCode === 'MISSING_INPUTS'
                ? 'NEEDS_EVIDENCE'
                : 'NEEDS_INTERFACE',
          blockingLevel,
          replacementCriteria: {
            kind: 'process',
            capabilityHint: 'personal-agent.chat',
            deadline: null,
          },
          signalCodes: [reasonCode],
          placeholderGapKey: `personal-agent-step-${blockedStep}`,
        },
        { meta: { ...ctx.meta, $gateway: false } }
      );
      return placeholder;
    } catch (error) {
      if (isActionUnavailable(error) || isNotFound(error)) {
        return null;
      }
      this.logger.warn(`personal-agent gap marker unavailable: ${error.message}`);
      return null;
    }
  },

  buildCriticalStepCheckpointKey(plan = {}, plannedStep = {}) {
    return [
      plan?.routeKey || plan?.routeLabel || plan?.primaryIntent || 'unknown-plan',
      plannedStep?.step || 0,
      plannedStep?.action || 'unknown-action',
    ].join('::');
  },

  buildCriticalStepResumeSnapshot(plan = {}, plannedStep = {}) {
    const safeSteps = Array.isArray(plan?.steps)
      ? plan.steps.map((step) => ({
          step: Number.isFinite(Number(step?.step)) ? Number(step.step) : null,
          action: step?.action || null,
          purpose: step?.purpose || null,
          criticalityClass: step?.criticalityClass || null,
          required: Boolean(step?.required),
          paramsTemplate:
            step?.paramsTemplate && typeof step.paramsTemplate === 'object'
              ? step.paramsTemplate
              : {},
          params: step?.params && typeof step.params === 'object' ? step.params : {},
          requiredScopes: Array.isArray(step?.requiredScopes) ? step.requiredScopes : [],
          hitlRequired: Boolean(step?.hitlRequired),
          responsibleRole: step?.responsibleRole || null,
          requiredResolverRoles: Array.isArray(step?.requiredResolverRoles)
            ? step.requiredResolverRoles
            : [],
          personaId: step?.personaId || null,
          personaName: step?.personaName || null,
          personaType: step?.personaType || null,
          personaResolution:
            step?.personaResolution && typeof step.personaResolution === 'object'
              ? step.personaResolution
              : null,
          routingContext: this.normalizeRoutingContext(step?.routingContext),
        }))
      : [];

    return {
      source: plan?.source || 'hitl-resume',
      routeKey: plan?.routeKey || null,
      routeLabel: plan?.routeLabel || null,
      primaryIntent: plan?.primaryIntent || plannedStep?.action || null,
      secondaryIntents: Array.isArray(plan?.secondaryIntents) ? plan.secondaryIntents : [],
      requestedDomains: Array.isArray(plan?.requestedDomains) ? plan.requestedDomains : [],
      unsupportedDomains: Array.isArray(plan?.unsupportedDomains) ? plan.unsupportedDomains : [],
      warnings: Array.isArray(plan?.warnings) ? plan.warnings : [],
      promptHints:
        plan?.promptHints && typeof plan.promptHints === 'object' ? plan.promptHints : {},
      status: plan?.status || 'ready',
      steps: safeSteps,
      blockedAction: plannedStep?.action || null,
      blockedStep: Number.isFinite(Number(plannedStep?.step)) ? Number(plannedStep.step) : null,
      responsibleRole:
        plannedStep?.responsibleRole || plannedStep?.ownerRole || plan?.responsibleRole || null,
      requiredResolverRoles: Array.isArray(plannedStep?.requiredResolverRoles)
        ? plannedStep.requiredResolverRoles
        : Array.isArray(plan?.requiredResolverRoles)
          ? plan.requiredResolverRoles
          : [],
      personaId: plannedStep?.personaId || plan?.personaId || null,
      personaName: plannedStep?.personaName || plan?.personaName || null,
      personaType: plannedStep?.personaType || plan?.personaType || null,
      personaResolution: plannedStep?.personaResolution || plan?.personaResolution || null,
      routingContext:
        this.normalizeRoutingContext(plannedStep?.routingContext) ||
        this.normalizeRoutingContext(plan?.routingContext) ||
        null,
    };
  },

  findCriticalStepCheckpointContext(
    session = {},
    { hitlItemId = null, blockedAction = null, blockedStep = null } = {}
  ) {
    const checkpointStore = this.ensureCriticalStepCheckpointStore(session);
    const entries = Object.entries(checkpointStore)
      .map(([checkpointKey, entry]) => ({ checkpointKey, ...(entry || {}) }))
      .filter((entry) => entry && typeof entry === 'object' && entry.hitlItemId);

    if (entries.length === 0) {
      return null;
    }

    const exactHitlMatches = hitlItemId
      ? entries.filter((entry) => entry.hitlItemId === hitlItemId)
      : [];
    const exactStepMatches =
      exactHitlMatches.length === 0 && blockedAction
        ? entries.filter(
            (entry) =>
              String(entry.action || '').trim() === String(blockedAction || '').trim() &&
              Number(entry.step || 0) === Number(blockedStep || 0)
          )
        : [];

    const matches = exactHitlMatches.length > 0 ? exactHitlMatches : exactStepMatches;
    if (matches.length === 0) {
      return null;
    }

    matches.sort((a, b) => {
      const aTs = Date.parse(a.updatedAt || a.createdAt || a.approvedAt || 0) || 0;
      const bTs = Date.parse(b.updatedAt || b.createdAt || b.approvedAt || 0) || 0;
      return bTs - aTs;
    });

    return matches[0] || null;
  },

  findCriticalStepPlanStackFrame(
    planStack = [],
    { hitlItemId = null, blockedAction = null, blockedStep = null } = {}
  ) {
    const stack = Array.isArray(planStack) ? planStack : [];
    if (stack.length === 0) {
      return null;
    }

    const exactHitlMatches = hitlItemId
      ? stack.filter(
          (frame) => frame && typeof frame === 'object' && frame.hitlItemId === hitlItemId
        )
      : [];
    const exactStepMatches =
      exactHitlMatches.length === 0 && blockedAction
        ? stack.filter(
            (frame) =>
              frame &&
              typeof frame === 'object' &&
              String(frame.blockedAction || '').trim() === String(blockedAction || '').trim() &&
              Number(frame.blockedStep || 0) === Number(blockedStep || 0)
          )
        : [];

    const matches = exactHitlMatches.length > 0 ? exactHitlMatches : exactStepMatches;
    return matches.length > 0 ? matches[matches.length - 1] : null;
  },
};
