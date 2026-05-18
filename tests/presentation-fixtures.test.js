'use strict';

const { ServiceBroker } = require('moleculer');
const PresentationService = require('../services/presentation.service');

const triwoFixture = require('./fixtures/presentation/triwo-vdmi-decision.fixture');
const pvKpiFixture = require('./fixtures/presentation/pv-wiesloch-kpi.fixture');
const comparisonFixture = require('./fixtures/presentation/vnb-benchmark-comparison.fixture');
const bessDdFixture = require('./fixtures/presentation/bess-financier-due-diligence.fixture');

describe('presentation fixtures (#CETview Prompt 7)', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(PresentationService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  test('PRES-TRIWO-01: renders VDMI five-column role matrix', async () => {
    const result = await broker.call('presentation.render', triwoFixture);

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('vdmi_matrix_table');
    expect(result.markdown).toContain('| Beschreibung des Schrittes | Verantwortlich | Durchführend | Mitwirkend | Informiert |');
    expect(result.markdown).toContain('TWL Netze');
  });

  test('PRES-TRIWO-02: includes evidence gaps and forbidden assumptions sections', async () => {
    const result = await broker.call('presentation.render', triwoFixture);

    expect(result.success).toBe(true);
    expect(result.markdown).toContain('### Evidenzlücken');
    expect(result.markdown).toContain('### Verbotene Annahmen');
    expect(result.markdown).toContain('formalen Antrag');
  });

  test('PRES-TRIWO-03: does not infer missing actors from prose and warns on missing role fields', async () => {
    const noRoleFixture = {
      ...triwoFixture,
      domainResult: {
        ...triwoFixture.domainResult,
        matrix: {
          ...triwoFixture.domainResult.matrix,
          tasks: [
            {
              taskId: 'triwo-missing-role-fields',
              taskName: 'Gatekeeping-Entscheidung Anschlussbegehren',
            },
          ],
        },
      },
    };

    const result = await broker.call('presentation.render', noRoleFixture);

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('vdmi_matrix_table');
    expect(result.presentation.warnings).toContain('missing_role_field_verantwortlich');
    expect(result.presentation.warnings).toContain('missing_role_field_durchfuehrend');
    expect(result.presentation.warnings).toContain('missing_role_field_mitwirkend');
    expect(result.presentation.warnings).toContain('missing_role_field_information');

    const firstRow = result.presentation.tables[0].rows[0];
    expect(firstRow[1]).toBe('—');
    expect(firstRow[2]).toBe('—');
    expect(firstRow[3]).toBe('—');
    expect(firstRow[4]).toBe('—');
  });

  test('PRES-KPI-01: PV fixture renders as kpi_fact', async () => {
    const result = await broker.call('presentation.render', pvKpiFixture);

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('kpi_fact');
    expect(result.markdown).toContain('42');
  });

  test('PRES-KPI-02: simple KPI output does not contain VDMI table header', async () => {
    const result = await broker.call('presentation.render', pvKpiFixture);

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('kpi_fact');
    expect(result.markdown).not.toContain('| Beschreibung des Schrittes | Verantwortlich | Durchführend | Mitwirkend | Informiert |');
  });

  test('PRES-KPI-03: missing source/asOf creates warnings without inventing metadata', async () => {
    const result = await broker.call('presentation.render', {
      ...pvKpiFixture,
      domainResult: {
        ...pvKpiFixture.domainResult,
        source: undefined,
        asOf: undefined,
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('kpi_fact');
    expect(result.presentation.warnings).toContain('missing_source');
    expect(result.presentation.warnings).toContain('missing_as_of');
    expect(result.markdown).not.toContain('Quelle:');
    expect(result.markdown).not.toContain('| Stand |');
  });

  test('PRES-COMP-01: benchmark fixture renders as comparison_table', async () => {
    const result = await broker.call('presentation.render', comparisonFixture);

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('comparison_table');
    expect(result.markdown).toContain('| Eintrag | Wert |');
  });

  test('PRES-COMP-02: missing values are not invented from prose', async () => {
    const result = await broker.call('presentation.render', comparisonFixture);

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('comparison_table');
    expect(result.markdown).toContain('Stadtwerke Troisdorf');
    expect(result.markdown).toContain('Digitalisierungsindex —');
    expect(result.markdown).not.toContain('0.76 | Digitalisierungsindex 0.76');
  });

  test('PRES-EVID-01: evidence fixture renders evidence_gap_table', async () => {
    const result = await broker.call('presentation.render', {
      intent: 'risk_analysis',
      domainResult: {
        evidenceGaps: [
          { label: 'BKZ-Bestätigung', reason: 'fehlt' },
        ],
        evidenceRequirements: [
          { label: 'Verbindliche Netzanschlussbestätigung' },
        ],
        sources: ['fixture:evidence-test'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('evidence_gap_table');
    expect(result.markdown).toContain('Evidenzlücke');
  });

  test('PRES-RISK-01: risk fixture renders risk_table', async () => {
    const result = await broker.call('presentation.render', {
      intent: 'risk_analysis',
      domainResult: {
        risks: [
          {
            risk: 'Grid delay',
            severity: 'high',
            impact: 'COD delay',
            mitigation: 'milestone contract',
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('risk_table');
    expect(result.markdown).toContain('Grid delay');
  });

  test('PRES-DEC-01: decision fixture renders decision_brief', async () => {
    const result = await broker.call('presentation.render', {
      intent: 'risk_analysis',
      domainResult: {
        decisionStatus: 'decision_blocked_until_evidence',
        expectedStatus: 'conditional_go',
        forbiddenAssumptions: ['No grid assumption without evidence'],
        nextActions: ['Provide binding grid confirmation'],
        evidenceGaps: [{ label: 'Grid confirmation', reason: 'missing' }],
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('decision_brief');
    expect(result.markdown).toContain('Entscheidungsstatus: decision_blocked_until_evidence');
  });

  test('PRES-DEC-02: object-valued nextActions are deterministic and never [object Object]', async () => {
    const result = await broker.call('presentation.render', {
      intent: 'risk_analysis',
      domainResult: {
        decisionStatus: 'decision_blocked_until_evidence',
        nextActions: [
          { id: 'na-1', type: 'condition', label: 'Payout condition: grid confirmation' },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('decision_brief');
    expect(result.markdown).toContain('Payout condition: grid confirmation');
    expect(result.markdown).not.toContain('[object Object]');
  });

  test('PRES-BANK-DD-01: due-diligence fixture renders deterministic primary decision_brief', async () => {
    const result = await broker.call('presentation.render', bessDdFixture);

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('decision_brief');
    expect(result.markdown).toContain('## Entscheidungsbrief');
  });

  test('PRES-BANK-DD-02: due-diligence risk attributes render in structured section/table', async () => {
    const result = await broker.call('presentation.render', bessDdFixture);

    expect(result.success).toBe(true);
    const riskTable = result.presentation.tables.find((table) => table.id === 'decision_risks');
    expect(riskTable).toBeDefined();
    expect(riskTable.headers).toEqual(['Risiko', 'Schweregrad', 'Wirkung', 'Gegenmaßnahme']);
    expect(result.markdown).toContain('Grid connection risk');
    expect(result.markdown).toContain('high');
  });

  test('PRES-BANK-DD-03: missing lender evidence renders structured evidence section/table', async () => {
    const result = await broker.call('presentation.render', bessDdFixture);

    expect(result.success).toBe(true);
    const evidenceTable = result.presentation.tables.find((table) => table.id === 'decision_evidence');
    expect(evidenceTable).toBeDefined();
    expect(evidenceTable.headers).toEqual(['Typ', 'Evidenz / Lücke', 'Detail']);
    expect(result.markdown).toContain('Binding grid connection confirmation / BKZ');
  });

  test('PRES-BANK-DD-04: unverified assumptions persist as warnings and no source/asOf is invented', async () => {
    const result = await broker.call('presentation.render', bessDdFixture);

    expect(result.success).toBe(true);
    expect(result.presentation.warnings).toContain('fixture_unverified_user_assertions');
    expect(result.markdown).not.toContain('Quelle:');
    expect(result.markdown).not.toContain('| Stand |');
  });

  test('PRES-BANK-DD-05: markdown contains financing-oriented next actions / payout conditions', async () => {
    const result = await broker.call('presentation.render', bessDdFixture);

    expect(result.success).toBe(true);
    expect(result.markdown).toContain('Grid connection confirmation as payout condition');
    expect(result.markdown).toContain('Require DSCR downside revenue case');
  });
});
