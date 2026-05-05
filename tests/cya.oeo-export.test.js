'use strict';

const CyaService = require('../services/cya.service');

describe('cya OEO export actions', () => {
  test('export.oeo returns productive JSON-LD payload', async () => {
    const result = await CyaService.actions['export.oeo'].handler({ params: {} });

    expect(result.ok).toBe(true);
    expect(result.oeo).toBeDefined();
    expect(result.warnings).toEqual([]);
    expect(result.validationSummary.status).toBe('ok');
    expect(result.deprecated).toBeUndefined();
  });

  test('export.oeo uses operator parameter in seeded graph', async () => {
    const result = await CyaService.actions['export.oeo'].handler({
      params: { operator: 'Stadtwerke Beispiel' },
    });

    const vnbNode = result.oeo['@graph'].find((entry) => entry['rdfs:label'] === 'Stadtwerke Beispiel');
    expect(vnbNode).toBeDefined();
  });

  test('export.oeo-stub acts as deprecated alias with sunset metadata', async () => {
    const result = await CyaService.actions['export.oeo-stub'].handler({ params: {} });

    expect(result.ok).toBe(true);
    expect(result.deprecated).toMatchObject({
      alias: '/api/cya/graph/export/oeo-stub',
      replacement: '/api/cya/graph/export/oeo',
      sunsetDate: '2026-11-05',
    });
  });

  test('export.oeo rejects unsupported OEO versions with explicit type', async () => {
    await expect(
      CyaService.actions['export.oeo'].handler({ params: { oeoVersion: '1.0.0' } })
    ).rejects.toMatchObject({ type: 'UNSUPPORTED_OEO_VERSION', code: 400 });
  });
});
