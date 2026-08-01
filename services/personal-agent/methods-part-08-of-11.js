'use strict';

// personal-agent methods chunk 8/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: emitWorkOutLoudSafe, emitBootstrapWorkOutLoudIfChanged, emitScopedKnowledgeWorkOutLoud, emitOnboardingWorkOutLoud, resolveScopedKnowledgeState, buildKnowledgeScopeTraceSummary, buildAgentTrace, queryKnowledgeOrientation, normalizeRoutingContext, deriveCriticalStepRoutingMetadata, updateCriticalStepCheckpointStatus, findSessionPendingHitlReference, buildHitlTerminalMessage, resolveSessionHitlResumeGate

const {
  getTenantId,
  sanitizeBootstrapContext,
  sanitizeScopedDatapoints,
  PERSONAL_AGENT_STATES,
  summarizeStateMachine,
  summarizeExecutionStateGraph,
  summarizeTurnGraph,
  queryKnowledgeOrientationAdapter,
  PERSONAL_AGENT_WORK_OUT_LOUD_EVENT,
  WORK_OUT_LOUD_SIGNAL_TYPES,
  buildContextFieldWorkOutLoudPayload,
  normalizeHitlStatus,
  isHitlApprovedStatus,
  isHitlTerminalStatus,
} = require('./shared');

module.exports = {
  emitWorkOutLoudSafe(ctx, payload) {
    if (!payload) {
      return null;
    }

    try {
      this.broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);
      return payload;
    } catch (error) {
      this.logger?.warn(
        `personal-agent.work-out-loud emit failed for tenantId=${payload?.tenantId || 'n/a'}: ${error.message}`
      );
      return null;
    }
  },

  emitBootstrapWorkOutLoudIfChanged(
    ctx,
    {
      previousBootstrapContext = null,
      nextBootstrapContext = null,
      contextMutationMode = 'append',
    } = {}
  ) {
    const before = sanitizeBootstrapContext(previousBootstrapContext);
    const after = sanitizeBootstrapContext(nextBootstrapContext);

    if (!after?.organizationType || after.organizationType === 'unknown') {
      return null;
    }

    const sameOrganizationType = before?.organizationType === after.organizationType;
    const sameStatus = before?.status === after.status;
    if (sameOrganizationType && sameStatus) {
      return null;
    }

    const payload = buildContextFieldWorkOutLoudPayload({
      tenantId: getTenantId(ctx),
      userId: String(ctx.meta?.authUser?.userId || 'anonymous'),
      signalType: WORK_OUT_LOUD_SIGNAL_TYPES.BOOTSTRAP_CONTEXT_UPDATED,
      contextField: 'organizationType',
      rawValue: after.organizationType,
      sourceKind: 'bootstrap_context',
      scope: 'user',
      updateReason: contextMutationMode === 'replace' ? 'context_replace' : 'context_append',
      confidence: after.status === 'established' ? 1 : 0.9,
    });

    return this.emitWorkOutLoudSafe(ctx, payload);
  },

  emitScopedKnowledgeWorkOutLoud(
    ctx,
    {
      previousSessionDataPoints = [],
      previousUserDataPoints = [],
      nextSessionDataPoints = [],
      nextUserDataPoints = [],
      knownContext = {},
    } = {}
  ) {
    const previous = new Set(
      [...previousSessionDataPoints, ...previousUserDataPoints].map(
        (point) => `${point.scope}|${point.key}|${point.status}|${point.source}`
      )
    );
    const next = [...nextSessionDataPoints, ...nextUserDataPoints];

    for (const point of next) {
      const diffKey = `${point.scope}|${point.key}|${point.status}|${point.source}`;
      if (previous.has(diffKey)) {
        continue;
      }

      const payload = buildContextFieldWorkOutLoudPayload({
        tenantId: getTenantId(ctx),
        userId: String(ctx.meta?.authUser?.userId || 'anonymous'),
        signalType: WORK_OUT_LOUD_SIGNAL_TYPES.SCOPED_FACT_LEARNED,
        contextField: point.key,
        rawValue: knownContext?.[point.key],
        sourceKind: point.source === 'knownContext' ? 'known_context' : 'scoped_knowledge',
        scope: point.scope,
        updateReason: 'known_context_merge',
        confidence: 0.8,
      });

      this.emitWorkOutLoudSafe(ctx, payload);
    }

    return null;
  },

  emitOnboardingWorkOutLoud(ctx, { answer = null, hydratedContext = {} } = {}) {
    if (!answer?.paramKey) {
      return null;
    }

    const payload = buildContextFieldWorkOutLoudPayload({
      tenantId: getTenantId(ctx),
      userId: String(ctx.meta?.authUser?.userId || 'anonymous'),
      signalType: WORK_OUT_LOUD_SIGNAL_TYPES.ONBOARDING_FACT_LEARNED,
      contextField: answer.paramKey,
      rawValue: hydratedContext?.[answer.paramKey],
      sourceKind: 'onboarding_answer',
      scope: 'user',
      updateReason: 'onboarding_answer',
      confidence: 0.85,
    });

    return this.emitWorkOutLoudSafe(ctx, payload);
  },

  resolveScopedKnowledgeState({ session = {}, knownContext = {} } = {}) {
    const now = new Date().toISOString();
    const existingSession = sanitizeScopedDatapoints(session?.l3?.knowledgeScopeDataPoints || []);
    const existingUser = sanitizeScopedDatapoints(
      session?.l2?.userProfile?.knowledgeScopeDataPoints || []
    );

    const KNOWN_CONTEXT_ALLOWLIST = {
      organizationType: 'user',
      responsibleRole: 'role',
      roleId: 'role',
      gridOperatorBdew: 'tenant_candidate',
      gridOperatorId: 'tenant_candidate',
      gridOperatorName: 'tenant_candidate',
      bdew: 'tenant_candidate',
      vnbName: 'tenant_candidate',
      postalCode: 'session',
      city: 'session',
      voltageLevel: 'session',
    };

    const derivedFromKnownContext = Object.entries(KNOWN_CONTEXT_ALLOWLIST).reduce(
      (acc, [key, scope]) => {
        const value = (knownContext || {})[key];
        if (value === undefined || value === null) {
          return acc;
        }
        const isScalar =
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
        if (!isScalar) {
          return acc;
        }
        acc.push({
          key,
          scope,
          source: 'knownContext',
          status: 'observed',
          updatedAt: now,
        });
        return acc;
      },
      []
    );

    const explicitRaw = Array.isArray(knownContext?.knowledgeScopeDataPoints)
      ? knownContext.knowledgeScopeDataPoints
      : [];
    const explicitNormalized = sanitizeScopedDatapoints(
      explicitRaw.map((point) => ({
        key: point?.key,
        scope: point?.scope,
        source: point?.source || 'knownContext',
        status: point?.status,
        updatedAt: point?.updatedAt || now,
      }))
    );

    const merged = sanitizeScopedDatapoints([
      ...existingSession,
      ...existingUser,
      ...derivedFromKnownContext,
      ...explicitNormalized,
    ]);

    return {
      sessionDataPoints: merged.filter(
        (point) => point.scope === 'session' || point.scope === 'tenant_candidate'
      ),
      userDataPoints: merged.filter((point) => point.scope === 'user' || point.scope === 'role'),
    };
  },

  buildKnowledgeScopeTraceSummary(knowledgeScope = []) {
    const sanitized = sanitizeScopedDatapoints(knowledgeScope);
    const byScope = {};
    const bySource = {};

    for (const point of sanitized) {
      byScope[point.scope] = (byScope[point.scope] || 0) + 1;
      bySource[point.source] = (bySource[point.source] || 0) + 1;
    }

    return {
      total: sanitized.length,
      byScope,
      bySource,
    };
  },

  buildAgentTrace({
    routing = null,
    plan = null,
    execution = null,
    evidencePlan = null,
    consultation = null,
    responseStrategy = null,
    stateMachine = null,
    executionStateGraph = null,
    turnGraph = null,
    routingDecision = null,
    personaResolution = null,
    bootstrapContext = null,
    knowledgeScope = null,
    workLog = null, // v0.57.3
    reflection = null, // v0.57.5 #158
    locationResolution = null, // v0.60: location resolution trace
    policy = null,
  } = {}) {
    const toolAttempts = Array.isArray(consultation?.attemptsSummary)
      ? consultation.attemptsSummary.map((attempt) => ({
          tool: attempt.tool,
          success: attempt.success,
          attempts: attempt.attempts,
          inputType: attempt.inputType,
        }))
      : [];

    return {
      traceId: `trace_${Date.now()}`,
      planning: {
        source: routing?.source || null,
        primaryIntent: routing?.primaryIntent || null,
        routeKey: routing?.routeKey || null,
        routeLabel: routing?.routeLabel || null,
        planStatus: plan?.status || null,
        plannedSteps: Array.isArray(plan?.steps) ? plan.steps.length : 0,
        warnings: Array.isArray(routing?.warnings) ? routing.warnings : [],
      },
      execution: {
        status: execution?.status || null,
        completedSteps: execution?.completedSteps || 0,
        stopReason: execution?.stopPoint?.reasonCode || null,
        hitlItemId: execution?.stopPoint?.hitlItemId || null,
        criticalStepBlocked: execution?.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL',
        meta: execution?.meta || null,
      },
      routingDecision: routingDecision
        ? {
            target: routingDecision.target || null,
            label: routingDecision.label || null,
            confidence:
              typeof routingDecision.confidence === 'number' ? routingDecision.confidence : null,
            determinism: routingDecision.determinism || null,
            gapReason: routingDecision?.gap?.reason || null,
          }
        : null,
      responseStrategy: responseStrategy
        ? {
            audienceType: responseStrategy.audience || null,
            audience: responseStrategy.audience || null,
            audienceConfidence:
              typeof responseStrategy.audienceConfidence === 'number'
                ? responseStrategy.audienceConfidence
                : null,
            epistemicState: responseStrategy.epistemicState || null,
            abstractionLevel: responseStrategy.abstractionLevel || null,
            nextMove: responseStrategy.nextMove || null,
            nextDialogueMove: responseStrategy.nextMove || null,
            decisionRole: responseStrategy.decisionRole || null,
            confidence:
              typeof responseStrategy.confidence === 'number' ? responseStrategy.confidence : null,
            workingAssumptions: Array.isArray(responseStrategy.assumptions)
              ? responseStrategy.assumptions
              : [],
            userFacingQuestionStyle: responseStrategy.userFacingQuestionStyle || null,
            shouldHideInternalSchema: Boolean(responseStrategy.shouldHideInternalSchema),
            assumptionCount: Array.isArray(responseStrategy.assumptions)
              ? responseStrategy.assumptions.length
              : 0,
          }
        : null,
      evidence: {
        source: evidencePlan?.source || null,
        registryKey: evidencePlan?.registryKey || null,
        confidence: typeof evidencePlan?.confidence === 'number' ? evidencePlan.confidence : null,
        gapIds: Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps.map((gap) => gap.id) : [],
      },
      stateMachine: summarizeStateMachine(stateMachine),
      executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
      turnGraph: summarizeTurnGraph(turnGraph),
      consultationDebug: Array.isArray(consultation?.debugTrace)
        ? consultation.debugTrace
        : undefined,
      degradation:
        consultation?.degradation && typeof consultation.degradation === 'object'
          ? consultation.degradation
          : undefined,
      toolAttempts,
      personaResolution, // v0.56.2
      bootstrapContext: this.buildBootstrapTraceContext(bootstrapContext),
      knowledgeScope: this.buildKnowledgeScopeTraceSummary(knowledgeScope || []),
      workLog: Array.isArray(workLog) ? workLog : [], // v0.57.3
      reflection: reflection && typeof reflection === 'object' ? reflection : undefined, // v0.57.5 #158
      // v0.60: location extraction trace for DevOps/OSM/MaStR consumers
      locationResolution:
        locationResolution && typeof locationResolution === 'object'
          ? locationResolution
          : undefined,
      policy: policy && typeof policy === 'object' ? policy : null,
    };
  },

  async queryKnowledgeOrientation(ctx, { message, activeDomains = [] } = {}) {
    return queryKnowledgeOrientationAdapter(ctx, {
      message,
      activeDomains,
    });
  },

  normalizeRoutingContext(routingContext) {
    if (!routingContext || typeof routingContext !== 'object' || Array.isArray(routingContext)) {
      return null;
    }
    return { ...routingContext };
  },

  deriveCriticalStepRoutingMetadata({ plan = {}, plannedStep = {}, knownContext = {} } = {}) {
    const stepResolverRoles = Array.isArray(plannedStep?.requiredResolverRoles)
      ? plannedStep.requiredResolverRoles
      : [];
    const planResolverRoles = Array.isArray(plan?.requiredResolverRoles)
      ? plan.requiredResolverRoles
      : [];
    const contextResolverRoles = Array.isArray(knownContext?.requiredResolverRoles)
      ? knownContext.requiredResolverRoles
      : [];

    return {
      responsibleRole:
        plannedStep?.responsibleRole ||
        plannedStep?.ownerRole ||
        plan?.responsibleRole ||
        knownContext?.responsibleRole ||
        null,
      requiredResolverRoles:
        stepResolverRoles.length > 0
          ? stepResolverRoles
          : planResolverRoles.length > 0
            ? planResolverRoles
            : contextResolverRoles,
      personaId: plannedStep?.personaId || plan?.personaId || knownContext?.personaId || null,
      routingContext:
        this.normalizeRoutingContext(plannedStep?.routingContext) ||
        this.normalizeRoutingContext(plan?.routingContext) ||
        this.normalizeRoutingContext(knownContext?.routingContext) ||
        null,
    };
  },

  updateCriticalStepCheckpointStatus(session = {}, hitlItemId, status) {
    const normalizedStatus = normalizeHitlStatus(status);
    if (!hitlItemId || !normalizedStatus) {
      return;
    }

    const store = this.ensureCriticalStepCheckpointStore(session);
    for (const [checkpointKey, checkpoint] of Object.entries(store)) {
      if (!checkpoint || checkpoint.hitlItemId !== hitlItemId) {
        continue;
      }

      store[checkpointKey] = {
        ...checkpoint,
        status: normalizedStatus,
        updatedAt: new Date().toISOString(),
        ...(normalizedStatus === 'approved' ? { approvedAt: new Date().toISOString() } : {}),
      };
    }
  },

  findSessionPendingHitlReference(session = {}, knownContext = {}) {
    const sessionStopPoint =
      session?.l3?.stopPoint && typeof session.l3.stopPoint === 'object'
        ? session.l3.stopPoint
        : null;
    const stateMachineState = String(session?.l3?.stateMachine?.currentState || '').trim();

    const knownContextHitlItemId =
      knownContext?.hitlItemId || knownContext?.hitl?.itemId || knownContext?.hitlItem?.id || null;

    const stopPointHitlItemId =
      sessionStopPoint?.hitlItemId ||
      sessionStopPoint?.hitlItem?.id ||
      sessionStopPoint?.onboardingQuestion?.hitlItem?.id ||
      null;

    const stopPointIndicatesMandatoryHitl =
      sessionStopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL' && Boolean(stopPointHitlItemId);
    const stateIndicatesHitlBlocked =
      stateMachineState === PERSONAL_AGENT_STATES.HITL_BLOCKED ||
      stateMachineState === 'hitl_blocked';

    const checkpointContext = this.findCriticalStepCheckpointContext(session, {
      hitlItemId: knownContextHitlItemId || stopPointHitlItemId || null,
      blockedAction: sessionStopPoint?.blockedAction || null,
      blockedStep: sessionStopPoint?.blockedStep || null,
    });
    const checkpointHitlItemId = checkpointContext?.hitlItemId || null;

    const hitlItemId =
      knownContextHitlItemId || stopPointHitlItemId || checkpointHitlItemId || null;

    const shouldGateBySession =
      Boolean(hitlItemId) &&
      (stopPointIndicatesMandatoryHitl || stateIndicatesHitlBlocked || Boolean(checkpointContext));

    return {
      shouldGateBySession,
      hitlItemId,
      sessionStopPoint,
      checkpointContext,
      stateMachineState,
    };
  },

  buildHitlTerminalMessage(status, blockedAction = null) {
    const suffix = blockedAction ? ` (${blockedAction})` : '';
    if (['rejected', 'declined', 'cancelled'].includes(status)) {
      return `Die erforderliche HITL-Freigabe${suffix} wurde abgelehnt oder widerrufen. Der blockierte Schritt wird nicht ausgeführt.`;
    }
    if (status === 'expired') {
      return `Die erforderliche HITL-Freigabe${suffix} ist abgelaufen. Bitte starten Sie den Vorgang neu, falls der Schritt erneut ausgeführt werden soll.`;
    }
    if (status === 'resolved') {
      return `Die HITL-Freigabe${suffix} ist bereits abgeschlossen. Es liegt kein offener Freigabe-Blocker mehr vor.`;
    }
    return `Die HITL-Freigabe${suffix} befindet sich nicht mehr in einem ausführbaren Zustand.`;
  },

  async resolveSessionHitlResumeGate(ctx, { session = {}, knownContext = {}, message = '' } = {}) {
    const hitlRef = this.findSessionPendingHitlReference(session, knownContext);

    if (!hitlRef?.shouldGateBySession || !hitlRef?.hitlItemId) {
      return { mode: 'none' };
    }

    const hitlItem = await this.getHitlItem(ctx, hitlRef.hitlItemId);
    const resolvedStatus = normalizeHitlStatus(
      hitlItem?.status ||
        hitlRef?.sessionStopPoint?.hitlItem?.status ||
        hitlRef?.sessionStopPoint?.onboardingQuestion?.hitlItem?.status ||
        hitlRef?.checkpointContext?.status ||
        'pending'
    );

    this.updateCriticalStepCheckpointStatus(
      session,
      hitlRef.hitlItemId,
      resolvedStatus || 'pending'
    );

    if (isHitlApprovedStatus(resolvedStatus)) {
      const savedStopPoint =
        session.l3?.stopPoint && typeof session.l3.stopPoint === 'object'
          ? { ...session.l3.stopPoint }
          : null;
      const resumePlanState = this.resolveCriticalStepResumePlan(session, hitlRef);
      session.l3.stopPoint = null;

      if (!resumePlanState.planSnapshot?.steps?.length) {
        const diagnosticMessage =
          'Die HITL-Freigabe wurde bestätigt, aber der gespeicherte Resume-Plan konnte nicht wiederhergestellt werden. Bitte den Vorgang aus dem ursprünglichen Schritt neu starten.';
        const diagnosticStopPoint = this.buildStopPoint({
          reasonCode: 'approved_hitl_resume_missing_plan',
          message: diagnosticMessage,
          blockedStep:
            Number(savedStopPoint?.blockedStep || hitlRef?.checkpointContext?.step || 1) || 1,
          status: 'failed',
          placeholder: {
            blockedAction:
              savedStopPoint?.blockedAction || hitlRef?.checkpointContext?.action || null,
            hitlItem: hitlItem
              ? this.toPublicStopPointHitlItem(hitlItem)
              : hitlRef.hitlItemId
                ? { id: hitlRef.hitlItemId, status: resolvedStatus || 'approved' }
                : null,
            responsibleRole:
              savedStopPoint?.responsibleRole ||
              hitlRef?.checkpointContext?.responsibleRole ||
              null,
            requiredResolverRoles: Array.isArray(savedStopPoint?.requiredResolverRoles)
              ? savedStopPoint.requiredResolverRoles
              : Array.isArray(hitlRef?.checkpointContext?.requiredResolverRoles)
                ? hitlRef.checkpointContext.requiredResolverRoles
                : [],
            personaId: savedStopPoint?.personaId || hitlRef?.checkpointContext?.personaId || null,
            personaName:
              savedStopPoint?.personaName || hitlRef?.checkpointContext?.personaName || null,
            personaType:
              savedStopPoint?.personaType || hitlRef?.checkpointContext?.personaType || null,
            personaResolution:
              savedStopPoint?.personaResolution ||
              hitlRef?.checkpointContext?.personaResolution ||
              null,
            routingContext:
              this.normalizeRoutingContext(savedStopPoint?.routingContext) ||
              this.normalizeRoutingContext(hitlRef?.checkpointContext?.routingContext) ||
              null,
          },
        });
        return {
          mode: 'approved-missing-plan',
          hitlItemId: hitlRef.hitlItemId,
          hitlItem,
          status: resolvedStatus,
          savedStopPoint,
          checkpointContext: resumePlanState.checkpointContext,
          planStackFrame: resumePlanState.planStackFrame,
          planSnapshot: null,
          stopPoint: diagnosticStopPoint,
          reply: diagnosticMessage,
        };
      }

      if (!session.l3 || typeof session.l3 !== 'object') {
        session.l3 = {};
      }
      session.l3._approvedHitlResume = resumePlanState.planSnapshot;
      return {
        mode: 'approved',
        hitlItemId: hitlRef.hitlItemId,
        hitlItem,
        status: resolvedStatus,
        savedStopPoint,
        checkpointContext: resumePlanState.checkpointContext,
        planStackFrame: resumePlanState.planStackFrame,
        planSnapshot: resumePlanState.planSnapshot,
      };
    }

    const baseStopPoint =
      hitlRef?.sessionStopPoint && typeof hitlRef.sessionStopPoint === 'object'
        ? hitlRef.sessionStopPoint
        : {};
    const basePlaceholder =
      baseStopPoint?.placeholder && typeof baseStopPoint.placeholder === 'object'
        ? baseStopPoint.placeholder
        : {};
    const publicHitlItem =
      this.toPublicStopPointHitlItem(hitlItem) ||
      this.toPublicStopPointHitlItem(baseStopPoint?.hitlItem) ||
      (hitlRef.hitlItemId
        ? {
            id: hitlRef.hitlItemId,
            status: resolvedStatus || 'pending',
            responsibleRole:
              baseStopPoint?.responsibleRole || basePlaceholder?.responsibleRole || null,
            requiredResolverRoles: Array.isArray(baseStopPoint?.requiredResolverRoles)
              ? baseStopPoint.requiredResolverRoles
              : Array.isArray(basePlaceholder?.requiredResolverRoles)
                ? basePlaceholder.requiredResolverRoles
                : [],
            personaId: baseStopPoint?.personaId || basePlaceholder?.personaId || null,
            personaName: baseStopPoint?.personaName || basePlaceholder?.personaName || null,
            personaType: baseStopPoint?.personaType || basePlaceholder?.personaType || null,
            personaResolution:
              baseStopPoint?.personaResolution || basePlaceholder?.personaResolution || null,
            routingContext:
              this.normalizeRoutingContext(baseStopPoint?.routingContext) ||
              this.normalizeRoutingContext(basePlaceholder?.routingContext) ||
              null,
          }
        : null);

    const blockedAction =
      baseStopPoint?.blockedAction ||
      basePlaceholder?.blockedAction ||
      hitlRef?.checkpointContext?.action ||
      null;
    const blockedStep =
      Number(
        baseStopPoint?.blockedStep ||
          basePlaceholder?.blockedStep ||
          hitlRef?.checkpointContext?.step ||
          1
      ) || 1;

    const placeholder = {
      ...basePlaceholder,
      blockedAction,
      missingParams: [],
      responsibleRole:
        baseStopPoint?.responsibleRole ||
        basePlaceholder?.responsibleRole ||
        publicHitlItem?.responsibleRole ||
        null,
      requiredResolverRoles: Array.isArray(baseStopPoint?.requiredResolverRoles)
        ? baseStopPoint.requiredResolverRoles
        : Array.isArray(basePlaceholder?.requiredResolverRoles)
          ? basePlaceholder.requiredResolverRoles
          : Array.isArray(publicHitlItem?.requiredResolverRoles)
            ? publicHitlItem.requiredResolverRoles
            : [],
      personaId:
        baseStopPoint?.personaId || basePlaceholder?.personaId || publicHitlItem?.personaId || null,
      personaName:
        baseStopPoint?.personaName ||
        basePlaceholder?.personaName ||
        publicHitlItem?.personaName ||
        null,
      personaType:
        baseStopPoint?.personaType ||
        basePlaceholder?.personaType ||
        publicHitlItem?.personaType ||
        null,
      personaResolution:
        baseStopPoint?.personaResolution ||
        basePlaceholder?.personaResolution ||
        publicHitlItem?.personaResolution ||
        null,
      routingContext:
        this.normalizeRoutingContext(baseStopPoint?.routingContext) ||
        this.normalizeRoutingContext(basePlaceholder?.routingContext) ||
        this.normalizeRoutingContext(publicHitlItem?.routingContext) ||
        null,
      hitlItem: publicHitlItem,
    };

    if (isHitlTerminalStatus(resolvedStatus)) {
      const terminalMessage = this.buildHitlTerminalMessage(resolvedStatus, blockedAction);
      const terminalStopPoint = this.buildStopPoint({
        reasonCode: 'HITL_TERMINAL_DECISION',
        message: terminalMessage,
        blockedStep,
        status: 'hitl-terminal',
        placeholder,
      });
      session.l3.stopPoint = terminalStopPoint;
      return {
        mode: 'terminal',
        hitlItemId: hitlRef.hitlItemId,
        status: resolvedStatus,
        stopPoint: terminalStopPoint,
        reply: terminalMessage,
      };
    }

    const blockedStopPoint = this.buildStopPoint({
      reasonCode: 'MANDATORY_HITL_APPROVAL',
      message:
        String(baseStopPoint?.message || '').trim() ||
        `Kritischer Prüfschritt ${blockedStep}${blockedAction ? ` (${blockedAction})` : ''} erfordert vor Ausführung eine verpflichtende HITL-Freigabe.`,
      blockedStep,
      status: 'hitl-required',
      placeholder,
    });

    const onboardingQuestion = this.buildHitlOnboardingQuestion(
      blockedStopPoint,
      baseStopPoint?.onboardingQuestion?.planSnapshot || null
    );
    const stopPoint = {
      ...blockedStopPoint,
      onboardingQuestion,
      message: onboardingQuestion.message,
      hitlItemId: onboardingQuestion?.hitlItem?.id || blockedStopPoint?.hitlItemId || null,
    };

    session.l3.stopPoint = stopPoint;

    const explicitApprovalIntent = this.isHitlApprovalIntent(message);

    if (explicitApprovalIntent) {
      try {
        await ctx.call(
          'hitl.approve',
          {
            id: hitlRef.hitlItemId,
            comment: 'Approved from Personal Agent conversation turn.',
          },
          { meta: { ...ctx.meta, $gateway: false } }
        );
        this.updateCriticalStepCheckpointStatus(session, hitlRef.hitlItemId, 'approved');
        return this.resolveSessionHitlResumeGate(ctx, {
          session,
          knownContext: { ...(knownContext || {}), hitlItemId: hitlRef.hitlItemId },
          message: '',
        });
      } catch (error) {
        this.logger?.warn?.(`HITL approval intent could not be applied: ${error.message}`);
      }
    }

    const replyBase = this.buildHitlApprovalMarkdown(onboardingQuestion);
    const reply = explicitApprovalIntent
      ? `${replyBase}\n\nHinweis: Ich habe die Freigabe erkannt, konnte sie aber nicht automatisch auf das HITL-Element anwenden. Bitte bestätigen Sie das HITL-Element explizit oder nennen Sie die HITL-ID.`
      : replyBase;

    return {
      mode: 'blocked',
      hitlItemId: hitlRef.hitlItemId,
      status: resolvedStatus || 'pending',
      stopPoint,
      reply,
    };
  },
};
