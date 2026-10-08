const { ServiceBroker } = require('moleculer');
const ApiGateway = require('moleculer-web');

jest.mock('../src/mcp-client', () => ({ callWithNewSession: jest.fn() }));
const { callWithNewSession } = require('../src/mcp-client');
const service = require('../services/energy-market.service');

describe('Issue #755 installations HTTP error regression', () => {
  let broker, base;
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(service);
    broker.createService({
      name: 'test-api',
      mixins: [ApiGateway],
      settings: {
        port: 0,
        routes: [
          {
            path: '/api',
            aliases: { 'POST /installations': 'energy-market.installations' },
            bodyParsers: { json: true },
            mappingPolicy: 'restrict',
          },
        ],
      },
    });
    await broker.start();
    base = `http://127.0.0.1:${broker.getLocalService('test-api').server.address().port}`;
  });
  afterAll(() => broker.stop());
  beforeEach(() => callWithNewSession.mockReset());

  it.each(['json', 'csv', 'xlsx'])(
    'returns HTTP 400 instead of 500 for the upstream error envelope (%s)',
    async (format) => {
      callWithNewSession
        .mockResolvedValueOnce({ success: true, results: [{ mastrId: 'SNB123456789012' }] })
        .mockResolvedValueOnce({ success: true, data: { isError: true } });
      const response = await fetch(`${base}/api/installations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationType: 'storage',
          gridOperatorName: 'Example',
          minCapacityKW: 100,
          limit: 5,
          format,
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining('gridOperatorMastrId'),
      });
    }
  );

  it.each(['lookup', 'installations'])(
    'returns actionable HTTP 400 when %s returns a null MCP response',
    async (phase) => {
      if (phase === 'installations')
        callWithNewSession.mockResolvedValueOnce({ results: [{ mastrId: 'SNB123456789012' }] });
      callWithNewSession.mockResolvedValueOnce(null);
      const response = await fetch(`${base}/api/installations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationType: 'storage',
          gridOperatorName: 'Example',
          limit: 5,
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining('gridOperatorMastrId'),
      });
      expect(callWithNewSession).toHaveBeenCalledTimes(phase === 'lookup' ? 1 : 2);
    }
  );
});
