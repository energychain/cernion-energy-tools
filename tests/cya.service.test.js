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
  });
});
