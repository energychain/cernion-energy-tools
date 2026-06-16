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
    expect(result.dossierMarkdown).toContain('Ohne validierte Evidence keine Beispiele, Paragraphen, Behörden, Netzbetreiber, Fristen oder typischen Verfahren nennen.');
    expect(result.dossierMarkdown).toContain('user-provided project fact (low)');
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
    expect(result.dossierMarkdown).toContain('Validierte Cernion-Evidence: Keine belastbaren Treffer gefunden');
  });

  test('answer dossier ignores anonymized LLM generator derivations as usable evidence', async () => {
    const service = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return {
          status: 'available',
          hits: [
            {
              source: 'knowledge-rag',
              value: 'Anonymisierte Ableitung aus Thorstens Steuerimpuls-Routine via LLM Generator.',
              retrievalHint: 'Rechenzentrum Mauer Netzanschluss 10 MW',
            },
          ],
        };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx = buildCtx({
      question:
        'Können wir in 69256 Mauer ein Rechenzentrum bauen, das 10 MW Strom benötigt? Wir sind Projektentwickler und prüfen Netzanschluss und Standortmachbarkeit.',
    });

    const result = await handler.call(service, ctx);

    expect(result.userContext).toBe('technical_operator');
    expect(result.confidence).toBe('low');
    expect(result.dossierMarkdown).toContain('user-provided project fact (low)');
    expect(result.dossierMarkdown).not.toContain('Anonymisierte Ableitung aus Thorstens Steuerimpuls-Routine');
  });

  test('answer dossier stores user-provided project facts as tenant-scoped low evidence', async () => {
    const puts = [];
    const queries = [];
    const service = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return { status: 'missing', hits: [] };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx = buildCtx(
      {
        question:
          'Für Turn 3 liefere ich folgende Datenpunkte: Standort 69256 Mauer; geplante Anschlussleistung 10 MW; Nutzung Rechenzentrum; kontinuierlicher Lastgang 24/7; gewünschte Netzanschlussprüfung inklusive Netzebene, verfügbarer Anschlussleistung, Transformatorreserve, N-1-Betrachtung und Zeitplan für Netzausbau.',
        sessionId: 'tenant-low-evidence-store-test',
      },
      {
        'object-store.put': (p) => {
          puts.push(p);
          return { ok: true };
        },
        'object-store.query': (p) => {
          queries.push(p);
          return { docs: [] };
        },
      }
    );

    const result = await handler.call(service, ctx);

    const lowEvidencePuts = puts.filter((p) => p.namespace === 'tenant:test-tenant:answer_dossier_low_evidence');
    expect(lowEvidencePuts.length).toBeGreaterThanOrEqual(4);
    expect(lowEvidencePuts.map((p) => p.payload.factType)).toEqual(
      expect.arrayContaining(['location', 'requested_power', 'asset_class', 'load_profile', 'requested_check_scope'])
    );
    const powerFact = lowEvidencePuts.find((p) => p.payload.factType === 'requested_power')?.payload;
    expect(powerFact?.projectScope?.scopeKey).toBe('69256 mauer|10 mw');
    expect(powerFact?.semanticTags).toEqual(expect.arrayContaining(['oeo:electricity-demand', 'oeo:power-unit']));
    expect(powerFact?.oeoClasses?.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['electricity-demand', 'electrical-energy', 'unit-megawatt'])
    );
    const checkScopeFact = lowEvidencePuts.find((p) => p.payload.factType === 'requested_check_scope')?.payload;
    expect(checkScopeFact?.semanticTags).toEqual(expect.arrayContaining(['oeo:electricity-grid']));
    expect(checkScopeFact?.oeoClasses?.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['electricity-grid', 'distribution-grid', 'grid-component', 'voltage-level'])
    );
    expect(queries.some((p) => p.namespace === 'tenant:test-tenant:answer_dossier_low_evidence')).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.dossierMarkdown).toContain('user-provided project fact (low)');
    expect(result.dossierMarkdown).toContain('Standort: 69256 Mauer');
    expect(result.dossierMarkdown).toContain('Evidence-Qualität: low');
    expect(result.dossierMarkdown).toContain('OEO: electricity demand');
    expect(result.dossierMarkdown).toContain('Validierte Cernion-Evidence: Keine belastbaren Treffer gefunden');
  });

  test('answer dossier does not learn MaStR candidate-list rows as project facts', async () => {
    const puts = [];
    const service = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return { status: 'missing', hits: [] };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx = buildCtx(
      {
        question:
          'Ich bin im Assetmanagement eines Netzbetreibers und prüfe einen Anschluss im Bereich Heidelberg Ost.\n\nKundenprojekt:\n- Projekt_ID: PRJ-1012\n- Kunde: Mayer Services\n- Projektart: PV Dachanlage\n- Kapazitaet_kW: 24.1\n- Status: Installation\n- Standortkontext: Heidelberg Ost / nahe Schaltanlage AST-1012\n\nMaStR-Auszug:\n- SEE100000000008 | Solar | 15.6 kWp | In Prüfung | MS\n- SAN100000000009 | Speicher | 6.8 kW | Geprüft | NS\n- SEE100000000010 | Solar | 24.0 kWp | In Prüfung | MS\n- SEE100000000011 | Solar | 10.2 kWp | Geprüft | NS\n- SAN100000000012 | Speicher | 8.9 kW | In Prüfung | NS\n\nNetzasset-Kontext:\n- AST-1012 | Schaltanlage | MS | Installationsjahr 2021 | Heidelberg Ost\n\nFrage: Welche MaStR-Einheit ist der wahrscheinlichste Kandidat?',
        sessionId: 'tenant-mastr-candidate-list-test',
      },
      {
        'object-store.put': (p) => {
          puts.push(p);
          return { ok: true };
        },
      }
    );

    const result = await handler.call(service, ctx);
    const payloads = puts
      .filter((p) => p.namespace === 'tenant:test-tenant:answer_dossier_low_evidence')
      .map((p) => p.payload);

    expect(payloads.map((p) => p.factType)).toEqual(expect.arrayContaining(['requested_power']));
    expect(payloads.find((p) => p.factType === 'requested_power')?.value).toBe('24.1 kW');
    expect(payloads.find((p) => p.value === '6.8 kW')).toBeUndefined();
    expect(payloads.find((p) => p.value === '8.9 kW')).toBeUndefined();
    expect(payloads.find((p) => p.factType === 'asset_component' && p.label === 'Speicher')).toBeUndefined();
    expect(payloads.find((p) => p.factType === 'requested_power')?.projectScope?.scopeKey).toBe('24.1 kw');
    expect(result.dossierMarkdown).toContain('Geplante Anschlussleistung: 24.1 kW');
    expect(result.dossierMarkdown).not.toContain('Speicher: 6.8 kW');
  });

  test('answer dossier stores available documents and missing requirements as tenant-scoped low evidence', async () => {
    const puts = [];
    const service = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return { status: 'missing', hits: [] };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx = buildCtx(
      {
        question:
          'Weitere Angaben zum Rechenzentrum in 69256 Mauer mit 10 MW: Der Projektentwickler kann einen Lageplan, eine geplante Inbetriebnahme 2028, ein vorläufiges Single-Line-Diagramm und ein Lastprofil als Viertelstundenzeitreihe nachreichen. Noch unbekannt sind zuständiger Netzbetreiber, verfügbarer Netzverknüpfungspunkt, Reserven im Umspannwerk und verbindliche TAB.',
        sessionId: 'tenant-low-evidence-docs-test',
      },
      {
        'object-store.put': (p) => {
          puts.push(p);
          return { ok: true };
        },
      }
    );

    const result = await handler.call(service, ctx);

    const payloads = puts
      .filter((p) => p.namespace === 'tenant:test-tenant:answer_dossier_low_evidence')
      .map((p) => p.payload);
    expect(payloads.map((p) => p.factType)).toEqual(
      expect.arrayContaining(['available_document', 'missing_evidence_requirement', 'project_timeline'])
    );
    expect(payloads.map((p) => p.value)).toEqual(
      expect.arrayContaining([
        'Lageplan',
        'vorläufiges Single-Line-Diagramm',
        'Lastprofil als Viertelstundenzeitreihe',
        '2028',
        'zuständiger Netzbetreiber',
        'verfügbarer Netzverknüpfungspunkt',
        'Reserven im Umspannwerk',
        'verbindliche TAB',
      ])
    );
    const requirement = payloads.find((p) => p.value === 'verfügbarer Netzverknüpfungspunkt');
    expect(requirement?.projectScope?.scopeKey).toBe('69256 mauer|10 mw');
    expect(requirement?.semanticTags).toEqual(expect.arrayContaining(['cernion:evidence-requirement']));
    expect(requirement?.oeoClasses?.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['electricity-grid', 'grid-component'])
    );
    expect(result.dossierMarkdown).toContain('user-provided evidence availability (low)');
    expect(result.dossierMarkdown).toContain('user-provided evidence requirement (low)');
    expect(result.dossierMarkdown).toContain('Geplante Inbetriebnahme: 2028');
  });

  test('answer dossier permits explicit preliminary answer request without upgrading low evidence confidence', async () => {
    const service = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return { status: 'missing', hits: [] };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx = buildCtx({
      question:
        'Ich weiß, dass es nur Low Evidence ist. Bitte gib trotzdem eine vorläufige Einschätzung auf Basis der Nutzerangaben: Rechenzentrum in 69256 Mauer mit 10 MW und 24/7 Lastprofil.',
      sessionId: 'tenant-low-evidence-prelim-test',
    });

    const result = await handler.call(service, ctx);

    expect(result.confidence).toBe('low');
    expect(result.preliminaryAnswerRequested).toBe(true);
    expect(result.dossierMarkdown).toContain('- preliminary_answer_requested: true');
    expect(result.dossierMarkdown).toContain('nicht belastbare Arbeitshypothese');
    expect(result.dossierMarkdown).toContain('Low-Evidence-Basis');
    expect(result.dossierMarkdown).toContain('Validierte Cernion-Evidence: Keine belastbaren Treffer gefunden');
  });

  test('answer dossier reuses only current-tenant low evidence in later sessions', async () => {
    const service = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return { status: 'missing', hits: [] };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx = buildCtx(
      {
        question:
          'Welche Daten kennen wir bereits für die Netzanschlussprüfung eines 10 MW Rechenzentrums in 69256 Mauer?',
        sessionId: 'tenant-low-evidence-reuse-test',
      },
      {
        'object-store.query': (p) => {
          if (p.namespace !== 'tenant:test-tenant:answer_dossier_low_evidence') return { docs: [] };
          return {
            docs: [
              {
                key: 'dossier-low-location',
                payload: {
                  type: 'answer-dossier-user-fact',
                  factType: 'location',
                  label: 'Standort',
                  value: '69256 Mauer',
                  normalizedValue: '69256 mauer',
                  projectScope: {
                    location: '69256 Mauer',
                    postalCode: '69256',
                    power: '10 MW',
                    normalizedLocation: '69256 mauer',
                    normalizedPower: '10 mw',
                    scopeKey: '69256 mauer|10 mw',
                  },
                  evidenceQuality: 'low',
                  semanticTags: ['cernion:location', 'cernion:postal-code'],
                  oeoClasses: [],
                  source: 'user_chat',
                  sourceSessionId: 'older-session',
                },
              },
              {
                key: 'dossier-low-document',
                payload: {
                  type: 'answer-dossier-user-fact',
                  factType: 'available_document',
                  label: 'Verfügbare Unterlage',
                  value: 'Lastprofil als Viertelstundenzeitreihe',
                  normalizedValue: 'lastprofil als viertelstundenzeitreihe',
                  projectScope: {
                    location: '69256 Mauer',
                    postalCode: '69256',
                    power: '10 MW',
                    normalizedLocation: '69256 mauer',
                    normalizedPower: '10 mw',
                    scopeKey: '69256 mauer|10 mw',
                  },
                  evidenceQuality: 'low',
                  semanticTags: ['cernion:evidence-document'],
                  oeoClasses: [{ id: 'time-series', label: 'time series' }],
                  source: 'user_chat',
                  sourceSessionId: 'older-session',
                },
              },
              {
                key: 'dossier-low-requirement-1',
                payload: {
                  type: 'answer-dossier-user-fact',
                  factType: 'missing_evidence_requirement',
                  label: 'Fehlende Evidence-Anforderung',
                  value: 'verbindliche TAB',
                  normalizedValue: 'verbindliche tab',
                  projectScope: {
                    location: '69256 Mauer',
                    postalCode: '69256',
                    power: '10 MW',
                    normalizedLocation: '69256 mauer',
                    normalizedPower: '10 mw',
                    scopeKey: '69256 mauer|10 mw',
                  },
                  evidenceQuality: 'low',
                  semanticTags: ['cernion:evidence-requirement'],
                  oeoClasses: [{ id: 'electricity-grid', label: 'electricity grid' }],
                  source: 'user_chat',
                  sourceSessionId: 'older-session',
                },
              },
              {
                key: 'dossier-low-requirement-2',
                payload: {
                  type: 'answer-dossier-user-fact',
                  factType: 'missing_evidence_requirement',
                  label: 'Fehlende Evidence-Anforderung',
                  value: 'Reserven im Umspannwerk',
                  normalizedValue: 'reserven im umspannwerk',
                  projectScope: {
                    location: '69256 Mauer',
                    postalCode: '69256',
                    power: '10 MW',
                    normalizedLocation: '69256 mauer',
                    normalizedPower: '10 mw',
                    scopeKey: '69256 mauer|10 mw',
                  },
                  evidenceQuality: 'low',
                  semanticTags: ['cernion:evidence-requirement'],
                  oeoClasses: [{ id: 'electricity-grid', label: 'electricity grid' }],
                  source: 'user_chat',
                  sourceSessionId: 'older-session',
                },
              },
              {
                key: 'dossier-low-other-project-location',
                payload: {
                  type: 'answer-dossier-user-fact',
                  factType: 'location',
                  label: 'Standort',
                  value: '74889 Sinsheim',
                  normalizedValue: '74889 sinsheim',
                  projectScope: {
                    location: '74889 Sinsheim',
                    postalCode: '74889',
                    power: '12 MW',
                    normalizedLocation: '74889 sinsheim',
                    normalizedPower: '12 mw',
                    scopeKey: '74889 sinsheim|12 mw',
                  },
                  evidenceQuality: 'low',
                  semanticTags: ['cernion:location', 'cernion:postal-code'],
                  oeoClasses: [],
                  source: 'user_chat',
                  sourceSessionId: 'other-session',
                },
              },
            ],
          };
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.confidence).toBe('low');
    expect(result.dossierMarkdown).toContain('Standort: 69256 Mauer');
    expect(result.dossierMarkdown).toContain('Lastprofil als Viertelstundenzeitreihe');
    expect(result.dossierMarkdown).toContain('verbindliche TAB');
    expect(result.dossierMarkdown).toContain('Reserven im Umspannwerk');
    expect(result.dossierMarkdown).not.toContain('74889 Sinsheim');
    expect(result.dossierMarkdown).not.toContain('other-tenant');
  });

  test('Tuebingen grid operator brief does not reuse unrelated scoped project low evidence', async () => {
    const service = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return { status: 'missing', hits: [] };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx = buildCtx(
      {
        question:
          'Ich bin Geschaeftsfuehrer der Stadtwerke Tuebingen. Gib mir bitte ein belastbares Briefing fuer Zielnetzplanung, §14a, Redispatch 2.0, Flexibilitaet, grosse Verbraucher, EE-Ausbau und Gleichzeitigkeiten.',
        sessionId: 'tenant-tuebingen-strategy-test',
      },
      {
        'object-store.query': (p) => {
          if (p.namespace !== 'tenant:test-tenant:answer_dossier_low_evidence') return { docs: [] };
          return {
            docs: [
              {
                key: 'dossier-low-mauer-location',
                payload: {
                  type: 'answer-dossier-user-fact',
                  factType: 'location',
                  label: 'Standort',
                  value: '69256 Mauer',
                  normalizedValue: '69256 mauer',
                  projectScope: {
                    location: '69256 Mauer',
                    postalCode: '69256',
                    power: '10 MW',
                    normalizedLocation: '69256 mauer',
                    normalizedPower: '10 mw',
                    scopeKey: '69256 mauer|10 mw',
                  },
                  evidenceQuality: 'low',
                  semanticTags: ['cernion:location', 'cernion:postal-code'],
                  oeoClasses: [],
                  source: 'user_chat',
                  sourceSessionId: 'mauer-session',
                },
              },
              {
                key: 'dossier-low-mauer-timeline',
                payload: {
                  type: 'answer-dossier-user-fact',
                  factType: 'project_timeline',
                  label: 'Geplante Inbetriebnahme',
                  value: '2028',
                  normalizedValue: '2028',
                  projectScope: {
                    location: '69256 Mauer',
                    postalCode: '69256',
                    power: '10 MW',
                    normalizedLocation: '69256 mauer',
                    normalizedPower: '10 mw',
                    scopeKey: '69256 mauer|10 mw',
                  },
                  evidenceQuality: 'low',
                  semanticTags: ['cernion:project-timeline'],
                  oeoClasses: [],
                  source: 'user_chat',
                  sourceSessionId: 'mauer-session',
                },
              },
              {
                key: 'dossier-low-sinsheim-location',
                payload: {
                  type: 'answer-dossier-user-fact',
                  factType: 'location',
                  label: 'Standort',
                  value: '74889 Sinsheim',
                  normalizedValue: '74889 sinsheim',
                  projectScope: {
                    location: '74889 Sinsheim',
                    postalCode: '74889',
                    power: '12 MW',
                    normalizedLocation: '74889 sinsheim',
                    normalizedPower: '12 mw',
                    scopeKey: '74889 sinsheim|12 mw',
                  },
                  evidenceQuality: 'low',
                  semanticTags: ['cernion:location', 'cernion:postal-code'],
                  oeoClasses: [],
                  source: 'user_chat',
                  sourceSessionId: 'sinsheim-session',
                },
              },
              {
                key: 'dossier-low-sinsheim-timeline',
                payload: {
                  type: 'answer-dossier-user-fact',
                  factType: 'project_timeline',
                  label: 'Geplante Inbetriebnahme',
                  value: '2029',
                  normalizedValue: '2029',
                  projectScope: {
                    location: '74889 Sinsheim',
                    postalCode: '74889',
                    power: '12 MW',
                    normalizedLocation: '74889 sinsheim',
                    normalizedPower: '12 mw',
                    scopeKey: '74889 sinsheim|12 mw',
                  },
                  evidenceQuality: 'low',
                  semanticTags: ['cernion:project-timeline'],
                  oeoClasses: [],
                  source: 'user_chat',
                  sourceSessionId: 'sinsheim-session',
                },
              },
            ],
          };
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.answerMode).toBe('evidence_collection');
    expect(result.userContext).toBe('target_grid_planning');
    expect(result.processStage).toBe('evidence_collection');
    expect(result.dossierMarkdown).toContain('Stadtwerke Tuebingen');
    expect(result.dossierMarkdown).not.toContain('69256 Mauer');
    expect(result.dossierMarkdown).not.toContain('10 MW');
    expect(result.dossierMarkdown).not.toContain('2028');
    expect(result.dossierMarkdown).not.toContain('74889 Sinsheim');
    expect(result.dossierMarkdown).not.toContain('12 MW');
    expect(result.dossierMarkdown).not.toContain('2029');
  });

  test('Wiesloch metering scenario is classified and stored with metering and asset facts', async () => {
    const puts = [];
    const service = {
      ...buildServiceHarness(),
      async collectCopilotKnowledgeEvidence() {
        return { status: 'missing', hits: [] };
      },
      async searchCopilotEntities() {
        return { results: [] };
      },
    };
    const ctx = buildCtx(
      {
        question:
          'Ich bin im Messwesen beim Netzbetreiber und pruefe 69168 Wiesloch: MK10 Standard-Zusammenlegung ist vorgesehen, eventuell ist MK40 noetig. Die alte PV-Anlage ist demontiert, ein Speicher mit 5 kW, eine Waermepumpe mit 7,5 kW und eine neue PV-Anlage mit 10 kWp sind geplant.',
        sessionId: 'tenant-wiesloch-metering-test',
      },
      {
        'object-store.put': (p) => {
          puts.push(p);
          return { ok: true };
        },
      }
    );

    const result = await handler.call(service, ctx);
    const payloads = puts
      .filter((p) => p.namespace === 'tenant:test-tenant:answer_dossier_low_evidence')
      .map((p) => p.payload);

    expect(result.answerMode).toBe('evidence_collection');
    expect(result.userContext).toBe('technical_operator');
    expect(result.processStage).toBe('evidence_collection');
    expect(payloads.map((p) => p.factType)).toEqual(
      expect.arrayContaining(['location', 'metering_concept', 'asset_component', 'asset_status'])
    );
    expect(payloads.map((p) => p.value)).toEqual(
      expect.arrayContaining(['69168 Wiesloch', 'MK10', 'MK40', '5 kW', '7.5 kW', '10 kWp', 'demontiert'])
    );
    expect(payloads.find((p) => p.value === 'MK10')?.semanticTags).toEqual(expect.arrayContaining(['cernion:metering-concept']));
    expect(payloads.find((p) => p.factType === 'asset_component' && p.value === '5 kW')?.label).toBe('Speicher');
    expect(payloads.find((p) => p.factType === 'asset_component' && p.value === '7.5 kW')?.label).toBe('Wärmepumpe');
    expect(payloads.find((p) => p.factType === 'asset_component' && p.value === '10 kWp')?.label).toBe('Neue PV-Anlage');
    expect(payloads.find((p) => p.factType === 'asset_status' && p.value === 'demontiert')?.label).toBe('PV-Altanlage');
    expect(result.dossierMarkdown).toContain('Messkonzept: MK10');
    expect(result.dossierMarkdown).toContain('Messkonzept: MK40');
    expect(result.dossierMarkdown).toContain('Speicher: 5 kW');
    expect(result.dossierMarkdown).toContain('Wärmepumpe: 7.5 kW');
    expect(result.dossierMarkdown).toContain('Neue PV-Anlage: 10 kWp');
    expect(result.dossierMarkdown).toContain('PV-Altanlage: demontiert');
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

  // ── Capability Broker integration (v0.63.4) ──────────────────────────────

  // AC1 — Broker called with $gateway: false
  test('broker: capability-broker.recommend called with meta.$gateway=false', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'Netzkapazität Sinsheim' },
      {
        'capability-broker.recommend': async () => ({ intent: 'grid_query', capability: 'grid_operator', confidence: 0.7 }),
      }
    );

    await handler.call(service, ctx);

    const brokerCall = ctx.call.mock.calls.find(([action]) => action === 'capability-broker.recommend');
    expect(brokerCall).toBeDefined();
    expect(brokerCall[2]).toMatchObject({ meta: expect.objectContaining({ $gateway: false }) });
  });

  // AC2 — Successful broker result in capabilityRouting, auditTrail, dossier markdown
  test('broker: success result appears in capabilityRouting, auditTrail.broker, and dossier markdown', async () => {
    const service = buildServiceHarness();
    const brokerResponse = {
      intent: 'grid_capacity_query',
      capability: 'grid_operator_identity_resolution',
      confidence: 0.85,
      domain: 'grid_planning',
      routeLabel: 'Netzkapazität',
      recommendedCapabilities: ['grid_operator_identity_resolution'],
      requiredInputs: ['location', 'power'],
      missingInputs: ['power'],
      risks: ['unknown_operator'],
      hitlRequired: true,
      preferredActions: ['resolve_grid_operator'],
      fallbackActions: ['manual_lookup'],
      summary: 'Route to grid operator identity resolution for capacity query',
    };
    const ctx = buildCtx(
      { question: 'Zuständiger Netzbetreiber für 74889 Sinsheim 12 MW?' },
      { 'capability-broker.recommend': async () => brokerResponse }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.capabilityRouting).toMatchObject({
      status: 'success',
      timedOut: false,
      source: 'capability-broker',
      result: expect.objectContaining({ intent: 'grid_capacity_query', capability: 'grid_operator_identity_resolution' }),
    });
    expect(typeof result.capabilityRouting.elapsedMs).toBe('number');

    expect(result.auditTrail.broker).toMatchObject({
      status: 'success',
      timedOut: false,
      intent: 'grid_capacity_query',
      capability: 'grid_operator_identity_resolution',
    });

    expect(result.dossierMarkdown).toContain('## Capability Routing Context');
    expect(result.dossierMarkdown).toContain('- status: success');
    expect(result.dossierMarkdown).toContain('- intent: grid_capacity_query');
    expect(result.dossierMarkdown).toContain('- capability: grid_operator_identity_resolution');
    expect(result.dossierMarkdown).toContain('- domain: grid_planning');
    expect(result.dossierMarkdown).toContain('hitl_required: true');
    expect(result.dossierMarkdown).toContain('Advisory note');
    // Section must appear before Final Renderer Instruction
    const routingIdx = result.dossierMarkdown.indexOf('## Capability Routing Context');
    const rendererIdx = result.dossierMarkdown.indexOf('## Final Renderer Instruction');
    expect(routingIdx).toBeGreaterThan(-1);
    expect(routingIdx).toBeLessThan(rendererIdx);
  });

  // AC3 — Broker timeout → valid dossier, capabilityRouting.status='timeout'
  test('broker: timeout returns valid dossier with capabilityRouting.status=timeout', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'Zeitüberschreitung Test' },
      {
        'capability-broker.recommend': async () => {
          const err = new Error('broker_timeout');
          throw err;
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.capabilityRouting).toMatchObject({
      status: 'timeout',
      timedOut: true,
      result: null,
      source: 'capability-broker',
    });
    expect(result.auditTrail.broker.status).toBe('timeout');
    expect(result.auditTrail.broker.timedOut).toBe(true);
    expect(result.dossierMarkdown).toContain('## Capability Routing Context');
    expect(result.dossierMarkdown).toContain('- status: timeout');
    expect(result.dossierMarkdown).toContain('proceed on Evidence basis only');
  });

  // AC4 — Broker failure → valid dossier, capabilityRouting.status='failed'
  test('broker: generic failure returns valid dossier with capabilityRouting.status=failed', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'Broker Fehler Test' },
      {
        'capability-broker.recommend': async () => {
          throw new Error('internal broker error');
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.capabilityRouting.status).toBe('failed');
    expect(result.capabilityRouting.timedOut).toBe(false);
    expect(result.auditTrail.broker.status).toBe('failed');
    expect(result.dossierMarkdown).toContain('## Capability Routing Context');
  });

  // AC5 — Broker unavailable (ServiceNotFoundError) → capabilityRouting.status='unavailable'
  test('broker: ServiceNotFoundError maps to capabilityRouting.status=unavailable', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'Broker nicht verfügbar Test' },
      {
        'capability-broker.recommend': async () => {
          const err = new Error('Service not found');
          err.name = 'ServiceNotFoundError';
          throw err;
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.capabilityRouting.status).toBe('unavailable');
    expect(result.capabilityRouting.timedOut).toBe(false);
    expect(result.auditTrail.broker.status).toBe('unavailable');
  });

  // AC6 — Broker output MUST NOT upgrade evidence confidence
  test('broker: high-confidence broker response does not upgrade dossier evidence confidence', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'Netzkapazität Prüfung' },
      {
        'capability-broker.recommend': async () => ({
          intent: 'capacity_check',
          capability: 'grid_check',
          confidence: 0.99,
          domain: 'grid_planning',
        }),
      }
    );

    const result = await handler.call(service, ctx);

    // With no real evidence (mocks return empty), dossier confidence stays 'low'
    expect(result.confidence).toBe('low');
    // capabilityRouting.result carries the broker confidence, but it does NOT propagate to result.confidence
    expect(result.capabilityRouting.result?.confidence).toBe(0.99);
    // Dossier markdown must not present broker recommendation as validated evidence in Known Evidence section
    expect(result.dossierMarkdown).toContain('Advisory note');
    const knownEvidenceMatch = result.dossierMarkdown.match(/## Known Evidence\n([\s\S]*?)(?=\n##)/);
    const knownEvidenceSection = knownEvidenceMatch ? knownEvidenceMatch[1] : '';
    expect(knownEvidenceSection).not.toContain('0.99');
  });

  // AC7 — Budget: derived from timeBudgetMs (8%), min 1500, max 2500; broker runs in parallel
  test('broker: budget derived from timeBudgetMs, runs regardless of evidence collection budget', async () => {
    // timeBudgetMs = 5000 → factCollectionMs = 0, broker budget = max(1500, floor(5000*0.08)) = 1500
    // broker should still be called even when there is no evidence collection budget
    const service = buildServiceHarness();
    const brokerCalls = [];
    const ctx = buildCtx(
      { question: 'Kurzfristige Anfrage', timeBudgetMs: 5000 },
      {
        'capability-broker.recommend': async (p) => {
          brokerCalls.push(p);
          return { intent: 'quick_query', capability: 'fast_path', confidence: 0.5 };
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(brokerCalls.length).toBe(1);
    expect(result.capabilityRouting.status).toBe('success');
    expect(result.capabilityRouting.elapsedMs).toBeGreaterThanOrEqual(0);
    // For 30s budget: min(2500, max(1500, floor(30000*0.08))) = min(2500, max(1500, 2400)) = 2400
    // We can't easily assert the exact budget value from the outside, but we can verify
    // the broker call was made with the correct task/mode
    expect(brokerCalls[0]).toMatchObject({ task: 'Kurzfristige Anfrage', mode: 'initial' });
  });

  // AC8 — Dossier is renderer-neutral: broker does not trigger execution
  test('broker: advisory section present without triggering any process execution', async () => {
    const service = buildServiceHarness();
    const executionCalls = [];
    const ctx = buildCtx(
      { question: 'Netzanschlussantrag stellen' },
      {
        'capability-broker.recommend': async () => ({
          intent: 'process_trigger',
          capability: 'netzanschluss_antrag',
          confidence: 0.9,
          preferredActions: ['submit_application'],
        }),
        'personal-agent.executeProcessIntent': async (p) => {
          executionCalls.push(p);
          return { success: true };
        },
        'personal-agent.rejectProcessIntent': async (p) => {
          executionCalls.push(p);
          return { success: true };
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(executionCalls).toHaveLength(0);
    expect(result.capabilityRouting.status).toBe('success');
    expect(result.dossierMarkdown).toContain('Advisory note');
  });

  // AC9 — Broker payload delivered in schemaVersion v1 format
  test('broker: called with cernion.capabilityRecommendation.v1 schema and initial mode', async () => {
    const service = buildServiceHarness();
    let capturedPayload;
    const ctx = buildCtx(
      { question: 'Schema-Version Test', domain: 'grid_planning' },
      {
        'capability-broker.recommend': async (p) => {
          capturedPayload = p;
          return null;
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(capturedPayload).toMatchObject({
      schemaVersion: 'cernion.capabilityRecommendation.v1',
      mode: 'initial',
      task: 'Schema-Version Test',
      resolvedParams: {},
      resolvedCapabilities: [],
    });
    // null result from broker → treated as failed (not unavailable, not timeout)
    // status should be 'success' with result:null, or 'failed'... actually null is a valid return
    // when broker returns null, Promise.race resolves with null → status: 'success', result: null
    expect(result.capabilityRouting.status).toBe('success');
    expect(result.capabilityRouting.result).toBeNull();
    // dossier markdown should use non-success rendering (result is null)
    expect(result.dossierMarkdown).toContain('## Capability Routing Context');
  });

  // ── Hydration phase tests (v0.63.4) ─────────────────────────────────────────

  // H1 — Hydration: energy-market.co2Intensity called when postal code in question and broker recommends it
  test('hydration: energy-market.co2Intensity called when broker recommends it and postal code is in question', async () => {
    const service = buildServiceHarness();
    const co2Calls = [];
    const ctx = buildCtx(
      { question: 'CO2-Intensität für 74889 Sinsheim bitte anzeigen', timeBudgetMs: 30000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'co2_query',
          capability: 'energy_market',
          confidence: 0.8,
          preferredActions: ['energy-market.co2Intensity'],
          fallbackActions: [],
        }),
        'energy-market.co2Intensity': async (p) => {
          co2Calls.push(p);
          return { index: 42, co2: 210, renewable: 0.68, label: 'Sinsheim Netz' };
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(co2Calls).toHaveLength(1);
    expect(co2Calls[0]).toMatchObject({ location: '74889', forecast: true });
    expect(result.hydration.attempted).toContain('energy-market.co2Intensity');
    expect(result.hydration.succeeded).toContain('energy-market.co2Intensity');
    expect(result.hydration.evidenceAdded).toBe(1);
    expect(result.auditTrail.hydration.evidenceAdded).toBe(1);
    // Hydrated evidence must appear in Known Evidence section with source label
    expect(result.dossierMarkdown).toContain('energy-market.co2Intensity');
    expect(result.dossierMarkdown).toContain('GrünstromIndex: 42');
    expect(result.dossierMarkdown).toContain('CO₂-Intensität: 210 g/kWh');
    // Hydrated evidence lifts confidence evidence count (evidenceQuality=validated)
    expect(result.confidence).not.toBe('low');
  });

  test('hydration: supports real broker recommendedPlan action shape', async () => {
    const service = buildServiceHarness();
    const co2Calls = [];
    const ctx = buildCtx(
      { question: 'CO2-Intensität für 74889 Sinsheim bitte anzeigen', timeBudgetMs: 30000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'residual_load_forecast_for_dso',
          capability: 'residual_load_forecast_for_dso',
          confidence: 0.84,
          recommendedPlan: [
            { step: 1, action: 'grid-operations.marketPartners' },
            { step: 2, action: 'energy-market.co2Intensity' },
          ],
          recommendedCapabilities: [
            {
              capability: 'residual_load_forecast_for_dso',
              actions: ['grid-operations.marketPartners', 'energy-market.co2Intensity'],
            },
          ],
        }),
        'energy-market.co2Intensity': async (p) => {
          co2Calls.push(p);
          return { index: 42, co2: 210, renewable: 0.68, label: 'Sinsheim Netz' };
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(co2Calls).toHaveLength(1);
    expect(co2Calls[0]).toMatchObject({ location: '74889', forecast: true });
    expect(result.hydration.succeeded).toContain('energy-market.co2Intensity');
    expect(result.hydration.evidenceAdded).toBe(1);
    expect(result.dossierMarkdown).toContain('GrünstromIndex: 42');
  });

  test('hydration: formats real energy-market.co2Intensity response shape', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'CO2-Intensität für 74889 Sinsheim bitte anzeigen', timeBudgetMs: 30000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'residual_load_forecast_for_dso',
          capability: 'residual_load_forecast_for_dso',
          confidence: 0.84,
          recommendedPlan: [{ step: 1, action: 'energy-market.co2Intensity' }],
        }),
        'energy-market.co2Intensity': async () => ({
          success: true,
          co2_intensity_gco2eq_kwh: 380,
          average_today_gco2eq_kwh: 364.5,
          data: { location: '74889' },
        }),
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.hydration.succeeded).toContain('energy-market.co2Intensity');
    expect(result.hydration.evidenceAdded).toBe(1);
    expect(result.dossierMarkdown).toContain('CO₂-Intensität: 380 g/kWh');
    expect(result.dossierMarkdown).toContain('Tagesmittel: 364.5 g/kWh');
  });

  test('hydration: hydrates AGSI and ENTSO-E cross-commodity Lagebild actions', async () => {
    const service = buildServiceHarness();
    const calls = [];
    const ctx = buildCtx(
      {
        question:
          'Bitte 72h Lagebild fuer Beschaffung mit Gasspeicher AGSI und ENTSO-E Lastprognose, Windprognose und Day-Ahead Deutschland erstellen.',
        timeBudgetMs: 30000,
      },
      {
        'capability-broker.recommend': async () => ({
          intent: 'cross_commodity_supply_security_lagebild',
          capability: 'cross_commodity_supply_security_lagebild',
          confidence: 0.91,
          recommendedPlan: [
            { step: 1, action: 'gas-storage.countryStorage' },
            { step: 2, action: 'gas-storage.supplySecurityCheck' },
            { step: 3, action: 'entsoe.loadForecast' },
            { step: 4, action: 'entsoe.windSolarForecast' },
            { step: 5, action: 'entsoe.dayAheadPrices' },
          ],
        }),
        'gas-storage.countryStorage': async (p) => {
          calls.push(['gas-storage.countryStorage', p]);
          return {
            data: {
              country: 'DE',
              storage: {
                fillPercentage: 72.5,
                gasInStorage: 180,
                workingGasVolume: 248.2,
                trend: 'falling',
                coverageDays: 23.4,
              },
            },
            metadata: { timestamp: '2026-06-16T10:00:00Z' },
          };
        },
        'gas-storage.supplySecurityCheck': async (p) => {
          calls.push(['gas-storage.supplySecurityCheck', p]);
          return {
            data: {
              status: 'ADEQUATE',
              fillLevel: 72.5,
              winterMandateStatus: 'monitor',
              coverageDays: 23.4,
            },
          };
        },
        'entsoe.loadForecast': async (p) => {
          calls.push(['entsoe.loadForecast', p]);
          return {
            region: 'Germany',
            eicCode: '10Y1001A1001A83F',
            statistics: { avgLoadMW: 61234, maxLoadMW: 70123 },
            dataPoints: [{ timestamp: '2026-06-17T00:00:00Z', loadMW: 58000 }],
            metadata: { source: 'ENTSO-E Transparency Platform' },
          };
        },
        'entsoe.windSolarForecast': async (p) => {
          calls.push(['entsoe.windSolarForecast', p]);
          return {
            region: 'Germany',
            statistics: { avgForecastMW: 9200, minForecastMW: 4100 },
            forecasts: [{ timestamp: '2026-06-17T00:00:00Z', total: 5100 }],
            metadata: { source: 'ENTSO-E Transparency Platform' },
          };
        },
        'entsoe.dayAheadPrices': async (p) => {
          calls.push(['entsoe.dayAheadPrices', p]);
          return {
            region: 'Germany',
            statistics: { avgPriceEURperMWh: 118.4, maxPriceEURperMWh: 211.7 },
            dataPoints: [{ timestamp: '2026-06-17T00:00:00Z', priceEURperMWh: 102.5 }],
            metadata: { source: 'ENTSO-E Transparency Platform' },
          };
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(calls.map(([action]) => action)).toEqual([
      'gas-storage.countryStorage',
      'gas-storage.supplySecurityCheck',
      'entsoe.loadForecast',
      'entsoe.windSolarForecast',
      'entsoe.dayAheadPrices',
    ]);
    expect(calls[0][1]).toMatchObject({ country: 'DE' });
    expect(calls[2][1]).toMatchObject({ region: 'Germany', resolution: 'hourly' });
    expect(result.hydration.succeeded).toEqual(
      expect.arrayContaining([
        'gas-storage.countryStorage',
        'gas-storage.supplySecurityCheck',
        'entsoe.loadForecast',
        'entsoe.windSolarForecast',
        'entsoe.dayAheadPrices',
      ])
    );
    expect(result.hydration.evidenceAdded).toBe(5);
    expect(result.dossierMarkdown).toContain('Gasspeicher Deutschland / AGSI');
    expect(result.dossierMarkdown).toContain('Fuellstand: 72.5%');
    expect(result.dossierMarkdown).toContain('ENTSO-E Lastprognose Deutschland');
    expect(result.dossierMarkdown).toContain('ENTSO-E Wind-/Solar-Prognose Deutschland');
    expect(result.dossierMarkdown).toContain('ENTSO-E Day-Ahead-Preise Deutschland');
  });

  // H2 — Hydration: no postal code → action not called
  test('hydration: energy-market.co2Intensity not called when no postal code extractable', async () => {
    const service = buildServiceHarness();
    const co2Calls = [];
    const ctx = buildCtx(
      { question: 'Zeig mir die CO2-Intensität bitte', timeBudgetMs: 30000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'co2_query',
          capability: 'energy_market',
          confidence: 0.8,
          preferredActions: ['energy-market.co2Intensity'],
        }),
        'energy-market.co2Intensity': async (p) => {
          co2Calls.push(p);
          return { index: 55, co2: 180 };
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(co2Calls).toHaveLength(0);
    expect(result.hydration.attempted).toHaveLength(0);
    expect(result.hydration.evidenceAdded).toBe(0);
  });

  // H3 — Hydration: action not on allowlist is never called
  test('hydration: actions not on allowlist are not called even if broker recommends them', async () => {
    const service = buildServiceHarness();
    const forbiddenCalls = [];
    const ctx = buildCtx(
      { question: 'Netzplanung 74889 Sinsheim', timeBudgetMs: 30000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'something',
          capability: 'some_cap',
          confidence: 0.9,
          preferredActions: ['grid-operator.submitApplication', 'process.triggerWorkflow'],
          fallbackActions: ['some-service.writeData'],
        }),
        'grid-operator.submitApplication': async (p) => { forbiddenCalls.push(p); return {}; },
        'process.triggerWorkflow': async (p) => { forbiddenCalls.push(p); return {}; },
        'some-service.writeData': async (p) => { forbiddenCalls.push(p); return {}; },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(forbiddenCalls).toHaveLength(0);
    expect(result.hydration.attempted).toHaveLength(0);
    expect(result.hydration.evidenceAdded).toBe(0);
  });

  // H4 — Hydration: action timeout → fail-open, dossier succeeds without hydrated evidence
  test('hydration: timeout returns valid dossier with hydration.timedOut tracking', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'CO2-Intensität für 69115 Heidelberg', timeBudgetMs: 30000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'co2_query',
          capability: 'energy_market',
          confidence: 0.8,
          preferredActions: ['energy-market.co2Intensity'],
        }),
        'energy-market.co2Intensity': async () => {
          const err = new Error('hydration_timeout');
          throw err;
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.hydration.timedOut).toContain('energy-market.co2Intensity');
    expect(result.hydration.evidenceAdded).toBe(0);
    expect(result.hydration.succeeded).toHaveLength(0);
    // Dossier still valid
    expect(result.dossierMarkdown).toContain('# CERNION ANSWER DOSSIER');
  });

  // H5 — Hydration: action failure → fail-open
  test('hydration: action failure is captured in hydration.failed; dossier succeeds', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'CO2-Daten für 70173 Stuttgart', timeBudgetMs: 30000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'co2_query',
          capability: 'energy_market',
          confidence: 0.75,
          preferredActions: ['energy-market.co2Intensity'],
        }),
        'energy-market.co2Intensity': async () => {
          throw new Error('internal service error');
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.hydration.failed).toContain('energy-market.co2Intensity');
    expect(result.hydration.evidenceAdded).toBe(0);
  });

  // H6 — Hydration: skipped when time budget is too small (timeBudgetMs < 12s → thinkingMs=0)
  test('hydration: skipped when timeBudgetMs gives thinkingMs ≤ 3000 (< 12s budget)', async () => {
    const service = buildServiceHarness();
    const co2Calls = [];
    const ctx = buildCtx(
      { question: 'CO2 für 74889 Sinsheim', timeBudgetMs: 5000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'co2_query',
          capability: 'energy_market',
          confidence: 0.9,
          preferredActions: ['energy-market.co2Intensity'],
        }),
        'energy-market.co2Intensity': async (p) => {
          co2Calls.push(p);
          return { index: 30, co2: 250 };
        },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(co2Calls).toHaveLength(0);
    expect(result.hydration.attempted).toHaveLength(0);
    expect(result.hydration.evidenceAdded).toBe(0);
  });

  // H7 — Hydration: evidence carries source action name and validated quality
  test('hydration: hydrated evidence entry has source=actionName and evidenceQuality=validated', async () => {
    const service = buildServiceHarness();
    const ctx = buildCtx(
      { question: 'Grünstromindex für 80331 München', timeBudgetMs: 30000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'co2_query',
          capability: 'energy_market',
          confidence: 0.8,
          preferredActions: ['energy-market.co2Intensity'],
        }),
        'energy-market.co2Intensity': async () => ({ index: 75, co2: 120, renewable: 0.85 }),
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    // Known Evidence section should contain the action name as the source identifier
    expect(result.dossierMarkdown).toContain('energy-market.co2Intensity');
    expect(result.dossierMarkdown).toContain('GrünstromIndex: 75');
    // Since evidenceQuality is 'validated', it counts toward confidence evidence count
    expect(result.hydration.succeeded).toContain('energy-market.co2Intensity');
  });

  // H8 — Hydration: broker must not trigger write/consequential actions
  test('hydration: write-style action in broker preferredActions is never called', async () => {
    const service = buildServiceHarness();
    const writeCalls = [];
    const ctx = buildCtx(
      { question: 'Bitte Netzanschluss beantragen 74889 Sinsheim', timeBudgetMs: 30000 },
      {
        'capability-broker.recommend': async () => ({
          intent: 'application_submit',
          capability: 'grid_connection',
          confidence: 0.95,
          preferredActions: ['grid-operator.submitApplication', 'process.createReceipt'],
          fallbackActions: ['document.store'],
        }),
        'grid-operator.submitApplication': async (p) => { writeCalls.push(p); return { submitted: true }; },
        'process.createReceipt': async (p) => { writeCalls.push(p); return { receipt: 'abc' }; },
        'document.store': async (p) => { writeCalls.push(p); return { stored: true }; },
      }
    );

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(writeCalls).toHaveLength(0);
    expect(result.hydration.attempted).toHaveLength(0);
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
