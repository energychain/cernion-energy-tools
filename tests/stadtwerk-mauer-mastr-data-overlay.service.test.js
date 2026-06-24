'use strict';

const { ServiceBroker } = require('moleculer');

const MastrDataOverlayService = require('../services/stadtwerk-mauer-mastr-data-overlay.service');

describe('stadtwerk-mauer-mastr-data-overlay service', () => {
  let broker;
  let calls;

  beforeAll(async () => {
    calls = [];
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          handler(ctx) {
            calls.push(ctx.params);
            return {
              success: true,
              data: {
                installations: [
                  {
                    mastrNummer: 'SEE-MAUER-001',
                    installationType: 'solar',
                    bruttoleistung: 12.5,
                    netzbetreiberName: 'Syna GmbH',
                    netzbetreiberMastrNummer: 'SNB-SYNA',
                  },
                  {
                    mastrNummer: 'SEE-MAUER-002',
                    installationType: 'storage',
                    bruttoleistung: 7.5,
                    gridOperatorName: 'Syna GmbH',
                    gridOperatorMastrId: 'SNB-SYNA',
                  },
                ],
              },
            };
          },
        },
      },
    });
    broker.createService(MastrDataOverlayService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    calls = [];
  });

  it('builds a real MaStR baseline with virtual Stadtwerk Mauer operator overlay', async () => {
    const result = await broker.call(
      'stadtwerk-mauer-mastr-data-overlay.getStatus',
      {},
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(result.status).toBe('blended_overlay_ready');
    expect(result.tenantId).toBe('stadtwerk-mauer');
    expect(result.postalCode).toBe('69256');
    expect(result.municipality).toBe('Mauer');
    expect(result.assetCount).toBe(2);
    expect(result.totalCapacityKw).toBe(20);
    expect(result.typeCounts).toMatchObject({ solar: 1, storage: 1 });
    expect(result.originalGridOperators[0]).toMatchObject({
      name: 'Syna GmbH',
      mastrId: 'SNB-SYNA',
      assetCount: 2,
    });
    expect(result.operatorOverlay.virtualGridOperator.name).toBe('Stadtwerk Mauer');
    expect(result.operatorOverlay.realWorldOperatorHint.name).toBe('Syna GmbH');
    expect(result.operatorOverlay.preservesOriginalMastrFacts).toBe(true);
    expect(result.operatorOverlay.mutatesMastrRecords).toBe(false);
    expect(result.sampleAssets[0]).toMatchObject({
      mastrNummer: 'SEE-MAUER-001',
      originalGridOperatorName: 'Syna GmbH',
      virtualGridOperatorName: 'Stadtwerk Mauer',
    });
    expect(result.resetBoundary.deletesImportedMastrBaseline).toBe(false);
    expect(result.sourceActions.notCalled).toEqual(
      expect.arrayContaining(['mako.dispatch', 'device-control.execute', 'mastr.write'])
    );
    expect(calls[0]).toMatchObject({
      installationType: 'all',
      postleitzahl: '69256',
      location: 'Mauer',
      operationalStatus: 'all',
      includeNapData: true,
      limit: 'all',
    });
  });

  it('blocks non-Mauer tenants before querying MaStR', async () => {
    const result = await broker.call(
      'stadtwerk-mauer-mastr-data-overlay.getStatus',
      {},
      { meta: { tenantId: 'public' } }
    );

    expect(result.status).toBe('blocked_outside_sandbox_tenant');
    expect(result.sandboxBoundaryAllowed).toBe(false);
    expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
      'stadtwerk_mauer_tenant_scope'
    );
    expect(calls).toHaveLength(0);
  });
});
