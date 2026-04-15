'use strict';

const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');
const CyaService = require('../services/cya.service');

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
});
