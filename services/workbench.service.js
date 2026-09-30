'use strict';

const crypto = require('crypto');
const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');
const { WorkbenchStore } = require('../src/workbench-store');
const {
  cleanString,
  normalizeClient,
  normalizeConversationRef,
  normalizeTaskEnvelope,
  workbenchOpenApi,
} = require('../src/workbench-contract');
const { presentCase, presentCaseListItem } = require('../src/workbench-case-presenter');
const { presentEvent } = require('../src/workbench-event-presenter');
const { normalizeEvidenceInput, safeEvidenceRef } = require('../src/workbench-evidence');
const { buildTurnMemory, safeTurnMemory } = require('../src/workbench-turn-memory');
const {
  defaultPlaybooksForTenant,
  matchPlaybooks,
  safePlaybook,
} = require('../src/workbench-playbooks');
const { taskFromEvent, safeTask } = require('../src/workbench-inbox-tasks');
const {
  ACTIVITY_TAXONOMY_VERSION,
  getWorkbenchActivity,
  listWorkbenchActivities,
  matchWorkbenchActivities,
} = require('../src/workbench-activity-taxonomy');
const {
  GOVERNANCE_MAP_VERSION,
  governanceForDomain,
  toolAllowedByGovernance,
  skillAllowedByGovernance,
} = require('../src/workbench-tool-governance');
const {
  TOOL_REGISTRY_VERSION,
  getWorkbenchTool,
  listWorkbenchTools,
  safeTool,
  simulateToolOutput,
} = require('../src/workbench-tools');
const { buildWebEvidence } = require('../src/workbench-web-evidence');

const action = (rest, summary, handler, params = {}) => ({
  rest,
  params,
  openapi: workbenchOpenApi(rest, summary, [], params),
  handler,
});
const caseParams = { caseId: { type: 'string', min: 1 } };
const WORKBENCH_DATABASES = [
  ['conversationsDb', './data/cet_workbench_conversations', 'CET_WORKBENCH_CONVERSATIONS_DB_PATH'],
  ['identityDb', './data/cet_workbench_identity_mappings', 'CET_WORKBENCH_IDENTITY_DB_PATH'],
  ['deliveryDb', './data/cet_workbench_delivery_clients', 'CET_WORKBENCH_DELIVERY_DB_PATH'],
  ['evidenceDb', './data/cet_workbench_evidence', 'CET_WORKBENCH_EVIDENCE_DB_PATH'],
  ['turnMemoryDb', './data/cet_workbench_turn_memory', 'CET_WORKBENCH_TURN_MEMORY_DB_PATH'],
  ['contextDb', './data/cet_workbench_context', 'CET_WORKBENCH_CONTEXT_DB_PATH'],
  ['playbookDb', './data/cet_workbench_playbooks', 'CET_WORKBENCH_PLAYBOOK_DB_PATH'],
  ['inboxDb', './data/cet_workbench_inbox_tasks', 'CET_WORKBENCH_INBOX_DB_PATH'],
  ['toolRunDb', './data/cet_workbench_tool_runs', 'CET_WORKBENCH_TOOL_RUN_DB_PATH'],
];
function workbenchDbMixin([dbProperty, defaultDbPath, dbPathEnvVar]) {
  const config = { defaultDbPath, dbPathEnvVar, dbProperty };
  if (dbProperty !== 'conversationsDb') {
    config.settingsKey = `${dbProperty.replace(/Db$/, '')}DbPath`;
  }
  return createPouchDbLifecycleMixin(config);
}

function workbenchError(message, code = 'WORKBENCH_POLICY_BLOCKED', data = {}) {
  throw new Errors.MoleculerClientError(message, 403, code, data);
}

module.exports = {
  name: 'workbench',
  mixins: WORKBENCH_DATABASES.map(workbenchDbMixin),
  actions: {
    'activities.list': action(
      'GET /activities',
      'Return the Workbench Activity Taxonomy for energy utility chat routing',
      async function (ctx) {
        principal(ctx, ctx.params);
        const domain = cleanString(ctx.params.domain, { max: 80 }) || null;
        const query = cleanString(ctx.params.query, { max: 500 }) || null;
        const caseStarterEligible =
          ctx.params.caseStarterEligible === undefined
            ? null
            : ctx.params.caseStarterEligible === true || ctx.params.caseStarterEligible === 'true';
        const activities = query
          ? matchWorkbenchActivities(query, { limit: Number(ctx.params.limit) || 10 }).map(
              (match) => ({
                ...match.activity,
                matchScore: match.score,
                matchedSignals: match.matchedSignals,
              })
            )
          : listWorkbenchActivities({ domain, caseStarterEligible });
        return {
          schemaVersion: ACTIVITY_TAXONOMY_VERSION,
          activities,
        };
      }
    ),
    'activities.get': action(
      'GET /activities/:activityId',
      'Return one Workbench Activity Taxonomy entry',
      async function (ctx) {
        principal(ctx, ctx.params);
        const activity = getWorkbenchActivity(ctx.params.activityId);
        if (!activity) throw new Errors.MoleculerClientError('Activity not found', 404);
        return { schemaVersion: ACTIVITY_TAXONOMY_VERSION, activity };
      },
      { activityId: { type: 'string', min: 1 } }
    ),
    'tools.list': action(
      'GET /tools',
      'Return CET-governed Workbench tools filtered by domain and role',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const domain = cleanString(ctx.params.domain, 'domain', { max: 80 }) || 'governance';
        const tools = listWorkbenchTools().map((tool) => {
          const decision = toolAllowedByGovernance(tool, { domain, actorRoles: p.roles });
          return safeTool(tool, decision);
        });
        return {
          registryVersion: TOOL_REGISTRY_VERSION,
          governanceMapVersion: GOVERNANCE_MAP_VERSION,
          domain,
          tools,
        };
      },
      { domain: { type: 'string', optional: true } }
    ),
    'tools.run': action(
      'POST /cases/:caseId/tools/:toolId/run',
      'Run a CET-governed Workbench tool and attach safe evidence/receipt references',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const caseId = ctx.params.caseId || ctx.params.cetCaseId;
        const state = await this.loadVisibleCase(ctx, p, caseId);
        const domain =
          state.currentDomain || state.lastClassification?.primaryDomain || 'governance';
        const tool = getWorkbenchTool(ctx.params.toolId);
        const decision = toolAllowedByGovernance(tool, { domain, actorRoles: p.roles });
        if (!decision.allowed) {
          const blocked = await this.store.saveToolRun({
            tenantId: p.tenantId,
            actorId: p.actorId,
            caseId,
            toolId: ctx.params.toolId,
            toolClass: tool?.toolClass || 'unknown',
            sideEffectClass: tool?.sideEffectClass || 'unknown',
            status: 'blocked',
            inputSummary: 'Tool run blocked by CET governance',
            outputSummary: null,
            blockedReason: decision.blockedReason,
          });
          workbenchError('Workbench tool blocked by CET governance', 'WORKBENCH_TOOL_BLOCKED', {
            toolRunId: blocked.toolRunId,
            blockedReason: decision.blockedReason,
          });
        }
        let webEvidence = null;
        try {
          if (tool.toolClass === 'web_fetch' || tool.toolClass === 'web_browse') {
            webEvidence = await buildWebEvidence({
              ...(ctx.params.input || {}),
              evidenceType: tool.evidenceOutputType || ctx.params.input?.evidenceType,
            });
          }
        } catch (err) {
          const failed = await this.store.saveToolRun({
            tenantId: p.tenantId,
            actorId: p.actorId,
            caseId,
            toolId: tool.toolId,
            toolClass: tool.toolClass,
            sideEffectClass: tool.sideEffectClass,
            status: 'failed',
            inputSummary: JSON.stringify(ctx.params.input || {}).slice(0, 500),
            outputSummary: null,
            blockedReason: err.message,
          });
          err.data = { ...(err.data || {}), toolRunId: failed.toolRunId };
          throw err;
        }
        const simulated = webEvidence
          ? {
              outputSummary: `${tool.title}: fetched ${webEvidence.sourceRef.url}`,
              safeDisplayText: webEvidence.safeSummary,
              rawOutputStored: false,
            }
          : simulateToolOutput(tool, ctx.params.input || {});
        const evidenceId = `tool_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const evidence = await this.store.saveEvidence({
          tenantId: p.tenantId,
          actorId: p.actorId,
          caseId,
          evidenceId,
          evidenceType: webEvidence?.evidenceType || tool.evidenceOutputType || 'generic_document',
          label: webEvidence?.label || `${tool.title} result`,
          safeSummary: simulated.safeDisplayText,
          sourceType: webEvidence?.sourceType || 'existing_cet_evidence_ref',
          sourceRef: webEvidence?.sourceRef || { toolId: tool.toolId, toolClass: tool.toolClass },
          sensitivityLevel: 'tenant_internal',
          provenance: webEvidence?.provenance || {
            system: 'cet-workbench-tool-runtime',
            toolId: tool.toolId,
          },
          evidenceRole: 'tool_result',
          claimStrength: 'supporting',
          readinessReviewRequired: true,
          fileHash: webEvidence?.fileHash,
          hashStatus: webEvidence?.hashStatus,
          sourceFingerprint: webEvidence?.sourceFingerprint,
          extracts: webEvidence
            ? {
                url: webEvidence.sourceRef.url,
                title: webEvidence.sourceRef.title,
                retrievedAt: webEvidence.retrievedAt,
                contentType: webEvidence.contentType,
                safeSummary: webEvidence.safeSummary,
              }
            : {},
          routingSignals: webEvidence
            ? ['web_evidence', webEvidence.evidenceType, tool.toolClass]
            : [],
        });
        const toolRun = await this.store.saveToolRun({
          tenantId: p.tenantId,
          actorId: p.actorId,
          caseId,
          toolId: tool.toolId,
          toolClass: tool.toolClass,
          sideEffectClass: tool.sideEffectClass,
          status: 'completed',
          inputSummary: JSON.stringify(ctx.params.input || {}).slice(0, 500),
          outputSummary: simulated.outputSummary,
          evidenceRefs: [safeEvidenceRef(evidence, { clearance: p.clearance })],
          receiptRefs: [],
          auditRef: `audit:${caseId}:${evidenceId}`,
        });
        await ctx.call('domain-router.ingestUpdate', {
          cetCaseId: caseId,
          kind: 'evidence_available',
          version: `tool:${toolRun.toolRunId}`,
          validated: false,
          evidenceRef: evidence.evidenceId,
          routingSignals: ['workbench_tool_result', tool.toolClass, tool.toolId],
        });
        return { toolRun, evidenceRef: safeEvidenceRef(evidence, { clearance: p.clearance }) };
      },
      {
        caseId: { type: 'string', min: 1 },
        toolId: { type: 'string', min: 1 },
        input: { type: 'object', optional: true },
      }
    ),
    'tool-runs.list': action(
      'GET /cases/:caseId/tool-runs',
      'List CET-governed Workbench tool runs for a case',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        await this.loadVisibleCase(ctx, p, ctx.params.caseId);
        const items = await this.store.listToolRuns({
          tenantId: p.tenantId,
          caseId: ctx.params.caseId,
        });
        return { items };
      },
      caseParams
    ),
    'tool-runs.get': action(
      'GET /cases/:caseId/tool-runs/:toolRunId',
      'Return one CET-governed Workbench tool run',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        await this.loadVisibleCase(ctx, p, ctx.params.caseId);
        const toolRun = await this.store.getToolRun({
          tenantId: p.tenantId,
          toolRunId: ctx.params.toolRunId,
        });
        if (toolRun.caseId !== ctx.params.caseId) {
          workbenchError('Tool run belongs to another case', 'WORKBENCH_TOOL_RUN_CASE_MISMATCH');
        }
        return { toolRun };
      },
      { caseId: { type: 'string', min: 1 }, toolRunId: { type: 'string', min: 1 } }
    ),
    'governance-map.get': action(
      'GET /governance-map/:domain',
      'Return the Workbench tool/skill governance map for a domain',
      async function (ctx) {
        principal(ctx, ctx.params);
        const domain = ctx.params.domain || 'governance';
        return {
          schemaVersion: GOVERNANCE_MAP_VERSION,
          domain,
          governance: governanceForDomain(domain),
        };
      },
      { domain: { type: 'string', optional: true } }
    ),
    'skills.filter': action(
      'POST /skills/filter',
      'Filter active playbooks through the Workbench tool/skill governance map',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const domain = ctx.params.domain || 'governance';
        const tenantPlaybooks = await this.store.listPlaybooks({ tenantId: p.tenantId, domain });
        const playbooks = [
          ...defaultPlaybooksForTenant(p.tenantId),
          ...tenantPlaybooks.map((playbook) => safePlaybook(playbook)),
        ];
        const items = playbooks
          .map((skill) => ({
            skill: safePlaybook(skill),
            decision: skillAllowedByGovernance(skill, { domain, actorRoles: p.roles }),
          }))
          .filter((item) => item.decision.allowed);
        return { schemaVersion: GOVERNANCE_MAP_VERSION, domain, items };
      },
      { domain: { type: 'string', optional: true } }
    ),
    'cases.get': action(
      'GET /cases/:caseId',
      'Return a UI-safe CET case summary for Workbench clients',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const state = await ctx.call('domain-router.explain', {
          cetCaseId: ctx.params.caseId,
        });
        const full = await this.loadVisibleCase(ctx, p, ctx.params.caseId);
        const evidenceRefs = ctx.params.includeEvidence
          ? await this.store.listEvidence({ tenantId: p.tenantId, caseId: ctx.params.caseId })
          : [];
        const turnMemory = await this.loadTurnMemory(p, ctx.params.caseId);
        return presentCase(
          { ...full, lastClassification: state, turnMemory },
          {
            evidenceRefs,
            eventSummary: await this.eventSummary(p, ctx.params.caseId),
            clearance: p.clearance,
          }
        );
      },
      caseParams
    ),
    'cases.list': action(
      'GET /cases',
      'Return UI-safe Workbench case inbox items',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const domainStates = await this.visibleDomainStates(p);
        const caseIds = domainStates.map((state) => state.cetCaseId);
        const summaries = await this.eventSummaries(p, caseIds);
        await this.deriveInboxTasksForCases(p, caseIds);
        const taskSummaries = await this.taskSummaries(p, caseIds);
        const items = [];
        for (const state of domainStates) {
          const summary = summaries.get(state.cetCaseId) || this.emptyEventSummary();
          const taskSummary = taskSummaries.get(state.cetCaseId) || this.emptyTaskSummary();
          if (
            ctx.params.status &&
            presentCaseListItem(state, summary, taskSummary).status !== ctx.params.status
          )
            continue;
          if (ctx.params.domain && state.currentDomain !== ctx.params.domain) continue;
          if (
            ctx.params.readinessState &&
            state.lastClassification?.readinessState !== ctx.params.readinessState
          )
            continue;
          items.push(presentCaseListItem(state, summary, taskSummary));
        }
        items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const limit = Number(ctx.params.limit || 50);
        return { items: items.slice(0, limit), nextCursor: null };
      },
      {
        status: { type: 'string', optional: true },
        domain: { type: 'string', optional: true },
        readinessState: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, integer: true, min: 1, max: 100 },
      }
    ),
    'conversations.linkCase': action(
      'POST /conversations/link-case',
      'Link an Open WebUI conversation to a CET case',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const ref = normalizeConversationRef(ctx.params);
        this.assertCompleteOpenWebUiIdentity(ref);
        const caseId = cleanString(ctx.params.caseId || ctx.params.cetCaseId, 'caseId', {
          required: true,
        });
        const full = await this.loadVisibleCase(ctx, p, caseId);
        const linked = await this.store.linkConversation({
          tenantId: p.tenantId,
          client: ref.client,
          conversationId: ref.conversationId,
          openWebuiConversationId: ref.openWebuiConversationId,
          openWebuiUserId: ref.openWebuiUserId,
          openWebuiOrgId: ref.openWebuiOrgId,
          cetCaseId: caseId,
          caseStateVersion: full.caseStateVersion,
          clientId: ctx.params.clientId || full.asyncDelivery?.clientId || null,
          overwrite: !!ctx.params.overwrite,
        });
        return { linked: true, conversationRef: this.conversationRef(linked) };
      }
    ),
    'conversations.resolve': action(
      'GET /conversations/resolve',
      'Resolve an Open WebUI conversation to a CET case',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const ref = normalizeConversationRef(ctx.params);
        this.assertCompleteOpenWebUiIdentity(ref);
        const mapping = await this.store.resolveConversation(
          { tenantId: p.tenantId, client: ref.client, conversationId: ref.conversationId },
          { optional: true }
        );
        if (!mapping) return { found: false };
        const full = await this.loadVisibleCase(ctx, p, mapping.cetCaseId);
        return {
          found: true,
          caseId: mapping.cetCaseId,
          cetCaseId: mapping.cetCaseId,
          caseStateVersion: full.caseStateVersion || mapping.caseStateVersion,
          status: 'active',
          conversationRef: this.conversationRef(mapping),
        };
      }
    ),
    'events.list': action(
      'GET /events',
      'Return UI-safe pending/delivered CET case events for Workbench clients',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const clientId = cleanString(ctx.params.clientId, 'clientId', { required: true });
        const deliveryClient = await this.ensureDeliveryClient(p, clientId);
        const response = await ctx.call('domain-router.events.list', {
          clientId,
          caseId: ctx.params.caseId || ctx.params.cetCaseId,
          since: ctx.params.since,
        });
        const filteredEvents = (response.events || []).filter((event) => {
          if (!this.deliveryClientAllowsEvent(deliveryClient, event)) return false;
          if (ctx.params.attentionOnly && !event.requiresUserAttention) return false;
          return true;
        });
        const items = await Promise.all(
          filteredEvents.map(async (event) => {
            const conversation = await this.findConversationForCase(p.tenantId, event.cetCaseId);
            return presentEvent(event, conversation);
          })
        );
        return { items, nextCursor: null };
      },
      {
        clientId: { type: 'string', min: 1 },
        caseId: { type: 'string', optional: true },
        cetCaseId: { type: 'string', optional: true },
        since: { type: 'string', optional: true },
        attentionOnly: { type: 'boolean', optional: true, convert: true },
      }
    ),
    'events.ack': action(
      'POST /events/:eventId/ack',
      'Acknowledge a Workbench event after visible delivery',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const clientId = cleanString(ctx.params.clientId, 'clientId', { required: true });
        await this.ensureDeliveryClient(p, clientId);
        const event = await ctx.call('domain-router.events.ack', {
          eventId: ctx.params.eventId,
          clientId,
        });
        return presentEvent(event, await this.findConversationForCase(p.tenantId, event.cetCaseId));
      },
      { eventId: 'string', clientId: 'string' }
    ),
    'admin.tenantMappings.create': action(
      'POST /admin/tenant-mappings',
      'Provision an Open WebUI organization to CET tenant mapping',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const client = normalizeClient(ctx.params.client || 'open-webui');
        const externalOrgId = cleanString(ctx.params.externalOrgId, 'externalOrgId', {
          required: true,
        });
        const cetTenantId = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.cetTenantId || p.tenantId, 'cetTenantId', { required: true })
        );
        const mapping = await this.store.saveTenantMapping({
          client,
          externalOrgId,
          cetTenantId,
          defaultClientId: cleanString(ctx.params.defaultClientId, 'defaultClientId'),
          enabled: ctx.params.enabled !== false,
        });
        return { saved: true, mapping };
      }
    ),
    'admin.userMappings.create': action(
      'POST /admin/user-mappings',
      'Provision an Open WebUI user to CET actor and role mapping',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const client = normalizeClient(ctx.params.client || 'open-webui');
        const roles = Array.isArray(ctx.params.roles) ? ctx.params.roles : p.roles;
        const externalOrgId = cleanString(
          ctx.params.externalOrgId || ctx.params.openWebuiOrgId,
          'externalOrgId',
          {
            required: true,
          }
        );
        const externalUserId = cleanString(
          ctx.params.externalUserId || ctx.params.openWebuiUserId,
          'externalUserId',
          {
            required: true,
          }
        );
        const cetTenantId = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.cetTenantId || p.tenantId, 'cetTenantId', { required: true })
        );
        const tenantMapping = await this.loadTenantMappingForAdmin(p, client, externalOrgId);
        if (tenantMapping.cetTenantId !== cetTenantId) {
          deny('Workbench user mapping tenant does not match organization mapping');
        }
        const mapping = await this.store.saveUserMapping({
          client,
          externalOrgId,
          externalUserId,
          cetTenantId,
          cetActorId: cleanString(
            ctx.params.cetActorId || ctx.params.actorId || p.actorId,
            'cetActorId',
            {
              required: true,
            }
          ),
          roles,
          sensitivityClearance: ctx.params.sensitivityClearance || p.clearance || [],
          defaultClientId: cleanString(ctx.params.defaultClientId, 'defaultClientId'),
          enabled: ctx.params.enabled !== false,
        });
        return { saved: true, mapping };
      }
    ),
    'admin.userMappings.get': action(
      'GET /admin/user-mappings/:externalUserId',
      'Resolve an Open WebUI user mapping',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const client = normalizeClient(ctx.params.client || 'open-webui');
        const externalOrgId = cleanString(
          ctx.params.externalOrgId || ctx.params.openWebuiOrgId,
          'externalOrgId',
          {
            required: true,
          }
        );
        await this.loadTenantMappingForAdmin(p, client, externalOrgId);
        const mapping = await this.store.getUserMapping({
          client,
          externalOrgId,
          externalUserId: cleanString(ctx.params.externalUserId, 'externalUserId', {
            required: true,
          }),
        });
        this.authorizeTargetTenant(p, mapping.cetTenantId);
        return { found: true, mapping };
      },
      { externalUserId: 'string' }
    ),
    'deliveryClients.create': action(
      'POST /delivery-clients',
      'Register a tenant-bound Workbench delivery client for MWI polling',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const deliveryClient = await this.store.registerDeliveryClient({
          tenantId: p.tenantId,
          clientId: cleanString(ctx.params.clientId, 'clientId', { required: true }),
          clientType: ctx.params.clientType || 'open-webui',
          deliveryMode: ctx.params.deliveryMode || 'poll',
          ackMode: ctx.params.ackMode || 'explicit',
          eventTypes: Array.isArray(ctx.params.eventTypes) ? ctx.params.eventTypes : [],
          enabled: ctx.params.enabled !== false,
        });
        return {
          clientId: deliveryClient.clientId,
          enabled: deliveryClient.enabled,
          pollUrl: `/api/workbench/events?clientId=${encodeURIComponent(deliveryClient.clientId)}`,
          deliveryClient,
        };
      }
    ),
    'admin.userContexts.save': action(
      'POST /admin/user-contexts',
      'Save a CET-governed Workbench user context profile',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const targetTenant = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.tenantId || p.tenantId, 'tenantId', { required: true })
        );
        const actorId = cleanString(ctx.params.actorId || ctx.params.cetActorId, 'actorId', {
          required: true,
        });
        const profile = await this.store.saveUserContext({
          tenantId: targetTenant,
          actorId,
          externalClientRefs: Array.isArray(ctx.params.externalClientRefs)
            ? ctx.params.externalClientRefs
            : [],
          roleFamilies: Array.isArray(ctx.params.roleFamilies) ? ctx.params.roleFamilies : [],
          domainsAllowed: Array.isArray(ctx.params.domainsAllowed) ? ctx.params.domainsAllowed : [],
          sensitivityClearance: Array.isArray(ctx.params.sensitivityClearance)
            ? ctx.params.sensitivityClearance
            : [],
          language: cleanString(ctx.params.language, 'language'),
          tone: cleanString(ctx.params.tone, 'tone'),
          defaultNoCallGuards: Array.isArray(ctx.params.defaultNoCallGuards)
            ? ctx.params.defaultNoCallGuards
            : [],
          defaultEscalationRules: Array.isArray(ctx.params.defaultEscalationRules)
            ? ctx.params.defaultEscalationRules
            : [],
          preferredEvidenceHandling: Array.isArray(ctx.params.preferredEvidenceHandling)
            ? ctx.params.preferredEvidenceHandling
            : [],
          enabled: ctx.params.enabled !== false,
        });
        return { saved: true, profile: this.safeUserContext(profile) };
      }
    ),
    'admin.workspaceContexts.save': action(
      'POST /admin/workspace-contexts',
      'Save a CET-governed Workbench workspace context profile',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const tenantId = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.tenantId || p.tenantId, 'tenantId', { required: true })
        );
        const client = normalizeClient(ctx.params.client || 'open-webui');
        const workspaceId = cleanString(
          ctx.params.workspaceId || ctx.params.openWebuiOrgId || ctx.params.externalWorkspaceRef,
          'workspaceId',
          { required: true }
        );
        const profile = await this.store.saveWorkspaceContext({
          tenantId,
          client,
          workspaceId,
          externalWorkspaceRef: ctx.params.externalWorkspaceRef || workspaceId,
          allowedDomains: Array.isArray(ctx.params.allowedDomains) ? ctx.params.allowedDomains : [],
          defaultDeliveryClientId: cleanString(
            ctx.params.defaultDeliveryClientId,
            'defaultDeliveryClientId'
          ),
          defaultPlaybooks: Array.isArray(ctx.params.defaultPlaybooks)
            ? ctx.params.defaultPlaybooks
            : [],
          workspaceNoCallGuards: Array.isArray(ctx.params.workspaceNoCallGuards)
            ? ctx.params.workspaceNoCallGuards
            : [],
          sensitivityBoundary: ctx.params.sensitivityBoundary || 'tenant_internal',
          caseVisibilityPolicy: ctx.params.caseVisibilityPolicy || 'tenant',
          enabled: ctx.params.enabled !== false,
        });
        return { saved: true, profile: this.safeWorkspaceContext(profile) };
      }
    ),
    'contextRefs.create': action(
      'POST /context-refs',
      'Create a governed ContextRef for Open WebUI artifacts',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const allowedTypes = new Set([
          'openwebui_note_ref',
          'openwebui_calendar_event_ref',
          'openwebui_workspace_doc_ref',
          'openwebui_task_ref',
          'openwebui_automation_trigger_ref',
        ]);
        const contextType = cleanString(ctx.params.contextType, 'contextType', { required: true });
        if (!allowedTypes.has(contextType)) {
          throw new Errors.MoleculerClientError('Unsupported ContextRef type', 400);
        }
        const ref = await this.store.saveContextRef({
          tenantId: p.tenantId,
          actorId: p.actorId,
          contextRefId: cleanString(ctx.params.contextRefId, 'contextRefId'),
          contextType,
          purpose: ctx.params.purpose || 'routing_context',
          label: cleanString(ctx.params.label, 'label', { required: true }),
          sourceRef: ctx.params.sourceRef || {},
          sensitivityLevel: ctx.params.sensitivityLevel || 'tenant_internal',
          safeSummary: cleanString(ctx.params.safeSummary, 'safeSummary', { max: 1000 }),
          provenance: ctx.params.provenance || { system: 'open-webui' },
        });
        return { saved: true, contextRef: this.safeContextRef(ref) };
      }
    ),
    'playbooks.save': action(
      'POST /playbooks',
      'Create or update a governed CET Workbench playbook',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const playbookId = cleanString(ctx.params.playbookId, 'playbookId', { required: true });
        const playbook = await this.store.savePlaybook({
          tenantId: p.tenantId,
          playbookId,
          title: cleanString(ctx.params.title, 'title', { required: true }),
          scope: ctx.params.scope || 'tenant',
          domain: ctx.params.domain || 'governance',
          workspaceId: cleanString(ctx.params.workspaceId, 'workspaceId'),
          roleFamilies: Array.isArray(ctx.params.roleFamilies) ? ctx.params.roleFamilies : [],
          version: ctx.params.version,
          status: ctx.params.status || 'draft',
          routingSignals: Array.isArray(ctx.params.routingSignals) ? ctx.params.routingSignals : [],
          requiredEvidence: Array.isArray(ctx.params.requiredEvidence)
            ? ctx.params.requiredEvidence
            : [],
          allowedActions: Array.isArray(ctx.params.allowedActions) ? ctx.params.allowedActions : [],
          blockedActions: Array.isArray(ctx.params.blockedActions) ? ctx.params.blockedActions : [],
          noCallGuards: Array.isArray(ctx.params.noCallGuards) ? ctx.params.noCallGuards : [],
          handoffRules: Array.isArray(ctx.params.handoffRules) ? ctx.params.handoffRules : [],
          eventRules: Array.isArray(ctx.params.eventRules) ? ctx.params.eventRules : [],
        });
        return { saved: true, playbook: safePlaybook(playbook) };
      }
    ),
    'playbooks.list': action(
      'GET /playbooks',
      'List active/default Workbench playbooks for a tenant/domain',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const tenantPlaybooks = await this.store.listPlaybooks({
          tenantId: p.tenantId,
          domain: ctx.params.domain,
        });
        return {
          items: [
            ...defaultPlaybooksForTenant(p.tenantId),
            ...tenantPlaybooks.map((playbook) => safePlaybook(playbook)),
          ],
        };
      }
    ),
    'inbox.tasks.list': action(
      'GET /inbox/tasks',
      'Return actionable Workbench inbox tasks derived from Case Events',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const caseId = cleanString(ctx.params.caseId || ctx.params.cetCaseId, 'caseId');
        const caseIds = caseId
          ? [caseId]
          : (await this.visibleDomainStates(p)).map((s) => s.cetCaseId);
        await this.deriveInboxTasksForCases(p, caseIds);
        const tasks = await this.store.listInboxTasks({
          tenantId: p.tenantId,
          caseId,
          status: ctx.params.status,
        });
        return { items: tasks.map((task) => safeTask(task)), nextCursor: null };
      }
    ),
    'inbox.tasks.assign': action(
      'POST /inbox/tasks/:taskId/assign',
      'Assign a Workbench inbox task',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const task = await this.updateInboxTask(p, ctx.params.taskId, {
          assignedTo: cleanString(ctx.params.assignedTo || p.actorId, 'assignedTo', {
            required: true,
          }),
          status: 'in_progress',
        });
        return safeTask(task);
      },
      { taskId: { type: 'string', min: 1 } }
    ),
    'inbox.tasks.resolve': action(
      'POST /inbox/tasks/:taskId/resolve',
      'Resolve a Workbench inbox task without erasing event audit',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const task = await this.completeInboxTask(p, ctx.params.taskId, 'resolved');
        return safeTask(task);
      },
      { taskId: { type: 'string', min: 1 } }
    ),
    'inbox.tasks.dismiss': action(
      'POST /inbox/tasks/:taskId/dismiss',
      'Dismiss a Workbench inbox task without acknowledging underlying events',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const task = await this.completeInboxTask(p, ctx.params.taskId, 'dismissed');
        return safeTask(task);
      },
      { taskId: { type: 'string', min: 1 } }
    ),
    chat: action(
      'POST /chat',
      'Run a CET-led Workbench chat turn: classify new conversations, continue mapped cases',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const envelope = normalizeTaskEnvelope(ctx.params);
        const mapping = await this.resolveUserMapping(ctx, p, envelope);
        let conversation = await this.store.resolveConversation(
          {
            tenantId: p.tenantId,
            client: envelope.channel,
            conversationId: envelope.conversationId,
          },
          { optional: true }
        );
        let reservation = null;
        if (!conversation) {
          reservation = await this.store.reserveConversation({
            tenantId: p.tenantId,
            client: envelope.channel,
            conversationId: envelope.conversationId,
            openWebuiConversationId: envelope.openWebuiConversationId,
            openWebuiUserId: envelope.openWebuiUserId,
            openWebuiOrgId: envelope.openWebuiOrgId,
            clientId: envelope.asyncDelivery.clientId,
          });
          conversation = reservation.reserved
            ? null
            : await this.waitForConversationCase({
                tenantId: p.tenantId,
                client: envelope.channel,
                conversationId: envelope.conversationId,
              });
        } else if (!conversation.cetCaseId) {
          conversation = await this.waitForConversationCase({
            tenantId: p.tenantId,
            client: envelope.channel,
            conversationId: envelope.conversationId,
          });
        }
        const workbenchContext = await this.loadWorkbenchContext(p, envelope, mapping);
        const meta = this.metaForMapping(ctx, p, mapping);
        const previousMemory = conversation?.cetCaseId
          ? await this.loadTurnMemory(p, conversation.cetCaseId)
          : null;
        const params = {
          ...envelope,
          knownContext: {
            ...envelope.knownContext,
            workbenchContext,
            ...(previousMemory ? { cetTurnMemory: safeTurnMemory(previousMemory) } : {}),
          },
          requestedMode: conversation ? 'continue' : 'classify',
          ...(conversation ? { cetCaseId: conversation.cetCaseId } : {}),
        };
        const result = await ctx.call(
          conversation ? 'domain-router.continue' : 'domain-router.classify',
          params,
          { meta }
        );
        if (!conversation) {
          await this.store.linkConversation({
            tenantId: p.tenantId,
            client: envelope.channel,
            conversationId: envelope.conversationId,
            openWebuiConversationId: envelope.openWebuiConversationId,
            openWebuiUserId: envelope.openWebuiUserId,
            openWebuiOrgId: envelope.openWebuiOrgId,
            cetCaseId: result.cetCaseId,
            caseStateVersion: result.caseStateVersion,
            clientId: envelope.asyncDelivery.clientId,
          });
        } else if (result?.caseStateVersion) {
          await this.store.linkConversation({
            tenantId: p.tenantId,
            client: envelope.channel,
            conversationId: envelope.conversationId,
            openWebuiConversationId: envelope.openWebuiConversationId,
            openWebuiUserId: envelope.openWebuiUserId,
            openWebuiOrgId: envelope.openWebuiOrgId,
            cetCaseId: result.cetCaseId || conversation.cetCaseId,
            caseStateVersion: result.caseStateVersion,
            clientId: envelope.asyncDelivery.clientId,
          });
        }
        const caseId = result.cetCaseId || conversation?.cetCaseId;
        const turnMemory = caseId
          ? await this.saveTurnMemory(p, {
              caseId,
              caseStateVersion: result.caseStateVersion,
              previousMemory,
              classification: result,
              envelope,
              mapping,
              workbenchContext,
            })
          : null;
        const clientId = envelope.asyncDelivery?.clientId;
        const eventSummary = caseId
          ? await this.eventSummary(p, caseId, { clientId })
          : this.emptyEventSummary();
        if (turnMemory) {
          turnMemory.recentEventStatus = eventSummary;
          await this.store.saveTurnMemory({
            tenantId: p.tenantId,
            actorId: p.actorId,
            caseId,
            caseStateVersion: result.caseStateVersion,
            memory: turnMemory,
          });
        }
        return this.chatResponse(
          conversation ? 'continue' : 'classify',
          result,
          eventSummary,
          turnMemory
        );
      }
    ),
    'cases.attachEvidence': action(
      'POST /cases/:caseId/evidence',
      'Attach Open WebUI file references as auditable CET EvidenceRefs',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        await this.loadVisibleCase(ctx, p, ctx.params.caseId);
        const evidence = normalizeEvidenceInput(ctx.params, {
          tenantId: p.tenantId,
          actorId: p.actorId,
          caseId: ctx.params.caseId,
          clearance: p.clearance,
        });
        const saved = await this.store.saveEvidence({
          ...evidence,
          tenantId: p.tenantId,
          actorId: p.actorId,
          caseId: ctx.params.caseId,
          forceNewVersion: ctx.params.forceNewVersion === true,
        });
        const generatedEvents = [];
        if (!saved.duplicate) {
          await ctx.call('domain-router.ingestUpdate', {
            cetCaseId: ctx.params.caseId,
            kind: 'evidence_available',
            version: saved.evidenceId,
            validated: false,
            evidenceRef: saved.evidenceId,
            readinessReviewRequired: !!saved.readinessReviewRequired,
            routingSignals: saved.routingSignals || [],
          });
          generatedEvents.push({ eventType: 'evidence.available', severity: 'info' });
        }
        return {
          evidenceRef: safeEvidenceRef(saved, { clearance: p.clearance }),
          duplicate: !!saved.duplicate,
          duplicateOf: saved.duplicateOf,
          readinessReviewRequired: !!saved.readinessReviewRequired,
          generatedEvents,
        };
      },
      caseParams
    ),
    'cases.dossier': action(
      'POST /cases/:caseId/dossier',
      'Render a Workbench dossier wrapper around the current CET case',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const state = await this.loadVisibleCase(ctx, p, ctx.params.caseId);
        const turnMemory = await this.loadTurnMemory(p, ctx.params.caseId);
        const summary = presentCase(
          { ...state, turnMemory },
          {
            evidenceRefs: await this.store.listEvidence({
              tenantId: p.tenantId,
              caseId: ctx.params.caseId,
            }),
            eventSummary: await this.eventSummary(p, ctx.params.caseId),
            clearance: p.clearance,
          }
        );
        let content = `# ${summary.title}\n\n${summary.lastResponseText || 'CET case summary.'}`;
        try {
          const dossier = await ctx.call('personal-agent.answerDossier', {
            question: ctx.params.question || summary.title,
            sessionId: ctx.params.sessionId || `workbench:${ctx.params.caseId}`,
            context: { cetCaseId: ctx.params.caseId, workbenchSummary: summary },
          });
          content = dossier?.answer || dossier?.content || content;
        } catch (e) {
          if (![404, 503].includes(e.code) && ![404, 503].includes(e.status)) throw e;
        }
        return {
          caseId: ctx.params.caseId,
          dossierId: `dos_${crypto.randomUUID()}`,
          format: ctx.params.format || 'markdown',
          title: summary.title,
          content,
          evidenceRefs: summary.evidenceRefs,
          noCallGuards: summary.noCallGuards,
          readinessState: summary.readinessState,
          nonBinding: summary.readinessState !== 'ready',
          createdAt: new Date().toISOString(),
        };
      },
      caseParams
    ),
  },
  created() {
    this.store = new WorkbenchStore({
      conversationsDb: this.conversationsDb,
      identityDb: this.identityDb,
      deliveryDb: this.deliveryDb,
      evidenceDb: this.evidenceDb,
      turnMemoryDb: this.turnMemoryDb,
      contextDb: this.contextDb,
      playbookDb: this.playbookDb,
      inboxDb: this.inboxDb,
      toolRunDb: this.toolRunDb,
    });
  },
  methods: {
    safeUserContext(profile) {
      if (!profile) return null;
      return {
        tenantId: profile.tenantId,
        actorId: profile.actorId,
        roleFamilies: profile.roleFamilies || [],
        domainsAllowed: profile.domainsAllowed || [],
        sensitivityClearance: profile.sensitivityClearance || [],
        language: profile.language || null,
        tone: profile.tone || null,
        defaultNoCallGuards: profile.defaultNoCallGuards || [],
        defaultEscalationRules: profile.defaultEscalationRules || [],
        preferredEvidenceHandling: profile.preferredEvidenceHandling || [],
        updatedAt: profile.updatedAt,
      };
    },
    safeWorkspaceContext(profile) {
      if (!profile) return null;
      return {
        tenantId: profile.tenantId,
        client: profile.client,
        workspaceId: profile.workspaceId,
        allowedDomains: profile.allowedDomains || [],
        defaultDeliveryClientId: profile.defaultDeliveryClientId || null,
        defaultPlaybooks: profile.defaultPlaybooks || [],
        workspaceNoCallGuards: profile.workspaceNoCallGuards || [],
        sensitivityBoundary: profile.sensitivityBoundary || 'tenant_internal',
        caseVisibilityPolicy: profile.caseVisibilityPolicy || 'tenant',
        updatedAt: profile.updatedAt,
      };
    },
    safeContextRef(ref) {
      if (!ref) return null;
      return {
        contextRefId: ref.contextRefId,
        contextType: ref.contextType,
        purpose: ref.purpose,
        label: ref.label,
        sensitivityLevel: ref.sensitivityLevel,
        safeSummary: ref.safeSummary,
        provenance: ref.provenance,
        createdAt: ref.createdAt,
      };
    },
    requireAdmin(ctx) {
      const p = principal(ctx, ctx.params);
      if (
        !p.roles.some((r) => ['ROLE_TENANT_ADMIN', 'ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r))
      ) {
        deny('Workbench admin role required');
      }
      return p;
    },
    authorizeTargetTenant(p, targetTenantId) {
      const isPlatformAdmin = p.roles.some((r) => ['ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r));
      if (!isPlatformAdmin && targetTenantId !== p.tenantId) {
        deny('Workbench tenant admin cannot provision foreign tenant');
      }
      return targetTenantId;
    },
    async loadWorkbenchContext(p, envelope, mapping) {
      const userContext = await this.store.getUserContext(
        { tenantId: p.tenantId, actorId: mapping?.cetActorId || p.actorId },
        { optional: true }
      );
      const workspaceId = envelope.openWebuiOrgId || envelope.conversationId || 'default';
      const workspaceContext = await this.store.getWorkspaceContext(
        { tenantId: p.tenantId, client: envelope.channel, workspaceId },
        { optional: true }
      );
      const tenantPlaybooks = await this.store.listPlaybooks({ tenantId: p.tenantId });
      const playbooks = matchPlaybooks(
        [...defaultPlaybooksForTenant(p.tenantId), ...tenantPlaybooks],
        { roles: mapping?.roles || p.roles, workspaceId }
      );
      return {
        userProfile: this.safeUserContext(userContext),
        workspaceProfile: this.safeWorkspaceContext(workspaceContext),
        applicablePlaybooks: playbooks,
        noCallGuards: [
          ...(userContext?.defaultNoCallGuards || []),
          ...(workspaceContext?.workspaceNoCallGuards || []),
          ...playbooks.flatMap((playbook) => playbook.noCallGuards || []),
        ].slice(0, 12),
        routingSignals: playbooks.flatMap((playbook) => playbook.routingSignals || []).slice(0, 30),
      };
    },
    metaForMapping(ctx, p, mapping) {
      return {
        ...ctx.meta,
        apiToken: {
          ...(ctx.meta?.apiToken || {}),
          tenantId: p.tenantId,
          id: mapping?.cetActorId || p.actorId,
          roles: mapping?.roles?.length ? mapping.roles : p.roles,
          sensitivityFlags: mapping?.sensitivityClearance || p.clearance || [],
        },
      };
    },
    async resolveUserMapping(ctx, p, envelope) {
      this.assertCompleteOpenWebUiIdentity(envelope);
      if (!envelope.openWebuiUserId || !envelope.openWebuiOrgId) return null;
      const tenantMapping = await this.store.getTenantMapping(
        {
          client: envelope.channel,
          externalOrgId: envelope.openWebuiOrgId,
        },
        { optional: true }
      );
      if (!tenantMapping) {
        throw new Errors.MoleculerClientError(
          'Workbench tenant mapping required',
          403,
          'WORKBENCH_TENANT_MAPPING_REQUIRED'
        );
      }
      if (tenantMapping.cetTenantId !== p.tenantId) deny('Workbench tenant mapping mismatch');
      const mapping = await this.store.getUserMapping(
        {
          client: envelope.channel,
          externalOrgId: envelope.openWebuiOrgId,
          externalUserId: envelope.openWebuiUserId,
        },
        { optional: true }
      );
      if (!mapping) {
        throw new Errors.MoleculerClientError(
          'Workbench identity mapping required',
          403,
          'WORKBENCH_MAPPING_REQUIRED'
        );
      }
      if (mapping.cetTenantId !== p.tenantId) deny('Workbench tenant mapping mismatch');
      return mapping;
    },
    assertCompleteOpenWebUiIdentity(input = {}) {
      const hasUser = !!input.openWebuiUserId;
      const hasOrg = !!input.openWebuiOrgId;
      if (hasUser !== hasOrg) {
        throw new Errors.MoleculerClientError(
          'Open WebUI user and organization identifiers must be provided together',
          403,
          'WORKBENCH_IDENTITY_INCOMPLETE'
        );
      }
    },
    async loadTenantMappingForAdmin(p, client, externalOrgId) {
      const tenantMapping = await this.store.getTenantMapping({ client, externalOrgId });
      this.authorizeTargetTenant(p, tenantMapping.cetTenantId);
      return tenantMapping;
    },
    conversationRef(mapping) {
      return {
        client: mapping.client,
        conversationId: mapping.externalConversationId,
        openWebuiConversationId: mapping.openWebuiConversationId,
        caseId: mapping.cetCaseId,
        cetCaseId: mapping.cetCaseId,
        caseStateVersion: mapping.caseStateVersion,
      };
    },
    async visibleDomainStates(p) {
      const service = this.broker.getLocalService('domain-router');
      return service ? await service.visibleStates(p) : [];
    },
    async loadVisibleCase(ctx, p, caseId) {
      const service = this.broker.getLocalService('domain-router');
      if (!service) throw new Errors.MoleculerClientError('Domain Router unavailable', 503);
      return service.loadCase(p, caseId);
    },
    async loadTurnMemory(p, caseId) {
      const doc = await this.store.getTurnMemory(
        { tenantId: p.tenantId, caseId },
        { optional: true }
      );
      return safeTurnMemory(doc?.memory || null);
    },
    async saveTurnMemory(p, input) {
      const memory = buildTurnMemory({
        previousMemory: input.previousMemory,
        classification: input.classification,
        envelope: input.envelope,
        mapping: input.mapping,
        principal: p,
      });
      await this.store.saveTurnMemory({
        tenantId: p.tenantId,
        actorId: p.actorId,
        caseId: input.caseId,
        caseStateVersion: input.caseStateVersion,
        memory,
      });
      return memory;
    },
    emptyTaskSummary() {
      return { open: 0, attention: 0 };
    },
    async updateInboxTask(p, taskId, patch) {
      const existing = await this.store.getInboxTask({ tenantId: p.tenantId, taskId });
      const saved = await this.store.saveInboxTask({
        ...existing,
        ...patch,
        tenantId: p.tenantId,
        taskId,
      });
      return saved;
    },
    completeInboxTask(p, taskId, status) {
      return this.updateInboxTask(p, taskId, {
        status,
        resolvedAt: new Date().toISOString(),
        resolvedBy: p.actorId,
      });
    },
    async deriveInboxTasksForCases(p, caseIds = []) {
      const service = this.broker.getLocalService('domain-router');
      if (!service || !caseIds.length) return [];
      const allowed = new Set(caseIds);
      const states = new Map(
        (await this.visibleDomainStates(p)).map((state) => [state.cetCaseId, state])
      );
      const events = (await service.eventsDb.allDocs({ include_docs: true })).rows
        .map((row) => row.doc)
        .filter((doc) => doc.tenantId === p.tenantId && allowed.has(doc.cetCaseId))
        .filter((doc) => ['pending', 'delivered'].includes(doc.deliveryState));
      const tasks = await Promise.all(
        events.map(async (doc) => {
          const existing = await this.store.getInboxTask(
            { tenantId: p.tenantId, taskId: `task_${doc.eventId}` },
            { optional: true }
          );
          if (existing && ['resolved', 'dismissed'].includes(existing.status)) return null;
          const task = taskFromEvent(doc, {
            domain: states.get(doc.cetCaseId)?.currentDomain,
            existing,
          });
          return this.store.saveInboxTask({ ...task, tenantId: p.tenantId });
        })
      );
      return tasks.filter(Boolean);
    },
    async taskSummaries(p, caseIds = []) {
      const summaries = new Map(caseIds.map((caseId) => [caseId, this.emptyTaskSummary()]));
      const tasks = await this.store.listInboxTasks({ tenantId: p.tenantId });
      const allowed = new Set(caseIds);
      for (const task of tasks) {
        const caseId = task.caseId || task.cetCaseId;
        if (!allowed.has(caseId) || !['open', 'in_progress'].includes(task.status)) continue;
        const summary = summaries.get(caseId) || this.emptyTaskSummary();
        const next = { ...summary, open: summary.open + 1 };
        if (task.severity === 'attention') next.attention += 1;
        summaries.set(caseId, next);
      }
      return summaries;
    },
    emptyEventSummary() {
      return { pending: 0, delivered: 0, unacknowledged: 0, attention: 0 };
    },
    async eventSummary(p, caseId, { clientId = null } = {}) {
      const summaries = await this.eventSummaries(p, [caseId], { clientId });
      return summaries.get(caseId) || this.emptyEventSummary();
    },
    async eventSummaries(p, caseIds = [], { clientId = null } = {}) {
      const service = this.broker.getLocalService('domain-router');
      const summaries = new Map(caseIds.map((caseId) => [caseId, this.emptyEventSummary()]));
      if (!service || !caseIds.length) return summaries;
      const allowed = new Set(caseIds);
      for (const { doc } of (await service.eventsDb.allDocs({ include_docs: true })).rows) {
        if (doc.tenantId !== p.tenantId || !allowed.has(doc.cetCaseId)) continue;
        if (clientId && doc.targetClient !== clientId) continue;
        if (!['pending', 'delivered'].includes(doc.deliveryState)) continue;
        const summary = summaries.get(doc.cetCaseId) || this.emptyEventSummary();
        const next = { ...summary };
        if (doc.deliveryState === 'pending') next.pending += 1;
        if (doc.deliveryState === 'delivered') next.delivered += 1;
        next.unacknowledged += 1;
        if (doc.requiresUserAttention) next.attention += 1;
        summaries.set(doc.cetCaseId, next);
      }
      return summaries;
    },
    async findConversationForCase(tenantId, caseId) {
      for (const row of (await this.conversationsDb.allDocs({ include_docs: true })).rows) {
        const doc = row.doc;
        if (doc.tenantId === tenantId && doc.cetCaseId === caseId && doc.enabled !== false)
          return doc;
      }
      return null;
    },
    deliveryClientAllowsEvent(deliveryClient, event) {
      if (!deliveryClient?.eventTypes?.length) return true;
      return deliveryClient.eventTypes.includes(event.eventType);
    },
    async ensureDeliveryClient(p, clientId) {
      const registered = await this.store.getDeliveryClient(
        { tenantId: p.tenantId, clientId },
        { optional: true }
      );
      if (!registered) {
        throw new Errors.MoleculerClientError(
          'Workbench delivery client registration required',
          403,
          'WORKBENCH_DELIVERY_CLIENT_REQUIRED'
        );
      }
      return registered;
    },
    waitForConversationCase(input) {
      const attemptResolve = async (attempt = 0) => {
        const mapping = await this.store.resolveConversation(input, { optional: true });
        if (mapping?.cetCaseId) return mapping;
        if (attempt >= 19) {
          throw new Errors.MoleculerClientError(
            'Workbench conversation classification still pending',
            409,
            'WORKBENCH_CONVERSATION_PENDING'
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        return attemptResolve(attempt + 1);
      };
      return attemptResolve();
    },
    chatResponse(
      usedOperation,
      result,
      eventSummary = this.emptyEventSummary(),
      turnMemory = null
    ) {
      return {
        caseId: result.cetCaseId,
        cetCaseId: result.cetCaseId,
        caseStateVersion: result.caseStateVersion,
        usedOperation,
        primaryDomain: result.primaryDomain,
        alternativeDomains: result.alternativeDomains || [],
        activityHints: result.activityHints || [],
        readinessState: result.readinessState,
        responseText: result.responseText || result.responseGuidance || '',
        requiredClarifications: result.requiredClarifications || [],
        missingEvidence: result.missingEvidence || [],
        noCallGuards: result.noCallGuards || [],
        turnMemorySummary: turnMemory ? safeTurnMemory(turnMemory) : null,
        events: [],
        eventSummary,
        pendingEvents: eventSummary.unacknowledged || eventSummary.pending || 0,
      };
    },
  },
};
