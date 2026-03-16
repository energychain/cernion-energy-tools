const { resolveVnbIdentity } = require('../src/vnb-identity');

describe('vnb-identity', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('resolves identity from environment variables first', async () => {
    process.env.CERNION_VNB_MASTR_ID = 'SNB935578300972';
    process.env.CERNION_VNB_NAME = 'Stadtwerke Test';
    process.env.CERNION_VNB_BDEW = '9904350000002';

    const result = await resolveVnbIdentity(null);

    expect(result).toEqual({
      mastrId: 'SNB935578300972',
      name: 'Stadtwerke Test',
      bdewCode: '9904350000002',
    });
  });

  it('falls back to datasource metadata when env is not set', async () => {
    delete process.env.CERNION_VNB_MASTR_ID;
    delete process.env.CERNION_VNB_NAME;
    delete process.env.CERNION_VNB_BDEW;

    const broker = {
      call: jest.fn(async (actionName) => {
        if (actionName === 'datasource-registry.list') {
          return {
            data: [
              {
                id: 'source-1',
                updatedAt: '2026-03-16T10:00:00.000Z',
                connectorConfig: {
                  Anschlussnetzbetreiber: 'Netze Musterstadt GmbH',
                },
              },
            ],
          };
        }
        if (actionName === 'datasource-cache.query') {
          return { data: [] };
        }
        return null;
      }),
    };

    const result = await resolveVnbIdentity(broker);

    expect(result).toEqual({
      mastrId: null,
      name: 'Netze Musterstadt GmbH',
      bdewCode: null,
    });
  });

  it('returns null when nothing can be resolved', async () => {
    delete process.env.CERNION_VNB_MASTR_ID;
    delete process.env.CERNION_VNB_NAME;
    delete process.env.CERNION_VNB_BDEW;

    const broker = {
      call: jest.fn(async () => ({ data: [] })),
    };

    const result = await resolveVnbIdentity(broker);
    expect(result).toBeNull();
  });
});
