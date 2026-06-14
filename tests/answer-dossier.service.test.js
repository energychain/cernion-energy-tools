'use strict';

const PersonalAgentService = require('../services/personal-agent.service');

// ── Shared helpers ───────────────────────────────────────────────────────────

function buildServiceHarness() {
  return {
    ...PersonalAgentService.methods,
  };
}

/**
 * Build a minimal ctx mock that stubs out all object-store / search / knowledge-rag calls
 * so the answerDossier handler runs deterministically without PouchDB or network access.
 *
 * @param {object} [overrides] - Optional per-action response overrides keyed by action name
 * @param {object} [meta]      - Optional ctx.meta fields
 */
function buildCtx(params, overrides = {}, meta = { tenantId: 'test-tenant' }) {
  return {
    meta,
    params,
    call: jest.fn(async (action, callParams) => {
      if (overrides[action] !== undefined) {
        return typeof overrides[action] === 'function'
          ? overrides[action](callParams)
          : overrides[action];
      }
      // Default stubs — no real data, avoids PouchDB / network
      if (action === 'object-store.get') return null;
      if (action === 'object-store.put') return { ok: true };
      if (action === 'object-store.query') return { docs: [] };
      if (action === 'query.search') return { results: [], totalResults: 0 };
      if (action === 'knowledge-rag.query') return { success: true, data: { results: [] } };
      if (action === 'datapoint.list') return { datapoints: [] };
      // Any other action → safely return empty
      return {};
    }),
  };
}

const handler = PersonalAgentService.actions.answerDossier.handler;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('answerDossier action', () => {
  // 1. Mandatory sections present
  test('dossierMarkdown contains all 11 mandatory heading strings', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Was ist der aktuelle Status?' });

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
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
  });

  // 2. Final Renderer Instruction contains original prompt verbatim
  test('Final Renderer Instruction contains original question verbatim', async () => {
    const service = buildServiceHarness();
    const question = 'Meine spezifische Frage über Netzplanung XYZ-789';
    const ctx = buildCtx({ question });

    const result = await handler.call(service, ctx);

    expect(result.dossierMarkdown).toContain(question);
    // Ensure it appears in the Final Renderer Instruction section
    const finalInstructionIdx = result.dossierMarkdown.indexOf('## Final Renderer Instruction');
    const questionIdx = result.dossierMarkdown.lastIndexOf(question);
    expect(finalInstructionIdx).toBeGreaterThan(-1);
    expect(questionIdx).toBeGreaterThan(finalInstructionIdx);
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
    expect(result.dossierMarkdown).toContain('## Final Renderer Instruction');
  });

  // 5. Unknown context → clarification_needed
  test('unknown question → answerMode=clarification_needed and userContext=unknown', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Was ist das?' });

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('clarification_needed');
    expect(result.userContext).toBe('unknown');
  });

  // 6. target_grid_planning → evidence_collection
  test('Zielnetzplanung question → answerMode=evidence_collection and userContext=target_grid_planning', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Was ist der Status der Zielnetzplanung?' });

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('evidence_collection');
    expect(result.userContext).toBe('target_grid_planning');
  });

  // 7. Management context → management_brief
  test('Bürgermeister-Überblick question → answerMode=management_brief', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Bürgermeister-Überblick: wie ist der aktuelle Stand?' });

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('management_brief');
    expect(result.userContext).toBe('management');
  });

  // 8. Process action → prepare_intent
  test('Process action question → answerMode=prepare_intent', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Bitte den Redispatch-Prozess einleiten' });

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('prepare_intent');
    expect(result.userContext).toBe('process_action');
  });

  // 9. timeoutWarning emitted when timeBudgetMs >= 25000
  test('timeoutWarning is a non-empty string when timeBudgetMs >= 25000 (default 30000)', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx({ question: 'Timeout Warning Test' });

    const result = await handler.call(service, ctx);

    expect(typeof result.timeoutWarning).toBe('string');
    expect(result.timeoutWarning.length).toBeGreaterThan(0);
  });

  // 10. Two-turn session continuity
  test('two-turn session: second turn with target_grid_planning context persists userContext', async () => {
    const service = buildServiceHarness();
    const sessionId = 'test-session-continuity';

    // Turn 1 — unknown question
    const ctx1 = buildCtx(
      { question: 'Ich habe eine allgemeine Frage', sessionId },
      {},
      { tenantId: 'test-tenant' }
    );
    const result1 = await handler.call(service, ctx1);

    expect(result1.userContext).toBe('unknown');
    expect(result1.auditTrail.version).toBe(1);

    // Simulate session persistence: capture what was written in turn 1
    // The handler calls object-store.get (to read) then persistSession which calls object-store.put
    // We reconstruct the dossier session state from result1 to inject as prior state in turn 2
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
        version: 1,
        question: 'Ich habe eine allgemeine Frage',
        processStage: result1.processStage,
        userContext: result1.userContext,
        answerMode: result1.answerMode,
        confidence: result1.confidence,
        completionState: result1.completionState,
        createdAt: new Date().toISOString(),
      },
    ];

    // Turn 2 — Zielnetzplanung question in same session; mock object-store to return prior state
    const ctx2 = buildCtx(
      { question: 'Es geht um Zielnetzplanung', sessionId },
      {
        'object-store.get': (p) => {
          if (p && p.key === sessionId) {
            return {
              payload: {
                dossier: {
                  state: savedDossierState,
                  turns: savedDossierTurns,
                },
              },
            };
          }
          return null;
        },
      },
      { tenantId: 'test-tenant' }
    );

    const result2 = await handler.call(service, ctx2);

    expect(result2.userContext).toBe('target_grid_planning');
    expect(result2.auditTrail.version).toBe(2);
  });
});
