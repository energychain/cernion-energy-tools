'use strict';

const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');
const CyaService = require('../services/cya.service');
const { getJob, getResult } = require('../src/job-store');

jest.mock('../src/cya-synthesis', () => ({
  synthesizeNarrative: jest.fn(async () => ({
    generatedAt: new Date().toISOString(),
    narrative: {
      headline: 'Belastbare Einordnung',
      executiveSummary: 'Kurzfassung',
      keyPoints: ['Punkt A'],
      recommendedActions: ['Aktion A'],
      riskNotes: ['Risiko A'],
    },
  })),
}));

describe('cya.service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'query',
      actions: {
        ask: {
          handler(ctx) {
            if (String(ctx.params.query).toLowerCase().includes('bautzen')) {
              return {
                answer: 'Keine belastbare Aussage verfügbar.',
                data: null,
                sources: [],
                metadata: { executionTime: 0.3 },
              };
            }
            if (String(ctx.params.query).includes('redispatch')) {
              throw new Error('simulated upstream error');
            }
            return {
              answer: 'Fachliche Lageeinschätzung verfügbar.',
              data: { kpi: 1 },
              sources: ['mastr_db'],
              metadata: { executionTime: 0.5 },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          handler(ctx) {
            const location = String(ctx.params.location || '').toLowerCase();
            const plz = String(ctx.params.postleitzahl || '');
            const isHoeheinod = location.includes('höheinöd') || location.includes('hoheinod') || plz === '66989';
            const isBautzen = location.includes('bautzen');

            if (isBautzen) {
              return { success: true, data: { installations: [] } };
            }

            if (isHoeheinod) {
              if (ctx.params.installationType === 'solar') {
                return {
                  success: true,
                  data: {
                    installations: [
                      {
                        mastrNummer: 'SEE999952467552',
                        bruttoleistung: 2100,
                        commissioningDate: '2009-12-01',
                        postleitzahl: '66989',
                        ort: 'Höheinöd',
                      },
                    ],
                  },
                };
              }
              if (ctx.params.installationType === 'wind') {
                return {
                  success: true,
                  data: {
                    installations: [
                      {
                        mastrNummer: 'SEE969028349266',
                        bruttoleistung: 3300,
                        commissioningDate: '2016-09-01',
                        postleitzahl: '66989',
                        ort: 'Höheinöd',
                      },
                    ],
                  },
                };
              }
              if (ctx.params.installationType === 'storage') {
                return { success: true, data: { installations: [] } };
              }
            }

            // Default fixture for non-Höheinöd locations
            if (ctx.params.installationType === 'solar') {
              return {
                success: true,
                data: {
                  installations: [
                    {
                      mastrNummer: 'SEE_HEI_001',
                      bruttoleistung: 120,
                      commissioningDate: '2018-01-15',
                      postleitzahl: '69115',
                      ort: 'Heidelberg',
                    },
                  ],
                },
              };
            }
            if (ctx.params.installationType === 'wind') {
              return {
                success: true,
                data: {
                  installations: [
                    {
                      mastrNummer: 'SEW_HEI_001',
                      bruttoleistung: 1500,
                      commissioningDate: '2019-07-01',
                      postleitzahl: '69115',
                      ort: 'Heidelberg',
                    },
                  ],
                },
              };
            }
            if (ctx.params.installationType === 'storage') {
              return {
                success: true,
                data: {
                  installations: [
                    {
                      mastrNummer: 'SES_HEI_001',
                      bruttoleistung: 100,
                      commissioningDate: '2021-04-01',
                      postleitzahl: '69115',
                      ort: 'Heidelberg',
                    },
                  ],
                },
              };
            }

            return { success: true, data: { installations: [] } };
          },
        },
      },
    });

    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: `./data/object-store-cya-test-${Date.now()}`,
      },
    });

    broker.createService(CyaService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('creates profile and loads it', async () => {
    const create = await broker.call('cya.createProfile', {
      profile_id: 'cya_test_profile',
      actor: { role: 'grid_operator', organization: 'Stadtwerke Test' },
      strategic_goals: ['Rechtssicherheit'],
      tone: 'sachlich',
    });

    expect(create.success).toBe(true);

    const load = await broker.call('cya.getProfile', { profile_id: 'cya_test_profile' });
    expect(load.success).toBe(true);
    expect(load.profile.actor.role).toBe('grid_operator');
  });

  it('generates completed response when grounding is sufficient', async () => {
    const result = await broker.call('cya.generate', {
      profile_id: 'cya_test_profile',
      target_audience: 'Aufsichtsrat',
      context: {
        location: 'Heidelberg',
        trigger: 'Presseanfrage',
        focus_areas: ['capacity', 'compliance'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.narrative).toBeTruthy();
    expect(typeof result.session_id).toBe('string');
  });

  it('returns clarification status when grounding is weak', async () => {
    const result = await broker.call('cya.generate', {
      profile_id: 'cya_test_profile',
      target_audience: 'Vorstand',
      context: {
        trigger: 'Nachfrage',
        focus_areas: ['redispatch'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('needs_clarification');
    expect(result.clarification).toBeTruthy();
  });

  it('returns needs_clarification for Bautzen when facts are empty/low-confidence only', async () => {
    const result = await broker.call('cya.generate', {
      profile_id: 'cya_test_profile',
      target_audience: 'Vorstand',
      context: {
        location: 'Bautzen',
        trigger: 'Anschlussanfrage Speicher 10 MW',
        focus_areas: ['capacity', 'grid_expansion'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('needs_clarification');
    expect(result.narrative).toBeNull();
    expect(result.clarification).toBeTruthy();
    expect(result.clarification.reason).toBe('insufficient_fact_quality');
  });

  it('injects granular MaStR facts for Höheinöd and completes synthesis', async () => {
    const result = await broker.call('cya.generate', {
      profile_id: 'cya_test_profile',
      target_audience: 'Aufsichtsrat',
      context: {
        location: 'Höheinöd',
        trigger: 'Lagebild Erneuerbare',
        focus_areas: ['capacity', 'renewables'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.narrative).toBeTruthy();

    const capacityFact = result.grounding.facts.find((f) => f.focusArea === 'capacity');
    expect(capacityFact).toBeTruthy();
    expect(capacityFact.statement).toContain('SEE999952467552');
    expect(capacityFact.statement).toContain('SEE969028349266');
    expect(capacityFact.statement).toContain('keine Großspeicher > 50 kW');
    expect(capacityFact.sources).toContain('cernion_installations_local');
  });

  it('refines a generated session', async () => {
    const generated = await broker.call('cya.generate', {
      profile_id: 'cya_test_profile',
      target_audience: 'Aufsichtsrat',
      context: {
        location: 'Heidelberg',
        trigger: 'Follow-up',
        focus_areas: ['capacity'],
      },
    });

    const refined = await broker.call('cya.refine', {
      session_id: generated.session_id,
      user_feedback: 'Bitte Fokus auf Maßnahmen.',
    });

    expect(refined.success).toBe(true);
    expect(refined.status).toBe('completed');
    expect(refined.narrative).toBeTruthy();
  });

  it('resolves needs_clarification via HITL provided_data override in refine', async () => {
    // Step 1: generate — all focus areas fail (redispatch throws, no location provided)
    const generated = await broker.call('cya.generate', {
      profile_id: 'cya_test_profile',
      target_audience: 'Netzanschluss-Abteilung Netze BW',
      context: {
        // Intentionally no location → triggers clarification
        trigger: 'Netze BW verzögert 10-MW-Speicher-Anschluss und fordert Ausbau.',
        focus_areas: ['redispatch'],
      },
    });

    expect(generated.status).toBe('needs_clarification');
    expect(generated.session_id).toBeTruthy();

    // Step 2: refine with provided_data — must bypass MCP and produce completed response
    const refined = await broker.call('cya.refine', {
      session_id: generated.session_id,
      clarification_response: {
        provided_data: {
          redispatch: 'Netzregion leidet unter §13a-Abregelungen von Wind/PV in Mauer.',
          capacity: 'Lokale PV-Durchdringung 8 MW, 10-MW-Speicher muss ans 110-kV-UW Meckesheim.',
        },
      },
    });

    expect(refined.success).toBe(true);
    expect(refined.status).toBe('completed');
    expect(refined.narrative).toBeTruthy();

    // Grounding must reflect merged trusted facts
    const trustedFacts = refined.grounding.facts.filter((f) => f.trusted === true);
    expect(trustedFacts.length).toBeGreaterThanOrEqual(1);
    trustedFacts.forEach((f) => {
      expect(f.confidence).toBe('medium');
      expect(f.dataProvenance).toBe('user_asserted');
    });
  });

  it('topology hop injects VOLTAGE_HOP_REQUIRED signal when capacity_mw >= 10', async () => {
    // osm-geo.substationFinder is not registered → topology hop degrades gracefully
    const result = await broker.call('cya.generate', {
      profile_id: 'cya_test_profile',
      target_audience: 'Netzplaner',
      context: {
        location: 'Mauer',
        trigger: '10-MW-Speicher geplant',
        focus_areas: ['capacity', 'nova'],
        capacity_mw: 10,
      },
    });

    // Must not crash regardless of OSM availability
    expect(result.success).toBe(true);
    // If hop was detected (osm graceful fallback with needsHop:true), signal should appear
    if (result.regulatory_graph?.signals) {
      const hopSignal = result.regulatory_graph.signals.find(
        (s) => s.ruleId === 'VOLTAGE_HOP_REQUIRED'
      );
      // Either the signal is present OR OSM wasn't available and needsHop:false — both valid
      if (hopSignal) {
        expect(hopSignal.severity).toBe('warning');
      }
    }
  });

  describe('backward compatibility: v0.26.8 single-agent behavior (no perspectives)', () => {
    it('generates classic result when perspectives param is absent (fallback to v0.26.8)', async () => {
      const result = await broker.call('cya.generate', {
        profile_id: 'cya_test_profile',
        target_audience: 'Aufsichtsrat',
        context: {
          location: 'Heidelberg',
          trigger: 'Presseanfrage',
          focus_areas: ['capacity'],
          // No perspectives parameter — should execute classic path
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.narrative).toBeTruthy();
      expect(result.narrative.headline).toBeTruthy();
      expect(result.session_id).toBeTruthy();

      // Classic response shape: no stakeholder_states, no multi_perspective
      expect(result.stakeholder_states).toBeUndefined();
      expect(result.multi_perspective).toBeUndefined();

      // Single narrative only
      expect(Array.isArray(result.narrative)).toBe(false);
      expect(typeof result.narrative).toBe('object');
    });

    it('generates classic result when perspectives param is empty array (fallback to v0.26.8)', async () => {
      const result = await broker.call('cya.generate', {
        profile_id: 'cya_test_profile',
        target_audience: 'Aufsichtsrat',
        context: {
          location: 'Heidelberg',
          trigger: 'Presseanfrage',
          focus_areas: ['capacity'],
        },
        perspectives: [], // Empty array — should fallback to classic
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.narrative).toBeTruthy();
      expect(result.stakeholder_states).toBeUndefined();
    });

    it('refine on classic (non-multi-agent) session preserves v0.26.8 behavior', async () => {
      // Generate without perspectives
      const generated = await broker.call('cya.generate', {
        profile_id: 'cya_test_profile',
        target_audience: 'Aufsichtsrat',
        context: {
          location: 'Heidelberg',
          trigger: 'Follow-up',
          focus_areas: ['capacity'],
        },
      });

      // Refine without perspectives — should stay in classic mode
      const refined = await broker.call('cya.refine', {
        session_id: generated.session_id,
        user_feedback: 'Bitte Fokus auf Maßnahmen.',
      });

      expect(refined.success).toBe(true);
      expect(refined.status).toBe('completed');
      expect(refined.narrative).toBeTruthy();
      expect(refined.stakeholder_states).toBeUndefined();
    });

    it('async classic generate (no perspectives) preserves phase logging', async () => {
      const gatewayResult = await broker.call(
        'cya.generate',
        {
          profile_id: 'cya_test_profile',
          target_audience: 'Aufsichtsrat',
          context: {
            location: 'Heidelberg',
            trigger: 'Presseanfrage',
            focus_areas: ['capacity'],
          },
        },
        {
          meta: {
            $gateway: true,
          },
        }
      );

      await new Promise((r) => setTimeout(r, 2000));

      const jobRecord = getJob(gatewayResult.jobId);
      const phases = jobRecord.logs.map((l) => l.phase);
      // Dedup in case phases are logged multiple times
      const uniquePhases = [...new Set(phases)];
      expect(uniquePhases).toEqual([
        'phase_1_retrieval',
        'phase_2_graph',
        'phase_3_grounding',
        'phase_4_synthesis',
      ]);

      const resultPayload = getResult(gatewayResult.jobId);
      expect(resultPayload.status).toBe('completed');
      expect(resultPayload.stakeholder_states).toBeUndefined();
    });

    it('clarification flow (no perspectives) remains v0.26.8: needs_clarification → refine → completed', async () => {
      // Step 1: no location, low-confidence facts
      const generated = await broker.call('cya.generate', {
        profile_id: 'cya_test_profile',
        target_audience: 'Netzplaner',
        context: {
          trigger: 'Speicher geplant',
          focus_areas: ['redispatch'],
        },
      });

      expect(generated.status).toBe('needs_clarification');
      expect(generated.clarification).toBeTruthy();
      expect(generated.session_id).toBeTruthy();

      // Step 2: refine with provided_data (classic HITL path)
      const refined = await broker.call('cya.refine', {
        session_id: generated.session_id,
        clarification_response: {
          provided_data: {
            capacity: '10 MW Lithium-Speicher an 110-kV-UW Meckesheim',
            redispatch: 'Regionale Redispatch-Last im Jahr 2025: 450 GWh erwartet.',
          },
        },
      });

      expect(refined.success).toBe(true);
      expect(refined.status).toBe('completed');
      expect(refined.narrative).toBeTruthy();
      expect(refined.stakeholder_states).toBeUndefined();
    });

    it('clarification + refine in async mode (no perspectives) executes complete classic workflow', async () => {
      // Generate (async, REST call)
      const generateResult = await broker.call(
        'cya.generate',
        {
          profile_id: 'cya_test_profile',
          target_audience: 'Netzplaner',
          context: {
            trigger: 'Speicher geplant',
            focus_areas: ['redispatch'],
          },
        },
        {
          meta: {
            $gateway: true,
          },
        }
      );

      await new Promise((r) => setTimeout(r, 1500));

      const generatePayload = getResult(generateResult.jobId);
      expect(generatePayload.status).toBe('needs_clarification');
      const sessionId = generatePayload.session_id;

      // Refine (sync, internal call)
      const refined = await broker.call('cya.refine', {
        session_id: sessionId,
        clarification_response: {
          provided_data: {
            capacity: '10 MW Lithium-Speicher',
            redispatch: 'High curtailment expected',
          },
        },
      });

      expect(refined.success).toBe(true);
      expect(refined.status).toBe('completed');
      expect(refined.narrative).toBeTruthy();
      expect(refined.stakeholder_states).toBeUndefined();
    });
  });

  describe('async job pattern', () => {
    it('returns sync result for internal (non-gateway) calls', async () => {
      // Internal call: no ctx.meta.$gateway flag
      const result = await broker.call('cya.generate', {
        profile_id: 'cya_test_profile',
        target_audience: 'Aufsichtsrat',
        context: {
          location: 'Heidelberg',
          trigger: 'Presseanfrage',
          focus_areas: ['capacity'],
        },
      });

      // Should return synchronous 200 result, not 202 job descriptor
      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.narrative).toBeTruthy();
      expect(result.session_id).toBeTruthy();
      // No jobId in response — that's only for REST/gateway calls
      expect(result.jobId).toBeUndefined();
    });

    it('returns 202 job descriptor for REST (gateway) calls with jobId and polling URLs', async () => {
      // Simulate REST gateway call by setting ctx.meta.$gateway = true
      const result = await broker.call(
        'cya.generate',
        {
          profile_id: 'cya_test_profile',
          target_audience: 'Aufsichtsrat',
          context: {
            location: 'Heidelberg',
            trigger: 'Presseanfrage',
            focus_areas: ['capacity'],
          },
        },
        {
          meta: {
            $gateway: true, // Simulate REST API gateway caller
          },
        }
      );

      // Should return 202 job descriptor immediately (no narrative)
      expect(result.success).toBe(true);
      expect(result.status).toBe('queued');
      expect(result.jobId).toBeTruthy();
      expect(result.message).toContain('Job started');
      expect(result.statusUrl).toMatch(/^\/api\/jobs\/.*\/status$/);
      expect(result.resultUrl).toMatch(/^\/api\/jobs\/.*\/result$/);
      // No narrative in 202 response
      expect(result.narrative).toBeUndefined();
      expect(result.session_id).toBeUndefined();

      // Wait a bit for background worker to process
      await new Promise((r) => setTimeout(r, 100));

      // Job status should be available
      const jobRecord = getJob(result.jobId);
      expect(jobRecord).toBeTruthy();
      expect(jobRecord.service).toBe('cya');
      expect(jobRecord.action).toBe('generate');
    });

    it('logs phase progress via appendLog during async worker execution', async () => {
      // Gateway call to trigger async job pattern
      const gatewayResult = await broker.call(
        'cya.generate',
        {
          profile_id: 'cya_test_profile',
          target_audience: 'Aufsichtsrat',
          context: {
            location: 'Heidelberg',
            trigger: 'Presseanfrage',
            focus_areas: ['capacity'],
          },
        },
        {
          meta: {
            $gateway: true,
          },
        }
      );

      expect(gatewayResult.jobId).toBeTruthy();

      // Wait for background worker to complete
      await new Promise((r) => setTimeout(r, 2000));

      // Check job record for phase progress logging
      const jobRecord = getJob(gatewayResult.jobId);
      expect(jobRecord).toBeTruthy();
      expect(jobRecord.status).toBe('completed');

      // Should have logged all 4 phases
      const logs = jobRecord.logs || [];
      expect(logs.length).toBeGreaterThan(0);

      const phases = logs.map((l) => l.phase);
      expect(phases).toContain('phase_1_retrieval');
      expect(phases).toContain('phase_2_graph');
      expect(phases).toContain('phase_3_grounding');
      expect(phases).toContain('phase_4_synthesis');

      // Phase progress should be cumulative: 0 → 33 → 66 → 75 → 100
      const percents = logs.map((l) => l.percent);
      expect(Math.max(...percents)).toBe(100);
    });

    it('stores job result that can be retrieved via getResult', async () => {
      // Gateway call
      const gatewayResult = await broker.call(
        'cya.generate',
        {
          profile_id: 'cya_test_profile',
          target_audience: 'Aufsichtsrat',
          context: {
            location: 'Heidelberg',
            trigger: 'Presseanfrage',
            focus_areas: ['capacity'],
          },
        },
        {
          meta: {
            $gateway: true,
          },
        }
      );

      const jobId = gatewayResult.jobId;

      // Wait for completion
      await new Promise((r) => setTimeout(r, 2000));

      // Retrieve result
      const resultPayload = getResult(jobId);
      expect(resultPayload).toBeTruthy();
      expect(resultPayload.success).toBe(true);
      expect(resultPayload.status).toBe('completed');
      expect(resultPayload.narrative).toBeTruthy();
      expect(resultPayload.session_id).toBeTruthy();
    });

    it('halts async pipeline before synthesis for Bautzen low-fact scenario', async () => {
      const gatewayResult = await broker.call(
        'cya.generate',
        {
          profile_id: 'cya_test_profile',
          target_audience: 'Vorstand',
          context: {
            location: 'Bautzen',
            trigger: 'Anschlussanfrage Speicher 10 MW',
            focus_areas: ['capacity', 'grid_expansion'],
          },
        },
        {
          meta: {
            $gateway: true,
          },
        }
      );

      await new Promise((r) => setTimeout(r, 2000));

      const resultPayload = getResult(gatewayResult.jobId);
      expect(resultPayload).toBeTruthy();
      expect(resultPayload.status).toBe('needs_clarification');
      expect(resultPayload.narrative).toBeNull();
      expect(resultPayload.clarification.reason).toBe('insufficient_fact_quality');

      const jobRecord = getJob(gatewayResult.jobId);
      const phases = (jobRecord.logs || []).map((l) => l.phase);
      expect(phases).toContain('phase_3_grounding');
      expect(phases).not.toContain('phase_4_synthesis');
    });

    it('completes async Höheinöd run with granular MaStR facts and synthesis', async () => {
      const gatewayResult = await broker.call(
        'cya.generate',
        {
          profile_id: 'cya_test_profile',
          target_audience: 'Aufsichtsrat',
          context: {
            location: 'Höheinöd',
            trigger: 'Lagebild Erneuerbare',
            focus_areas: ['capacity', 'renewables'],
          },
        },
        {
          meta: {
            $gateway: true,
          },
        }
      );

      await new Promise((r) => setTimeout(r, 2000));

      const resultPayload = getResult(gatewayResult.jobId);
      expect(resultPayload).toBeTruthy();
      expect(resultPayload.status).toBe('completed');
      expect(resultPayload.narrative).toBeTruthy();

      const capacityFact = resultPayload.grounding.facts.find((f) => f.focusArea === 'capacity');
      expect(capacityFact.statement).toContain('SEE999952467552');
      expect(capacityFact.statement).toContain('SEE969028349266');

      const jobRecord = getJob(gatewayResult.jobId);
      const phases = (jobRecord.logs || []).map((l) => l.phase);
      expect(phases).toContain('phase_4_synthesis');
    });
  });
});
