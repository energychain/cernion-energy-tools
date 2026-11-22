'use strict';

// Netzplanung pack (micro-agent tier, Phase 1). All data below is SYNTHETIC TEST DATA: the stub
// services stand in for the read actions the expanders call; no network, no model.

const { ServiceBroker } = require('moleculer');

const UNIT_IN_PROJECT = 'SEE900000000001';
const UNIT_OUTSIDE_LAYER0 = 'SEE900000000002';
const UNIT_UNKNOWN = 'SEE900000000003';
const UNIT_SLOW = 'SEE900000000009';
const PROJECT = {
  projectId: 'test-project-1',
  name: 'Testgebiet Nord (synthetisch)',
  bbox: { south: 49.0, west: 8.0, north: 49.5, east: 8.5 },
  municipalityKey: '01234567',
  layers: ['layer0'],
  graphStats: { nodes: 3, edges: 2 },
};
const seenTenants = [];

const stubs = [
  {
    name: 'znp',
    actions: {
      listProjects(ctx) {
        seenTenants.push(ctx.meta.tenantId);
        return { projects: [PROJECT], total: 1 };
      },
      getProjectAssets(ctx) {
        if (ctx.params.projectId !== PROJECT.projectId) throw new Error('not found');
        return {
          totalCount: 1,
          offset: 0,
          limit: ctx.params.limit,
          assets: [
            {
              mastrNummer: UNIT_IN_PROJECT,
              capacity: 99,
              assetType: 'solar',
              status: 'In Betrieb',
            },
          ],
        };
      },
    },
  },
  {
    name: 'osm-geo',
    actions: {
      async validate(ctx) {
        const { mastrNummer } = ctx.params;
        // An unref timer, so the slow source does not keep jest alive after the run.
        if (mastrNummer === UNIT_SLOW)
          await new Promise((resolve) => setTimeout(resolve, 5000).unref());
        if (mastrNummer === UNIT_UNKNOWN)
          return { success: false, degradedReason: 'NO_OBJECTS_FOUND' };
        return {
          success: true,
          data: {
            mastrNummer,
            installation: {
              location:
                mastrNummer === UNIT_OUTSIDE_LAYER0
                  ? { lat: 49.2, lon: 8.2 }
                  : { lat: 52, lon: 13 },
              installationType: 'solar',
              bruttoleistungKW: 99,
              registeredGridOperator: 'Testnetz GmbH',
              registeredGridOperatorId: 'SNB900000000001',
            },
            validation: {
              verdict: 'CONSISTENT',
              confidenceScore: 72,
              layer1_vnbdigital: { vnbFound: 'Testnetz GmbH' },
            },
          },
        };
      },
      substationFinder(ctx) {
        if (ctx.params.postalCode !== '12345')
          return { success: true, data: { summary: { totalSubstations: 0 } } };
        return {
          success: true,
          data: {
            summary: {
              totalSubstations: 4,
              byVoltageLevel: { NS_MS: 3, MS_HS: 1 },
              dominantOperator: 'Testnetz',
              dominantOperatorShare: 0.75,
            },
            substations: [
              {
                osmId: 'node/1',
                type: 'substation',
                subtype: 'transmission',
                voltageLevel: 'HS',
                name: 'UW Teststadt',
              },
              {
                osmId: 'node/2',
                type: 'substation',
                subtype: 'distribution',
                voltageLevel: 'NS',
                name: 'ONS Weg 1',
              },
            ],
            dataQuality: { coverageLabel: 'MEDIUM' },
          },
        };
      },
    },
  },
  {
    name: 'municipality',
    actions: {
      lookup(ctx) {
        if (ctx.params.municipality !== '12345') return { found: false, sourceStatus: 'no-match' };
        return {
          found: true,
          name: 'Teststadt',
          ags: '01234567',
          state: 'Testland',
          postalCode: '12345',
          sourceStatus: 'destatis-gv100',
        };
      },
    },
  },
  {
    name: 'agnes-bottleneck',
    actions: {
      list() {
        return {
          assessments: [
            {
              _id: 'agnes:test-1',
              label: 'Testbewertung',
              createdAt: '2026-01-01T00:00:00.000Z',
              overallSeverity: 'CRITICAL',
              summary: { criticalCount: 1, warningCount: 0, uncoveredBottlenecks: 1 },
              bottlenecks: [
                {
                  elementId: 'TR-7',
                  voltageLevel: 'MS',
                  severity: 'CRITICAL',
                  findings: [
                    {
                      code: 'N1_LOADING_CRITICAL',
                      value: 95,
                      message: 'Auslastung 95% überschreitet N-1-Grenzwert 90%',
                    },
                  ],
                },
              ],
              fnavCoverage: [{ elementId: 'TR-7', coverageStatus: 'INSUFFICIENT' }],
            },
          ],
        };
      },
    },
  },
  {
    name: 'gasnetz-waermeplanung',
    actions: {
      list() {
        return {
          reconciliations: [
            {
              _id: 'gwp:test-1',
              planningYear: 2030,
              kpis: { highRiskCount: 1, totalSegments: 2 },
              segmentResults: [
                {
                  segmentId: 'GS-11',
                  strandedRisk: 'HIGH',
                  decommissionHorizon: 'BY_2035',
                  totexSignal: 'HALT_NEW_INVESTMENT',
                },
              ],
            },
          ],
        };
      },
    },
  },
  {
    name: 'vnb-monitor',
    actions: {
      snapshot(ctx) {
        return {
          bdewCode: ctx.params.bdewCode,
          timestamp: '2026-01-01T00:00:00.000Z',
          identity: { name: 'Testnetz GmbH' },
          ewk: { anschlussdauer: { eeNS_weeks: 12, bundesmedianEeNS_weeks: 10, eeMS_weeks: 30 } },
        };
      },
    },
  },
];

const statements = (finding) => finding.facts.map((fact) => fact.statement);

describe('micro-agent pack netzplanung', () => {
  let broker;
  const expand = (object, context = {}) =>
    broker.call('micro-agent.netzplanung.expand', { object, context });

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    for (const stub of stubs) broker.createService(stub);
    broker.createService(require('../services/micro-agent-netzplanung.service'));
    await broker.start();
  });
  afterAll(() => broker.stop());

  test('the manifest declares all kinds and the concern', async () => {
    const manifest = await broker.call('micro-agent.netzplanung.describe');
    expect(manifest.expands.sort()).toEqual(
      ['concern', 'grid.connection_request', 'grid.node', 'plant.register_unit'].sort()
    );
    const detected = await broker.call('micro-agent.netzplanung.detect', {
      text: `Was ist mit ${UNIT_IN_PROJECT}?`,
    });
    expect(detected).toEqual([
      expect.objectContaining({ kind: 'plant.register_unit', value: UNIT_IN_PROJECT }),
    ]);
  });

  test('a MaStR unit: master data and ZNP membership with provenance, tenant in the call meta', async () => {
    seenTenants.length = 0;
    const finding = await expand(
      { objectId: 'O2', kind: 'plant.register_unit', value: UNIT_IN_PROJECT },
      { tenantId: 'tenant-test' }
    );
    expect(finding.failed).toBeUndefined();
    expect(finding.facts.every((fact) => fact.provenance.source)).toBe(true);
    const sources = finding.facts.map((fact) => fact.provenance.source);
    expect(sources).toEqual(
      expect.arrayContaining([
        'detectors.registerUnitNumbers',
        'osm-geo.validate',
        'znp.getProjectAssets',
      ])
    );
    expect(finding.facts.find((fact) => fact.role === 'quantity')).toMatchObject({
      value: '99',
      unit: 'kW',
      basis: 'source',
    });
    expect(statements(finding).join('\n')).toContain('Testgebiet Nord');
    expect(finding.relations).toEqual([expect.objectContaining({ from: 'O2', rel: 'belongs_to' })]);
    expect(seenTenants).toContain('tenant-test');
  });

  test('a unit inside a project area but missing in Layer 0 is reported, with the negative scope', async () => {
    const finding = await expand({ kind: 'plant.register_unit', value: UNIT_OUTSIDE_LAYER0 });
    expect(statements(finding).join('\n')).toContain('fehlt dort aber in Layer 0');
    expect(finding.negatives).toEqual([
      expect.objectContaining({ searched: UNIT_OUTSIDE_LAYER0, result: 'no_hit' }),
    ]);
    expect(finding.negatives[0].scope).toContain('Testgebiet Nord');
  });

  test('an unknown unit yields negatives with scope, a descriptive mention an open question', async () => {
    const finding = await expand({ kind: 'plant.register_unit', value: UNIT_UNKNOWN });
    expect(finding.negatives.map((row) => row.result)).toEqual(
      expect.arrayContaining(['degraded_NO_OBJECTS_FOUND', 'no_hit'])
    );
    expect(finding.negatives.every((row) => row.searched && row.scope)).toBe(true);
    const vague = await expand({ kind: 'plant.register_unit', value: 'die PV-Anlage am Rathaus' });
    expect(vague.facts).toEqual([]);
    expect(vague.openQuestions[0].question).toContain('MaStR-Nummer');
  });

  test('unsupported kinds are refused', async () => {
    const finding = await expand({ kind: 'invoice.number', value: 'R-1' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
  });

  test('a connection request: parsed values, area, project and the named station as follow-up', async () => {
    const object = {
      objectId: 'O3',
      kind: 'grid.connection_request',
      value: 'Batteriespeicher 2,5 MW in 12345, MS, Anschluss am UW Teststadt',
      provenance: { origin: 'message', quote: 'Batteriespeicher 2,5 MW in 12345' },
    };
    const finding = await expand(object);
    const quantity = finding.facts.find(
      (fact) => fact.basis === 'parsed' && fact.role === 'quantity'
    );
    expect(quantity).toMatchObject({ value: '2500', unit: 'kW' });
    expect(finding.facts.map((fact) => fact.provenance.source)).toEqual(
      expect.arrayContaining([
        'municipality.lookup',
        'znp.listProjects',
        'osm-geo.substationFinder',
      ])
    );
    expect(statements(finding).join('\n')).toContain('UW Teststadt');
    // 12345 is the postal code, not a capacity; 2,5 is not a postal code.
    expect(finding.facts.filter((fact) => fact.statement.startsWith('Genannter Ort'))).toHaveLength(
      1
    );
    const next = await broker.call('micro-agent.netzplanung.plan', { finding, object });
    expect(next).toEqual([expect.objectContaining({ kind: 'grid.node', value: 'UW Teststadt' })]);
  });

  test('a connection request without place and capacity asks instead of guessing', async () => {
    const finding = await expand({
      kind: 'grid.connection_request',
      value: 'neuer Anschluss für eine Wärmepumpe',
    });
    expect(finding.facts).toEqual([]);
    expect(finding.openQuestions.length).toBeGreaterThanOrEqual(2);
  });

  test('a grid node: bottleneck and gas segment from the stores, negatives with scope', async () => {
    const node = await expand({ kind: 'grid.node', value: 'TR-7 (MS)' });
    expect(statements(node).join('\n')).toContain('CRITICAL');
    expect(node.facts.map((fact) => fact.provenance.source)).toContain('agnes-bottleneck.list');
    expect(node.negatives).toEqual([
      expect.objectContaining({
        result: 'no_hit',
        scope: expect.stringContaining('gasnetz-waermeplanung'),
      }),
    ]);
    const segment = await expand({ kind: 'grid.node', value: 'Abschnitt GS-11' });
    expect(statements(segment).join('\n')).toContain('Stranded-Asset-Risiko HIGH');
    // TR-77 is not TR-7: no partial match.
    const other = await expand({ kind: 'grid.node', value: 'TR-77' });
    expect(other.facts).toEqual([]);
    expect(other.negatives.length).toBe(2);
  });

  test('a slow source does not throw: the expander returns what it has in time', async () => {
    const finding = await expand({ kind: 'plant.register_unit', value: UNIT_SLOW });
    expect(finding.failed).toBeUndefined();
    expect(finding.negatives).toEqual(
      expect.arrayContaining([expect.objectContaining({ result: 'source_unavailable' })])
    );
    expect(finding.facts[0].basis).toBe('parsed');
  }, 10000);

  test('the concern without consequence gives the area state', async () => {
    const finding = await expand({
      kind: 'concern',
      value: 'Wie lange dauert ein Netzanschluss bei 9900000000001?',
    });
    const sources = finding.facts.map((fact) => fact.provenance.source);
    expect(sources).toEqual(
      expect.arrayContaining([
        'znp.listProjects',
        'agnes-bottleneck.list',
        'gasnetz-waermeplanung.list',
        'vnb-monitor.snapshot',
      ])
    );
    expect(statements(finding).join('\n')).toContain('12 Wochen');
  });

  test('the concern with consequenceOf: affected planning objects or a scoped negative', async () => {
    const touched = await expand(
      { objectId: 'O1', kind: 'concern', value: 'Frage' },
      { consequenceOf: `Einheit ${UNIT_IN_PROJECT} wurde stillgelegt; Trafo TR-7 betroffen` }
    );
    expect(touched.relations.map((row) => row.rel)).toEqual(['affects', 'affects']);
    expect(touched.relations.map((row) => row.to).join(' ')).toContain('Testgebiet Nord');
    const untouched = await expand(
      { kind: 'concern', value: 'Frage' },
      { consequenceOf: 'Die Abschlagsrechnung wurde korrigiert' }
    );
    expect(untouched.facts).toEqual([]);
    expect(untouched.negatives).toEqual([
      expect.objectContaining({ result: 'no_identifier_in_finding', scope: expect.any(String) }),
    ]);
  });
});

test('format parsing: capacities, postal codes and voltage codes', () => {
  const { parsing } = require('../src/micro-agents/packs/netzplanung.expanders');
  expect(parsing.capacities('PV 750kWp und 1.500 kW sowie 0,63 MVA')).toEqual([
    expect.objectContaining({ kW: 750, quote: '750kWp' }),
    expect.objectContaining({ kW: 1500, quote: '1.500 kW' }),
    expect.objectContaining({ kW: 630, quote: '0,63 MVA' }),
  ]);
  expect(parsing.postalCodes('Anlage 12000 kW in 54321')).toEqual(['54321']);
  expect(parsing.voltageLevels('Umspannung MS/NS')).toEqual(['MS', 'NS']);
});
