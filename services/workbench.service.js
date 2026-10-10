'use strict';

const crypto = require('crypto');
const {
  startLocalProvisioning,
  stopLocalProvisioning,
} = require('../src/local-provisioning-channel');
const { handleCorrectionTurn } = require('../src/workbench-corrections');
const { answerSystemActivity } = require('../src/workbench-system-activity');
const coverageTurn = require('../src/function-coverage-turn');
const { classifyWorkbenchIntent } = require('../src/workbench-intent-router');
const caseLinking = require('../src/workbench-case-linking');
const { rawContentAllowed } = require('../src/case-linking');
const contentTurn = require('../src/workbench-content-turn');
const conversationAssistance = require('../src/workbench-conversation');
const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { gatewayForbidden, validateRoles } = require('../src/auth/token-policy');
const { principal, deny } = require('../src/domain-router-policy');
const { WorkbenchStore } = require('../src/workbench-store');
const { normalizeMappingEmail } = require('../src/workbench-identity');
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
  buildSkillInput,
  projectSkillFromCase,
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
const {
  buildMailEvidence,
  normalizeMailAccountInput,
  safeMailAccount,
} = require('../src/workbench-mail-evidence');
const {
  defaultRoleAlignment,
  normalizeRoleAlignmentInput,
  normalizeWilliMappingInput,
  safeRoleAlignment,
  safeWilliMapping,
} = require('../src/workbench-willi-mako-mapping');
const {
  WilliMakoClient,
  buildWilliMakoEvidence,
  normalizeWilliLookupInput,
  safeSessionsResponse,
} = require('../src/workbench-willi-mako-connector');
const { encryptMailSecret, secretFingerprint } = require('../src/workbench-mail-secret-store');
const {
  CASE_STARTERS_VERSION,
  getCaseStarter,
  listCaseStarters,
  renderStarterPrompt,
  starterKnownContext,
} = require('../src/workbench-case-starters');

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
  ['mailAccountDb', './data/cet_workbench_mail_accounts', 'CET_WORKBENCH_MAIL_ACCOUNT_DB_PATH'],
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
  hooks: {
    before: {
      '*': function gatewayBoundary(ctx) {
        if (
          ctx.meta.apiToken?.type === 'gateway' &&
          (!['workbench.chat', 'workbench.query'].includes(ctx.action.name) ||
            ctx.options.parentCtx?.action?.name !== 'openai-compatible.chatCompletions')
        )
          gatewayForbidden();
      },
      chat: coverageTurn.before,
      query: coverageTurn.before,
    },
    after: { chat: coverageTurn.after, query: coverageTurn.after },
    error: { chat: coverageTurn.error, query: coverageTurn.error },
  },
  mixins: [...WORKBENCH_DATABASES.map(workbenchDbMixin), conversationAssistance.lifecycle],
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

    'caseStarters.list': action(
      'GET /case-starters',
      'Return taxonomy-derived guided Workbench case starters for Open WebUI clients',
      async function (ctx) {
        principal(ctx, ctx.params);
        const domain = cleanString(ctx.params.domain, 'domain', { max: 80 }) || null;
        return {
          schemaVersion: CASE_STARTERS_VERSION,
          items: listCaseStarters({ domain }),
        };
      },
      { domain: { type: 'string', optional: true } }
    ),
    'caseStarters.start': action(
      'POST /case-starters/:starterId/start',
      'Start a Workbench case from a guided case starter through the normal CET chat path',
      async function (ctx) {
        principal(ctx, ctx.params);
        this.assertCompleteOpenWebUiIdentity(ctx.params);
        if (!ctx.params.openWebuiUserId || !ctx.params.openWebuiOrgId) {
          throw new Errors.MoleculerClientError(
            'Open WebUI mapped user and organization are required for guided case starters',
            403,
            'WORKBENCH_MAPPING_REQUIRED'
          );
        }
        const starter = getCaseStarter(ctx.params.starterId);
        if (!starter) throw new Errors.MoleculerClientError('Case starter not found', 404);
        const message = `Starte einen Fall: ${renderStarterPrompt(starter, ctx.params)}`;
        const chatParams = {
          ...ctx.params,
          channel: ctx.params.channel || 'open-webui',
          client: ctx.params.client || 'open-webui',
          message,
          userRequest: message,
          knownContext: {
            ...(ctx.params.knownContext && typeof ctx.params.knownContext === 'object'
              ? ctx.params.knownContext
              : {}),
            caseStarter: starterKnownContext(starter, ctx.params),
          },
        };
        const result = await ctx.call('workbench.chat', chatParams, { meta: ctx.meta });
        return {
          schemaVersion: CASE_STARTERS_VERSION,
          starter,
          ...result,
        };
      }
    ),
    'mail.accounts.create': action(
      'POST /mail/accounts',
      'Register a tenant-bound Workbench mail account with CET-encrypted credentials',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const account = normalizeMailAccountInput(ctx.params, {
          tenantId: p.tenantId,
          actorId: p.actorId,
          encryptSecret: (secret) => encryptMailSecret(secret),
          secretFingerprint: (secret) => secretFingerprint(secret),
        });
        const saved = await this.store.saveMailAccount(account);
        return { saved: true, mailAccount: safeMailAccount(saved) };
      }
    ),
    'mail.accounts.list': action(
      'GET /mail/accounts',
      'List tenant-bound Workbench mail accounts without exposing credentials',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const accounts = await this.store.listMailAccounts({
          tenantId: p.tenantId,
          enabledOnly: true,
        });
        return { items: accounts.map((account) => safeMailAccount(account)) };
      }
    ),
    'mail.accounts.delete': action(
      'DELETE /mail/accounts/:mailAccountRef',
      'Disable a tenant-bound Workbench mail account',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const mailAccountRef = cleanString(ctx.params.mailAccountRef, 'mailAccountRef', {
          required: true,
        });
        const deleted = await this.store.deleteMailAccount({
          tenantId: p.tenantId,
          mailAccountRef,
        });
        return { deleted: true, mailAccount: safeMailAccount(deleted) };
      },
      { mailAccountRef: { type: 'string', min: 1 } }
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
        let mailEvidence = null;
        try {
          if (tool.toolClass === 'web_fetch' || tool.toolClass === 'web_browse') {
            webEvidence = await buildWebEvidence({
              ...(ctx.params.input || {}),
              evidenceType: tool.evidenceOutputType || ctx.params.input?.evidenceType,
            });
          } else if (['mail_search', 'mail_read', 'mail_attachment_ref'].includes(tool.toolClass)) {
            const mailAccountRef = cleanString(ctx.params.input?.mailAccountRef, 'mailAccountRef', {
              required: true,
            });
            const account = await this.store.getMailAccount({
              tenantId: p.tenantId,
              mailAccountRef,
            });
            mailEvidence = buildMailEvidence({ tool, input: ctx.params.input || {}, account });
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
        const externalEvidence = webEvidence || mailEvidence;
        const simulated = externalEvidence
          ? {
              outputSummary: `${tool.title}: ${externalEvidence.label}`,
              safeDisplayText: externalEvidence.safeSummary,
              rawOutputStored: false,
            }
          : simulateToolOutput(tool, ctx.params.input || {});
        const evidenceId = `tool_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const evidence = await this.store.saveEvidence({
          tenantId: p.tenantId,
          actorId: p.actorId,
          caseId,
          evidenceId,
          evidenceType:
            externalEvidence?.evidenceType || tool.evidenceOutputType || 'generic_document',
          label: externalEvidence?.label || `${tool.title} result`,
          safeSummary: simulated.safeDisplayText,
          sourceType: externalEvidence?.sourceType || 'existing_cet_evidence_ref',
          sourceRef: externalEvidence?.sourceRef || {
            toolId: tool.toolId,
            toolClass: tool.toolClass,
          },
          sensitivityLevel: 'tenant_internal',
          provenance: externalEvidence?.provenance || {
            system: 'cet-workbench-tool-runtime',
            toolId: tool.toolId,
          },
          evidenceRole: 'tool_result',
          claimStrength: 'supporting',
          readinessReviewRequired: true,
          fileHash: externalEvidence?.fileHash,
          hashStatus: externalEvidence?.hashStatus,
          sourceFingerprint: externalEvidence?.sourceFingerprint,
          extracts:
            externalEvidence?.extracts ||
            (webEvidence
              ? {
                  url: webEvidence.sourceRef.url,
                  title: webEvidence.sourceRef.title,
                  retrievedAt: webEvidence.retrievedAt,
                  contentType: webEvidence.contentType,
                  safeSummary: webEvidence.safeSummary,
                }
              : {}),
          routingSignals: externalEvidence
            ? ['workbench_tool_result', tool.toolClass, tool.toolId, externalEvidence.evidenceType]
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
        const shared = await caseLinking.sharedCaseSummary(this, p, ctx.params.caseId);
        if (shared) return shared;
        const state = await ctx.call('domain-router.explain', {
          cetCaseId: ctx.params.caseId,
        });
        const full = await this.loadVisibleCase(ctx, p, ctx.params.caseId);
        const evidenceRefs = ctx.params.includeEvidence
          ? await this.store.listEvidence({ tenantId: p.tenantId, caseId: ctx.params.caseId })
          : [];
        const turnMemory = await this.loadTurnMemory(p, ctx.params.caseId);
        const summary = presentCase(
          { ...full, lastClassification: state, turnMemory },
          {
            evidenceRefs,
            eventSummary: await this.eventSummary(p, ctx.params.caseId),
            clearance: p.clearance,
          }
        );
        return {
          ...summary,
          initialRequest: full.initialRequest || '',
          internalDrafts: await conversationAssistance.listDrafts(
            this.conversationsDb,
            p,
            ctx.params.caseId
          ),
        };
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
          if (rawContentAllowed(p, state) && state.actorId !== p.actorId)
            await this.broker.getLocalService('domain-router').auditCaseAccess(p, state);
          items.push(
            rawContentAllowed(p, state)
              ? presentCaseListItem(state, summary, taskSummary)
              : await this.broker.getLocalService('domain-router').readCaseSummary(p, state)
          );
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
    'admin.mappings.list': action(
      'GET /admin/mappings',
      'List tenant and user mappings for the authenticated tenant and client',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const tenantId = this.authorizeTargetTenant(p, ctx.params.tenantId || p.tenantId);
        const client = normalizeClient(ctx.params.client || 'open-webui');
        const rows = await this.identityDb.allDocs({ include_docs: true });
        return {
          tenantId,
          mappings: rows.rows
            .map((row) => row.doc)
            .filter(
              (doc) =>
                ['workbench_tenant_mapping', 'workbench_user_mapping'].includes(doc.type) &&
                doc.cetTenantId === tenantId &&
                doc.client === client
            ),
        };
      },
      { tenantId: { type: 'string', optional: true }, client: { type: 'string', optional: true } }
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
        const roles = validateRoles(Array.isArray(ctx.params.roles) ? ctx.params.roles : p.roles, {
          support: p.roles.some((r) => ['ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r)),
        });
        const externalOrgId = cleanString(
          ctx.params.externalOrgId || ctx.params.openWebuiOrgId,
          'externalOrgId',
          {
            required: true,
          }
        );
        const externalUserId = cleanString(
          ctx.params.externalUserId || ctx.params.openWebuiUserId,
          'externalUserId'
        );
        const externalUserEmail = normalizeMappingEmail(ctx.params.externalUserEmail);
        if (!!externalUserId === !!externalUserEmail) {
          throw new Errors.MoleculerClientError(
            'Provide either a user id or an email address.',
            422,
            'WORKBENCH_CONTRACT_INVALID'
          );
        }
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
          externalUserEmail,
          cetTenantId,
          cetActorId: cleanString(
            ctx.params.cetActorId || ctx.params.actorId || p.actorId,
            'cetActorId',
            {
              required: true,
            }
          ),
          roles,
          sensitivityClearance: this.validateMappingClearance(
            ctx.params.sensitivityClearance || p.clearance || []
          ),
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
    'admin.williMakoMappings.create': action(
      'POST /admin/willi-mako/mappings',
      'Provision a Willi-MaKo mandant/user mapping into CET tenant/actor roles',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const targetTenant = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.cetTenantId || p.tenantId, 'cetTenantId', { required: true })
        );
        const roleProfile = ctx.params.williRoleProfile || ctx.params.roleProfile || 'normal_user';
        const tenantAlignment = await this.store.getWilliRoleAlignment(
          { cetTenantId: targetTenant, williRoleProfile: roleProfile },
          { optional: true }
        );
        const mappingInput = normalizeWilliMappingInput(
          { ...ctx.params, cetTenantId: targetTenant },
          { tenantId: targetTenant, actorId: p.actorId },
          tenantAlignment || defaultRoleAlignment(roleProfile)
        );
        if (!p.roles.some((r) => ['ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r))) {
          if (mappingInput.cetTenantId !== p.tenantId) {
            deny('Workbench tenant admin cannot provision foreign Willi-MaKo mapping');
          }
          if (mappingInput.isWilliStaff) {
            deny('Willi-MaKo staff mapping requires platform admin');
          }
        }
        const mapping = await this.store.saveWilliMapping(mappingInput);
        return { saved: true, mapping: safeWilliMapping(mapping) };
      }
    ),
    'admin.williMakoMappings.resolve': action(
      'GET /admin/willi-mako/mappings/resolve',
      'Resolve a Willi-MaKo mandant/user/email mapping into CET tenant/actor roles',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const targetTenant = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.cetTenantId || p.tenantId, 'cetTenantId', { required: true })
        );
        const mapping = await this.store.getWilliMapping({
          cetTenantId: targetTenant,
          williMandantId: cleanString(
            ctx.params.williMandantId || ctx.params.externalOrgId,
            'williMandantId',
            {
              required: true,
            }
          ),
          williUserId: cleanString(
            ctx.params.williUserId || ctx.params.externalUserId,
            'williUserId'
          ),
          externalEmailNorm: cleanString(
            ctx.params.externalEmailNorm || ctx.params.email,
            'externalEmailNorm'
          )?.toLowerCase(),
        });
        this.authorizeTargetTenant(p, mapping.cetTenantId);
        return { found: true, mapping: safeWilliMapping(mapping) };
      }
    ),
    'admin.williMakoRoleAlignments.list': action(
      'GET /admin/willi-mako/role-alignments',
      'List Willi-MaKo role profile alignments for this CET tenant',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const targetTenant = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.cetTenantId || p.tenantId, 'cetTenantId', { required: true })
        );
        const saved = await this.store.listWilliRoleAlignments({ cetTenantId: targetTenant });
        const savedProfiles = new Set(saved.map((item) => item.williRoleProfile));
        const defaults = ['normal_user', 'mandant_admin', 'staff', 'external_advisor']
          .filter((profile) => !savedProfiles.has(profile))
          .map((profile) => defaultRoleAlignment(profile));
        return {
          items: [...saved, ...defaults]
            .map((item) => safeRoleAlignment(item))
            .sort((a, b) => String(a.williRoleProfile).localeCompare(String(b.williRoleProfile))),
        };
      }
    ),
    'admin.williMakoRoleAlignments.save': action(
      'POST /admin/willi-mako/role-alignments',
      'Configure a tenant-scoped Willi-MaKo role profile alignment',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const targetTenant = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.cetTenantId || p.tenantId, 'cetTenantId', { required: true })
        );
        const input = normalizeRoleAlignmentInput(
          { ...ctx.params, cetTenantId: targetTenant },
          { tenantId: targetTenant, actorId: p.actorId }
        );
        if (
          input.williRoleProfile === 'staff' &&
          !p.roles.some((r) => ['ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r))
        ) {
          deny('Willi-MaKo staff role alignment requires platform admin');
        }
        const saved = await this.store.saveWilliRoleAlignment(input);
        return { saved: true, alignment: safeRoleAlignment(saved) };
      }
    ),
    'williMako.sessions.discover': action(
      'GET /willi-mako/sessions',
      'Discover tenant-scoped Willi-MaKo sessions for a mapped CET actor',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const lookup = normalizeWilliLookupInput(ctx.params);
        const mapping = await this.resolveWilliMappingForPrincipal(p, lookup);
        const response = await this.williMakoClient.sessions({
          ...lookup,
          williMandantId: mapping.williMandantId,
        });
        return { mapping: safeWilliMapping(mapping), ...safeSessionsResponse(response) };
      }
    ),
    'williMako.evidence.attach': action(
      'POST /cases/:caseId/willi-mako/evidence',
      'Attach a Willi-MaKo diagnostic summary as governed CET EvidenceRef',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const caseId = ctx.params.caseId || ctx.params.cetCaseId;
        await this.loadVisibleCase(ctx, p, caseId);
        const lookup = normalizeWilliLookupInput(ctx.params);
        const mapping = await this.resolveWilliMappingForPrincipal(p, lookup);
        const summary = ctx.params.evidenceSummary
          ? ctx.params.evidenceSummary
          : await this.williMakoClient.evidenceSummary({
              williMandantId: mapping.williMandantId,
              williSessionId: lookup.williSessionId,
            });
        const williEvidence = buildWilliMakoEvidence(summary, {
          mapping,
          actorId: p.actorId,
          caseId,
        });
        const evidence = await this.store.saveEvidence({
          ...williEvidence,
          evidenceId: `willi_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          tenantId: p.tenantId,
          actorId: p.actorId,
          caseId,
          forceNewVersion: ctx.params.forceNewVersion === true,
        });
        const generatedEvents = [];
        if (!evidence.duplicate) {
          await ctx.call('domain-router.ingestUpdate', {
            cetCaseId: caseId,
            kind: 'evidence_available',
            version: evidence.evidenceId,
            validated: false,
            evidenceRef: evidence.evidenceId,
            readinessReviewRequired: true,
            routingSignals: evidence.routingSignals || [],
          });
          generatedEvents.push({ eventType: 'evidence.available', severity: 'info' });
        }
        return {
          evidenceRef: safeEvidenceRef(evidence, { clearance: p.clearance }),
          duplicate: !!evidence.duplicate,
          duplicateOf: evidence.duplicateOf,
          readinessReviewRequired: true,
          generatedEvents,
          mapping: safeWilliMapping(mapping),
        };
      },
      caseParams
    ),
    'williMako.case.link': action(
      'POST /cases/:caseId/willi-mako/link',
      'Link a CET Workbench case to a tenant-scoped Willi-MaKo session',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const caseId = ctx.params.caseId || ctx.params.cetCaseId;
        await this.loadVisibleCase(ctx, p, caseId);
        const lookup = normalizeWilliLookupInput(ctx.params);
        const mapping = await this.resolveWilliMappingForPrincipal(p, lookup);
        const response = await this.williMakoClient.linkCase({
          williMandantId: mapping.williMandantId,
          williSessionId: lookup.williSessionId,
          cetCaseId: caseId,
          cetTenantId: p.tenantId,
          cetActorId: p.actorId,
          correlationId: ctx.params.correlationId,
        });
        return { linked: true, mapping: safeWilliMapping(mapping), willi: response };
      },
      caseParams
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
    'skills.list': action(
      'GET /skills',
      'List tenant-scoped CET Workbench governed skills (issue #640), including code-owned defaults',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const tenantSkills = await this.store.listPlaybooks({
          tenantId: p.tenantId,
          domain: ctx.params.domain,
          status: ctx.params.status,
        });
        const items = [
          ...(ctx.params.status && ctx.params.status !== 'active'
            ? []
            : defaultPlaybooksForTenant(p.tenantId)),
          ...tenantSkills.map((skill) => safePlaybook(skill)),
        ];
        return { items };
      },
      { domain: { type: 'string', optional: true }, status: { type: 'string', optional: true } }
    ),
    'skills.get': action(
      'GET /skills/:skillId',
      'Return one tenant-scoped CET Workbench governed skill (issue #640)',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const skillId = cleanString(ctx.params.skillId, 'skillId', { required: true });
        const doc = await this.store.getSkill(
          { tenantId: p.tenantId, skillId },
          { optional: true }
        );
        if (doc) return { skill: safePlaybook(doc) };
        const fallback = defaultPlaybooksForTenant(p.tenantId).find(
          (item) => item.skillId === skillId
        );
        if (!fallback)
          throw new Errors.MoleculerClientError(
            'Workbench skill not found',
            404,
            'WORKBENCH_NOT_FOUND'
          );
        return { skill: fallback };
      },
      { skillId: { type: 'string', min: 1 } }
    ),
    'skills.create': action(
      'POST /skills',
      'Create a tenant-scoped CET Workbench governed skill draft (issue #640)',
      async function (ctx) {
        const p = this.requireSkillGovernance(ctx);
        const skillId = cleanString(ctx.params.skillId || ctx.params.playbookId, 'skillId', {
          required: true,
        });
        const input = buildSkillInput(ctx.params);
        const saved = await this.store.createOrUpdateSkillDraft({
          ...input,
          tenantId: p.tenantId,
          skillId,
          actorId: p.actorId,
          actorRoles: p.roles,
        });
        return { saved: true, skill: safePlaybook(saved) };
      },
      { skillId: { type: 'string', optional: true } }
    ),
    'skills.propose': action(
      'POST /skills/:skillId/propose',
      'Transition a draft CET Workbench skill to proposed (issue #640)',
      function (ctx) {
        return this.transitionSkillLifecycle(ctx, {
          transition: 'proposed',
          fromStatuses: ['draft'],
          toStatus: 'proposed',
        });
      },
      { skillId: { type: 'string', min: 1 } }
    ),
    'skills.activate': action(
      'POST /skills/:skillId/activate',
      'Activate a proposed CET Workbench skill; requires Workbench governance role (issue #640)',
      function (ctx) {
        return this.transitionSkillLifecycle(ctx, {
          transition: 'activated',
          fromStatuses: ['proposed'],
          toStatus: 'active',
        });
      },
      { skillId: { type: 'string', min: 1 } }
    ),
    'skills.deprecate': action(
      'POST /skills/:skillId/deprecate',
      'Deprecate an active CET Workbench skill without deleting audit history (issue #640)',
      function (ctx) {
        return this.transitionSkillLifecycle(ctx, {
          transition: 'deprecated',
          fromStatuses: ['active'],
          toStatus: 'deprecated',
        });
      },
      { skillId: { type: 'string', min: 1 } }
    ),
    'cases.skills.proposeFromCase': action(
      'POST /cases/:caseId/skills/propose-from-case',
      'Propose a tenant CET Workbench skill draft from a resolved/confirmed case (issue #640)',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const caseId = cleanString(ctx.params.caseId, 'caseId', { required: true });
        const state = await this.loadVisibleCase(ctx, p, caseId);
        const classification = state.lastClassification || {};
        if (
          !classification.readinessState ||
          classification.readinessState === 'evidence_required'
        ) {
          workbenchError(
            'Case is not resolved/confirmed enough to propose a skill',
            'WORKBENCH_SKILL_CASE_NOT_RESOLVED'
          );
        }
        const skillId = cleanString(ctx.params.skillId, 'skillId') || `case-${caseId}-skill`;
        const existing = await this.store.getSkill(
          { tenantId: p.tenantId, skillId },
          { optional: true }
        );
        if (existing?.sourceCaseId && existing.sourceCaseId !== caseId) {
          workbenchError(
            'skillId already used by a different source case',
            'WORKBENCH_SKILL_CONFLICT'
          );
        }
        if (existing && existing.status !== 'draft') {
          return { saved: true, skill: safePlaybook(existing), idempotent: true };
        }
        const evidenceRefs = await this.store.listEvidence({ tenantId: p.tenantId, caseId });
        const evidenceTypes = [...new Set(evidenceRefs.map((e) => e.evidenceType).filter(Boolean))];
        const projected = projectSkillFromCase({
          classification,
          currentDomain: state.currentDomain,
          evidenceTypes,
          override: {
            title: cleanString(ctx.params.title, 'title', { max: 200 }),
            description: cleanString(ctx.params.description, 'description', { max: 2000 }),
            examplePrompts: Array.isArray(ctx.params.examplePrompts)
              ? ctx.params.examplePrompts
              : [],
          },
        });
        const input = buildSkillInput(projected);
        await this.store.createOrUpdateSkillDraft({
          ...input,
          tenantId: p.tenantId,
          skillId,
          actorId: p.actorId,
          actorRoles: p.roles,
          sourceCaseId: caseId,
        });
        const proposed = await this.store.transitionSkillStatus({
          tenantId: p.tenantId,
          skillId,
          actorId: p.actorId,
          actorRoles: p.roles,
          transition: 'proposed',
          fromStatuses: ['draft'],
          toStatus: 'proposed',
        });
        return { saved: true, skill: safePlaybook(proposed.skill), idempotent: false };
      },
      { caseId: { type: 'string', min: 1 } }
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
        const tasks = await this.projectInboxTasksForCases(p, caseIds, {
          caseId,
          status: ctx.params.status,
        });
        let proposals = [];
        try {
          proposals = await ctx.call('shared-service-agent.proposals', { tenantId: p.tenantId });
        } catch (error) {
          if (!['SERVICE_NOT_FOUND', 'SERVICE_NOT_AVAILABLE'].includes(error.type)) throw error;
        }
        return {
          items: [
            ...tasks.map((task) => safeTask(task)),
            ...proposals.map((proposal) => ({
              taskId: proposal.ref,
              type: 'shared-service-proposal',
              attentionState: 'proposal_review_required',
              severity: 'info',
              blockingReason: proposal.summary,
              nextSafeAction:
                'Vorschlag im Chat anhand seiner Beschreibung annehmen oder ablehnen.',
              status: 'open',
              title: proposal.summary,
              summary: proposal.summary,
              functionId: proposal.functionId,
              proposalRef: proposal.ref,
            })),
          ],
          nextCursor: null,
        };
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
    // Internal read-only entrypoint: use the same mapped principal as chat,
    // without reserving conversations, classifying cases or acknowledging events.
    query: {
      params: {
        intentMode: {
          type: 'enum',
          values: ['status_query', 'knowledge_query', 'data_lookup', 'system_activity_query'],
        },
      },
      async handler(ctx) {
        const envelope = normalizeTaskEnvelope(ctx.params);
        let { p, mapping } = await this.resolveTurnPrincipal(ctx, envelope);
        const meta = this.metaForMapping(ctx, p, mapping);
        p = principal({ meta }, ctx.params);
        coverageTurn.mapped(ctx, meta);
        if (ctx.params.intentMode === 'system_activity_query') {
          return answerSystemActivity(
            {
              meta,
              logger: this.logger,
              broker: this.broker,
              call: (name, input) =>
                ctx.call(name, input, {
                  meta,
                  timeout: this.settings.systemActivityReadTimeoutMs || 3000,
                }),
            },
            envelope.userRequest,
            {
              model: this.settings.systemActivityModel,
              resolverOptions: this.settings.systemActivityResolver || {},
            }
          );
        }
        if (ctx.params.intentMode === 'knowledge_query') {
          const result = await ctx.call(
            'personal-agent.chat',
            {
              message: envelope.userRequest,
              chatMode: 'consultation',
            },
            { meta }
          );
          return { responseText: result.reply || '' };
        }
        if (ctx.params.intentMode === 'status_query') {
          const conversationStatus = await caseLinking.conversationCaseStatus(
            this,
            ctx,
            p,
            envelope,
            meta
          );
          const linkedStatus = await caseLinking.findIdentifierStatus(
            ctx,
            envelope.userRequest,
            meta
          );
          return (
            linkedStatus ||
            conversationStatus || {
              responseText:
                'Ich kann den Vorgang noch nicht eindeutig zuordnen. Nenne mir eine Fallnummer oder eine Kennung, dann prüfe ich Bearbeitung und Stand.',
            }
          );
        }
        const message = envelope.userRequest.toLowerCase();
        if (/\b(tools)\b/.test(message)) return ctx.call('workbench.tools.list', {}, { meta });
        if (/starters|fallstarter/.test(message))
          return ctx.call('workbench.caseStarters.list', {}, { meta });
        if (/events|ereignisse/.test(message))
          return ctx.call('workbench.inbox.tasks.list', {}, { meta });
        return ctx.call(
          'workbench.cases.list',
          {
            ...(/mako|ma-ko|marktkommunikation/.test(message)
              ? { domain: 'market_communication' }
              : {}),
          },
          { meta }
        );
      },
    },
    chat: action(
      'POST /chat',
      'Run a CET-led Workbench chat turn: classify new conversations, continue mapped cases',
      async function (ctx) {
        const envelope = normalizeTaskEnvelope(ctx.params);
        let { p, mapping } = await this.resolveTurnPrincipal(ctx, envelope);
        coverageTurn.mapped(ctx, this.metaForMapping(ctx, p, mapping));
        const correctionMeta = this.metaForMapping(ctx, p, mapping);
        p = principal({ meta: correctionMeta }, ctx.params);
        const background = require('../src/workbench-background-task');
        if (background.backgroundTask(envelope.userRequest))
          return background.answerBackgroundTask(envelope.userRequest, p.tenantId, this.logger);
        const pending = await conversationAssistance.readTurn(this.conversationsDb, p, envelope);
        const memoryContext = {
          ...ctx,
          call: (name, params, options) =>
            ctx.call(name, params, { meta: { ...correctionMeta, ...options?.meta } }),
        };
        if (pending?.tenantMemoryFactIds?.length) {
          const priorityReply = await require('../src/tenant-memory').preturn(
            memoryContext,
            p,
            envelope,
            pending
          );
          if (priorityReply) return priorityReply;
        }
        if (this.broker.getLocalService('dataset')) {
          const datasetTurn = await ctx.call(
            'dataset.turn',
            {
              question: envelope.userRequest,
              documents: envelope.documents || [],
              conversationId: envelope.conversationId,
            },
            { meta: correctionMeta }
          );
          if (datasetTurn.handled) {
            this.logger.info('Workbench turn phases and sources', {
              phaseTimes: { answerMs: datasetTurn.answerMs || 0 },
              sources: datasetTurn.sources || [],
            });
            await conversationAssistance.saveTurn(this.conversationsDb, p, envelope, {
              tenantMemoryFactIds: [],
            });
            return {
              state: 'assistance',
              nonBinding: true,
              responseText: datasetTurn.responseText,
              sources: datasetTurn.sources || [],
              phaseTimes: { answerMs: datasetTurn.answerMs || 0 },
            };
          }
          if (datasetTurn.documents) envelope.documents = datasetTurn.documents;
        }
        const memoryReply = await require('../src/tenant-memory').preturn(
          memoryContext,
          p,
          envelope,
          pending
        );
        if (memoryReply) return memoryReply;
        const conversation = await this.store.resolveConversation(
          {
            tenantId: p.tenantId,
            client: envelope.channel,
            conversationId: envelope.conversationId,
          },
          { optional: true }
        );
        if (
          envelope.documents?.length ||
          require('../src/workbench-document-input').documentReference(envelope.userRequest) ||
          require('../src/workbench-thread').isDocumentInput(envelope.userRequest)
        )
          return contentTurn.runContentTurn(this, ctx, {
            p,
            mapping,
            envelope,
            pending,
            conversation,
            meta: correctionMeta,
          });
        if (/^(?:kein fall|no case)[.!\s]*$/i.test(envelope.userRequest.trim())) {
          return contentTurn.discard(this, ctx, p, envelope, pending, correctionMeta);
        }
        const confirmation = conversationAssistance.emptyConfirmation(envelope.userRequest);
        const offeredContent =
          pending?.offeredContent || conversationAssistance.substantiveMessage(ctx.params.messages);
        const caseLinkCorrection = await caseLinking.handleCaseLinkTurn(
          this,
          ctx,
          p,
          envelope,
          correctionMeta
        );
        if (caseLinkCorrection) return caseLinkCorrection;
        const correctionResult = await handleCorrectionTurn(
          {
            params: ctx.params,
            meta: correctionMeta,
            call: (name, input) => ctx.call(name, input, { meta: correctionMeta }),
          },
          envelope,
          this.store,
          {
            model: this.settings.systemActivityModel,
            allowUnmatchedConfirmation:
              confirmation &&
              !!(offeredContent || pending?.lastQuestion || pending?.askedQuestions?.length),
          }
        );
        if (correctionResult) {
          let offeredCorrectionContent = pending?.offeredContent || '';
          const question = correctionResult.responseText.includes('?')
            ? correctionResult.responseText
            : '';
          const alreadyAsked =
            question &&
            (question === pending?.lastQuestion ||
              (pending?.askedQuestions || []).some((item) => item.question === question));
          if (alreadyAsked) {
            offeredCorrectionContent ||= envelope.userRequest;
            correctionResult.responseText =
              'Du kannst eine eindeutige Bezeichnung wählen, mit „Starte einen Fall“ einen Fall starten oder mit „Frage beantworten“ eine unverbindliche Einschätzung anfordern.';
          }
          await conversationAssistance.saveTurn(this.conversationsDb, p, envelope, {
            correctionFamily: 'function',
            offeredContent: offeredCorrectionContent,
            lastQuestion: question && !alreadyAsked ? question : '',
            askedQuestions: [
              ...(pending?.askedQuestions || []),
              ...(question && !alreadyAsked ? [{ key: `correction:${question}`, question }] : []),
            ],
          });
          return correctionResult;
        }
        const choice = await contentTurn.selectChoice(this, ctx, {
          p,
          mapping,
          envelope,
          conversation,
          meta: correctionMeta,
        });
        if (choice) return choice;
        const intent = classifyWorkbenchIntent(envelope.userRequest, {
          cetCaseId: conversation?.cetCaseId,
        });
        if (['status_query', 'data_lookup', 'system_activity_query'].includes(intent)) {
          return ctx.call(
            'workbench.query',
            { ...ctx.params, intentMode: intent },
            { meta: correctionMeta }
          );
        }
        return contentTurn.runContentTurn(this, ctx, {
          p,
          mapping,
          envelope,
          pending,
          conversation,
          meta: correctionMeta,
        });
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
  async started() {
    await startLocalProvisioning(this);
    require('../src/tenant-memory').startRecovery(this);
  },
  async stopped() {
    await require('../src/tenant-memory').stopRecovery(this);
    await Promise.allSettled([...(this.workbenchDocumentReviews?.values() || [])]);
    await Promise.allSettled([...(this.tenantMemoryJobs || [])]);
    await stopLocalProvisioning(this);
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
      mailAccountDb: this.mailAccountDb,
    });
    this.williMakoClient = new WilliMakoClient({
      baseUrl: this.settings.williMakoBaseUrl || process.env.WILLI_MAKO_BASE_URL,
      secret: this.settings.williMakoServiceSecret || process.env.WILLI_MAKO_CET_SERVICE_SECRET,
      token: this.settings.williMakoServiceToken || process.env.WILLI_MAKO_CET_SERVICE_TOKEN,
      timeoutMs:
        Number(this.settings.williMakoTimeoutMs || process.env.WILLI_MAKO_TIMEOUT_MS) || 8000,
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
    requireSkillGovernance(ctx) {
      const p = principal(ctx, ctx.params);
      if (
        !p.roles.some((r) =>
          ['ROLE_TENANT_ADMIN', 'ROLE_PROCESS_OWNER', 'ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r)
        )
      ) {
        deny('Workbench skill governance role required');
      }
      return p;
    },
    async transitionSkillLifecycle(ctx, lifecycle) {
      const p = this.requireSkillGovernance(ctx);
      const skillId = cleanString(ctx.params.skillId, 'skillId', { required: true });
      const result = await this.store.transitionSkillStatus({
        tenantId: p.tenantId,
        skillId,
        actorId: p.actorId,
        actorRoles: p.roles,
        ...lifecycle,
      });
      return { saved: true, skill: safePlaybook(result.skill) };
    },
    authorizeTargetTenant(p, targetTenantId) {
      const isPlatformAdmin = p.roles.some((r) => ['ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r));
      if (!isPlatformAdmin && targetTenantId !== p.tenantId) {
        deny('Workbench tenant admin cannot provision foreign tenant');
      }
      return targetTenantId;
    },
    async resolveWilliMappingForPrincipal(p, lookup) {
      const mapping = await this.store.getWilliMapping({
        cetTenantId: p.tenantId,
        williMandantId: lookup.williMandantId,
        williUserId: lookup.williUserId,
        externalEmailNorm: lookup.externalEmailNorm,
      });
      this.authorizeTargetTenant(p, mapping.cetTenantId);
      const isPlatformAdmin = p.roles.some((r) => ['ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r));
      const isTenantAdmin = p.roles.includes('ROLE_TENANT_ADMIN');
      const isMappedActor = mapping.cetActorId === p.actorId;
      if (!isPlatformAdmin && !isTenantAdmin && !isMappedActor) {
        deny('Willi-MaKo mapping does not belong to the authenticated CET actor');
      }
      if (mapping.isWilliStaff && !isPlatformAdmin) {
        deny('Willi-MaKo staff evidence requires platform admin');
      }
      return mapping;
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
        [...tenantPlaybooks, ...defaultPlaybooksForTenant(p.tenantId)],
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
    validateMappingClearance(values) {
      if (
        !Array.isArray(values) ||
        values.some(
          (value) =>
            !['public', 'tenant_internal', 'restricted', 'highly_sensitive'].includes(value)
        )
      ) {
        throw new Errors.MoleculerClientError(
          'Unsupported sensitivity clearance',
          422,
          'WORKBENCH_CONTRACT_INVALID'
        );
      }
      return [...new Set(values)];
    },
    async resolveTurnPrincipal(ctx, envelope) {
      const gateway = ctx.meta.apiToken?.type === 'gateway';
      const token = ctx.meta.apiToken;
      if (!gateway) {
        const p = principal(ctx, ctx.params);
        if (ctx.meta.authUser?.authType === 'legacy-token') {
          // A normal HTTP API token always acts as itself, including on direct Workbench routes.
          delete envelope.openWebuiUserId;
          delete envelope.openWebuiOrgId;
          delete envelope.openWebuiUserEmail;
          return { p, mapping: null };
        }
        return { p, mapping: await this.resolveUserMapping(ctx, p, envelope) };
      }
      if (
        envelope.channel !== token.client ||
        (!envelope.openWebuiUserId && !envelope.openWebuiUserEmail) ||
        !envelope.openWebuiOrgId ||
        !token.tenantId ||
        (token.externalOrgId && envelope.openWebuiOrgId !== token.externalOrgId)
      )
        gatewayForbidden();
      // Only the token's tenant may select the mapping. No token roles enter principal().
      const mapping = await this.resolveUserMapping(ctx, { tenantId: token.tenantId }, envelope);
      const meta = this.metaForMapping(ctx, { tenantId: token.tenantId }, mapping);
      const p = principal({ meta }, ctx.params);
      // Persist before executing the delegated operation; an audit failure fails closed.
      await this.identityDb.put({
        _id: `gateway-delegation:${crypto.randomUUID()}`,
        type: 'workbench_gateway_delegation',
        tokenId: token.id,
        client: token.client,
        externalUserId: envelope.openWebuiUserId || null,
        cetActorId: mapping.cetActorId,
        tenantId: token.tenantId,
        createdAt: new Date().toISOString(),
      });
      return { p, mapping };
    },
    metaForMapping(ctx, p, mapping) {
      if (ctx.meta.apiToken?.type === 'gateway') {
        // Replace the transport principal entirely, including scopes/groups/global meta roles.
        return {
          tenantId: p.tenantId,
          workbenchMappedActor: mapping.cetActorId,
          sharedServiceNoticesStructured: ctx.meta.sharedServiceNoticesStructured,
          sharedServiceNoticesDefer: ctx.meta.sharedServiceNoticesDefer,
          authUser: {
            authType: 'workbench-mapping',
            // Mapped people can perform contextual reads; never inherit transport full-access.
            scope: 'read-only',
            tenantId: p.tenantId,
            id: mapping.cetActorId,
            userId: mapping.cetActorId,
            roles: mapping.roles || [],
            sensitivityFlags: mapping.sensitivityClearance || [],
          },
          apiToken: {
            type: 'delegated-person',
            tenantId: p.tenantId,
            id: mapping.cetActorId,
            userId: mapping.cetActorId,
            roles: mapping.roles || [],
            scopes: [],
            sensitivityFlags: mapping.sensitivityClearance || [],
          },
        };
      }
      return {
        ...ctx.meta,
        ...(mapping
          ? {
              workbenchMappedActor: mapping.cetActorId,
              ...(ctx.meta.authUser
                ? {
                    authUser: {
                      ...ctx.meta.authUser,
                      userId: mapping.cetActorId,
                      id: mapping.cetActorId,
                      roles: mapping.roles?.length ? mapping.roles : p.roles,
                      sensitivityFlags: mapping.sensitivityClearance || [],
                    },
                  }
                : {}),
            }
          : {}),
        apiToken: {
          ...(ctx.meta?.apiToken || {}),
          tenantId: p.tenantId,
          id: mapping?.cetActorId || p.actorId,
          ...(mapping ? { userId: mapping.cetActorId, tokenId: mapping.cetActorId } : {}),
          roles: mapping?.roles?.length ? mapping.roles : p.roles,
          sensitivityFlags: mapping?.sensitivityClearance || p.clearance || [],
        },
      };
    },
    async resolveUserMapping(ctx, p, envelope) {
      this.assertCompleteOpenWebUiIdentity(envelope);
      if ((!envelope.openWebuiUserId && !envelope.openWebuiUserEmail) || !envelope.openWebuiOrgId)
        return null;
      const tenantMapping = await this.store.getTenantMapping(
        {
          client: envelope.channel,
          externalOrgId: envelope.openWebuiOrgId,
        },
        { optional: true }
      );
      if (!tenantMapping) {
        throw new Errors.MoleculerClientError(
          'Für diese Organisation ist noch kein Zugang eingerichtet. Bitte wenden Sie sich an Ihre Administration.',
          403,
          'WORKBENCH_TENANT_MAPPING_REQUIRED'
        );
      }
      if (tenantMapping.cetTenantId !== p.tenantId) deny('Workbench tenant mapping mismatch');
      let mapping = envelope.openWebuiUserId
        ? await this.store.getUserMapping(
            {
              client: envelope.channel,
              externalOrgId: envelope.openWebuiOrgId,
              externalUserId: envelope.openWebuiUserId,
            },
            { optional: true }
          )
        : null;
      if (!mapping && ctx.meta.apiToken?.type === 'gateway' && envelope.openWebuiUserEmail) {
        mapping = await this.store.getUserMappingByEmail({
          client: envelope.channel,
          externalOrgId: envelope.openWebuiOrgId,
          externalUserEmail: envelope.openWebuiUserEmail,
        });
      }
      if (!mapping) {
        throw new Errors.MoleculerClientError(
          'Für diesen Nutzer ist noch kein Zugang eingerichtet. Bitte wenden Sie sich an Ihre Administration.',
          403,
          'WORKBENCH_MAPPING_REQUIRED'
        );
      }
      if (mapping.cetTenantId !== p.tenantId) deny('Workbench tenant mapping mismatch');
      return mapping;
    },
    assertCompleteOpenWebUiIdentity(input = {}) {
      const hasUser = !!input.openWebuiUserId || !!input.openWebuiUserEmail;
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
        workbenchContext: input.workbenchContext,
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
      const existing =
        (await this.store.getInboxTask({ tenantId: p.tenantId, taskId }, { optional: true })) ||
        (await this.materializeInboxTask(p, taskId));
      const router = this.broker.getLocalService('domain-router');
      await router.loadCase(p, existing.caseId || existing.cetCaseId);
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
    async materializeInboxTask(p, taskId) {
      const service = this.broker.getLocalService('domain-router');
      if (!service) {
        throw new Errors.MoleculerClientError(
          'Inbox task not found',
          404,
          'WORKBENCH_INBOX_TASK_NOT_FOUND'
        );
      }
      const eventId = String(taskId || '').replace(/^task_/, '');
      const states = new Map(
        (await this.visibleDomainStates(p))
          .filter((state) => rawContentAllowed(p, state))
          .map((state) => [state.cetCaseId, state])
      );
      for (const { doc } of (await service.eventsDb.allDocs({ include_docs: true })).rows) {
        if (doc.tenantId !== p.tenantId || doc.eventId !== eventId || !states.has(doc.cetCaseId))
          continue;
        if (!['pending', 'delivered'].includes(doc.deliveryState)) break;
        const state = states.get(doc.cetCaseId);
        if (state.actorId !== p.actorId) await service.auditCaseAccess(p, state);
        const task = taskFromEvent(doc, { domain: state.currentDomain });
        return this.store.saveInboxTask({ ...task, tenantId: p.tenantId });
      }
      throw new Errors.MoleculerClientError(
        'Inbox task not found',
        404,
        'WORKBENCH_INBOX_TASK_NOT_FOUND'
      );
    },
    async deriveInboxTasksForCases(p, caseIds = []) {
      const tasks = await this.projectInboxTasksForCases(p, caseIds);
      return Promise.all(
        tasks
          .filter((task) => !task.persisted)
          .map((task) => this.store.saveInboxTask({ ...task, tenantId: p.tenantId }))
      );
    },
    async projectInboxTasksForCases(p, caseIds = [], { caseId = null, status = null } = {}) {
      const allowed = new Set(caseIds.filter(Boolean));
      const states = new Map(
        (await this.visibleDomainStates(p))
          .filter((state) => rawContentAllowed(p, state))
          .map((state) => [state.cetCaseId, state])
      );
      const persisted = await this.store.listInboxTasks({ tenantId: p.tenantId, caseId, status });
      const byTaskId = new Map(
        persisted
          .filter(
            (task) =>
              states.has(task.caseId || task.cetCaseId) &&
              (!caseIds.length || allowed.has(task.caseId || task.cetCaseId))
          )
          .map((task) => [task.taskId, { ...task, persisted: true }])
      );
      const service = this.broker.getLocalService('domain-router');
      if (service && allowed.size) {
        const rows = await service.eventsDb.allDocs({ include_docs: true });
        for (const { doc } of rows.rows) {
          if (
            doc.tenantId !== p.tenantId ||
            !allowed.has(doc.cetCaseId) ||
            !states.has(doc.cetCaseId)
          )
            continue;
          if (!['pending', 'delivered'].includes(doc.deliveryState)) continue;
          const existing = byTaskId.get(`task_${doc.eventId}`);
          if (existing && ['resolved', 'dismissed'].includes(existing.status)) continue;
          const projected = taskFromEvent(doc, {
            domain: states.get(doc.cetCaseId)?.currentDomain,
            existing,
          });
          byTaskId.set(projected.taskId, {
            ...projected,
            tenantId: p.tenantId,
            persisted: !!existing,
          });
        }
      }
      const result = [...byTaskId.values()].filter((task) => !status || task.status === status);
      for (const caseId of new Set(result.map((task) => task.caseId || task.cetCaseId))) {
        const state = states.get(caseId);
        if (state?.actorId !== p.actorId) await service.auditCaseAccess(p, state);
      }
      return result.sort((a, b) =>
        String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))
      );
    },
    async taskSummaries(p, caseIds = []) {
      const summaries = new Map(caseIds.map((caseId) => [caseId, this.emptyTaskSummary()]));
      const allowed = new Set(caseIds);
      const tasks = await this.projectInboxTasksForCases(p, caseIds);
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
        uncertain: result.uncertain === true,
        selectedCapabilities: result.selectedCapabilities || [],
        ...(result.uncertain ? { state: 'capability_clarification_required' } : {}),
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
