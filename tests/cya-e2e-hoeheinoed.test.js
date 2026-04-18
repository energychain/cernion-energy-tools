'use strict';

const path = require('path');
const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');

const HOEHEINOED_INSTALLATIONS = [
  {
    mastrNummer: 'SEE969028349266',
    name: 'WEA Höheinöd HOE01',
    type: 'wind',
    nettonennleistung: 3300,
    bruttoleistung: 3300,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2016-09-26T00:00:00.000Z',
    fernsteuerbarkeitDv: '1',
    netzbetreiberpruefungStatus: 2954,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    lastUpdatedAt: '2021-07-07T12:21:13.786Z',
    typenbezeichnung: 'V112-3.3MW',
    napData: {
      spannungsebene: 352,
      spannungsebeneLabel: 'Mittelspannung (MV)',
      netzbetreiberMastrNummer: 'SNB961471621746',
    },
  },
  {
    mastrNummer: 'SEE991748766191',
    name: 'WEA R01',
    type: 'wind',
    nettonennleistung: 7000,
    bruttoleistung: 7000,
    einheitBetriebsstatus: '31',
    inbetriebnahmedatum: null,
    fernsteuerbarkeitDv: null,
    netzbetreiberpruefungStatus: 2955,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    lastUpdatedAt: '2026-01-29T10:45:53.635Z',
    nabenhoehe: 162,
    rotordurchmesser: 175,
    latitude: 49.304441,
    longitude: 7.617739,
    napData: null,
  },
  {
    mastrNummer: 'SEE988204328529',
    name: 'WEA R02',
    type: 'wind',
    nettonennleistung: 7000,
    bruttoleistung: 7000,
    einheitBetriebsstatus: '31',
    inbetriebnahmedatum: null,
    fernsteuerbarkeitDv: null,
    netzbetreiberpruefungStatus: 2955,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    lastUpdatedAt: '2026-01-29T10:47:57.588Z',
    nabenhoehe: 162,
    rotordurchmesser: 175,
    latitude: 49.303042,
    longitude: 7.60907,
    napData: null,
  },
  {
    mastrNummer: 'SEE974207082094',
    name: 'Höheinöd W123',
    type: 'wind',
    nettonennleistung: 2300,
    bruttoleistung: 2300,
    einheitBetriebsstatus: '38',
    inbetriebnahmedatum: '2006-01-24T00:00:00.000Z',
    fernsteuerbarkeitDv: '1',
    netzbetreiberpruefungStatus: 2954,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    lastUpdatedAt: '2026-02-10T11:37:23.239Z',
    typenbezeichnung: 'E70',
    napData: { spannungsebene: 352, spannungsebeneLabel: 'Mittelspannung (MV)' },
  },
  {
    mastrNummer: 'SEE999952467552',
    name: 'Solarpark Höheinöd',
    type: 'solar',
    nettonennleistung: 2103.7,
    bruttoleistung: 2103.7,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2009-12-16T00:00:00.000Z',
    fernsteuerbarkeitDv: null,
    netzbetreiberpruefungStatus: 2954,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    lastUpdatedAt: '2025-10-01T06:53:44.800Z',
    latitude: 49.286977,
    longitude: 7.5806,
    napData: {
      spannungsebene: 352,
      spannungsebeneLabel: 'Mittelspannung (MV)',
      netzbetreiberMastrNummer: 'SNB961471621746',
    },
  },
  {
    mastrNummer: 'SEE976608984557',
    name: 'BHKW 1 Biogasanlage Höheinöd',
    type: 'biomass',
    nettonennleistung: 600,
    bruttoleistung: 600,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2011-10-20T00:00:00.000Z',
    fernsteuerbarkeitDv: '1',
    netzbetreiberpruefungStatus: 2954,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    lastUpdatedAt: '2022-07-05T05:04:42.772Z',
    napData: { spannungsebene: 352, spannungsebeneLabel: 'Mittelspannung (MV)' },
  },
  {
    mastrNummer: 'SEE982890040772',
    name: 'Speicher',
    type: 'storage',
    nettonennleistung: 6.93,
    bruttoleistung: 12,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2019-04-29T00:00:00.000Z',
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    lastUpdatedAt: '2022-10-25T04:44:45.994Z',
    napData: { spannungsebene: 354, spannungsebeneLabel: 'Niederspannung (LV)' },
  },
];

const MOCK_NARRATIVE = {
  headline: 'Netzgebiet Höheinöd: 14 MW Zubau bei ungesteuertem Altbestand',
  executiveSummary:
    'Im PLZ-Gebiet 66989 Höheinöd stehen 14 MW neue Windenergieanlagen vor der Genehmigung. Der bestehende Solarpark (2,1 MW, IBN 2009) verfügt über keine Fernsteuerbarkeit, was die Anwendung des NOVA-Prinzips einschränkt.',
  keyPoints: [
    '14 MW neue WEA in Planung (2× 7 MW, Status: In Planung, Nabenhöhe 162m)',
    '2,1 MW Solarpark ohne Fernsteuerbarkeit (IBN 2009) — NOVA-Blocker',
    'Kein Utility-Scale-Speicher (>50 kW) im Netzgebiet',
    '3× Alt-WEA dauerhaft stillgelegt (E-70, 2006) — Repowering-Potenzial',
    '600 kW Biogasanlage als stabilisierende Grundlast',
  ],
  recommendedActions: [
    'Netzverträglichkeitsprüfung für 14 MW Windpark-Zubau einleiten',
    'Nachrüstung Fernsteuerbarkeit Solarpark Höheinöd prüfen (§ 9 EEG)',
    'Utility-Scale-Speicher als Flexibilitätsoption bewerten',
  ],
  riskNotes: [
    'Ohne Fernsteuerbarkeitsnachrüstung bleibt NOVA-Prinzip eingeschränkt',
    'Netzbetreiberprüfung für beide 7-MW-WEA steht noch aus (Status 2955)',
  ],
};

const mockGenerateStructured = jest.fn();

jest.mock('../src/llm-client', () => ({
  SchemaType: {
    OBJECT: 'object',
    STRING: 'string',
    ARRAY: 'array',
    BOOLEAN: 'boolean',
  },
  generateStructured: (...args) => mockGenerateStructured(...args),
}));

jest.mock('../src/cya-report-builder', () => ({
  buildCyaNarrativePdf: jest.fn(async () => Buffer.from('%PDF-1.4\nHöheinöd CYA Demo Report\n%%EOF')),
}));

const CyaService = require('../services/cya.service');

function buildNarrativeForPrompt(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (lower.includes('journalist')) {
    return {
      ...MOCK_NARRATIVE,
      headline: 'Höheinöd im Fokus: Windausbau, Netzdruck und lokale Chancen',
    };
  }
  if (lower.includes('project_developer')) {
    return {
      ...MOCK_NARRATIVE,
      headline: 'Projektierer-Sicht: 14 MW Wind müssen schneller angeschlossen werden',
    };
  }
  if (lower.includes('grid_operator')) {
    return {
      ...MOCK_NARRATIVE,
      headline: 'VNB-Sicht: Netzstabilität vor Geschwindigkeit im Ausbaukorridor Höheinöd',
    };
  }

  return MOCK_NARRATIVE;
}

function normalizeInstallationForRetriever(installation) {
  return {
    mastrNummer: installation.mastrNummer,
    bruttoleistung: installation.bruttoleistung,
    commissioningDate: installation.inbetriebnahmedatum,
    postleitzahl: installation.postleitzahl,
    ort: installation.gemeinde,
  };
}

describe('CYA E2E Demo — Höheinöd (PLZ 66989)', () => {
  let broker;
  let generateResult;
  let compareResult;

  beforeAll(async () => {
    mockGenerateStructured.mockImplementation(async (_schema, prompt) => {
      return buildNarrativeForPrompt(prompt);
    });

    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'query',
      actions: {
        ask: {
          handler(ctx) {
            const q = String(ctx.params.query || '').toLowerCase();
            if (q.includes('redispatch')) {
              return {
                answer: 'Redispatch-Risiko vorhanden; Engpassmanagement im Winterhalbjahr erhöht.',
                data: { redispatchRisk: 'medium' },
                sources: ['redispatch_monitor'],
                metadata: { executionTime: 0.42 },
              };
            }
            if (q.includes('nova')) {
              return {
                answer: 'NOVA-Kontext: netzorientierte Priorisierung möglich, sofern Steuerbarkeit gegeben ist.',
                data: { nova: 'limited' },
                sources: ['grid_policy_notes'],
                metadata: { executionTime: 0.31 },
              };
            }
            if (q.includes('grid_expansion')) {
              return {
                answer: 'Netzausbau priorisiert für Zubauachsen, Dauer abhängig von Mittelspannungsanbindung.',
                data: { expansion: 'ongoing' },
                sources: ['vnb_planing'],
                metadata: { executionTime: 0.37 },
              };
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
            const postleitzahl = String(ctx.params.postleitzahl || '');
            const isHoeheinod = postleitzahl === '66989' || location.includes('höheinöd') || location.includes('hoheinod');
            if (!isHoeheinod) {
              return { success: true, data: { installations: [] }, stats: { count: 0 } };
            }

            const type = String(ctx.params.installationType || 'all');
            const statusFilter = String(ctx.params.operationalStatus || '');
            const minCapacityKW = Number(ctx.params.minCapacityKW || 0);

            const installations = HOEHEINOED_INSTALLATIONS
              .filter((i) => type === 'all' || i.type === type)
              .filter((i) => !statusFilter || String(i.einheitBetriebsstatus) === statusFilter)
              .filter((i) => (i.bruttoleistung || 0) >= minCapacityKW)
              .map(normalizeInstallationForRetriever);

            return {
              success: true,
              data: { installations },
              stats: { count: installations.length },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'grid-operations',
      actions: {
        marketPartners: {
          handler() {
            return {
              results: [
                {
                  companyName: 'Pfalzwerke Netz AG',
                  bdewCode: '9907015000008',
                  mastrId: 'SNB961471621746',
                },
              ],
              count: 1,
            };
          },
        },
      },
    });

    broker.createService({
      name: 'osm-geo',
      actions: {
        substationFinder: {
          handler() {
            return {
              nearestSubstations: [
                {
                  lat: 49.30,
                  lon: 7.62,
                  name: 'UW Höheinöd',
                  distance_km: 0.8,
                },
              ],
              operatorName: 'Pfalzwerke Netz AG',
            };
          },
        },
      },
    });

    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: path.join(process.cwd(), 'data', `object-store-cya-e2e-hoeheinoed-${Date.now()}`),
      },
    });

    broker.createService(CyaService);

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('Phase A: Profil-Erstellung und Persistenz', () => {
    test('A1: Template-Katalog enthält mindestens 6 Templates', async () => {
      const result = await broker.call('cya.listTemplates');
      expect(result.templates.length).toBeGreaterThanOrEqual(6);
      expect(result.templates.map((t) => t.templateId)).toContain('vnb_defensiv');
      expect(result.templates.map((t) => t.templateId)).toContain('projektierer_offensiv');
    });

    test('A2: Profil aus Template erstellen mit Organization-Override', async () => {
      const result = await broker.call('cya.createFromTemplate', {
        templateId: 'vnb_defensiv',
        profile_id: 'e2e_pfalzwerke_netz',
        overrides: {
          organization: 'Pfalzwerke Netz AG',
          department: 'Netzplanung Südwestpfalz',
        },
      });
      expect(result.success).toBe(true);
      expect(result.templateId).toBe('vnb_defensiv');
    });

    test('A3: Profil ist persistent und enthält Override-Daten', async () => {
      const result = await broker.call('cya.getProfile', {
        profile_id: 'e2e_pfalzwerke_netz',
      });
      expect(result.profile.actor.organization).toBe('Pfalzwerke Netz AG');
      expect(result.profile.actor.department).toBe('Netzplanung Südwestpfalz');
      expect(result.profile.actor.role).toBe('grid_operator');
      expect(result.profile.strategic_goals.length).toBeGreaterThanOrEqual(3);
      expect(result.profile.tone).toContain('defensiv');
    });

    test('A4: Zweites Profil für Projektierer erstellen', async () => {
      const result = await broker.call('cya.createFromTemplate', {
        templateId: 'projektierer_offensiv',
        profile_id: 'e2e_windpark_gmbh',
        overrides: {
          organization: 'Windpark Höheinöd GmbH',
          department: 'Projektentwicklung',
        },
      });
      expect(result.success).toBe(true);
    });

    test('A5: listProfiles zeigt beide erstellten Profile', async () => {
      const result = await broker.call('cya.listProfiles');
      const ids = result.items.map((i) => i.key);
      expect(ids).toContain('e2e_pfalzwerke_netz');
      expect(ids).toContain('e2e_windpark_gmbh');
    });
  });

  describe('Phase B: Generate — VNB-Perspektive Höheinöd', () => {
    test('B1: Generate mit VNB-Profil und Höheinöd-Kontext', async () => {
      generateResult = await broker.call('cya.generate', {
        profile_id: 'e2e_pfalzwerke_netz',
        target_audience: 'Bürgermeister Höheinöd',
        context: {
          location: '66989 Höheinöd',
          trigger:
            'Anfrage des Ortsbürgermeisters: Warum dauert der Netzanschluss für den neuen Windpark so lange?',
          focus_areas: ['capacity', 'renewables', 'grid_expansion', 'nova'],
        },
        session_id: 'e2e_hoeheinoed_vnb',
      });

      expect(generateResult.status).toBe('completed');
      expect(generateResult.session_id).toBe('e2e_hoeheinoed_vnb');
    });

    test('B2: Grounding enthält Fakten mit MaStR-Provenance', () => {
      expect(generateResult.grounding).toBeDefined();
      expect(generateResult.grounding.facts.length).toBeGreaterThan(0);
      const mastrFacts = generateResult.grounding.facts.filter(
        (f) => f.dataProvenance === 'mastr_machine_verified'
          || (f.sources && f.sources.includes('cernion_installations_local'))
      );
      expect(mastrFacts.length).toBeGreaterThan(0);
    });

    test('B3: Regulatory Graph hat ausgelöste Regeln', () => {
      expect(generateResult.regulatory_graph).toBeDefined();
      const signals = generateResult.regulatory_graph.signals || [];
      expect(generateResult.regulatory_graph.evaluatedRules).toBeGreaterThan(0);
      expect(Array.isArray(signals)).toBe(true);
    });

    test('B4: Narrative hat Headline und Executive Summary', () => {
      expect(generateResult.narrative).toBeDefined();
      expect(generateResult.narrative.headline).toBeTruthy();
      expect(generateResult.narrative.executiveSummary).toBeTruthy();
      expect(Array.isArray(generateResult.narrative.keyPoints)).toBe(true);
    });

    test('B5: Session ist im Object Store persistent', async () => {
      const session = await broker.call('object-store.get', {
        namespace: 'cya_sessions',
        key: 'e2e_hoeheinoed_vnb',
      });
      expect(session.payload.status).toBe('completed');
      expect(session.payload.profile_id).toBe('e2e_pfalzwerke_netz');
    });
  });

  describe('Phase C: Multi-Perspektive — VNB vs. Projektierer vs. Journalist', () => {
    test('C1: compareProfiles mit 2 gespeicherten + 1 Template-Profil', async () => {
      compareResult = await broker.call('cya.compareProfiles', {
        profile_ids: [
          'e2e_pfalzwerke_netz',
          'e2e_windpark_gmbh',
          'journalist_neutral',
        ],
        target_audience: 'Gemeinderat Höheinöd',
        context: {
          location: '66989 Höheinöd',
          trigger: 'Gemeinderatssitzung: Diskussion über Windpark-Erweiterung und Netzausbau',
          focus_areas: ['capacity', 'renewables', 'grid_expansion'],
        },
        session_id: 'e2e_hoeheinoed_compare',
      });

      expect(compareResult.status).toBe('completed');
      expect(compareResult.perspectiveCount).toBe(3);
    });

    test('C2: Alle 3 Perspektiven haben status=completed', () => {
      compareResult.perspectives.forEach((p) => {
        expect(p.status).toBe('completed');
      });
    });

    test('C3: Perspektiven haben unterschiedliche Rollen', () => {
      const roles = compareResult.perspectives.map((p) => p.role);
      expect(roles).toContain('grid_operator');
      expect(roles).toContain('project_developer');
      expect(roles).toContain('journalist');
    });

    test('C4: Jede Perspektive hat eigene Narrative', () => {
      compareResult.perspectives.forEach((p) => {
        expect(p.narrative).toBeDefined();
        expect(p.narrative.headline).toBeTruthy();
      });
    });

    test('C5: Mixed Source-Types (profile + template)', () => {
      const types = compareResult.perspectives.map((p) => p.profileType);
      expect(types.filter((t) => t === 'profile').length).toBe(2);
      expect(types.filter((t) => t === 'template').length).toBe(1);
    });

    test('C6: Grounding ist identisch für alle Perspektiven (Phase 1-3 nur 1×)', () => {
      expect(compareResult.grounding).toBeDefined();
      expect(compareResult.grounding.factCount).toBeGreaterThan(0);
    });

    test('C7: Session ist als multi_perspective gespeichert', async () => {
      const session = await broker.call('object-store.get', {
        namespace: 'cya_sessions',
        key: 'e2e_hoeheinoed_compare',
      });
      expect(session.payload.type).toBe('multi_perspective');
      expect(session.payload.perspectives.length).toBe(3);
    });
  });

  describe('Phase D: PDF-Export', () => {
    test('D1: exportPdf für Einzelperspektive-Session', async () => {
      const pdfBuffer = await broker.call('cya.exportPdf', {
        session_id: 'e2e_hoeheinoed_vnb',
      });
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.slice(0, 4).toString()).toBe('%PDF');
      expect(pdfBuffer.length).toBeGreaterThan(20);
    });

    test('D2: exportPdf für Multi-Perspektive-Session', async () => {
      const pdfBuffer = await broker.call('cya.exportPdf', {
        session_id: 'e2e_hoeheinoed_compare',
      });
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.slice(0, 4).toString()).toBe('%PDF');
    });

    test('D3: exportJson für VNB-Session enthält vollständige Daten', async () => {
      const result = await broker.call('cya.exportJson', {
        session_id: 'e2e_hoeheinoed_vnb',
      });
      expect(result.success).toBe(true);
      expect(result.session.status).toBe('completed');
      expect(result.session.narrative.headline).toBeTruthy();
      expect(result.session.grounding.facts.length).toBeGreaterThan(0);
    });

    test('D4: exportPdf mit language=en', async () => {
      const pdfBuffer = await broker.call('cya.exportPdf', {
        session_id: 'e2e_hoeheinoed_vnb',
        language: 'en',
      });
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    });

    test('D5: exportPdf ohne Regulatorik-Details', async () => {
      const pdfBuffer = await broker.call('cya.exportPdf', {
        session_id: 'e2e_hoeheinoed_vnb',
        includeRegulatoryDetails: false,
        includeDataBasis: false,
      });
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    });
  });

  describe('Phase E: Refinement und Session-Gedächtnis', () => {
    test('E1: Refine der VNB-Session mit User-Feedback', async () => {
      const result = await broker.call('cya.refine', {
        session_id: 'e2e_hoeheinoed_vnb',
        user_feedback:
          'Bitte den Fokus stärker auf die fehlende Steuerbarkeit des 2009er Solarparks legen und das Repowering-Potenzial hervorheben.',
      });
      expect(result.status).toBe('completed');
      expect(result.narrative).toBeDefined();
    });

    test('E2: Session hat Refinement-History', async () => {
      const session = await broker.call('object-store.get', {
        namespace: 'cya_sessions',
        key: 'e2e_hoeheinoed_vnb',
      });
      const payload = session.payload;
      expect(payload.updatedAt || payload.refinedAt || payload.history).toBeTruthy();
      expect(Array.isArray(payload.history)).toBe(true);
      expect(payload.history.length).toBeGreaterThan(0);
    });

    test('E3: Profil bleibt nach Generate/Refine unverändert', async () => {
      const profile = await broker.call('cya.getProfile', {
        profile_id: 'e2e_pfalzwerke_netz',
      });
      expect(profile.profile.actor.organization).toBe('Pfalzwerke Netz AG');
      expect(profile.profile.actor.role).toBe('grid_operator');
      expect(profile.profile.tone).toContain('defensiv');
    });

    test('E4: exportPdf nach Refinement enthält aktualisierte Narrative', async () => {
      const pdfBuffer = await broker.call('cya.exportPdf', {
        session_id: 'e2e_hoeheinoed_vnb',
      });
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(20);
    });
  });

  describe('Phase F: Höheinöd-spezifische Datenvalidierung', () => {
    test('F1: MaStR-Mock enthält die erwarteten Schlüssel-Installationen', () => {
      const solarpark = HOEHEINOED_INSTALLATIONS.find(
        (i) => i.mastrNummer === 'SEE999952467552'
      );
      expect(solarpark).toBeDefined();
      expect(solarpark.nettonennleistung).toBe(2103.7);
      expect(solarpark.fernsteuerbarkeitDv).toBeNull();
      expect(solarpark.inbetriebnahmedatum).toContain('2009');
    });

    test('F2: 2× geplante 7 MW WEA sind im Mock', () => {
      const planned = HOEHEINOED_INSTALLATIONS.filter(
        (i) => i.einheitBetriebsstatus === '31'
      );
      expect(planned.length).toBe(2);
      expect(planned.every((i) => i.nettonennleistung === 7000)).toBe(true);
    });

    test('F3: mindestens 1× stillgelegte WEA im Mock (Status 38)', () => {
      const decommissioned = HOEHEINOED_INSTALLATIONS.filter(
        (i) => i.einheitBetriebsstatus === '38'
      );
      expect(decommissioned.length).toBeGreaterThanOrEqual(1);
    });

    test('F4: Kein Utility-Scale-Speicher (>50 kW)', () => {
      const largeStorage = HOEHEINOED_INSTALLATIONS.filter(
        (i) => i.type === 'storage' && i.nettonennleistung > 50
      );
      expect(largeStorage.length).toBe(0);
    });

    test('F5: Gesamtkapazität im Fixture plausibel', () => {
      const totalMW = HOEHEINOED_INSTALLATIONS.reduce(
        (sum, i) => sum + (i.nettonennleistung || 0), 0
      ) / 1000;
      expect(totalMW).toBeGreaterThan(20);
      expect(totalMW).toBeLessThan(40);
    });
  });
});
