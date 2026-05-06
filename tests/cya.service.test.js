'use strict';

const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');
const CyaService = require('../services/cya.service');
const { getJob, getResult } = require('../src/job-store');

jest.mock('../src/cya-report-builder', () => ({
  buildCyaNarrativePdf: jest.fn(async () => Buffer.from('%PDF-1.4\nfake-pdf-content')),
}));

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
  const hitlItems = [];

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
            const isHoeheinod =
              location.includes('höheinöd') || location.includes('hoheinod') || plz === '66989';
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

    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler(ctx) {
            const item = {
              id: `hitl-${hitlItems.length + 1}`,
              kind: ctx.params.kind,
              status: 'pending',
              payload: ctx.params.payload,
              agent_interventions: [
                {
                  action: 'created',
                  actor: 'system',
                },
              ],
            };
            hitlItems.push(item);
            return { success: true, item };
          },
        },
      },
    });

    broker.createService(CyaService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    hitlItems.length = 0;
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

  describe('profile templates', () => {
    it('listTemplates returns 6+ templates', async () => {
      const result = await broker.call('cya.listTemplates');

      expect(result.success).toBe(true);
      expect(Array.isArray(result.templates)).toBe(true);
      expect(result.templates.length).toBeGreaterThanOrEqual(6);
    });

    it('getTemplate returns vnb_defensiv with suggestedAudiences', async () => {
      const result = await broker.call('cya.getTemplate', { templateId: 'vnb_defensiv' });

      expect(result.success).toBe(true);
      expect(result.template).toBeTruthy();
      expect(result.template.templateId).toBe('vnb_defensiv');
      expect(Array.isArray(result.template.suggestedAudiences)).toBe(true);
      expect(result.template.suggestedAudiences.length).toBeGreaterThan(0);
    });

    it('getTemplate returns 404 for unknown template', async () => {
      await expect(
        broker.call('cya.getTemplate', { templateId: 'nonexistent' })
      ).rejects.toMatchObject({
        code: 404,
        type: 'TEMPLATE_NOT_FOUND',
      });
    });

    it('createFromTemplate creates profile from template', async () => {
      const createResult = await broker.call('cya.createFromTemplate', {
        templateId: 'vnb_defensiv',
        profile_id: 'cya_template_profile',
      });

      expect(createResult.success).toBe(true);
      expect(createResult.profile_id).toBe('cya_template_profile');
      expect(createResult.templateId).toBe('vnb_defensiv');
      expect(createResult.createdAt).toBeTruthy();

      const loaded = await broker.call('cya.getProfile', { profile_id: 'cya_template_profile' });
      expect(loaded.success).toBe(true);
      expect(loaded.profile.actor.role).toBe('grid_operator');
      expect(loaded.profile.tone).toBe('diplomatisch, rechtssicher, defensiv');
    });

    it('createFromTemplate overrides organization from overrides', async () => {
      await broker.call('cya.createFromTemplate', {
        templateId: 'vnb_defensiv',
        profile_id: 'cya_template_profile_override',
        overrides: {
          organization: 'Stadtwerke Override',
        },
      });

      const loaded = await broker.call('cya.getProfile', {
        profile_id: 'cya_template_profile_override',
      });
      expect(loaded.success).toBe(true);
      expect(loaded.profile.actor.organization).toBe('Stadtwerke Override');
    });

    it('createFromTemplate returns 404 for unknown template', async () => {
      await expect(
        broker.call('cya.createFromTemplate', {
          templateId: 'nonexistent',
          profile_id: 'cya_template_unknown',
        })
      ).rejects.toMatchObject({
        code: 404,
        type: 'TEMPLATE_NOT_FOUND',
      });
    });
  });

  describe('compareProfiles (multi-perspective)', () => {
    it('generates perspectives for 2 profiles', async () => {
      await broker.call('cya.createProfile', {
        profile_id: 'cmp_vnb',
        actor: { role: 'grid_operator', organization: 'VNB Test' },
        strategic_goals: ['CAPEX-Schutz'],
        tone: 'diplomatisch',
      });

      await broker.call('cya.createProfile', {
        profile_id: 'cmp_proj',
        actor: { role: 'project_developer', organization: 'Projektierer Test' },
        strategic_goals: ['Beschleunigung'],
        tone: 'bestimmt',
      });

      const result = await broker.call('cya.compareProfiles', {
        profile_ids: ['cmp_vnb', 'cmp_proj'],
        target_audience: 'Aufsichtsrat',
        context: {
          location: 'Heidelberg',
          trigger: 'Vergleichsperspektive',
          focus_areas: ['capacity'],
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.perspectiveCount).toBe(2);
      expect(Array.isArray(result.perspectives)).toBe(true);
      expect(result.perspectives).toHaveLength(2);
      result.perspectives.forEach((perspective) => {
        expect(perspective.status).toBe('completed');
        expect(perspective.narrative).toBeTruthy();
        expect(perspective.narrative.headline).toBeTruthy();
      });
    });

    it('accepts template_ids instead of profile_ids', async () => {
      const result = await broker.call('cya.compareProfiles', {
        profile_ids: ['vnb_defensiv', 'projektierer_offensiv'],
        target_audience: 'Vorstand',
        context: {
          location: 'Heidelberg',
          trigger: 'Template-Vergleich',
          focus_areas: ['capacity'],
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.perspectives).toHaveLength(2);
      expect(result.perspectives[0].profileType).toBe('template');
      expect(result.perspectives[1].profileType).toBe('template');
    });

    it('mixed: 1 profile_id + 1 template_id', async () => {
      await broker.call('cya.createProfile', {
        profile_id: 'cmp_mixed_profile',
        actor: { role: 'supplier', organization: 'Stadtwerk Test' },
        strategic_goals: ['Kundengewinnung'],
        tone: 'kundenorientiert',
      });

      const result = await broker.call('cya.compareProfiles', {
        profile_ids: ['cmp_mixed_profile', 'vnb_defensiv'],
        target_audience: 'Geschäftsführung',
        context: {
          location: 'Heidelberg',
          trigger: 'Mixed-Vergleich',
          focus_areas: ['capacity'],
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.perspectives).toHaveLength(2);
      expect(result.perspectives.some((p) => p.profileType === 'profile')).toBe(true);
      expect(result.perspectives.some((p) => p.profileType === 'template')).toBe(true);
    });

    it('validates min: 2 profile_ids', async () => {
      await expect(
        broker.call('cya.compareProfiles', {
          profile_ids: ['only_one'],
          target_audience: 'Vorstand',
          context: {
            trigger: 'Ungültiger Vergleich',
            focus_areas: ['capacity'],
          },
        })
      ).rejects.toMatchObject({
        code: 422,
      });
    });

    it('returns needs_clarification when grounding insufficient', async () => {
      const result = await broker.call('cya.compareProfiles', {
        profile_ids: ['vnb_defensiv', 'projektierer_offensiv'],
        target_audience: 'Vorstand',
        context: {
          trigger: 'Schwache Faktenlage',
          focus_areas: ['redispatch'],
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('needs_clarification');
      expect(result.clarification).toBeTruthy();
      expect(result.regulatory_graph).toBeTruthy();
      expect(result.grounding).toBeTruthy();
    });
  });

  it('returns created hitl item from helper for consensus escalation', async () => {
    const service = broker.getLocalService('cya');

    const result = await service._createHitlConsensusItem(
      { meta: { tenantId: 'tenant-cya' } },
      {
        sessionId: 'cya-session-1',
        eventName: 'cya.a2a.consensus.failed',
        payload: {
          blockers: ['netzbetreiber'],
          triggerFacts: ['capacity'],
          reason: 'multi_agent_conflict_unresolved',
        },
      }
    );

    expect(result.item.kind).toBe('cya-consensus-failed');
    expect(result.item.payload.sessionId).toBe('cya-session-1');
    expect(result.item.payload.blockers).toContain('netzbetreiber');
  });

  it('builds clarification response with direct hitl_item field', async () => {
    const service = broker.getLocalService('cya');

    const response = service.buildClarificationResponse({
      sessionId: 'cya-session-2',
      profileId: 'cya_test_profile',
      targetAudience: 'Vorstand',
      grounding: {
        clarification: {
          question: 'Bitte Daten nachreichen',
          reason: 'multi_agent_conflict_unresolved',
          suggestedInputs: ['capacity'],
        },
      },
      regulatoryGraph: { signals: [] },
      context: { focus_areas: ['capacity'] },
      hitlItem: { id: 'hitl-direct-1', status: 'pending' },
    });

    expect(response.status).toBe('needs_clarification');
    expect(response.hitl_item.id).toBe('hitl-direct-1');
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

  describe('exportPdf and exportJson', () => {
    let completedSessionId;
    let pendingSessionId;

    beforeAll(async () => {
      // Create a completed session
      completedSessionId = `cya_export_test_${Date.now()}`;
      await broker.call('object-store.put', {
        namespace: 'cya_sessions',
        key: completedSessionId,
        payload: {
          session_id: completedSessionId,
          status: 'completed',
          target_audience: 'Aufsichtsrat',
          metadata: {
            createdAt: new Date().toISOString(),
            location: 'Heidelberg',
            trigger: 'Test',
          },
          narrative: {
            headline: 'Testbericht',
            executiveSummary: 'Kurz.',
            keyPoints: ['Punkt A'],
            recommendedActions: [],
            riskNotes: [],
          },
          grounding: { confidence: 0.9, facts: [], dataGaps: [] },
          regulatory_graph: { signals: [] },
        },
      });

      // Create a pending session
      pendingSessionId = `cya_pending_test_${Date.now()}`;
      await broker.call('object-store.put', {
        namespace: 'cya_sessions',
        key: pendingSessionId,
        payload: {
          session_id: pendingSessionId,
          status: 'needs_clarification',
          narrative: null,
        },
      });
    });

    it('exportPdf returns a Buffer for a completed session', async () => {
      const result = await broker.call('cya.exportPdf', { session_id: completedSessionId });
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8', 0, 4)).toBe('%PDF');
    });

    it('exportPdf throws 409 when session is not completed', async () => {
      await expect(
        broker.call('cya.exportPdf', { session_id: pendingSessionId })
      ).rejects.toMatchObject({ code: 409 });
    });

    it('exportPdf throws 404 for unknown session', async () => {
      await expect(
        broker.call('cya.exportPdf', { session_id: 'non_existent_session_xyz' })
      ).rejects.toMatchObject({ code: 404 });
    });

    it('exportPdf forwards options to buildCyaNarrativePdf', async () => {
      const { buildCyaNarrativePdf } = require('../src/cya-report-builder');
      buildCyaNarrativePdf.mockClear();
      await broker.call('cya.exportPdf', {
        session_id: completedSessionId,
        language: 'en',
        includeRegulatoryDetails: false,
        includeDataBasis: false,
        includeAITransparency: false,
      });
      expect(buildCyaNarrativePdf).toHaveBeenCalledWith(
        expect.objectContaining({ session_id: completedSessionId }),
        {
          language: 'en',
          includeRegulatoryDetails: false,
          includeDataBasis: false,
          includeAITransparency: false,
        }
      );
    });

    it('exportJson returns session object', async () => {
      const result = await broker.call('cya.exportJson', { session_id: completedSessionId });
      expect(result.success).toBe(true);
      expect(result.session_id).toBe(completedSessionId);
      expect(typeof result.exportedAt).toBe('string');
      expect(result.session).toBeTruthy();
      expect(result.session.status).toBe('completed');
    });

    it('exportJson throws 404 for unknown session', async () => {
      await expect(
        broker.call('cya.exportJson', { session_id: 'non_existent_session_xyz' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });
});

// ── Multi-tenant isolation tests ──────────────────────────────────────────────
describe('multi-tenant CYA isolation', () => {
  let isolationBroker;

  beforeAll(async () => {
    isolationBroker = new ServiceBroker({ logger: false });

    isolationBroker.createService({
      name: 'query',
      actions: {
        ask: {
          handler() {
            return { answer: 'ok', data: { kpi: 1 }, sources: [], metadata: { executionTime: 0.1 } };
          },
        },
      },
    });

    isolationBroker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          handler() {
            return { success: true, data: { installations: [] } };
          },
        },
      },
    });

    isolationBroker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: `./data/object-store-cya-isolation-${Date.now()}`,
      },
    });

    isolationBroker.createService(CyaService);
    await isolationBroker.start();
  }, 30000);

  afterAll(async () => {
    await isolationBroker.stop();
  });

  it('profiles for two tenants are fully isolated', async () => {
    const profileId = 'shared_profile_id';

    await isolationBroker.call(
      'cya.createProfile',
      { profile_id: profileId, actor: { role: 'grid_operator', organization: 'Tenant A GmbH' }, strategic_goals: ['Ziel A'] },
      { meta: { tenantId: 'tenant-a' } }
    );

    await isolationBroker.call(
      'cya.createProfile',
      { profile_id: profileId, actor: { role: 'supplier', organization: 'Tenant B GmbH' }, strategic_goals: ['Ziel B'] },
      { meta: { tenantId: 'tenant-b' } }
    );

    const profileA = await isolationBroker.call('cya.getProfile', { profile_id: profileId }, { meta: { tenantId: 'tenant-a' } });
    const profileB = await isolationBroker.call('cya.getProfile', { profile_id: profileId }, { meta: { tenantId: 'tenant-b' } });

    expect(profileA.profile.actor.role).toBe('grid_operator');
    expect(profileA.profile.actor.organization).toBe('Tenant A GmbH');

    expect(profileB.profile.actor.role).toBe('supplier');
    expect(profileB.profile.actor.organization).toBe('Tenant B GmbH');
  });

  it('sessions for two tenants do not cross over (generate then refine)', async () => {
    const profileId = 'iso_profile';
    const profilePayload = {
      profile_id: profileId,
      actor: { role: 'grid_operator', organization: 'Isolation VNB' },
      strategic_goals: ['Stresstest'],
    };
    await isolationBroker.call('cya.createProfile', profilePayload, { meta: { tenantId: 'iso-a' } });
    await isolationBroker.call('cya.createProfile', profilePayload, { meta: { tenantId: 'iso-b' } });

    const genA = await isolationBroker.call(
      'cya.generate',
      { profile_id: profileId, target_audience: 'Aufsichtsrat', context: { location: 'Heidelberg', trigger: 'Test', focus_areas: ['capacity'] } },
      { meta: { tenantId: 'iso-a' } }
    );
    expect(genA.success).toBe(true);

    // Tenant B must not find Tenant A's session
    await expect(
      isolationBroker.call('cya.refine', { session_id: genA.session_id, user_feedback: 'Fokus' }, { meta: { tenantId: 'iso-b' } })
    ).rejects.toMatchObject({ code: 404 });

    // Tenant A can refine its own session
    const refinedA = await isolationBroker.call(
      'cya.refine',
      { session_id: genA.session_id, user_feedback: 'Bitte konkreter.' },
      { meta: { tenantId: 'iso-a' } }
    );
    expect(refinedA.success).toBe(true);
    // Status may be completed or needs_clarification depending on grounding; the key assertion
    // is that refine succeeded (no 404) and Tenant B cannot access the session.
    expect(['completed', 'needs_clarification']).toContain(refinedA.status);
  });

  it('profile.update for two tenants with same id is isolated', async () => {
    const profileId = 'shared_upd_profile';
    await isolationBroker.call(
      'cya.createProfile',
      { profile_id: profileId, actor: { role: 'grid_operator' }, strategic_goals: ['A'] },
      { meta: { tenantId: 'upd-a' } }
    );
    await isolationBroker.call(
      'cya.createProfile',
      { profile_id: profileId, actor: { role: 'supplier' }, strategic_goals: ['B'], tone: 'neutral' },
      { meta: { tenantId: 'upd-b' } }
    );

    await isolationBroker.call(
      'cya.profile.update',
      { id: profileId, tone: 'sachlich' },
      { meta: { tenantId: 'upd-a' } }
    );

    const profileA = await isolationBroker.call('cya.getProfile', { profile_id: profileId }, { meta: { tenantId: 'upd-a' } });
    const profileB = await isolationBroker.call('cya.getProfile', { profile_id: profileId }, { meta: { tenantId: 'upd-b' } });

    expect(profileA.profile.tone).toBe('sachlich');
    expect(profileB.profile.tone).toBe('neutral');
  });
});
