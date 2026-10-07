const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({ callWithNewSession: jest.fn() }));
const { callWithNewSession } = require('../src/mcp-client');
const service = require('../services/energy-market.service');

describe('Issue #755 installations filter resolution', () => {
  let broker;
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(service);
    await broker.start();
  });
  afterAll(() => broker.stop());
  beforeEach(() => {
    callWithNewSession.mockReset();
    callWithNewSession.mockResolvedValue({ success: true, data: { installations: [] } });
  });
  const search = (params = {}, meta = {}) =>
    broker.call(
      'energy-market.installations',
      { installationType: 'storage', limit: 5, ...params },
      { meta }
    );

  it('resolves a partial operator name from the real flat MCP response and delegates the token', async () => {
    callWithNewSession.mockResolvedValueOnce({
      success: true,
      results: [{ companyName: 'Example Netze GmbH', mastrId: 'SNB123456789012' }],
    });
    await search({ gridOperatorName: 'Example' }, { cernionToken: 'test-token' });
    expect(callWithNewSession.mock.calls[1]).toEqual([
      'cernion_installations_local',
      expect.objectContaining({ gridOperatorMastrId: 'SNB123456789012' }),
      'test-token',
    ]);
  });

  it.each([
    { success: false, error: { message: 'lookup unavailable' } },
    { success: true, data: { isError: true } },
    { success: true, results: [] },
    { success: true, results: [{ companyName: 'Supplier without operator ID' }] },
    { success: true, results: [{ mastrId: 'SNB111111111111' }, { mastrId: 'SNB222222222222' }] },
  ])('rejects unresolved or ambiguous names before an unfiltered search: %j', async (response) => {
    callWithNewSession.mockResolvedValueOnce(response);
    await expect(search({ gridOperatorName: 'Example' })).rejects.toMatchObject({
      code: 400,
      type: 'GRID_OPERATOR_UNRESOLVED',
    });
    expect(callWithNewSession).toHaveBeenCalledTimes(1);
  });

  it.each(['json', 'csv', 'xlsx'])(
    'regression: upstream isError never becomes HTTP 500 (%s)',
    async (format) => {
      callWithNewSession
        .mockResolvedValueOnce({ success: true, results: [{ mastrId: 'SNB123456789012' }] })
        .mockResolvedValueOnce({ success: true, data: { isError: true } });
      await expect(
        search({ gridOperatorName: 'Example', minCapacityKW: 100, format })
      ).rejects.toMatchObject({ code: 400 });
    }
  );

  it('reports a non-name upstream failure as 502', async () => {
    callWithNewSession.mockResolvedValueOnce({
      success: false,
      error: { message: 'backend unavailable' },
    });
    await expect(search()).rejects.toMatchObject({ code: 502 });
  });

  it.each(['69256', '69256 Mauer', 'Mauer'])(
    'resolves location %s with the existing postal directory',
    async (location) => {
      await search({ location });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_installations_local',
        expect.objectContaining({ postleitzahl: '69256' }),
        null
      );
    }
  );

  it('queries every postal code for a multi-PLZ city', async () => {
    const { resolveMunicipalityProfile } = require('../src/municipality-resolver');
    const codes = resolveMunicipalityProfile({ municipality: 'Heidelberg' }).postalCodes;
    await search({ location: 'Heidelberg' });
    expect(callWithNewSession.mock.calls.map((call) => call[1].postleitzahl)).toEqual(codes);
    expect(codes.length).toBeGreaterThan(1);
  });

  it.each(['Unknownville', 'Mauer, Rhein-Neckar-Kreis', 'Baden-Württemberg', 'Neustadt'])(
    'rejects unsupported or ambiguous location %s with the required format',
    async (location) => {
      await expect(search({ location })).rejects.toMatchObject({
        code: 400,
        message: expect.stringMatching(/postleitzahl/),
      });
      expect(callWithNewSession).not.toHaveBeenCalled();
    }
  );

  it('lets an explicit postal code override free text', async () => {
    await search({ location: 'Unknownville', postleitzahl: '69256' });
    expect(callWithNewSession.mock.calls[0][1].postleitzahl).toBe('69256');
  });

  it('rejects a nonnumeric postal code in parameter validation', async () => {
    await expect(search({ postleitzahl: 'abcde' })).rejects.toMatchObject({ code: 422 });
  });

  it('accepts a nested response, ignores malformed entries, and deduplicates one operator', async () => {
    callWithNewSession.mockResolvedValueOnce({
      success: true,
      data: {
        data: { results: [null, { mastrId: 'SNB123456789012' }, { mastrId: 'SNB123456789012' }] },
      },
    });
    await search({ gridOperatorName: 'Example' });
    expect(callWithNewSession.mock.calls[1][1].gridOperatorMastrId).toBe('SNB123456789012');
  });

  it('supports a BDEW-only market partner response', async () => {
    callWithNewSession.mockResolvedValueOnce({ results: [{ bdewCode: '9900992720003' }] });
    await search({ gridOperatorName: 'Example' });
    expect(callWithNewSession.mock.calls[1][1].gridOperatorBdewCode).toBe('9900992720003');
  });

  it('keeps an explicit operator ID without performing a name lookup', async () => {
    await search({ gridOperatorName: 'Example', gridOperatorMastrId: 'SNB123456789012' });
    expect(callWithNewSession).toHaveBeenCalledTimes(1);
    expect(callWithNewSession.mock.calls[0][0]).toBe('cernion_installations_local');
  });

  it('bounds the total result count across resolved postal codes', async () => {
    callWithNewSession.mockImplementation(async (_tool, params) => ({
      data: {
        installations: [{ mastrNummer: `SEE${params.postleitzahl}`, einheitBetriebsstatus: 35 }],
      },
    }));
    const result = await search({ location: 'Heidelberg', limit: 2 });
    expect(result.data.installations).toHaveLength(2);
    expect(result.data.pagination.hasMore).toBe(true);
    expect(callWithNewSession).toHaveBeenCalledTimes(2);
  });

  it('documents validated formats and installation types for calling tools', () => {
    const schema =
      service.actions.installations.openapi.requestBody.content['application/json'].schema;
    expect(schema.properties.installationType.enum).toContain('storage');
    expect(new RegExp(schema.properties.postleitzahl.pattern).test('01067')).toBe(true);
    expect(new RegExp(schema.properties.postleitzahl.pattern).test('abcde')).toBe(false);
    expect(schema.properties.gridOperatorName.description).toContain('400');
    expect(schema.properties.location.description).toContain('postleitzahl');
  });
});
