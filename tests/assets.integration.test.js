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
    const response = await broker.call('assets.byDSO', {
  "dso": "Stadtwerke Heidelberg Netz",
  "type": "storage"
});

    if (Array.isArray(response)) {
      expect(response.length).toBeGreaterThan(0);
      expect(response[0]).toHaveProperty('gCO2eqPerKWh');
    } else {
      expect(response).toBeTruthy();
    }
  }, 60000);
});
