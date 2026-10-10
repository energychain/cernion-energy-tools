'use strict';

const { ServiceBroker } = require('moleculer');
const Api = require('../services/api.service');

describe('Agentic catalog discovery over real HTTP', () => {
  let broker, base, previousUrl;
  const read = jest.fn(() => ({ privateResult: 'NOT-DISCOVERY-DATA' }));
  beforeAll(async () => {
    previousUrl = process.env.API_URL;
    process.env.API_URL = 'https://cet.example';
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({ ...Api, settings: { ...Api.settings, port: 0 } });
    broker.createService({
      name: 'meter',
      settings: { password: 'NOT-PUBLISHED' },
      actions: {
        read: { rest: 'GET /read', openapi: { summary: 'Zählerstände prüfen' }, handler: read },
        internal: { visibility: 'protected', rest: 'POST /internal', handler: read },
      },
    });
    await broker.start();
    base = `http://127.0.0.1:${broker.getLocalService('api').server.address().port}`;
  });
  afterAll(async () => {
    await broker.stop();
    if (previousUrl === undefined) delete process.env.API_URL;
    else process.env.API_URL = previousUrl;
  });
  test('both public well-known routes serve the same valid catalog without calling domain actions', async () => {
    const response = await fetch(`${base}/.well-known/ai-catalog.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/ai-catalog+json');
    expect(response.headers.get('link')).toContain('rel="ard"');
    const catalog = await response.json();
    expect(catalog.specVersion).toBe('1.0');
    const meter = catalog.entries.find((entry) => entry.displayName === 'meter');
    expect(meter.capabilities).toContain('meter.read');
    expect(meter.capabilities).not.toContain('meter.internal');
    expect(meter.data.paths['/api/meter/read'].get.summary).toBe('Zählerstände prüfen');
    expect(catalog.host.documentationUrl).toBe('https://cet.example/api/docs');
    const ard = await fetch(`${base}/.well-known/ard.json`);
    expect(ard.status).toBe(200);
    expect(await ard.json()).toEqual(catalog);
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(catalog)).not.toMatch(/NOT-PUBLISHED|NOT-DISCOVERY-DATA/);
    const cached = await fetch(`${base}/.well-known/ai-catalog.json`, {
      headers: { 'If-None-Match': response.headers.get('etag') },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
  });
  test('discovery link is advertised at the root and newly loaded services appear automatically', async () => {
    const root = await fetch(base, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('link')).toContain('rel="ai-catalog"');
    broker.createService({
      name: 'new-service',
      actions: { ping: { rest: 'GET /ping', handler: read } },
    });
    await broker.waitForServices('new-service');
    const response = await fetch(`${base}/.well-known/ai-catalog.json`, {
      headers: { 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'http' },
    });
    const catalog = await response.json();
    expect(catalog.entries.some((entry) => entry.displayName === 'new-service')).toBe(true);
    expect(catalog.host.documentationUrl).toBe('https://cet.example/api/docs');
    expect(JSON.stringify(catalog)).not.toContain('attacker.example');
    expect(read).not.toHaveBeenCalled();
  });
});
