/**
 * Assets Integration Test (live MCP)
 */

const path = require('path');
const { ServiceBroker } = require('moleculer');

describe('Assets Integration', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.loadServices(path.join(__dirname, '..', 'services'));
    broker.loadServices(path.join(__dirname, '..', 'custom-services'));
    await broker.start();
  }, 60000);

  afterAll(async () => {
    await broker.stop();
  });

  it('should return data from live MCP', async () => {
    const response = await broker.call('assets.list', {
      vnbName: 'Stadtwerke Heidelberg Netz',
      assetType: 'storage',
    });

    // Assets service returns array of installation objects
    expect(Array.isArray(response)).toBe(true);
    if (response.length > 0) {
      // Check for core MaStR fields
      expect(response[0]).toHaveProperty('SEE Nummer');
      expect(response[0]).toHaveProperty('Betreiber');
      expect(response[0]).toHaveProperty('Anlagentyp');
      expect(response[0]).toHaveProperty('Leistung MW');
    }
  }, 60000);
});
