'use strict';

// personal-agent methods chunk 10/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: resolveCriticalStepResumePlan, ensureCriticalStepCheckpointStore, getHitlItemStatus, getHitlItem, createCriticalStepHitlItem, resolveCriticalStepApproval, findBestVdmiDecisionTask, extractVdmiTaskFromExecutionState, loadVdmiMatrixForKnownContext, hydrateVdmiStepParams, executeDeterministicPlan, normalizeComparableText, extractLookupResults, classifyLocationOperatorConsistency

const {
  EXECUTION_MODES,
  ROUTING_CONTROL_ACTIONS,
  fillTemplateWithContext,
  pruneUndefinedDeep,
  runExecutionPreflight,
  isNotFound,
  isActionUnavailable,
  isParametersValidationError,
} = require('./shared');

module.exports = {
  resolveCriticalStepResumePlan(session = {}, hitlRef = {}) {
    const sessionStopPoint =
      session?.l3?.stopPoint && typeof session.l3.stopPoint === 'object'
        ? session.l3.stopPoint
        : null;
    const blockedAction = sessionStopPoint?.blockedAction || null;
    const blockedStep = Number(sessionStopPoint?.blockedStep || 0) || null;
    const checkpointContext = this.findCriticalStepCheckpointContext(session, {
      hitlItemId: hitlRef?.hitlItemId || sessionStopPoint?.hitlItemId || null,
      blockedAction,
      blockedStep,
    });

    const stopPointPlanSnapshot =
      sessionStopPoint?.onboardingQuestion?.planSnapshot &&
      Array.isArray(sessionStopPoint.onboardingQuestion.planSnapshot.steps) &&
      sessionStopPoint.onboardingQuestion.planSnapshot.steps.length > 0
        ? sessionStopPoint.onboardingQuestion.planSnapshot
        : null;
    const checkpointPlanSnapshot =
      checkpointContext?.planSnapshot &&
      Array.isArray(checkpointContext.planSnapshot.steps) &&
      checkpointContext.planSnapshot.steps.length > 0
        ? checkpointContext.planSnapshot
        : null;
    const planStackFrame = this.findCriticalStepPlanStackFrame(session?.planStack || [], {
      hitlItemId:
        hitlRef?.hitlItemId ||
        sessionStopPoint?.hitlItemId ||
        checkpointContext?.hitlItemId ||
        null,
      blockedAction,
      blockedStep,
    });
    const planStackPlanSnapshot =
      planStackFrame?.planSnapshot &&
      Array.isArray(planStackFrame.planSnapshot.steps) &&
      planStackFrame.planSnapshot.steps.length > 0
        ? planStackFrame.planSnapshot
        : null;

    return {
      planSnapshot:
        stopPointPlanSnapshot || checkpointPlanSnapshot || planStackPlanSnapshot || null,
      checkpointContext,
      planStackFrame,
      stopPointPlanSnapshot,
      checkpointPlanSnapshot,
      planStackPlanSnapshot,
    };
  },

  ensureCriticalStepCheckpointStore(session = {}) {
    if (!session.l3 || typeof session.l3 !== 'object') {
      session.l3 = {};
    }
    if (
      !session.l3.criticalStepCheckpoints ||
      typeof session.l3.criticalStepCheckpoints !== 'object'
    ) {
      session.l3.criticalStepCheckpoints = {};
    }
    return session.l3.criticalStepCheckpoints;
  },

  async getHitlItemStatus(ctx, hitlItemId) {
    const item = await this.getHitlItem(ctx, hitlItemId);
    return item?.status || null;
  },

  async getHitlItem(ctx, hitlItemId) {
    if (!hitlItemId) return null;
    try {
      const result = await ctx.call(
        'hitl.get',
        { id: hitlItemId },
        { meta: { ...ctx.meta, $gateway: false } }
      );
      return result?.item || null;
    } catch (error) {
      if (isActionUnavailable(error) || isNotFound(error)) {
        return null;
      }
      this.logger?.warn(`hitl.get failed for ${hitlItemId}: ${error.message}`);
      return null;
    }
  },

  async createCriticalStepHitlItem(
    ctx,
    { message, plan = {}, plannedStep = {}, session = {}, knownContext = {} }
  ) {
    try {
      const routingMetadata = this.deriveCriticalStepRoutingMetadata({
        plan,
        plannedStep,
        knownContext,
      });

      const payload = {
        sessionId: session?.id || null,
        routeKey: plan?.routeKey || null,
        routeLabel: plan?.routeLabel || null,
        primaryIntent: plan?.primaryIntent || null,
        step: plannedStep?.step || null,
        action: plannedStep?.action || null,
        purpose: plannedStep?.purpose || null,
        criticalityClass: plannedStep?.criticalityClass || null,
        userMessage: String(message || '').slice(0, 500),
      };

      const result = await ctx.call(
        'hitl.create',
        {
          kind: 'personal-agent-critical-step-approval',
          payload,
          originService: 'personal-agent',
          originAction: plannedStep?.action || 'unknown',
          severity: 'critical',
          requiredScope: 'full-access',
          responsibleRole: routingMetadata.responsibleRole,
          requiredResolverRoles: routingMetadata.requiredResolverRoles,
          personaId: routingMetadata.personaId,
          routingContext: routingMetadata.routingContext || {},
        },
        { meta: { ...ctx.meta, $gateway: false } }
      );

      return result?.item || null;
    } catch (error) {
      if (isActionUnavailable(error) || isNotFound(error)) {
        return null;
      }
      this.logger?.warn(`hitl.create failed for critical step checkpoint: ${error.message}`);
      return null;
    }
  },

  async resolveCriticalStepApproval(
    ctx,
    { message, plan = {}, plannedStep = {}, session = {}, knownContext = {} }
  ) {
    const store = this.ensureCriticalStepCheckpointStore(session);
    const checkpointKey = this.buildCriticalStepCheckpointKey(plan, plannedStep);
    const stored =
      store[checkpointKey] && typeof store[checkpointKey] === 'object'
        ? store[checkpointKey]
        : null;

    const providedHitlItemId =
      knownContext?.hitlItemId || knownContext?.hitl?.itemId || knownContext?.hitlItem?.id || null;

    if (providedHitlItemId) {
      const providedItem = await this.getHitlItem(ctx, providedHitlItemId);
      const providedStatus = providedItem?.status || null;
      if (providedStatus === 'approved') {
        store[checkpointKey] = {
          hitlItemId: providedHitlItemId,
          status: 'approved',
          approvedAt: new Date().toISOString(),
          action: plannedStep?.action || null,
          step: plannedStep?.step || null,
          checkpointKey,
          planSnapshot: this.buildCriticalStepResumeSnapshot(plan, plannedStep),
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
        return {
          approved: true,
          hitlItemId: providedHitlItemId,
          status: providedStatus,
          hitlItem: this.toPublicStopPointHitlItem(providedItem) || {
            id: providedHitlItemId,
            status: providedStatus,
          },
        };
      }

      store[checkpointKey] = {
        hitlItemId: providedHitlItemId,
        status: providedStatus || 'pending',
        updatedAt: new Date().toISOString(),
        action: plannedStep?.action || null,
        step: plannedStep?.step || null,
        checkpointKey,
        planSnapshot: this.buildCriticalStepResumeSnapshot(plan, plannedStep),
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
      return {
        approved: false,
        hitlItemId: providedHitlItemId,
        status: providedStatus || 'pending',
        hitlItem: this.toPublicStopPointHitlItem(providedItem) || {
          id: providedHitlItemId,
          status: providedStatus || 'pending',
        },
      };
    }

    const storedHitlItemId = stored?.hitlItemId || null;
    if (storedHitlItemId) {
      const storedItem = await this.getHitlItem(ctx, storedHitlItemId);
      const status = storedItem?.status || null;
      if (status === 'approved') {
        store[checkpointKey] = {
          ...stored,
          status: 'approved',
          approvedAt: new Date().toISOString(),
          planSnapshot:
            stored?.planSnapshot && Array.isArray(stored.planSnapshot.steps)
              ? stored.planSnapshot
              : this.buildCriticalStepResumeSnapshot(plan, plannedStep),
        };
        return {
          approved: true,
          hitlItemId: storedHitlItemId,
          status,
          hitlItem: this.toPublicStopPointHitlItem(storedItem) || {
            id: storedHitlItemId,
            status,
          },
        };
      }

      store[checkpointKey] = {
        ...stored,
        status: status || 'pending',
        updatedAt: new Date().toISOString(),
        planSnapshot:
          stored?.planSnapshot && Array.isArray(stored.planSnapshot.steps)
            ? stored.planSnapshot
            : this.buildCriticalStepResumeSnapshot(plan, plannedStep),
      };
      return {
        approved: false,
        hitlItemId: storedHitlItemId,
        status: status || 'pending',
        hitlItem: this.toPublicStopPointHitlItem(storedItem) || {
          id: storedHitlItemId,
          status: status || 'pending',
        },
      };
    }

    const createdItem = await this.createCriticalStepHitlItem(ctx, {
      message,
      plan,
      plannedStep,
      session,
      knownContext,
    });

    if (createdItem?.id) {
      store[checkpointKey] = {
        hitlItemId: createdItem.id,
        status: createdItem.status || 'pending',
        createdAt: new Date().toISOString(),
        action: plannedStep?.action || null,
        step: plannedStep?.step || null,
        checkpointKey,
        planSnapshot: this.buildCriticalStepResumeSnapshot(plan, plannedStep),
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
      return {
        approved: false,
        hitlItemId: createdItem.id,
        status: createdItem.status || 'pending',
        hitlItem: this.toPublicStopPointHitlItem(createdItem),
      };
    }

    return { approved: false, hitlItemId: null, status: 'pending', hitlItem: null };
  },

  findBestVdmiDecisionTask(matrix = {}) {
    const tasks = Array.isArray(matrix?.tasks) ? matrix.tasks : [];
    if (tasks.length === 0) {
      return {
        task: null,
        reason: 'no_tasks_available',
      };
    }

    const decisionRegex =
      /(decision|entscheidung|netzbetreiberentscheidung|anschluss|kapazit[aä]t|uebergabepunkt|übergabepunkt|governance|formal|antrag|gatekeeper)/i;
    const decisionCandidates = tasks.filter((task) =>
      decisionRegex.test(`${task?.taskId || ''} ${task?.taskName || ''} ${task?.phase || ''}`)
    );

    if (decisionCandidates.length === 1) {
      return {
        task: decisionCandidates[0],
        reason: 'decision_task_match',
      };
    }

    if (decisionCandidates.length > 1) {
      return {
        task: null,
        reason: 'ambiguous_decision_tasks',
        candidates: decisionCandidates.map((task) => task?.taskId).filter(Boolean),
      };
    }

    if (tasks.length === 1) {
      return {
        task: tasks[0],
        reason: 'single_task_fallback',
      };
    }

    return {
      task: null,
      reason: 'task_context_required',
      candidates: tasks.map((task) => task?.taskId).filter(Boolean),
    };
  },

  extractVdmiTaskFromExecutionState(executionState = {}) {
    const stepResults = executionState?.stepResults || {};
    const steps = Object.values(stepResults).map(
      (entry) => entry?.raw || entry?.data || entry || {}
    );

    for (const payload of steps.reverse()) {
      const dossierTask = payload?.dossier?.task;
      if (dossierTask && (dossierTask.taskId || dossierTask.taskName)) {
        return dossierTask;
      }
    }

    return null;
  },

  async loadVdmiMatrixForKnownContext(ctx, knownContext = {}) {
    const matrixId = knownContext?.matrixId || null;
    const processId = knownContext?.processId || knownContext?.jobId || null;

    if (matrixId) {
      try {
        const response = await ctx.call(
          'vdmi.get',
          { id: matrixId },
          { meta: { ...ctx.meta, $gateway: false } }
        );
        return response?.matrix || null;
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          return null;
        }
        throw error;
      }
    }

    if (processId) {
      try {
        const response = await ctx.call(
          'vdmi.context',
          { jobId: processId },
          { meta: { ...ctx.meta, $gateway: false } }
        );
        return response?.matrix || null;
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          return null;
        }
        throw error;
      }
    }

    return null;
  },

  async hydrateVdmiStepParams(ctx, { plannedStep, params, knownContext, executionState }) {
    const action = String(plannedStep?.action || '');
    if (!action.startsWith('vdmi.')) {
      return { params, stopPoint: null };
    }

    const hydrated = { ...(params || {}) };

    if (
      (action === 'vdmi.dossier' ||
        action === 'vdmi.negotiationTrace' ||
        action === 'vdmi.agentRole') &&
      !hydrated.taskId
    ) {
      if (knownContext?.taskId) {
        hydrated.taskId = knownContext.taskId;
      } else {
        const inferredTask = this.extractVdmiTaskFromExecutionState(executionState);
        if (inferredTask?.taskId) {
          hydrated.taskId = inferredTask.taskId;
          knownContext.taskId = inferredTask.taskId;
        } else {
          const matrix = await this.loadVdmiMatrixForKnownContext(ctx, knownContext);
          if (matrix) {
            const picked = this.findBestVdmiDecisionTask(matrix);
            if (picked?.task?.taskId) {
              hydrated.taskId = picked.task.taskId;
              knownContext.taskId = picked.task.taskId;
            } else {
              const reasonSuffix = picked?.reason ? ` (${picked.reason})` : '';
              return {
                params: hydrated,
                stopPoint: {
                  reasonCode: 'MISSING_VDMI_TASK_CONTEXT',
                  message: `VDMI Task-Kontext ist nicht eindeutig auflösbar${reasonSuffix}.`,
                  blockedStep: plannedStep.step,
                  blockedAction: action,
                  missingParams: ['taskId'],
                  status: 'interface-placeholder',
                },
              };
            }
          } else {
            return {
              params: hydrated,
              stopPoint: {
                reasonCode: 'MISSING_VDMI_TASK_CONTEXT',
                message: 'VDMI Task-Kontext fehlt. Bitte taskId, matrixId oder processId angeben.',
                blockedStep: plannedStep.step,
                blockedAction: action,
                missingParams: ['taskId'],
                status: 'interface-placeholder',
              },
            };
          }
        }
      }
    }

    if (action === 'vdmi.agentRole') {
      if (!hydrated.processType && knownContext?.processType) {
        hydrated.processType = knownContext.processType;
      }

      if (!hydrated.agentId) {
        const taskFromExecution = this.extractVdmiTaskFromExecutionState(executionState);
        const taskActors = Array.isArray(taskFromExecution?.verantwortlich)
          ? taskFromExecution.verantwortlich
          : [];

        let selectedActors = taskActors;

        if (selectedActors.length === 0 && hydrated.taskId) {
          const matrix = await this.loadVdmiMatrixForKnownContext(ctx, knownContext);
          const matchedTask = (matrix?.tasks || []).find(
            (task) => task?.taskId === hydrated.taskId
          );
          selectedActors = Array.isArray(matchedTask?.verantwortlich)
            ? matchedTask.verantwortlich
            : [];
        }

        if (selectedActors.length === 1 && selectedActors[0]?.actorId) {
          hydrated.agentId = selectedActors[0].actorId;
          knownContext.agentId = selectedActors[0].actorId;
        } else if (selectedActors.length > 1) {
          return {
            params: hydrated,
            stopPoint: {
              reasonCode: 'AMBIGUOUS_VDMI_V_ACTOR',
              message:
                'Mehrere verantwortliche V-Akteure gefunden. Bitte Agenten-ID eindeutig angeben.',
              blockedStep: plannedStep.step,
              blockedAction: action,
              missingParams: ['agentId'],
              status: 'interface-placeholder',
            },
          };
        } else {
          return {
            params: hydrated,
            stopPoint: {
              reasonCode: 'MISSING_VDMI_V_ACTOR',
              message: 'Kein verantwortlicher V-Akteur für die Entscheidungstask gefunden.',
              blockedStep: plannedStep.step,
              blockedAction: action,
              missingParams: ['agentId'],
              status: 'interface-placeholder',
            },
          };
        }
      }
    }

    return { params: hydrated, stopPoint: null };
  },

  async executeDeterministicPlan(
    ctx,
    {
      message,
      plan,
      knownContext,
      executionMode,
      session,
      skipGapForMissingInputs = false,
      existingAssumptions = [],
      executionTrace = null,
      toolCallTracker = null,
    }
  ) {
    const executionState = {
      stepResults: {},
    };
    const steps = [];
    let completedSteps = 0;
    let stopPoint = null;
    let assumptions = [...(existingAssumptions || [])];

    for (const plannedStep of plan.steps) {
      if (plannedStep?.action === ROUTING_CONTROL_ACTIONS.MISSING_CONTEXT) {
        continue;
      }

      if (executionMode === EXECUTION_MODES.AUTO && plannedStep?.hitlRequired === true) {
        const approval = await this.resolveCriticalStepApproval(ctx, {
          message,
          plan,
          plannedStep,
          session,
          knownContext,
        });

        const routingMetadata = this.deriveCriticalStepRoutingMetadata({
          plan,
          plannedStep,
          knownContext,
        });

        if (approval?.approved === true) {
          // Approval exists -> proceed with deterministic execution.
        } else {
          const hitlMessage = `Kritischer Prüfschritt ${plannedStep.step} (${plannedStep.action}) erfordert vor Ausführung eine verpflichtende HITL-Freigabe.`;
          const placeholder = await this.markRoutingGap(ctx, {
            reasonCode: 'MANDATORY_HITL_APPROVAL',
            message: hitlMessage,
            blockedStep: plannedStep.step,
            blockingLevel: 'hard',
          });

          const hitlItem =
            this.toPublicStopPointHitlItem(approval?.hitlItem) ||
            (approval?.hitlItemId
              ? {
                  id: approval.hitlItemId,
                  status: approval.status || 'pending',
                  responsibleRole: routingMetadata.responsibleRole,
                  requiredResolverRoles: routingMetadata.requiredResolverRoles,
                  personaId: routingMetadata.personaId,
                  routingContext: routingMetadata.routingContext,
                }
              : null);

          stopPoint = this.buildStopPoint({
            reasonCode: 'MANDATORY_HITL_APPROVAL',
            message: hitlMessage,
            blockedStep: plannedStep.step,
            status: placeholder ? 'interface-placeholder' : 'hitl-required',
            placeholder: {
              ...placeholder,
              blockedAction: plannedStep.action,
              missingParams: [],
              responsibleRole: hitlItem?.responsibleRole || routingMetadata.responsibleRole || null,
              requiredResolverRoles: Array.isArray(hitlItem?.requiredResolverRoles)
                ? hitlItem.requiredResolverRoles
                : routingMetadata.requiredResolverRoles,
              personaId: hitlItem?.personaId || routingMetadata.personaId || null,
              personaName: hitlItem?.personaName || null,
              personaType: hitlItem?.personaType || null,
              personaResolution: hitlItem?.personaResolution || null,
              routingContext:
                this.normalizeRoutingContext(hitlItem?.routingContext) ||
                this.normalizeRoutingContext(routingMetadata.routingContext) ||
                null,
              hitlItem,
            },
          });
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'hitl-required',
            params: {},
            missingInputs: [],
            hitlItemId: approval?.hitlItemId || null,
          });
          break;
        }
      }

      let params = pruneUndefinedDeep(
        fillTemplateWithContext(
          plannedStep.paramsTemplate,
          plannedStep.action,
          knownContext,
          plan.promptHints,
          executionState
        )
      );

      const vdmiHydration = await this.hydrateVdmiStepParams(ctx, {
        plannedStep,
        params,
        knownContext,
        executionState,
      });
      params = pruneUndefinedDeep(vdmiHydration.params || params);

      if (vdmiHydration.stopPoint) {
        const placeholder = await this.markRoutingGap(ctx, {
          reasonCode: vdmiHydration.stopPoint.reasonCode,
          message: vdmiHydration.stopPoint.message,
          blockedStep: plannedStep.step,
        });
        stopPoint = this.buildStopPoint({
          reasonCode: vdmiHydration.stopPoint.reasonCode,
          message: vdmiHydration.stopPoint.message,
          blockedStep: plannedStep.step,
          status: placeholder ? 'interface-placeholder' : vdmiHydration.stopPoint.status,
          placeholder: {
            ...placeholder,
            blockedAction: plannedStep.action,
            missingParams: vdmiHydration.stopPoint.missingParams,
          },
        });
        steps.push({
          step: plannedStep.step,
          action: plannedStep.action,
          status: 'blocked',
          params,
          missingInputs: vdmiHydration.stopPoint.missingParams || [],
        });
        break;
      }

      // Central execution preflight — must pass before any ctx.call.
      // Uses runExecutionPreflight for stricter checks (null, empty string, empty array/object)
      // beyond what the legacy getMissingInputs covers.
      const preflight = runExecutionPreflight(plannedStep.action, params, {
        requiredScopes: Array.isArray(plannedStep.requiredScopes) ? plannedStep.requiredScopes : [],
        contextScopes: knownContext?._scopes || null,
      });
      const missingInputs = preflight.missingParams;

      if (preflight.outcome === 'scope-blocked') {
        const placeholder = await this.markRoutingGap(ctx, {
          reasonCode: 'SCOPE_BLOCKED',
          message: `Step ${plannedStep.step} (${plannedStep.action}) requires scope evidence: ${missingInputs.join(', ')}`,
          blockedStep: plannedStep.step,
        });
        stopPoint = this.buildStopPoint({
          reasonCode: 'SCOPE_BLOCKED',
          message: `Scope-Voraussetzungen nicht erfüllt für ${plannedStep.action}: ${missingInputs.join(', ')}`,
          blockedStep: plannedStep.step,
          status: placeholder ? 'interface-placeholder' : 'scope-blocked',
          placeholder: {
            ...placeholder,
            blockedAction: plannedStep.action,
            missingParams: missingInputs,
          },
        });
        steps.push({
          step: plannedStep.step,
          action: plannedStep.action,
          status: 'scope-blocked',
          params,
          missingInputs,
        });
        break;
      }

      if (preflight.outcome === 'missing-inputs') {
        if (skipGapForMissingInputs) {
          stopPoint = {
            reasonCode: 'MISSING_INPUTS',
            message: `Missing inputs for ${plannedStep.action}: ${missingInputs.join(', ')}`,
            blockedStep: plannedStep.step,
            blockedAction: plannedStep.action,
            missingParams: missingInputs,
            status: 'missing-inputs',
          };
        } else {
          const placeholder = await this.markRoutingGap(ctx, {
            reasonCode: 'MISSING_INPUTS',
            message: `Step ${plannedStep.step} cannot run because required inputs are missing: ${missingInputs.join(', ')}`,
            blockedStep: plannedStep.step,
          });
          stopPoint = this.buildStopPoint({
            reasonCode: 'MISSING_INPUTS',
            message: `Missing inputs for ${plannedStep.action}: ${missingInputs.join(', ')}`,
            blockedStep: plannedStep.step,
            status: placeholder ? 'interface-placeholder' : 'missing-inputs',
            placeholder: {
              ...placeholder,
              blockedAction: plannedStep.action,
              missingParams: missingInputs,
            },
          });
        }
        steps.push({
          step: plannedStep.step,
          action: plannedStep.action,
          status: 'blocked',
          params,
          missingInputs,
        });
        break;
      }

      try {
        const startedAt = Date.now();
        const result = await ctx.call(plannedStep.action, params, {
          meta: { ...ctx.meta, $gateway: false },
        });
        if (result && typeof result === 'object' && result.success === false) {
          const toolMessage =
            result?.error?.message ||
            result?.message ||
            `${plannedStep.action} returned success=false`;
          stopPoint = this.buildStopPoint({
            reasonCode: 'ACTION_FAILED',
            message: `${plannedStep.action} konnte nicht abgeschlossen werden: ${toolMessage}`,
            blockedStep: plannedStep.step,
            status: 'action-error',
            placeholder: {
              blockedAction: plannedStep.action,
              missingParams: /bdew/i.test(toolMessage) ? ['bdew'] : [],
            },
          });
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'failed',
            params,
            result,
            error: toolMessage,
          });
          toolCallTracker?.record({
            phase: 'execution',
            tool: plannedStep.action,
            params,
            success: false,
            retries: 0,
            error: toolMessage,
          });
          executionTrace?.recordToolInvocation({
            phase: 'execution',
            tool: plannedStep.action,
            params,
            success: false,
            latencyMs: Date.now() - startedAt,
            retries: 0,
            error: toolMessage,
          });
          break;
        }
        const normalizedData =
          result && typeof result === 'object' && result.data !== undefined ? result.data : result;
        executionState.stepResults[plannedStep.step] = {
          data: normalizedData,
          raw: result,
          params,
        };
        completedSteps += 1;
        steps.push({
          step: plannedStep.step,
          action: plannedStep.action,
          status: 'completed',
          params,
          result,
        });
        toolCallTracker?.record({
          phase: 'execution',
          tool: plannedStep.action,
          params,
          success: true,
          retries: 0,
          result,
        });
        executionTrace?.recordToolInvocation({
          phase: 'execution',
          tool: plannedStep.action,
          params,
          success: true,
          latencyMs: Date.now() - startedAt,
          retries: 0,
          result,
        });

        if (plannedStep.action === 'grid-operations.marketPartners') {
          const resolvedList = Array.isArray(result?.data?.results)
            ? result.data.results
            : Array.isArray(result?.results)
              ? result.results
              : [];

          if (resolvedList.length === 0) {
            const nextStep = plan.steps.find(
              (candidate) => candidate.step === plannedStep.step + 1
            );
            stopPoint = {
              reasonCode: 'MISSING_INPUTS',
              message: 'Kein eindeutiger Netzbetreiber-Treffer aus den vorhandenen Angaben.',
              blockedStep: nextStep?.step || plannedStep.step + 1,
              blockedAction: nextStep?.action || null,
              missingParams: ['operatorEvidence'],
              status: 'evidence-gap',
            };
            break;
          }
        }

        if (plannedStep.action === 'grid-operations.vnbLookup') {
          const consistency = this.classifyLocationOperatorConsistency({
            knownContext,
            promptHints: plan.promptHints,
            steps,
          });
          if (consistency?.status === 'unverified' || consistency?.status === 'mismatch') {
            // Store unverified location/operator assumption for downstream synthesis
            const existingAssumption = assumptions.find(
              (a) => a.type === 'location_operator_unverified'
            );
            if (!existingAssumption) {
              assumptions.push({
                type: 'location_operator_unverified',
                location: consistency.hints?.projectLocation || '',
                assertedGridOperatorName: consistency.hints?.assertedOperator || '',
                matchedGridOperatorName: consistency.hints?.matchedOperatorName || '',
                status: consistency.status,
                requiredEvidence: [
                  'Netzanschlusszusage/BKZ',
                  'BDEW-Code',
                  'Marktlokation',
                  'Netzanschlusspunkt',
                ],
                createdAtStep: plannedStep.step,
                createdAtTurn: new Date().toISOString(),
              });
            }
            stopPoint = {
              reasonCode: 'MISSING_INPUTS',
              message: 'Standort/Netzbetreiber-Zuständigkeit ist noch nicht belastbar verifiziert.',
              blockedStep: plannedStep.step,
              blockedAction: plannedStep.action,
              missingParams: ['operatorEvidence'],
              status: 'evidence-gap',
              locationOperatorConsistency: consistency.status,
              evidenceHints: consistency.hints,
              questionTextOverride: this.buildOperatorEvidenceQuestion(consistency),
            };
            break;
          }
        }
      } catch (error) {
        toolCallTracker?.record({
          phase: 'execution',
          tool: plannedStep.action,
          params,
          success: false,
          retries: 0,
          error: error.message,
        });
        executionTrace?.recordToolInvocation({
          phase: 'execution',
          tool: plannedStep.action,
          params,
          success: false,
          retries: 0,
          error: error.message,
        });
        // Guard: Moleculer Parameters validation error slipped past preflight.
        // Convert to structured PREFLIGHT_MISS — do not expose schema internals to user.
        if (isParametersValidationError(error)) {
          const placeholder = await this.markRoutingGap(ctx, {
            reasonCode: 'PREFLIGHT_MISS',
            message: `Ungültige Parameter für ${plannedStep.action}.`,
            blockedStep: plannedStep.step,
          });
          stopPoint = this.buildStopPoint({
            reasonCode: 'PREFLIGHT_MISS',
            message: `Ungültige oder fehlende Parameter für ${plannedStep.action}. Bitte notwendige Felder prüfen.`,
            blockedStep: plannedStep.step,
            status: placeholder ? 'interface-placeholder' : 'missing-inputs',
            placeholder: {
              ...placeholder,
              blockedAction: plannedStep.action,
              missingParams: [],
              preflightRegression: true,
            },
          });
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'blocked',
            params,
            error: 'PREFLIGHT_MISS',
            preflightRegression: true,
          });
          break;
        }
        const placeholder = await this.markRoutingGap(ctx, {
          reasonCode: isActionUnavailable(error) ? 'UNSUPPORTED_CHAIN' : 'ACTION_FAILED',
          message: error.message,
          blockedStep: plannedStep.step,
        });
        stopPoint = this.buildStopPoint({
          reasonCode: isActionUnavailable(error) ? 'UNSUPPORTED_CHAIN' : 'ACTION_FAILED',
          message: error.message,
          blockedStep: plannedStep.step,
          status: placeholder ? 'interface-placeholder' : 'action-error',
          placeholder,
        });
        steps.push({
          step: plannedStep.step,
          action: plannedStep.action,
          status: 'failed',
          params,
          error: error.message,
        });
        break;
      }
    }

    if (!stopPoint && plan.status === 'partial') {
      const placeholder = await this.markRoutingGap(ctx, {
        reasonCode: 'UNSUPPORTED_CHAIN',
        message: plan.warnings[0] || 'Unsupported chained domains require manual continuation.',
        blockedStep: completedSteps + 1,
      });
      stopPoint = this.buildStopPoint({
        reasonCode: 'UNSUPPORTED_CHAIN',
        message: plan.warnings[0] || 'Unsupported chained domains require manual continuation.',
        blockedStep: completedSteps + 1,
        status: placeholder ? 'interface-placeholder' : 'unsupported-chain',
        placeholder,
      });
    }

    return {
      status: stopPoint ? 'partial' : 'completed',
      completedSteps,
      steps,
      stopPoint,
      message,
      assumptions,
    };
  },

  normalizeComparableText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, ' ')
      .trim();
  },

  extractLookupResults(step = {}) {
    const result = step?.result;
    if (!result || typeof result !== 'object') {
      return [];
    }
    if (Array.isArray(result?.data?.results)) {
      return result.data.results;
    }
    if (Array.isArray(result?.results)) {
      return result.results;
    }
    if (Array.isArray(result?.data?.data?.results)) {
      return result.data.data.results;
    }
    return [];
  },

  classifyLocationOperatorConsistency({ knownContext = {}, promptHints = {}, steps = [] } = {}) {
    const assertedOperator =
      knownContext?.assertedGridOperatorName ||
      promptHints?.assertedGridOperatorName ||
      promptHints?.gridOperatorName ||
      knownContext?.gridOperatorName ||
      '';
    const projectLocation =
      knownContext?.location || promptHints?.location || promptHints?.city || '';

    if (!assertedOperator || !projectLocation) {
      return null;
    }

    const marketPartnerStep = steps.find(
      (step) => step?.action === 'grid-operations.marketPartners' && step?.status === 'completed'
    );
    const vnbLookupStep = steps.find(
      (step) => step?.action === 'grid-operations.vnbLookup' && step?.status === 'completed'
    );
    const partnerResults = this.extractLookupResults(marketPartnerStep);
    const topHit = partnerResults[0] || null;

    const matchedOperatorName = String(
      topHit?.name || vnbLookupStep?.result?.operator?.name || ''
    ).trim();
    const lookupCity = String(
      topHit?.contacts?.[0]?.city || vnbLookupStep?.result?.operator?.city || ''
    ).trim();

    const normalizedAsserted = this.normalizeComparableText(assertedOperator);
    const normalizedMatched = this.normalizeComparableText(matchedOperatorName);
    const operatorMatches =
      !normalizedMatched ||
      normalizedMatched.includes(normalizedAsserted) ||
      normalizedAsserted.includes(normalizedMatched);

    if (!operatorMatches) {
      return {
        status: 'mismatch',
        hints: {
          assertedOperator,
          matchedOperatorName,
          projectLocation,
          lookupCity,
        },
      };
    }

    const hardMismatch = Boolean(
      vnbLookupStep?.result?.operator?.isResponsible === false ||
      vnbLookupStep?.result?.operator?.zustaendig === false ||
      vnbLookupStep?.result?.responsibilityMatch === false
    );

    if (hardMismatch) {
      return {
        status: 'mismatch',
        hints: {
          assertedOperator,
          matchedOperatorName,
          projectLocation,
          lookupCity,
        },
      };
    }

    const hardVerified = Boolean(
      vnbLookupStep?.result?.operator?.isResponsible === true ||
      vnbLookupStep?.result?.operator?.zustaendig === true ||
      vnbLookupStep?.result?.responsibilityMatch === true ||
      vnbLookupStep?.result?.operator?.evidenceVerified === true ||
      vnbLookupStep?.result?.operator?.verified === true
    );

    const normalizedProjectLocation = this.normalizeComparableText(projectLocation);
    const normalizedLookupCity = this.normalizeComparableText(lookupCity);
    const locationMatches = Boolean(
      normalizedProjectLocation &&
      normalizedLookupCity &&
      (normalizedLookupCity.includes(normalizedProjectLocation) ||
        normalizedProjectLocation.includes(normalizedLookupCity))
    );

    if (hardVerified && locationMatches) {
      return {
        status: 'verified',
        hints: {
          assertedOperator,
          matchedOperatorName,
          projectLocation,
          lookupCity,
        },
      };
    }

    return {
      status: 'unverified',
      hints: {
        assertedOperator,
        matchedOperatorName,
        projectLocation,
        lookupCity,
      },
    };
  },
};
