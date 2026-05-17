'use strict';

/**
 * Tests for presentation.service.js (#CETview Step 1)
 *
 * Test matrix:
 *   T-PRES-01  KPI-Fact fixture (PV-Anlagen Wiesloch) → type=kpi_fact, Markdown table, no VDMI warning
 *   T-PRES-02  VDMI-like fixture with matrix.tasks → type=vdmi_matrix_table, stub warning
 *   T-PRES-03  Empty domainResult → type=debug_summary, fallback warning
 *   T-PRES-04  preferredFormat=kpi_fact overrides auto-selection
 */

const { ServiceBroker } = require('moleculer');
const PresentationService = require('../services/presentation.service');

describe('presentation.service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(PresentationService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  // --------------------------------------------------------------------------
  // T-PRES-01: KPI-Fact — PV-Anlagen in Wiesloch
  // --------------------------------------------------------------------------
  test('T-PRES-01: KPI-Fact fixture for PV installations in Wiesloch produces kpi_fact with table', async () => {
    const result = await broker.call('presentation.render', {
      intent: 'asset_count_query',
      domainResult: {
        label: 'PV-Anlagen in Wiesloch',
        count: 312,
        unit: 'Anlagen',
        area: 'Wiesloch',
        source: 'Marktstammdatenregister (MaStR)',
        asOf: '2026-05-17',
        note: 'Nur Anlagen mit Status InBetrieb',
      },
    });

    // Type
    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('kpi_fact');

    // KPI entry
    expect(result.presentation.kpis).toHaveLength(1);
    expect(result.presentation.kpis[0].value).toBe(312);
    expect(result.presentation.kpis[0].unit).toBe('Anlagen');

    // Table
    expect(result.presentation.tables).toHaveLength(1);
    const tableRows = result.presentation.tables[0].rows;
    const rowFields = tableRows.map(([f]) => f);
    expect(rowFields).toContain('Antwort');
    expect(rowFields).toContain('Gebiet');
    expect(rowFields).toContain('Quelle');
    expect(rowFields).toContain('Stand');
    expect(rowFields).toContain('Hinweis');

    // Markdown: must contain a table, must NOT contain any VDMI warning
    expect(result.markdown).toMatch(/\| Feld \| Wert \|/);
    expect(result.markdown).toMatch(/Wiesloch/);
    expect(result.markdown).not.toMatch(/vdmi_matrix_table/);
    expect(result.markdown).not.toMatch(/nicht implementiert/);

    // No warnings expected for a complete KPI fixture
    expect(result.presentation.warnings).toHaveLength(0);

    // Source surfaced
    expect(result.presentation.sources).toContain('Marktstammdatenregister (MaStR)');
  });

  // --------------------------------------------------------------------------
  // T-PRES-02: VDMI-like fixture — type selection and stub warning
  // --------------------------------------------------------------------------
  test('T-PRES-02: VDMI matrix fixture selects vdmi_matrix_table and returns stub warning', async () => {
    const result = await broker.call('presentation.render', {
      intent: 'vdmi_role_boundary_governance',
      domainResult: {
        matrix: {
          id: 'matrix-triwo-001',
          name: 'Netzanschluss §17 EnWG',
          tasks: [
            {
              taskId: 'network-operator-decision',
              taskName: 'Formelle Netzbetreiberentscheidung',
              verantwortlich: ['DSO_GATEKEEPER'],
              durchfuehrend: ['TECHNICAL_PLANNER'],
              mitwirkend: ['APPLICANT'],
              information: ['REGULATOR'],
            },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('vdmi_matrix_table');

    // Must contain the not-implemented-yet warning
    expect(result.presentation.warnings).toContain('vdmi_matrix_table_renderer_not_implemented_yet');
    expect(result.markdown).toMatch(/vdmi_matrix_table_renderer_not_implemented_yet/);

    // Must NOT contain any invented role data
    expect(result.markdown).not.toMatch(/DSO_GATEKEEPER/);
  });

  // --------------------------------------------------------------------------
  // T-PRES-03: Empty / unclear domainResult → debug_summary fallback
  // --------------------------------------------------------------------------
  test('T-PRES-03: Empty domainResult falls back to debug_summary with fallback warning', async () => {
    const result = await broker.call('presentation.render', {
      domainResult: {},
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('debug_summary');

    const warnCodes = result.presentation.warnings.join(' ');
    expect(warnCodes).toMatch(/debug_summary_fallback/);
  });

  test('T-PRES-03b: domainResult with only unrecognised keys falls back to debug_summary', async () => {
    const result = await broker.call('presentation.render', {
      domainResult: {
        unknownField: 'foo',
        anotherField: 42,
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('debug_summary');
    expect(result.presentation.warnings.join(' ')).toMatch(/debug_summary_fallback/);
    // Scalar fields must be in the summary, not dumped as JSON
    expect(result.markdown).toMatch(/unknownField/);
    expect(result.markdown).not.toMatch(/\{.*"unknownField".*\}/);
  });

  // --------------------------------------------------------------------------
  // T-PRES-04: preferredFormat overrides auto-selection
  // --------------------------------------------------------------------------
  test('T-PRES-04: preferredFormat=kpi_fact overrides auto-selection even for VDMI-like fixture', async () => {
    // This domainResult would normally trigger vdmi_matrix_table,
    // but the explicit preferredFormat must win.
    const result = await broker.call('presentation.render', {
      preferredFormat: 'kpi_fact',
      domainResult: {
        matrix: {
          tasks: [
            {
              verantwortlich: ['ACTOR_A'],
              durchfuehrend: [],
              mitwirkend: [],
              information: [],
            },
          ],
        },
        // kpi_fact requires at least value/count + one supporting field:
        value: 1,
        unit: 'Matrix',
        source: 'test',
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('kpi_fact');
    // No VDMI stub warning
    expect(result.presentation.warnings.join(' ')).not.toMatch(/vdmi_matrix_table/);
  });

  test('falls back to debug_summary with unknown_preferred_format on unknown preferredFormat', async () => {
    const result = await broker.call('presentation.render', {
      preferredFormat: 'totally_unknown_renderer',
      domainResult: {
        count: 7,
        unit: 'Anlagen',
        source: 'MaStR',
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('debug_summary');
    expect(result.presentation.warnings).toContain('unknown_preferred_format');
  });

  test('selects evidence_gap_table and renders structured evidence gap rows', async () => {
    const result = await broker.call('presentation.render', {
      domainResult: {
        evidenceGaps: [
          { name: 'Formaler Antrag', reason: 'Nicht eingereicht' },
          { label: 'Trassenplan', detail: 'Anlage fehlt' },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('evidence_gap_table');
    expect(result.presentation.warnings).toContain('evidence_gap_table_renderer_not_implemented_yet');
    expect(result.presentation.tables).toHaveLength(1);
    expect(result.presentation.tables[0].headers).toEqual(['Evidenzlücke', 'Grund']);
    expect(result.markdown).toMatch(/Evidenzlücke/);
    expect(result.markdown).toMatch(/Formaler Antrag/);
  });

  test('selects risk_table and renders structured risk rows', async () => {
    const result = await broker.call('presentation.render', {
      domainResult: {
        assetRisks: [
          { name: 'Trafo-Überlast', impact: 'Versorgungsausfall', mitigation: 'Lastmanagement' },
          { label: 'N-1-Verletzung', wirkung: 'Reduzierte Resilienz' },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('risk_table');
    expect(result.presentation.warnings).toContain('risk_table_renderer_not_implemented_yet');
    expect(result.presentation.tables).toHaveLength(1);
    expect(result.presentation.tables[0].headers).toEqual(['Risiko', 'Wirkung', 'Gegenmaßnahme']);
    expect(result.markdown).toMatch(/Trafo-Überlast/);
  });

  test('selects decision_brief for decision_blocked status and forbidden assumptions', async () => {
    const result = await broker.call('presentation.render', {
      domainResult: {
        expectedStatus: 'decision_blocked_pending_formal_request',
        forbiddenAssumptions: ['Kapazitätszusage ohne formalen Antrag'],
        nextActions: ['Formalen Antrag einreichen'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('decision_brief');
    expect(result.presentation.warnings).toContain('decision_brief_renderer_not_implemented_yet');
    expect(result.markdown).toMatch(/decision_brief_renderer_not_implemented_yet/);
    expect(result.markdown).toMatch(/decision_blocked_pending_formal_request/);
  });

  test('selects comparison_table for peers/items/variants collections', async () => {
    const result = await broker.call('presentation.render', {
      domainResult: {
        peers: [
          { name: 'A', score: 11 },
          { name: 'B', score: 9 },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('comparison_table');
    expect(result.presentation.warnings).toContain('comparison_table_renderer_not_implemented_yet');
    expect(result.presentation.tables).toHaveLength(1);
    expect(result.markdown).toMatch(/Vergleichstabelle/);
    expect(result.markdown).toMatch(/\| Eintrag \| Wert \|/);
  });

  test('kpi_fact without source sets missing_source and does not invent source', async () => {
    const result = await broker.call('presentation.render', {
      preferredFormat: 'kpi_fact',
      domainResult: {
        label: 'PV-Anlagen in Wiesloch',
        count: 312,
        unit: 'Anlagen',
        asOf: '2026-05-17',
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('kpi_fact');
    expect(result.presentation.warnings).toContain('missing_source');
    expect(result.presentation.sources).toEqual([]);
    expect(result.markdown).not.toMatch(/Quelle:/);
    expect(result.markdown).not.toMatch(/\| Quelle \|/);
  });

  test('kpi_fact without asOf sets missing_as_of and does not invent stand', async () => {
    const result = await broker.call('presentation.render', {
      preferredFormat: 'kpi_fact',
      domainResult: {
        label: 'PV-Anlagen in Wiesloch',
        count: 312,
        unit: 'Anlagen',
        source: 'Marktstammdatenregister (MaStR)',
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('kpi_fact');
    expect(result.presentation.warnings).toContain('missing_as_of');
    expect(result.markdown).not.toMatch(/\| Stand \|/);
  });

  test('still selects vdmi_matrix_table and returns not-implemented warning for VDMI fixture', async () => {
    const result = await broker.call('presentation.render', {
      domainResult: {
        matrix: {
          tasks: [
            {
              taskName: 'Formelle Netzbetreiberentscheidung',
              verantwortlich: ['DSO_GATEKEEPER'],
              durchfuehrend: ['TECHNICAL_PLANNER'],
              mitwirkend: ['APPLICANT'],
              information: ['REGULATOR'],
            },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.presentation.type).toBe('vdmi_matrix_table');
    expect(result.presentation.warnings).toContain('vdmi_matrix_table_renderer_not_implemented_yet');
  });

  // --------------------------------------------------------------------------
  // Additional guard: domainResult is required
  // --------------------------------------------------------------------------
  test('rejects call when domainResult is absent', async () => {
    await expect(
      broker.call('presentation.render', {})
    ).rejects.toThrow();
  });
});
