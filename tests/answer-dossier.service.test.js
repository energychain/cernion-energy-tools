'use strict';

const path = require('path');
const PersonalAgentService = require('../services/personal-agent.service');

// ── Shared helpers ───────────────────────────────────────────────────────────

function buildServiceHarness() {
  return {
    ...PersonalAgentService.methods,
    logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
  };
}

/**
 * Builds a minimal ctx mock. All tests run the handler directly (no HTTP layer),
 * so we include a default authUser to pass the auth guard.
 * Tests for the auth guard explicitly omit authUser/apiToken/cernionToken.
 */
function buildCtx(params, overrides = {}, meta = { tenantId: 'test-tenant', authUser: { authType: 'test', userId: 'test-user' } }) {
  return {
    meta,
    params,
    call: jest.fn(async (action, callParams) => {
      if (overrides[action] !== undefined) {
        return typeof overrides[action] === 'function'
          ? overrides[action](callParams)
          : overrides[action];
      }
      if (action === 'object-store.get') return null;
      if (action === 'object-store.put') return { ok: true };
      if (action === 'object-store.query') return { docs: [] };
      if (action === 'query.search') return { results: [], totalResults: 0 };
      if (action === 'knowledge-rag.query') return { success: true, data: { results: [] } };
      if (action === 'datapoint.list') return { datapoints: [] };
      return {};
    }),
  };
}

const handler = PersonalAgentService.actions.answerDossier.handler;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('answerDossier action', () => {

  // 1. Renderer package and mandatory sections present
  test('dossierMarkdown is a renderer package and contains all mandatory dossier headings', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Was ist der aktuelle Status?' });

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.dossierMarkdown).toMatch(/^# CERNION RENDERER PACKAGE/);
    expect(result.dossierMarkdown).toContain('## Systemhinweis');
    expect(result.dossierMarkdown).toContain('## Aufgabe');
    expect(result.dossierMarkdown).toContain('## Cernion Answer Dossier');
    expect(result.dossierMarkdown).toContain('# CERNION ANSWER DOSSIER');
    expect(result.dossierMarkdown).toContain('## Metadata');
    expect(result.dossierMarkdown).toContain('## Original User Prompt');
    expect(result.dossierMarkdown).toContain('## Current Conversation State');
    expect(result.dossierMarkdown).toContain('## Required Answer Behavior');
    expect(result.dossierMarkdown).toContain('## Known Evidence');
    expect(result.dossierMarkdown).toContain('## Missing Evidence');
    expect(result.dossierMarkdown).toContain('## Reasoning Summary');
    expect(result.dossierMarkdown).toContain('## Forbidden Claims');
    expect(result.dossierMarkdown).toContain('## Recommended Answer Structure');
    expect(result.dossierMarkdown).toContain('## Final Renderer Instruction');
    expect(result.dossierMarkdown).toContain('Fuege keine Fakten, Gesetze, Quellen, Beispiele, Bewertungen oder Prozessentscheidungen hinzu');
  });

  // 2. Final Renderer Instruction contains original prompt verbatim
  test('Final Renderer Instruction contains original question verbatim', async () => {
    const service = buildServiceHarness();
    const question = 'Meine spezifische Frage über Netzplanung XYZ-789';
    const ctx = buildCtx({ question });

    const result = await handler.call(service, ctx);

    const finalInstructionIdx = result.dossierMarkdown.indexOf('## Final Renderer Instruction');
    const questionIdx = result.dossierMarkdown.lastIndexOf(question);
    expect(finalInstructionIdx).toBeGreaterThan(-1);
    expect(questionIdx).toBeGreaterThan(finalInstructionIdx);
  });

  test('renderer package contains original question before the embedded dossier', async () => {
    const service = buildServiceHarness();
    const question = 'Kann ich Strom an meinen Nachbarn verkaufen?';
    const ctx = buildCtx({ question });

    const result = await handler.call(service, ctx);

    const packageQuestionIdx = result.dossierMarkdown.indexOf(`"${question}"`);
    const embeddedDossierIdx = result.dossierMarkdown.indexOf('## Cernion Answer Dossier');
    expect(packageQuestionIdx).toBeGreaterThan(-1);
    expect(embeddedDossierIdx).toBeGreaterThan(packageQuestionIdx);
  });

  test('knowledgeSpace exposes authenticated tenant, session and renderer channel context', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({
      question: 'Wie ist der Zustand meiner Netzassets?',
      sessionId: 'session-assets-001',
      context: {
        tenantId: 'test-tenant',
        conversationId: 'conversation-assets-001',
        channel: 'n8n',
        surface: 'external-renderer',
      },
    });

    const result = await handler.call(service, ctx);

    expect(result.knowledgeSpace).toMatchObject({
      tenantId: 'test-tenant',
      requestedTenantId: 'test-tenant',
      tenantScopeStatus: 'context_tenant_matches_auth_tenant',
      sessionId: 'session-assets-001',
      conversationId: 'conversation-assets-001',
      channel: 'n8n',
      surface: 'external-renderer',
    });
    expect(result.dossierMarkdown).toContain('- tenant_id: test-tenant');
    expect(result.dossierMarkdown).toContain('- requested_context_tenant_id: test-tenant');
    expect(result.dossierMarkdown).toContain('- tenant_scope_status: context_tenant_matches_auth_tenant');
    expect(result.dossierMarkdown).toContain('- conversation_id: conversation-assets-001');
    expect(result.dossierMarkdown).toContain('- channel: n8n');
    expect(result.dossierMarkdown).toContain('- surface: external-renderer');
  });

  test('context tenant hint is ignored when it differs from authenticated tenant', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({
      question: 'Bitte ein Dossier fuer Anschlussbegehren erstellen',
      sessionId: 'session-grid-connection-001',
      context: {
        tenantId: 'other-tenant',
        conversationId: 'conversation-grid-connection-001',
        channel: 'n8n',
        surface: 'external-renderer',
      },
    });

    const result = await handler.call(service, ctx);

    expect(result.knowledgeSpace).toMatchObject({
      tenantId: 'test-tenant',
      requestedTenantId: 'other-tenant',
      tenantScopeStatus: 'context_tenant_ignored_auth_tenant_used',
      sessionId: 'session-grid-connection-001',
      conversationId: 'conversation-grid-connection-001',
    });
    expect(service.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('context.tenantId (other-tenant) differs from authenticated tenantId (test-tenant)')
    );
    expect(result.dossierMarkdown).toContain('- tenant_id: test-tenant');
    expect(result.dossierMarkdown).toContain('- requested_context_tenant_id: other-tenant');
    expect(result.dossierMarkdown).toContain('- tenant_scope_status: context_tenant_ignored_auth_tenant_used');
  });

  // 3. Time budget defaults applied
  test('timeBudget.totalBudgetMs defaults to 30000 when timeBudgetMs is omitted', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Standard-Zeitbudget Test' });

    const result = await handler.call(service, ctx);

    expect(result.timeBudget.totalBudgetMs).toBe(30000);
  });

  // 4. Compilation runs with small budget
  test('dossierMarkdown is present and contains Final Renderer Instruction with small timeBudgetMs', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Kleines Zeitbudget Test', timeBudgetMs: 6000 });

    const result = await handler.call(service, ctx);

    expect(result.dossierMarkdown).toBeTruthy();
    expect(result.dossierMarkdown.length).toBeGreaterThan(50);
    expect(result.dossierMarkdown).toContain('# CERNION RENDERER PACKAGE');
    expect(result.dossierMarkdown).toContain('## Final Renderer Instruction');
  });

  // 5. Unknown context → clarification_needed, context_clarification processStage
  test('unknown question → answerMode=clarification_needed, userContext=unknown, processStage=context_clarification', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Was ist das?' });

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('clarification_needed');
    expect(result.userContext).toBe('unknown');
    expect(result.processStage).toBe('context_clarification');
  });

  // 6. target_grid_planning → evidence_collection answerMode AND processStage
  test('Zielnetzplanung question → answerMode=evidence_collection, userContext=target_grid_planning, processStage=evidence_collection', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Was ist der Status der Zielnetzplanung?' });

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('evidence_collection');
    expect(result.userContext).toBe('target_grid_planning');
    expect(result.processStage).toBe('evidence_collection');
  });

  test('Projektentwickler data-center feasibility question → technical_operator evidence collection', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({
      question:
        'Können wir in 69256 Mauer ein Rechenzentrum bauen, das 10 MW Strom benötigt? Wir sind Projektentwickler und prüfen Netzanschluss und Standortmachbarkeit.',
    });

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('evidence_collection');
    expect(result.userContext).toBe('technical_operator');
    expect(result.processStage).toBe('evidence_collection');
    expect(result.dossierMarkdown).toContain('Bei leerer Evidence keine Beispiele, Paragraphen, Behörden, Netzbetreiber, Fristen oder typischen Verfahren nennen.');
  });

  // 7. Management context → management_brief
  test('Bürgermeister-Überblick question → answerMode=management_brief, userContext=mayor', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Bürgermeister-Überblick: wie ist der aktuelle Stand?' });

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('management_brief');
    expect(result.userContext).toBe('mayor');
  });

  // 8. Process action → prepare_intent
  test('Process action question → answerMode=prepare_intent, userContext=process_action, processStage=intent_prepared', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Bitte den Redispatch-Prozess einleiten' });

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('prepare_intent');
    expect(result.userContext).toBe('process_action');
    expect(result.processStage).toBe('intent_prepared');
  });

  // 9. timeoutWarning emitted when timeBudgetMs >= 25000
  test('timeoutWarning is a non-empty string when timeBudgetMs >= 25000 (default 30000)', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Timeout Warning Test' });

    const result = await handler.call(service, ctx);

    expect(typeof result.timeoutWarning).toBe('string');
    expect(result.timeoutWarning.length).toBeGreaterThan(0);
  });

  // 10. dossierVersion, parentDossierId, latestDossierId are first-class response fields
  test('dossierVersion, parentDossierId, latestDossierId are present as first-class fields', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Test first-class version fields' });

    const result = await handler.call(service, ctx);

    expect(typeof result.dossierVersion).toBe('number');
    expect(result.dossierVersion).toBe(1);
    expect(result).toHaveProperty('parentDossierId');
    expect(result).toHaveProperty('latestDossierId');
    expect(result.latestDossierId).toBe(result.dossierId);
  });

  // 11. followUp is null for completed dossiers, present for partial
  test('followUp is null when completionState=completed', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Normales Dossier ohne Timeout' });

    const result = await handler.call(service, ctx);

    // With no actual evidence calls failing, completionState should be completed
    expect(result.completionState).toBe('completed');
    expect(result.followUp).toBeNull();
  });

  // 12. followUp metadata appears for partial dossiers (simulated timeout)
  test('followUp metadata present when completionState=partial', async () => {
    const service = buildServiceHarness();
    // Simulate knowledge RAG returning timeout status
    const ctx = buildCtx(
      { question: 'Evidence Timeout Test' },
      {
        'knowledge-rag.query': async () => {
          throw new Error('timeout');
        },
      }
    );

    // Force partial by making knowledge evidence throw; handler catches and sets partial
    // We need to also make it fall into the partial path by overriding collectCopilotKnowledgeEvidence
    const service2 = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return { status: 'timeout', hits: [] };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx2 = buildCtx({ question: 'Evidence Timeout Test' });
    const result = await handler.call(service2, ctx2);

    expect(result.dossierMarkdown).toBeTruthy();
    expect(result.dossierMarkdown).toContain('## Final Renderer Instruction');
    expect(result.completionState).toBe('partial');
    expect(result.followUp).not.toBeNull();
    expect(result.followUp.available).toBe(true);
    expect(typeof result.followUp.pollAfterMs).toBe('number');
    expect(result.followUp.query.mode).toBe('answer_dossier_followup');
    expect(result.followUp.query.sessionId).toBe(result.sessionId);
  });

  test('follow-up data-center dossier filters irrelevant generic regulatory evidence', async () => {
    const sessionId = 'test-session-datacenter-evidence-filter';
    const priorDossierState = {
      processStage: 'evidence_collection',
      userContext: 'technical_operator',
      answerMode: 'evidence_collection',
      confidence: 'low',
      knownEvidence: [],
      missingEvidence: [],
      lastDossierId: 'prior-dossier-id',
      lastUpdatedAt: new Date().toISOString(),
    };
    const priorDossierTurns = [
      {
        dossierId: 'prior-dossier-id',
        parentDossierId: null,
        dossierVersion: 1,
        question:
          'Können wir in 69256 Mauer ein Rechenzentrum bauen, das 10 MW Strom benötigt? Wir sind Projektentwickler und prüfen Netzanschluss.',
        processStage: 'evidence_collection',
        userContext: 'technical_operator',
        answerMode: 'evidence_collection',
        confidence: 'low',
        completionState: 'completed',
        createdAt: new Date().toISOString(),
      },
    ];
    const service = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return {
          status: 'available',
          hits: [
            {
              source: 'BNetzA',
              value:
                'Antwort auf Bestellung spaetestens am 2. Werktag. Eigenkapitalzinssatz fuer Neuanlagen 4,23%.',
            },
          ],
        };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx = buildCtx(
      {
        question:
          'Bitte konkretisiere im zweiten Schritt nur, welche Daten wir fuer eine belastbare Netzanschlusspruefung erheben muessen.',
        sessionId,
      },
      {
        'object-store.get': (p) => {
          if (p && p.key === sessionId) {
            return { payload: { dossier: { state: priorDossierState, turns: priorDossierTurns } } };
          }
          return null;
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.userContext).toBe('technical_operator');
    expect(result.confidence).toBe('low');
    expect(result.dossierMarkdown).toContain('## Known Evidence\n_Keine Evidence verfügbar._');
    expect(result.dossierMarkdown).toContain('Cernion-Kontext: Keine direkten Treffer gefunden');
  });

  // 13. Two-turn session continuity: processStage advances to evidence_collection
  test('two-turn: turn 2 Zielnetzplanung → userContext=target_grid_planning, processStage=evidence_collection, dossierVersion=2', async () => {
    const service = buildServiceHarness();
    const sessionId = 'test-session-continuity-v2';

    // Turn 1 — unknown question
    const ctx1 = buildCtx({ question: 'Ich habe eine allgemeine Frage', sessionId });
    const result1 = await handler.call(service, ctx1);

    expect(result1.userContext).toBe('unknown');
    expect(result1.processStage).toBe('context_clarification');
    expect(result1.dossierVersion).toBe(1);

    // Build prior session state from turn 1 result
    const savedDossierState = {
      processStage: result1.processStage,
      userContext: result1.userContext,
      answerMode: result1.answerMode,
      confidence: result1.confidence,
      knownEvidence: [],
      missingEvidence: [],
      lastDossierId: result1.dossierId,
      lastUpdatedAt: new Date().toISOString(),
    };
    const savedDossierTurns = [
      {
        dossierId: result1.dossierId,
        parentDossierId: null,
        dossierVersion: 1,
        question: 'Ich habe eine allgemeine Frage',
        processStage: result1.processStage,
        userContext: result1.userContext,
        answerMode: result1.answerMode,
        confidence: result1.confidence,
        completionState: result1.completionState,
        createdAt: new Date().toISOString(),
      },
    ];

    // Turn 2 — Zielnetzplanung, same sessionId, prior session state injected
    const ctx2 = buildCtx(
      { question: 'Es geht um Zielnetzplanung', sessionId },
      {
        'object-store.get': (p) => {
          if (p && p.key === sessionId) {
            return { payload: { dossier: { state: savedDossierState, turns: savedDossierTurns } } };
          }
          return null;
        },
      }
    );
    const result2 = await handler.call(service, ctx2);

    expect(result2.userContext).toBe('target_grid_planning');
    expect(result2.answerMode).toBe('evidence_collection');
    expect(result2.processStage).toBe('evidence_collection');
    expect(result2.dossierVersion).toBe(2);
    expect(result2.auditTrail.version).toBe(2);
  });

  // 14. Auth guard — unauthenticated call throws AUTH_REQUIRED
  test('call without authUser/apiToken/cernionToken throws AUTH_REQUIRED (401)', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'Unauthenticated test' },
      {},
      { tenantId: null } // no auth signals
    );
    // Explicitly remove all auth signals
    delete ctx.meta.authUser;
    delete ctx.meta.apiToken;
    delete ctx.meta.cernionToken;

    await expect(handler.call(service, ctx)).rejects.toMatchObject({ code: 401, type: 'AUTH_REQUIRED' });
  });

  // 15. openapi-copilot.json does not expose answer-dossier
  test('openapi-copilot.json does not contain answer-dossier path', () => {
    const copilotPath = path.join(__dirname, '..', 'openapi-copilot.json');
    let copilotSpec;
    try {
      copilotSpec = require(copilotPath);
    } catch (_e) {
      // File may not exist in all environments — skip if missing
      return;
    }
    const specStr = JSON.stringify(copilotSpec);
    expect(specStr).not.toContain('answer-dossier');
    expect(specStr).not.toContain('answerDossier');
  });

});
