'use strict';

const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const AuthService = require('../services/auth.service');
const ApiService = require('../services/api.service');

describe('auth service foundation', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...AuthService,
      settings: {
        ...AuthService.settings,
        dbPath: path.join(os.tmpdir(), `cernion-auth-test-${Date.now()}`),
        oidc: {
          issuer: 'https://id.example.com',
          clientId: 'client-1',
          authorizationEndpoint: 'https://id.example.com/authorize',
          redirectUri: 'https://api.example.com/api/auth/oidc/callback',
          scope: 'openid profile email groups',
          groupRoleMap: {
            'cernion-approver': 'hitl-approver',
          },
        },
        saml: {
          entryPoint: 'https://adfs.example.com/adfs/ls/',
          issuer: 'urn:cernion',
          callbackUrl: 'https://api.example.com/api/auth/saml/acs',
          cert: 'dummy-cert',
          groupRoleMap: {
            'cernion-admin': 'full-access',
          },
        },
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  test('creates oidc authorization url', async () => {
    const result = await broker.call('auth.oidcLogin', { state: 's1', nonce: 'n1' });
    expect(result.success).toBe(true);
    expect(result.authorizationUrl).toContain('response_type=code');
    expect(result.authorizationUrl).toContain('state=s1');
  });

  test('creates and verifies session from oidc callback', async () => {
    const callback = await broker.call('auth.oidcCallback', {
      claims: {
        sub: 'user-oidc-1',
        groups: ['cernion-approver'],
      },
    });

    expect(callback.session.token.startsWith('csess_')).toBe(true);

    const verification = await broker.call('auth.verify', {
      token: callback.session.token,
      trackUsage: true,
    });

    expect(verification.valid).toBe(true);
    expect(verification.userId).toBe('user-oidc-1');
    expect(verification.roles).toContain('hitl-approver');
  });

  test('logout revokes session', async () => {
    const callback = await broker.call('auth.oidcCallback', {
      claims: { sub: 'user-logout-1' },
    });

    const logout = await broker.call('auth.logout', {
      token: callback.session.token,
    });

    expect(logout.revoked).toBe(true);

    const verification = await broker.call('auth.verify', {
      token: callback.session.token,
    });

    expect(verification.valid).toBe(false);
  });
});

describe('api auth role checks', () => {
  const apiRoute = ApiService.settings.routes.find((route) => route.path === '/api');

  function buildRequest(url, method, token) {
    return {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      query: {},
      body: {},
      params: {},
      $params: {},
      method,
      url,
    };
  }

  test('rejects hitl approve without hitl-approver role', async () => {
    const broker = {
      call: jest.fn().mockResolvedValue({
        valid: true,
        sessionId: 's1',
        userId: 'user-1',
        tenantId: 'tenant-a',
        groups: ['ops'],
        roles: ['full-access'],
      }),
    };

    await expect(
      apiRoute.onBeforeCall.call(
        { logger: { debug: jest.fn() }, broker },
        { meta: {} },
        apiRoute,
        buildRequest('/api/hitl/items/abc/approve', 'POST', 'csess_token'),
        {}
      )
    ).rejects.toMatchObject({ code: 403, type: 'ROLE_REQUIRED' });
  });

  test('allows hitl approve with hitl-approver role', async () => {
    const broker = {
      call: jest.fn().mockResolvedValue({
        valid: true,
        sessionId: 's2',
        userId: 'user-2',
        tenantId: 'tenant-a',
        groups: ['cernion-approver'],
        roles: ['hitl-approver', 'full-access'],
      }),
    };
    const ctx = { meta: {} };

    await expect(
      apiRoute.onBeforeCall.call(
        { logger: { debug: jest.fn() }, broker },
        ctx,
        apiRoute,
        buildRequest('/api/hitl/items/abc/approve', 'POST', 'csess_token'),
        {}
      )
    ).resolves.toBeUndefined();

    expect(ctx.meta.authUser.userId).toBe('user-2');
  });

  test('rejects write endpoint without full-access role', async () => {
    const broker = {
      call: jest.fn().mockResolvedValue({
        valid: true,
        sessionId: 's3',
        userId: 'user-3',
        tenantId: 'tenant-a',
        groups: ['cernion-approver'],
        roles: ['hitl-approver'],
      }),
    };

    await expect(
      apiRoute.onBeforeCall.call(
        { logger: { debug: jest.fn() }, broker },
        { meta: {} },
        apiRoute,
        buildRequest('/api/hitl/items/abc/reject', 'POST', 'csess_token'),
        {}
      )
    ).rejects.toMatchObject({ code: 403, type: 'ROLE_REQUIRED' });
  });
});
