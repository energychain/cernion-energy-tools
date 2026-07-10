'use strict';

const { ServiceBroker } = require('moleculer');
const ChatgptSidecarService = require('../services/chatgpt-sidecar.service');
const { defaultStore } = require('../src/chatgpt-sidecar-session-store');

describe('chatgpt-sidecar service', () => {
  let broker;
  let calls;

  beforeEach(async () => {
    calls = [];
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(ChatgptSidecarService);
    broker.createService({
      name: 'personal-agent',
      actions: {
        askCernionAgent: {
          handler(ctx) {
            calls.push({ action: 'personal-agent.askCernionAgent', params: ctx.params });
            if (ctx.params.question.includes('PV-Leistung wurde im Jahr 2025')) {
              return {
                success: true,
                shortAnswer: 'Generischer Gesetzgeber-Fallback',
                confidence: 'medium',
                evidence: [
                  {
                    source: 'Gesetzgeber',
                    value: '§ 4 Ausbaupfad mit allgemeinen Leistungszielen.',
                    metadata: { documentType: 'Gesetz' },
                  },
                ],
                evidenceBySource: {
                  knowledge: { status: 'available', hits: [{ id: 'law-1' }] },
                  datapoints: { status: 'missing', hits: [] },
                  objects: { status: 'missing', hits: [] },
                  planning: { status: 'available', hits: [{ id: 'planner-signal' }] },
                },
                processContext: [
                  'search:all',
                  'knowledge:available',
                  'datapoints:missing',
                  'objects:missing',
                  'planner:available',
                ],
              };
            }
            return {
              success: true,
              shortAnswer: 'Cernion evidence answer',
              evidence: [],
              forbiddenActions: ['execute', 'approve', 'delete'],
            };
          },
        },
      },
    });
    broker.createService({
      name: 'energy-market',
      actions: {
        prices: {
          rest: 'POST /prices',
          params: {
            market: { type: 'enum', values: ['day-ahead', 'intraday', 'futures'] },
            region: { type: 'string' },
            startDate: { type: 'string', optional: true },
            endDate: { type: 'string', optional: true },
          },
          openapi: {
            summary: 'Day-ahead and wholesale electricity prices by bidding zone',
            tags: ['Energy Market', 'ENTSO-E'],
            description:
              'Get hourly electricity market prices for a market such as day-ahead and a region such as DE-LU.',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['market', 'region'],
                    properties: {
                      market: { type: 'string', example: 'day-ahead' },
                      region: { type: 'string', example: 'DE-LU' },
                      startDate: { type: 'string', example: '2026-07-10' },
                      endDate: { type: 'string', example: '2026-07-11' },
                    },
                  },
                },
              },
            },
          },
          handler(ctx) {
            calls.push({ action: 'energy-market.prices', params: ctx.params });
            return {
              success: true,
              data: {
                market: ctx.params.market,
                region: ctx.params.region,
                prices: [
                  { timestamp: '2026-07-10T12:00:00+02:00', priceEURMWh: 78.4 },
                  { timestamp: '2026-07-10T13:00:00+02:00', priceEURMWh: 62.1 },
                ],
              },
            };
          },
        },
        co2Intensity: {
          rest: 'POST /co2-intensity',
          params: {
            location: { type: 'string' },
            timestamp: { type: 'string', optional: true },
            forecast: { type: 'boolean', optional: true, default: false },
          },
          openapi: {
            summary: 'CO2 intensity of electricity generation for a location',
            tags: ['Energy Market', 'ENTSO-E', 'CO2'],
            description:
              'Get current or forecast CO2 intensity values for electricity generation at a location.',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['location'],
                    properties: {
                      location: { type: 'string', example: 'Mauer, Baden-Württemberg, Germany' },
                      timestamp: { type: 'string' },
                      forecast: { type: 'boolean', example: true },
                    },
                  },
                },
              },
            },
          },
          handler(ctx) {
            calls.push({ action: 'energy-market.co2Intensity', params: ctx.params });
            return {
              success: true,
              data: {
                location: ctx.params.location,
                forecast: ctx.params.forecast,
                values: [
                  { timestamp: '2026-07-10T12:00:00+02:00', gCO2kWh: 390 },
                  { timestamp: '2026-07-10T13:00:00+02:00', gCO2kWh: 360 },
                ],
              },
            };
          },
        },
        installations: {
          handler(ctx) {
            calls.push({ action: 'energy-market.installations', params: ctx.params });
            if (ctx.params.postleitzahl === '69256' && ctx.params.installationType === 'solar') {
              return {
                success: true,
                data: {
                  installations: [
                    {
                      mastrNummer: 'SEE968420564550',
                      name: 'Bauhof',
                      bruttoleistung: 19.7,
                      inbetriebnahmedatum: '2009-11-11T00:00:00.000Z',
                      ort: 'Mauer',
                      gemeinde: 'Mauer',
                      postleitzahl: '69256',
                      netzbetreiberpruefungStatus: 2954,
                    },
                    {
                      mastrNummer: 'SEE988684464915',
                      name: 'PV-Anlage, IB',
                      bruttoleistung: 11.375,
                      inbetriebnahmedatum: '1965-06-04T00:00:00.000Z',
                      ort: 'Mauer',
                      gemeinde: 'Mauer',
                      postleitzahl: '69256',
                      netzbetreiberpruefungStatus: 2955,
                    },
                  ],
                  stats: { count: 2, totalCapacity: 31.075, avgCapacity: 15.5375 },
                },
              };
            }
            return {
              success: true,
              data: {
                installations: [],
                stats: { count: 0, totalCapacity: 0, avgCapacity: 0 },
              },
            };
          },
        },
      },
    });
    broker.createService({
      name: 'gas-storage',
      actions: {
        countryStorage: {
          rest: 'POST /country-storage',
          params: {
            country: { type: 'string', min: 2, max: 2 },
            includeOperators: { type: 'boolean', optional: true, default: false },
            includeFacilities: { type: 'boolean', optional: true, default: false },
          },
          openapi: {
            summary:
              'Current gas storage data for European countries (fill level, injection/withdrawal)',
            tags: ['Gas Storage (AGSI)'],
            description:
              'Get current gas storage fill level, percentage and working gas capacity for European countries.',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['country'],
                    properties: {
                      country: { type: 'string', example: 'DE' },
                      includeOperators: { type: 'boolean', example: false },
                      includeFacilities: { type: 'boolean', example: false },
                    },
                  },
                },
              },
            },
          },
          handler(ctx) {
            calls.push({ action: 'gas-storage.countryStorage', params: ctx.params });
            return {
              success: true,
              data: {
                country: 'Germany',
                code: ctx.params.country,
                date: '2026-07-08',
                storage: {
                  gasInStorage: 107.222,
                  workingGasVolume: 246.7926,
                  fillPercentage: 43.45,
                  trend: 0.13,
                },
                operations: {
                  injection: 356.65,
                  withdrawal: 26.6,
                },
                updatedAt: '2026-07-09 18:20:02',
              },
            };
          },
        },
      },
    });
    broker.createService({
      name: 'capability-broker',
      actions: {
        recommend: {
          handler(ctx) {
            calls.push({ action: 'capability-broker.recommend', params: ctx.params });
            return {
              capability: 'redispatch_readiness_gate',
              recommendedPlan: [{ action: 'redispatch-readiness-gate.getStatus' }],
            };
          },
        },
      },
    });
    broker.createService({
      name: 'datapoint',
      actions: {
        create: {
          handler(ctx) {
            calls.push({ action: 'datapoint.create', params: ctx.params });
            return { success: true, name: ctx.params.name, _rev: '1-abc' };
          },
        },
      },
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
  });

  const CREATOR_META = {
    meta: {
      authUser: {
        authType: 'session',
        tenantId: 'tenant-a',
        userId: 'user-a',
        roles: ['full-access', 'chatgpt-sidecar-creator'],
      },
    },
  };

  async function createSession(overrides = {}) {
    return broker.call(
      'chatgpt-sidecar.createSession',
      {
        capabilityProfile: ['knowledge-rag', 'draft-datapoints', 'datasource-mastr'],
        ...overrides,
      },
      CREATOR_META
    );
  }

  function ticketFrom(created) {
    return created.ticketUrl.split('/s/')[1].split('/')[0];
  }

  // ---------------------------------------------------------------------
  // Creation auth gate
  // ---------------------------------------------------------------------

  it('rejects session creation with no authenticated tenant', async () => {
    await expect(broker.call('chatgpt-sidecar.createSession', {})).rejects.toMatchObject({
      code: 401,
      type: 'AUTH_REQUIRED',
    });
  });

  it('rejects a read-only token from creating a session', async () => {
    await expect(
      broker.call(
        'chatgpt-sidecar.createSession',
        {},
        {
          meta: {
            apiToken: { scope: 'read-only', tenantId: 'tenant-a' },
            authUser: { roles: ['read-only'] },
          },
        }
      )
    ).rejects.toMatchObject({ code: 403, type: 'CHATGPT_SIDECAR_CREATE_FORBIDDEN' });
  });

  it('rejects a full-access caller without the chatgpt-sidecar-creator role', async () => {
    await expect(
      broker.call(
        'chatgpt-sidecar.createSession',
        {},
        { meta: { authUser: { tenantId: 'tenant-a', roles: ['full-access'] } } }
      )
    ).rejects.toMatchObject({ code: 403, type: 'CHATGPT_SIDECAR_CREATE_FORBIDDEN' });
  });

  it('rejects an invalid ttl', async () => {
    await expect(createSession({ ttl: '30d' })).rejects.toMatchObject({
      code: 400,
      type: 'CHATGPT_SIDECAR_INVALID_TTL',
    });
  });

  // ---------------------------------------------------------------------
  // No identity/credential leakage
  // ---------------------------------------------------------------------

  it('never leaks tenantId, userId, sessionId or provider credentials in the response payload', async () => {
    const created = await createSession();
    const serialized = JSON.stringify(created);
    expect(serialized).not.toMatch(/tenant-a|user-a/);
    expect(serialized).not.toMatch(/\bck_/);
    expect(created.actionOpenApiUrl).toContain('/api/chatgpt-sidecar/s/');
    expect(created.actionSetup).toMatchObject({
      recommended: true,
      mode: 'custom_gpt_action',
      authentication: { type: 'none_ticket_scoped' },
    });

    const ticket = ticketFrom(created);
    const manifest = await broker.call('chatgpt-sidecar.manifest', { ticket });
    const manifestSerialized = JSON.stringify(manifest);
    expect(manifestSerialized).not.toMatch(/tenant-a|user-a|ck_/);
    expect(manifest).not.toHaveProperty('sessionId');
    expect(manifest).not.toHaveProperty('tenantId');
  });

  // ---------------------------------------------------------------------
  // Manifest allowlist
  // ---------------------------------------------------------------------

  it('manifest returns only the session capability allowlist', async () => {
    const created = await createSession({ capabilityProfile: ['knowledge-rag', 'made-up'] });
    const ticket = ticketFrom(created);
    const manifest = await broker.call('chatgpt-sidecar.manifest', { ticket });
    expect(manifest.capabilityProfile).toEqual(['knowledge-rag']);
    expect(manifest.endpoints.browserAsk).toContain(`GET /api/chatgpt-sidecar/s/${ticket}/ask`);
    expect(manifest.endpoints.browserPlan).toContain(`GET /api/chatgpt-sidecar/s/${ticket}/plan`);
    expect(manifest.endpoints.actionOpenApi).toBe(
      `GET /api/chatgpt-sidecar/s/${ticket}/action-openapi.json`
    );
    expect(manifest.primaryIntegration).toBe('custom_gpt_action');
    expect(manifest.actionSetup).toMatchObject({
      recommended: true,
      mode: 'custom_gpt_action',
      schemaUrl: expect.stringContaining(`/api/chatgpt-sidecar/s/${ticket}/action-openapi.json`),
      authentication: {
        type: 'none_ticket_scoped',
      },
    });
    expect(manifest.actionSetup.steps.join('\n')).toContain('Actions -> Create new action');
    expect(manifest.actionSetup.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operationId: 'askCernion' }),
        expect.objectContaining({ operationId: 'planCernion' }),
      ])
    );
    expect(manifest.browserFacade).toMatchObject({
      safety: 'read_only_non_consequential',
      maxQueryLength: 2000,
    });
    expect(manifest.browserFacade.pythonClient).toMatchObject({
      usage: 'python_read_only_http_client_when_browser_navigation_blocks_dynamic_get_urls',
      askBaseUrl: expect.stringContaining(`/api/chatgpt-sidecar/s/${ticket}/ask`),
      planBaseUrl: expect.stringContaining(`/api/chatgpt-sidecar/s/${ticket}/plan`),
      timeoutSeconds: 30,
    });
    expect(manifest.browserFacade.pythonClient.example).toContain('urllib.parse.urlencode');
    expect(manifest.browserFacade.pythonClient.responseFields).toMatchObject({
      turnId: expect.stringContaining('next follow-up'),
      followUpContext: expect.stringContaining('parentTurnId'),
    });
    expect(manifest.responseContract).toMatchObject({
      schemaVersion: 'cernion.chatgpt-sidecar.response.v1',
      turnIdField: 'turnId',
      followUpContextField: 'followUpContext',
    });
    expect(manifest.conversation).toMatchObject({
      stateful: true,
      turnState: 'server_recorded',
      parentTurnIdField: 'parentTurnId',
    });
    expect(manifest.browserFacade.unavailableOperations).toEqual(
      expect.arrayContaining(['hitl_or_workflow_creation', 'external_connector_call'])
    );
  });

  it('serves a minimal session-scoped Custom GPT Action OpenAPI schema', async () => {
    const created = await createSession({ baseUrl: 'https://api.cernion.test/' });
    const ticket = ticketFrom(created);

    const schema = await broker.call('chatgpt-sidecar.actionOpenApi', { ticket });

    expect(schema.openapi).toBe('3.1.0');
    expect(schema.servers).toEqual([{ url: 'https://api.cernion.test' }]);
    expect(Object.keys(schema.paths).sort()).toEqual([
      `/api/chatgpt-sidecar/s/${ticket}/ask`,
      `/api/chatgpt-sidecar/s/${ticket}/plan`,
    ]);
    expect(schema.paths[`/api/chatgpt-sidecar/s/${ticket}/ask`].post).toMatchObject({
      operationId: 'askCernion',
      'x-openai-isConsequential': false,
    });
    expect(schema.paths[`/api/chatgpt-sidecar/s/${ticket}/plan`].post).toMatchObject({
      operationId: 'planCernion',
      'x-openai-isConsequential': false,
    });
    expect(
      schema.components.schemas.AskCernionRequest.properties.capability.enum
    ).toEqual(expect.arrayContaining(['knowledge-rag', 'datasource-mastr']));
    expect(JSON.stringify(schema)).not.toMatch(/tenant-a|user-a|sessionId|datapoints/);

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.action_openapi_read).toBe(1);
  });

  it('generated prompt includes a concrete initial ask URL from solution metadata', async () => {
    const created = await createSession({
      baseUrl: 'https://api.cernion.test/',
      metadata: { useCase: 'CO2 Emission fuer Mauer' },
    });
    const ticket = ticketFrom(created);

    expect(created.initialAskUrl).toBe(
      `https://api.cernion.test/api/chatgpt-sidecar/s/${ticket}/ask?query=CO2+Emission+fuer+Mauer`
    );
    expect(created.promptText).toContain(created.initialAskUrl);
    expect(created.promptText).toContain('Python/Data Analysis with outbound HTTPS');
    expect(created.promptText).toContain('urllib.parse.urlencode');
    expect(created.promptText).toContain('parentTurnId');

    const manifest = await broker.call('chatgpt-sidecar.manifest', { ticket });
    expect(manifest.initialAskUrl).toBe(created.initialAskUrl);
    expect(manifest.browserFacade.browserAskUrlTemplate).toBe(
      `https://api.cernion.test/api/chatgpt-sidecar/s/${ticket}/ask?query={urlencoded_question}&capability={optional_capability}`
    );
  });

  // ---------------------------------------------------------------------
  // TTL expiry -> 410
  // ---------------------------------------------------------------------

  it('returns 410 Gone with a regenerate instruction once the session has expired', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const session = defaultStore.getById(created.sessionId);
    session.expiresAt = new Date(Date.now() - 1000).toISOString();

    await expect(broker.call('chatgpt-sidecar.manifest', { ticket })).rejects.toMatchObject({
      code: 410,
      type: 'CHATGPT_SIDECAR_SESSION_EXPIRED',
    });
  });

  // ---------------------------------------------------------------------
  // Unknown / revoked ticket -> identical hard failure
  // ---------------------------------------------------------------------

  it('fails hard and identically for unknown and revoked tickets', async () => {
    await expect(
      broker.call('chatgpt-sidecar.manifest', { ticket: 'never-issued' })
    ).rejects.toMatchObject({ code: 404, type: 'CHATGPT_SIDECAR_TICKET_NOT_FOUND' });

    const created = await createSession();
    const ticket = ticketFrom(created);
    await broker.call(
      'chatgpt-sidecar.revokeSession',
      { sessionId: created.sessionId },
      CREATOR_META
    );

    await expect(broker.call('chatgpt-sidecar.manifest', { ticket })).rejects.toMatchObject({
      code: 404,
      type: 'CHATGPT_SIDECAR_TICKET_NOT_FOUND',
    });
  });

  // ---------------------------------------------------------------------
  // ask / plan
  // ---------------------------------------------------------------------

  it('ask forwards to the evidence flow and meters the call', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Welche Prozessschritte fehlen fuer die Gremienfreigabe?',
    });

    expect(result.success).toBe(true);
    expect(result.turnId).toMatch(/^cgs_turn_/);
    expect(result.resolvedQuestion).toBe(
      'Welche Prozessschritte fehlen fuer die Gremienfreigabe?'
    );
    expect(result.answer).toBe('Cernion evidence answer');
    expect(result.responseContract.schemaVersion).toBe('cernion.chatgpt-sidecar.response.v1');
    expect(result.followUpContext).toMatchObject({
      turnId: result.turnId,
      parentTurnId: null,
      resolvedQuestion: 'Welche Prozessschritte fehlen fuer die Gremienfreigabe?',
      transport: 'post',
      promptOnly: {
        statefulContextAvailable: true,
        requiresConcreteNextCall: true,
      },
    });
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeTruthy();

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.ask_call).toBe(1);
  });

  it('browser ask provides a read-only GET facade for prompt-only ChatGPT.com usage', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.browserAsk', {
      ticket,
      query: 'Welche PV-Anlage wurde 2015 in Mauer gebaut?',
      context: JSON.stringify({ source: 'chatgpt.com' }),
      parentTurnId: 'cgs_turn_previous',
    });

    expect(result.success).toBe(true);
    expect(result.turnId).toMatch(/^cgs_turn_/);
    expect(result.followUpContext).toMatchObject({
      parentTurnId: 'cgs_turn_previous',
      transport: 'browser_get',
      resolvedQuestion: 'Welche PV-Anlage wurde 2015 in Mauer gebaut?',
    });
    const forwarded = calls.find((c) => c.action === 'personal-agent.askCernionAgent');
    expect(forwarded).toBeTruthy();
    expect(forwarded.params.question).toBe('Welche PV-Anlage wurde 2015 in Mauer gebaut?');
    expect(forwarded.params.context).toMatchObject({
      source: 'chatgpt.com',
      tenantId: 'tenant-a',
    });

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.ask_call).toBe(1);
  });

  it('suppresses generic fallback evidence when an explicit non-knowledge capability has no grounding', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.browserAsk', {
      ticket,
      query: 'Welche PV-Leistung wurde im Jahr 2025 zusätzlich installiert?',
      capability: 'datasource-mastr',
    });

    expect(result.success).toBe(true);
    expect(result.shortAnswer).toContain('datasource-mastr');
    expect(result.shortAnswer).toContain('keine belastbare Capability-Evidence');
    expect(result.confidence).toBe('low');
    expect(result.evidence).toEqual([]);
    expect(result.capabilityGrounding).toMatchObject({
      requestedCapability: 'datasource-mastr',
      mode: 'hard',
      status: 'missing',
      reason: 'no_capability_evidence',
      genericFallbackSuppressed: true,
      fallbackEvidenceCount: 1,
    });
    expect(result.processContext).toEqual(
      expect.arrayContaining([
        'datapoints:missing',
        'objects:missing',
        'capability:datasource-mastr',
        'capability_evidence:missing',
        'generic_fallback:suppressed',
      ])
    );
    expect(result.followUpContext).toMatchObject({
      capability: 'datasource-mastr',
      confidence: 'low',
    });

    const forwarded = calls.find((c) => c.action === 'personal-agent.askCernionAgent');
    expect(forwarded.params.context).toMatchObject({
      requestedCapability: 'datasource-mastr',
      capabilityGrounding: 'hard',
    });
  });

  it('answers datasource-mastr PV capacity questions through the deterministic MaStR route when postal code is known', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Kannst Du mir sagen, wieviel PV Leistung in 69256 Mauer installiert ist?',
      capability: 'datasource-mastr',
    });

    expect(result.success).toBe(true);
    expect(result.shortAnswer).toContain('31,1 kW');
    expect(result.confidence).toBe('high');
    expect(result.capabilityGrounding).toMatchObject({
      requestedCapability: 'datasource-mastr',
      status: 'available',
      reason: 'capability_evidence_available',
    });
    expect(result.evidence[0]).toMatchObject({
      source: 'energy-market.installations',
      capability: 'datasource-mastr',
    });
    expect(result.evidence[0].metadata.examples).toHaveLength(2);
    expect(calls.find((c) => c.action === 'energy-market.installations')).toMatchObject({
      params: {
        installationType: 'solar',
        postleitzahl: '69256',
        operationalStatus: '35',
      },
    });
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeFalsy();

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.recentTurns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'ask',
          capability: 'datasource-mastr',
          queryPreview: expect.stringContaining('69256 Mauer'),
          answerPreview: expect.stringContaining('31,1 kW'),
          responseKind: 'capability_evidence_available',
          confidence: 'high',
          capabilityGrounding: expect.objectContaining({
            status: 'available',
            reason: 'capability_evidence_available',
          }),
          restPlan: null,
        }),
      ])
    );
  });

  it('prioritizes explicit datasource-mastr execution over matching blueprint hints', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Welche PV-Anlagen in 69256 Mauer gibt es?',
      capability: 'datasource-mastr',
    });

    expect(result.success).toBe(true);
    expect(result.shortAnswer).toContain('31,1 kW');
    expect(result.shortAnswer).not.toContain('Recommended');
    expect(result.processContext).toEqual(
      expect.arrayContaining(['capability:datasource-mastr', 'source:energy-market.installations'])
    );
    expect(calls.find((c) => c.action === 'energy-market.installations')).toBeTruthy();
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeFalsy();

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.recentTurns[0]).toMatchObject({
      capability: 'datasource-mastr',
      responseKind: 'capability_evidence_available',
      restPlan: null,
    });
  });

  it('returns a precise missing postal code response for datasource-mastr municipality-only questions', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Kannst Du mir sagen, wieviel PV Leistung in Mauer installiert ist?',
      capability: 'datasource-mastr',
    });

    expect(result.success).toBe(true);
    expect(result.shortAnswer).toContain('Postleitzahl');
    expect(result.capabilityGrounding).toMatchObject({
      requestedCapability: 'datasource-mastr',
      status: 'missing_required_input',
      reason: 'postal_code_required',
    });
    expect(result.openQuestions[0]).toContain('Mauer');
    expect(calls.find((c) => c.action === 'energy-market.installations')).toBeFalsy();
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeFalsy();
  });

  it('uses the read-only OpenAPI fallback for explicit gas storage capability questions', async () => {
    const created = await createSession({
      capabilityProfile: ['knowledge-rag', 'datasource-gas-storage'],
    });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Kannst Du mir sagen, wie voll die Gasspeicher aktuell in Deutschland sind?',
      capability: 'datasource-gas-storage',
    });

    expect(result.success).toBe(true);
    expect(result.shortAnswer).toContain('gas-storage.countryStorage');
    expect(result.shortAnswer).toContain('43,45 %');
    expect(result.confidence).toBe('medium');
    expect(result.capabilityGrounding).toMatchObject({
      requestedCapability: 'datasource-gas-storage',
      mode: 'hard',
      status: 'fallback',
      reason: 'openapi_semantic_router',
      fallbackSource: 'openapi_semantic_router',
      notDedicatedCapabilityRoute: true,
      resolvedOperationId: 'gas-storage_countryStorage',
      resolvedPath: '/api/gas-storage/country-storage',
      method: 'POST',
      action: 'gas-storage.countryStorage',
    });
    expect(result.processContext).toEqual(
      expect.arrayContaining([
        'capability:datasource-gas-storage',
        'capability_evidence:fallback',
        'fallback:openapi_semantic_router',
        'source:gas-storage.countryStorage',
        'not_dedicated_capability_route:true',
      ])
    );
    expect(result.evidence[0]).toMatchObject({
      source: 'gas-storage.countryStorage',
      capability: 'datasource-gas-storage',
      metadata: {
        fallbackSource: 'openapi_semantic_router',
        notDedicatedCapabilityRoute: true,
        operationId: 'gas-storage_countryStorage',
        path: '/api/gas-storage/country-storage',
        method: 'POST',
        params: {
          country: 'DE',
          includeOperators: false,
          includeFacilities: false,
        },
      },
    });
    expect(calls.find((c) => c.action === 'gas-storage.countryStorage')).toMatchObject({
      params: {
        country: 'DE',
        includeOperators: false,
        includeFacilities: false,
      },
    });
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeFalsy();

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.recentTurns[0]).toMatchObject({
      capability: 'datasource-gas-storage',
      responseKind: 'openapi_semantic_router',
      confidence: 'medium',
      capabilityGrounding: expect.objectContaining({
        status: 'fallback',
        reason: 'openapi_semantic_router',
      }),
    });
  });

  it('keeps single-country gas storage validation on countryStorage instead of compareCountries', async () => {
    const created = await createSession({
      capabilityProfile: ['knowledge-rag', 'datasource-gas-storage'],
    });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question:
        'Prüfe den aktuellsten verfügbaren Füllstand der deutschen Erdgasspeicher und vergleiche ihn ausdrücklich mit 43,45 % zum Datenstand 8. Juli 2026.',
      capability: 'datasource-gas-storage',
    });

    expect(result.success).toBe(true);
    expect(result.shortAnswer).toContain('gas-storage.countryStorage');
    expect(result.shortAnswer).toContain('43,45 %');
    expect(result.shortAnswer).not.toContain('[object Object]');
    expect(result.capabilityGrounding).toMatchObject({
      reason: 'openapi_semantic_router',
      resolvedOperationId: 'gas-storage_countryStorage',
      resolvedPath: '/api/gas-storage/country-storage',
    });
    expect(calls.find((c) => c.action === 'gas-storage.countryStorage')).toMatchObject({
      params: {
        country: 'DE',
      },
    });
  });

  it('routes datasource-entsoe day-ahead price questions to energy-market.prices', async () => {
    const created = await createSession({
      capabilityProfile: ['knowledge-rag', 'datasource-entsoe'],
    });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question:
        'Für die deutsche Gebotszone DE-LU: Gib die Day-Ahead-Strompreise stündlich für Freitag, 10.07.2026, ab der aktuellen Stunde in Europe/Berlin bis Samstag, 11.07.2026, 23:59 Europe/Berlin aus.',
      capability: 'datasource-entsoe',
    });

    expect(result.success).toBe(true);
    expect(result.responseKind || result.capabilityGrounding?.reason).toBe('openapi_semantic_router');
    expect(result.capabilityGrounding).toMatchObject({
      requestedCapability: 'datasource-entsoe',
      status: 'fallback',
      reason: 'openapi_semantic_router',
      resolvedOperationId: 'energy-market_prices',
      resolvedPath: '/api/energy-market/prices',
    });
    expect(calls.find((c) => c.action === 'energy-market.prices')).toMatchObject({
      params: {
        market: 'day-ahead',
        region: 'DE-LU',
        startDate: '2026-07-10',
        endDate: '2026-07-11',
      },
    });
    expect(calls.find((c) => c.action === 'energy-market.installations')).toBeFalsy();
  });

  it('parses key-value location parameters for datasource-entsoe CO2 intensity fallback', async () => {
    const created = await createSession({
      capabilityProfile: ['knowledge-rag', 'datasource-entsoe'],
    });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question:
        'CO2-Intensität der Stromerzeugung, hourly forecast, location=Mauer Baden-Württemberg Germany, forecast=true, resolution=hourly, Zeitraum 2026-07-10 bis 2026-07-11 Europe/Berlin. Verwende energy-market.co2Intensity.',
      capability: 'datasource-entsoe',
    });

    expect(result.success).toBe(true);
    expect(result.capabilityGrounding).toMatchObject({
      requestedCapability: 'datasource-entsoe',
      status: 'fallback',
      reason: 'openapi_semantic_router',
      resolvedOperationId: 'energy-market_co2Intensity',
      resolvedPath: '/api/energy-market/co2-intensity',
    });
    expect(result.shortAnswer).not.toContain('Pflichtparameter');
    expect(calls.find((c) => c.action === 'energy-market.co2Intensity')).toMatchObject({
      params: {
        location: 'Mauer Baden-Württemberg Germany',
        forecast: true,
      },
    });
    expect(calls.find((c) => c.action === 'energy-market.installations')).toBeFalsy();
  });

  it('does not execute an OpenAPI fallback from capability alone without question evidence', async () => {
    const created = await createSession({
      capabilityProfile: ['knowledge-rag', 'datasource-gas-storage'],
    });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie ist der aktuelle Prozessstatus?',
      capability: 'datasource-gas-storage',
    });

    expect(result.success).toBe(true);
    expect(calls.find((c) => c.action === 'gas-storage.countryStorage')).toBeFalsy();
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeTruthy();
  });

  it('ask blocks a capability that was not granted to the session, without calling downstream', async () => {
    const created = await createSession({ capabilityProfile: ['knowledge-rag'] });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie ist der MaStR-Status?',
      capability: 'datasource-mastr',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('capability_not_granted');
    expect(result.positiveFollowUps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missing: 'datasource-mastr',
          enablesDossierAddition: expect.stringContaining('scoped session'),
        }),
      ])
    );
    expect(calls).toHaveLength(0);

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.blocked_policy_attempt).toBe(1);
  });

  it('browser ask rejects overlong GET query text with prompt-safe follow-ups', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    await expect(
      broker.call('chatgpt-sidecar.browserAsk', {
        ticket,
        query: 'x'.repeat(2001),
      })
    ).rejects.toMatchObject({
      code: 400,
      type: 'CHATGPT_SIDECAR_BROWSER_QUERY_TOO_LONG',
      data: {
        positiveFollowUps: [
          expect.objectContaining({
            missing: 'shorter GET question or task',
          }),
        ],
      },
    });
    expect(calls).toHaveLength(0);
  });

  it('plan resolves via the capability broker without executing anything', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.plan', {
      ticket,
      task: 'Redispatch Produktivreife pruefen',
    });

    expect(result.success).toBe(true);
    expect(result.turnId).toMatch(/^cgs_turn_/);
    expect(result.resolvedQuestion).toBe('Redispatch Produktivreife pruefen');
    expect(result.responseContract.schemaVersion).toBe('cernion.chatgpt-sidecar.response.v1');
    expect(result.followUpContext).toMatchObject({
      turnId: result.turnId,
      transport: 'post',
    });
    expect(calls.find((c) => c.action === 'capability-broker.recommend')).toBeTruthy();
  });

  it('browser plan provides a read-only GET facade for prompt-only ChatGPT.com usage', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.browserPlan', {
      ticket,
      task: 'Finde passende Datenquellen fuer PV-Anlagenstammdaten in Mauer',
    });

    expect(result.success).toBe(true);
    expect(calls.find((c) => c.action === 'capability-broker.recommend')).toBeTruthy();

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.plan_call).toBe(1);
  });

  it('ask attaches ontology guardrail context and marks unsupported claims', async () => {
    const created = await createSession({
      capabilityProfile: [
        'knowledge-rag',
        'datasource-mastr',
        'datasource-entsoe',
        'ontology-guardrail',
      ],
    });
    const ticket = ticketFrom(created);

    const mastrResult = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Status der MaStR Meldung?',
      capability: 'datasource-mastr',
    });
    expect(mastrResult.ontology.supported).toBe(true);
    expect(mastrResult.ontology.classification).toBe('ontology_aligned');

    const entsoeResult = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie hoch ist der Day-Ahead Preis?',
      capability: 'datasource-entsoe',
    });
    expect(entsoeResult.ontology.supported).toBe(false);
    expect(entsoeResult.ontology.classification).toBe('unsupported_ontology_claim');
  });

  // ---------------------------------------------------------------------
  // Draft datapoints: allowed write + provenance
  // ---------------------------------------------------------------------

  it('creates a draft datapoint with server-side tenant/user/session provenance', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.datapoints', {
      ticket,
      value: { status: 'draft', summary: 'ZNP Kandidatenliste' },
      message: 'Bitte als Entwurf speichern',
    });

    expect(result.success).toBe(true);
    expect(result.writeScope).toBe('draft_write');

    const dpCall = calls.find((c) => c.action === 'datapoint.create');
    expect(dpCall).toBeTruthy();
    expect(dpCall.params.metadata).toMatchObject({
      origin: 'chatgpt_sidecar',
      sessionId: created.sessionId,
      tenantId: 'tenant-a',
      userId: 'user-a',
      capability: 'draft-datapoints',
      policyResult: 'allowed',
    });
    expect(dpCall.params.metadata.promptHash).toMatch(/^[a-f0-9]{16}$/);

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.draft_datapoint_created).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Blocked write attempts increment blocked-policy metering
  // ---------------------------------------------------------------------

  it('blocks a non-draft write class without mutating and increments blocked metering', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.datapoints', {
      ticket,
      writeClass: 'controlled_write',
      value: { status: 'draft' },
    });

    expect(result.success).toBe(false);
    expect(result.decision).toBe('requires_confirmation');
    expect(calls.find((c) => c.action === 'datapoint.create')).toBeUndefined();

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.blocked_policy_attempt).toBe(1);
    expect(metering.counts.draft_datapoint_created).toBeUndefined();
  });

  it('blocks a draft datapoint write when the session lacks the draft-datapoints capability', async () => {
    const created = await createSession({ capabilityProfile: ['knowledge-rag'] });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.datapoints', {
      ticket,
      value: { status: 'draft' },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('capability_not_granted');
    expect(calls.find((c) => c.action === 'datapoint.create')).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Metering increments
  // ---------------------------------------------------------------------

  it('meters session creation, manifest reads, ask, plan and draft datapoint creation', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    await broker.call('chatgpt-sidecar.manifest', { ticket });
    await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie lautet der aktuelle Prozessstatus?',
    });
    await broker.call('chatgpt-sidecar.plan', { ticket, task: 'Evidenz fuer Redispatch pruefen' });
    await broker.call('chatgpt-sidecar.datapoints', { ticket, value: { status: 'draft' } });

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts).toMatchObject({
      session_created: 1,
      manifest_read: 1,
      ask_call: 1,
      plan_call: 1,
      draft_datapoint_created: 1,
    });
  });

  // ---------------------------------------------------------------------
  // Revocation is tenant-scoped
  // ---------------------------------------------------------------------

  it('does not allow a different tenant to revoke a session', async () => {
    const created = await createSession();
    await expect(
      broker.call(
        'chatgpt-sidecar.revokeSession',
        { sessionId: created.sessionId },
        {
          meta: {
            authUser: {
              tenantId: 'tenant-b',
              userId: 'user-b',
              roles: ['full-access', 'chatgpt-sidecar-creator'],
            },
          },
        }
      )
    ).rejects.toMatchObject({ code: 404, type: 'CHATGPT_SIDECAR_SESSION_NOT_FOUND' });
  });

  // ---------------------------------------------------------------------
  // #390: full-scope catalog expansion
  // ---------------------------------------------------------------------

  it('grants the full catalog via the "*" wildcard and groups it by domain in the manifest', async () => {
    const created = await createSession({ capabilityProfile: ['*'] });
    const ticket = ticketFrom(created);

    expect(created.capabilities.length).toBeGreaterThan(100);

    const manifest = await broker.call('chatgpt-sidecar.manifest', { ticket });
    expect(Object.keys(manifest.capabilityDomains).length).toBeGreaterThan(1);
    expect(manifest.capabilityDomains.platform).toEqual(
      expect.arrayContaining(['knowledge-rag', 'draft-datapoints'])
    );

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/tenant-a|user-a/);
  });

  it('allows ask for a granted full-scope catalog capability id and blocks an ungranted one', async () => {
    const { FULL_CAPABILITY_CATALOG } = require('../src/chatgpt-sidecar-session-policy');
    const grantedId = FULL_CAPABILITY_CATALOG[0].id;
    const ungrantedId = FULL_CAPABILITY_CATALOG[1].id;

    const created = await createSession({ capabilityProfile: [grantedId] });
    const ticket = ticketFrom(created);

    const allowed = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie ist der aktuelle Evidenzstatus?',
      capability: grantedId,
    });
    expect(allowed.success).not.toBe(false);
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeTruthy();

    const blocked = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie ist der aktuelle Evidenzstatus?',
      capability: ungrantedId,
    });
    expect(blocked.success).toBe(false);
    expect(blocked.reason).toBe('capability_not_granted');
    expect(blocked.notAvailable).toContain('ungranted_capability');
  });

  it('never mutates beyond draft_write even when the granted capability set is the full catalog', async () => {
    const created = await createSession({ capabilityProfile: ['*'] });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.datapoints', {
      ticket,
      writeClass: 'process_execute',
      value: { status: 'draft' },
    });

    expect(result.success).toBe(false);
    expect(result.decision).toBe('requires_confirmation');
    expect(calls.find((c) => c.action === 'datapoint.create')).toBeUndefined();
  });
});
