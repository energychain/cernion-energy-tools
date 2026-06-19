const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const Re4deVariableGridFeeService = require('../services/re4de-variable-grid-fee.service');

describe('re4de-variable-grid-fee service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...Re4deVariableGridFeeService,
      settings: {
        ...Re4deVariableGridFeeService.settings,
        dbPath: path.join(os.tmpdir(), `re4de-vgf-test-db-${Date.now()}`),
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  const meta = { tenantId: 'test-tenant' };

  function tariffSheet(overrides = {}) {
    return {
      tariffSheetId: 'vgf-sheet-001',
      version: '1.0.0',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      publishedBy: 'vnb-demo',
      gridAreaId: 'grid-area-demo',
      gridOperatorId: 'vnb-demo',
      currency: 'EUR',
      priceUnit: 'ct/kWh',
      timezone: 'UTC',
      basePriceEurPerYear: 365,
      windows: [
        { windowId: 'offpeak', dayType: 'all', from: '00:00', to: '12:00', priceCtPerKwh: 4, priority: 10 },
        { windowId: 'peak', dayType: 'all', from: '12:00', to: '24:00', priceCtPerKwh: 8, priority: 10 },
      ],
      ...overrides,
    };
  }

  function meteringInput(overrides = {}) {
    return {
      maloId: 'malo-demo',
      meloId: 'melo-demo',
      resolution: 'PT15M',
      timezone: 'UTC',
      values: [
        { from: '2026-01-01T10:00:00.000Z', to: '2026-01-01T11:00:00.000Z', kwh: 10 },
      ],
      ...overrides,
    };
  }

  test('calculate persists deterministic variable grid-fee evidence', async () => {
    const result = await broker.call(
      're4de-variable-grid-fee.calculate',
      {
        tariffSheet: tariffSheet(),
        meteringInput: meteringInput(),
        section14aConfig: { eligible: true, module: 'MODULE_3', deviceId: 'wb-001' },
        sourceActions: ['edm.validation.getIntervals'],
      },
      { meta }
    );

    expect(result.status).toBe('calculated');
    expect(result.calculationId).toMatch(/^re4de-vgf:/);
    expect(result.tariffSchema).toBe('cernion.re4de.tariffSheet.v1');
    expect(result.totalKwh).toBe(10);
    expect(result.variableFeeEur).toBe(0.4);
    expect(result.basePriceEur).toBe(0.04);
    expect(result.totalEur).toBe(0.44);
    expect(result.section14aApplied).toBe(true);
    expect(result.validationFindings).toEqual([]);

    const evidence = await broker.call(
      're4de-variable-grid-fee.getEvidence',
      { calculationId: result.calculationId },
      { meta }
    );
    expect(evidence.found).toBe(true);
    expect(evidence.evidenceId).toBe(result.evidenceId);
    expect(evidence.tariffSheetId).toBe('vgf-sheet-001');
    expect(evidence.sourceActions).toEqual(['edm.validation.getIntervals']);
  });

  test('calculate splits intervals proportionally at tariff-window boundaries', async () => {
    const result = await broker.call(
      're4de-variable-grid-fee.calculate',
      {
        tariffSheet: tariffSheet({ basePriceEurPerYear: 0 }),
        meteringInput: meteringInput({
          values: [
            { from: '2026-01-01T11:30:00.000Z', to: '2026-01-01T12:30:00.000Z', kwh: 10 },
          ],
        }),
      },
      { meta }
    );

    expect(result.status).toBe('calculated');
    expect(result.variableFeeEur).toBe(0.6);
    expect(result.windowBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ windowId: 'offpeak', kwh: 5, eur: 0.2 }),
        expect.objectContaining({ windowId: 'peak', kwh: 5, eur: 0.4 }),
      ])
    );
  });

  test('calculate applies tariff windows using the ISO timestamp offset', async () => {
    const result = await broker.call(
      're4de-variable-grid-fee.calculate',
      {
        tariffSheet: tariffSheet({
          timezone: 'Europe/Berlin',
          basePriceEurPerYear: 0,
          windows: [
            { windowId: 'berlin-offpeak', dayType: 'all', from: '00:00', to: '12:00', priceCtPerKwh: 4, priority: 10 },
            { windowId: 'berlin-peak', dayType: 'all', from: '12:00', to: '24:00', priceCtPerKwh: 8, priority: 10 },
          ],
        }),
        meteringInput: meteringInput({
          timezone: 'Europe/Berlin',
          values: [
            { from: '2026-01-01T12:00:00+01:00', to: '2026-01-01T13:00:00+01:00', kwh: 10 },
          ],
        }),
      },
      { meta }
    );

    expect(result.status).toBe('calculated');
    expect(result.variableFeeEur).toBe(0.8);
    expect(result.windowBreakdown).toEqual([
      expect.objectContaining({ windowId: 'berlin-peak', kwh: 10, eur: 0.8 }),
    ]);
  });

  test('calculate records validation findings instead of silently correcting bad input', async () => {
    const result = await broker.call(
      're4de-variable-grid-fee.calculate',
      {
        tariffSheet: tariffSheet({ windows: [{ windowId: 'bad', from: '99:00', to: '10:00', priceCtPerKwh: 1 }] }),
        meteringInput: meteringInput({ timezone: 'Europe/Berlin' }),
      },
      { meta }
    );

    expect(result.status).toBe('invalid');
    expect(result.totalEur).toBe(0);
    expect(result.validationFindings.map((finding) => finding.finding)).toEqual(
      expect.arrayContaining([
        'RE4DE_TARIFF_WINDOW_INVALID',
        'RE4DE_TARIFF_WINDOWS_MISSING',
        'RE4DE_TIMEZONE_MISMATCH',
      ])
    );
  });

  test('getEvidence returns dossier-safe not-found state and protects tenant scope', async () => {
    const result = await broker.call(
      're4de-variable-grid-fee.calculate',
      { tariffSheet: tariffSheet(), meteringInput: meteringInput() },
      { meta }
    );

    await expect(
      broker.call(
        're4de-variable-grid-fee.getCalculation',
        { calculationId: result.calculationId },
        { meta: { tenantId: 'other-tenant' } }
      )
    ).rejects.toMatchObject({ code: 404, type: 'CALCULATION_NOT_FOUND' });

    const missing = await broker.call(
      're4de-variable-grid-fee.getEvidence',
      { calculationId: 're4de-vgf:missing' },
      { meta }
    );
    expect(missing).toEqual({
      found: false,
      message: 'No Re4DE variable grid-fee calculation evidence is available for this tenant yet',
    });
  });
});
