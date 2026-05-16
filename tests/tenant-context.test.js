'use strict';

/**
 * Tests: tenant-context.js — v0.38.0 Multi-Tenant Fundament
 */

const {
  getTenantId,
  tenantNamespace,
  tenantKey,
  validateTenantId,
  isTenantAllowed,
  DEFAULT_TENANT,
} = require('../src/tenant-context');

// ─── getTenantId ─────────────────────────────────────────────────────────────

describe('getTenantId', () => {
  test('ctx mit tenantId → gibt tenantId zurück', () => {
    const ctx = { meta: { tenantId: 'stadtwerk-a' } };
    expect(getTenantId(ctx)).toBe('stadtwerk-a');
  });

  test('ctx ohne tenantId → gibt DEFAULT_TENANT zurück', () => {
    const ctx = { meta: {} };
    expect(getTenantId(ctx)).toBe('default');
  });

  test('null ctx → gibt DEFAULT_TENANT zurück', () => {
    expect(getTenantId(null)).toBe('default');
  });

  test('undefined ctx → gibt DEFAULT_TENANT zurück', () => {
    expect(getTenantId(undefined)).toBe('default');
  });

  test('ctx mit leerem tenantId-String → gibt DEFAULT_TENANT zurück', () => {
    const ctx = { meta: { tenantId: '' } };
    expect(getTenantId(ctx)).toBe('default');
  });
});

// ─── tenantNamespace ─────────────────────────────────────────────────────────

describe('tenantNamespace', () => {
  test("mit tenantId 'stadtwerk-a': 'cya_profiles' → 'tenant:stadtwerk-a:cya_profiles'", () => {
    expect(tenantNamespace('cya_profiles', 'stadtwerk-a')).toBe('tenant:stadtwerk-a:cya_profiles');
  });

  test('mit DEFAULT_TENANT: Namespace unverändert', () => {
    expect(tenantNamespace('cya_profiles', DEFAULT_TENANT)).toBe('cya_profiles');
  });

  test('ohne tenantId (undefined): Namespace unverändert', () => {
    expect(tenantNamespace('cya_profiles', undefined)).toBe('cya_profiles');
  });

  test('ohne tenantId (null): Namespace unverändert', () => {
    expect(tenantNamespace('cya_profiles', null)).toBe('cya_profiles');
  });

  test('verschiedene Basis-Namespaces werden korrekt präfixiert', () => {
    expect(tenantNamespace('cya_sessions', 'vnb-x')).toBe('tenant:vnb-x:cya_sessions');
  });
});

// ─── tenantKey ───────────────────────────────────────────────────────────────

describe('tenantKey', () => {
  test('mit tenantId: key wird präfixiert', () => {
    expect(tenantKey('my-profile', 'stadtwerk-a')).toBe('stadtwerk-a:my-profile');
  });

  test('ohne tenantId (DEFAULT_TENANT): key unverändert', () => {
    expect(tenantKey('my-profile', DEFAULT_TENANT)).toBe('my-profile');
  });

  test('ohne tenantId (null): key unverändert', () => {
    expect(tenantKey('my-profile', null)).toBe('my-profile');
  });

  test('ohne tenantId (undefined): key unverändert', () => {
    expect(tenantKey('my-profile', undefined)).toBe('my-profile');
  });
});

// ─── validateTenantId ────────────────────────────────────────────────────────

describe('validateTenantId', () => {
  test("'stadtwerk-a' → valid (gibt true zurück)", () => {
    expect(validateTenantId('stadtwerk-a')).toBe(true);
  });

  test("'abc123' → valid", () => {
    expect(validateTenantId('abc123')).toBe(true);
  });

  test('null → valid (optional)', () => {
    expect(validateTenantId(null)).toBe(true);
  });

  test('undefined → valid (optional)', () => {
    expect(validateTenantId(undefined)).toBe(true);
  });

  test("Großbuchstabe 'Stadtwerk-A' → wirft INVALID_TENANT_ID", () => {
    expect(() => validateTenantId('Stadtwerk-A')).toThrow('INVALID_TENANT_ID');
  });

  test("Underscore 'stadtwerk_a' → wirft INVALID_TENANT_ID (kein Underscore erlaubt)", () => {
    expect(() => validateTenantId('stadtwerk_a')).toThrow('INVALID_TENANT_ID');
  });

  test("Sonderzeichen 'stadtwerk@a' → wirft INVALID_TENANT_ID", () => {
    expect(() => validateTenantId('stadtwerk@a')).toThrow('INVALID_TENANT_ID');
  });

  test('65 Zeichen → wirft INVALID_TENANT_ID', () => {
    const longId = 'a'.repeat(65);
    expect(() => validateTenantId(longId)).toThrow('INVALID_TENANT_ID');
  });

  test('64 Zeichen → valid (Grenzwert)', () => {
    const maxId = 'a'.repeat(64);
    expect(validateTenantId(maxId)).toBe(true);
  });

  test('Error hat code: INVALID_TENANT_ID', () => {
    try {
      validateTenantId('INVALID!');
      fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe('INVALID_TENANT_ID');
    }
  });
});

// ─── Token Manager Integration ───────────────────────────────────────────────

describe('Token Manager Integration — tenantId', () => {
  const tokenManagerService = require('../services/token-manager.service');

  // Hilfsfunktion: instanziiert einen minimalen Service-Mock
  function makeService(storageFile) {
    const svc = Object.create(tokenManagerService);
    svc.settings = { ...tokenManagerService.settings, storageFile };
    svc.logger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn() };
    svc.loadTokens = tokenManagerService.methods.loadTokens.bind(svc);
    svc.saveTokens = tokenManagerService.methods.saveTokens.bind(svc);
    return svc;
  }

  test('create mit tenantId → tenantId wird im gespeicherten Token gespeichert', () => {
    const path = require('path');
    const os = require('os');
    const storageFile = path.join(os.tmpdir(), `tokens-test-${Date.now()}.json`);
    const svc = makeService(storageFile);

    const ctx = { params: { name: 'Test Token', scope: 'full-access', tenantId: 'stadtwerk-a' } };
    const result = tokenManagerService.actions.create.handler.call(svc, ctx);

    expect(result.success).toBe(true);
    const tokens = svc.loadTokens();
    const created = tokens.find((t) => t.id === result.data.id);
    expect(created).toBeDefined();
    expect(created.tenantId).toBe('stadtwerk-a');

    require('fs').unlinkSync(storageFile);
  });

  test('create ohne tenantId → tenantId ist null im gespeicherten Token', () => {
    const path = require('path');
    const os = require('os');
    const storageFile = path.join(os.tmpdir(), `tokens-test-${Date.now()}.json`);
    const svc = makeService(storageFile);

    const ctx = { params: { name: 'Test Token 2', scope: 'read-only' } };
    const result = tokenManagerService.actions.create.handler.call(svc, ctx);

    const tokens = svc.loadTokens();
    const created = tokens.find((t) => t.id === result.data.id);
    expect(created.tenantId).toBeNull();

    require('fs').unlinkSync(storageFile);
  });

  test('verify → tenantId wird im Return-Wert exponiert', () => {
    const path = require('path');
    const os = require('os');
    const storageFile = path.join(os.tmpdir(), `tokens-test-${Date.now()}.json`);
    const svc = makeService(storageFile);

    // Token erstellen
    const createCtx = { params: { name: 'T3', scope: 'full-access', tenantId: 'vnb-test' } };
    const createResult = tokenManagerService.actions.create.handler.call(svc, createCtx);
    const rawToken = createResult.data.token;

    // Token verifizieren
    const verifyCtx = { params: { token: rawToken, method: 'GET', trackUsage: false } };
    const verifyResult = tokenManagerService.actions.verify.handler.call(svc, verifyCtx);

    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.tenantId).toBe('vnb-test');

    require('fs').unlinkSync(storageFile);
  });

  test('verify für Token ohne tenantId → tenantId ist null', () => {
    const path = require('path');
    const os = require('os');
    const storageFile = path.join(os.tmpdir(), `tokens-test-${Date.now()}.json`);
    const svc = makeService(storageFile);

    const createCtx = { params: { name: 'T4', scope: 'read-only' } };
    const createResult = tokenManagerService.actions.create.handler.call(svc, createCtx);
    const rawToken = createResult.data.token;

    const verifyCtx = { params: { token: rawToken, method: 'GET', trackUsage: false } };
    const verifyResult = tokenManagerService.actions.verify.handler.call(svc, verifyCtx);

    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.tenantId).toBeNull();

    require('fs').unlinkSync(storageFile);
  });

  test('tenant.list → gibt unique tenantIds zurück', () => {
    const path = require('path');
    const os = require('os');
    const storageFile = path.join(os.tmpdir(), `tokens-test-${Date.now()}.json`);
    const svc = makeService(storageFile);

    // Zwei Tokens für verschiedene Tenants + einen ohne Tenant erstellen
    tokenManagerService.actions.create.handler.call(svc, {
      params: { name: 'T-A1', scope: 'read-only', tenantId: 'stadtwerk-a' },
    });
    tokenManagerService.actions.create.handler.call(svc, {
      params: { name: 'T-A2', scope: 'read-only', tenantId: 'stadtwerk-a' },
    });
    tokenManagerService.actions.create.handler.call(svc, {
      params: { name: 'T-B', scope: 'read-only', tenantId: 'stadtwerk-b' },
    });
    tokenManagerService.actions.create.handler.call(svc, {
      params: { name: 'T-default', scope: 'read-only' },
    });

    const result = tokenManagerService.actions['tenant.list'].handler.call(svc, {});
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.tenants).toContain('stadtwerk-a');
    expect(result.tenants).toContain('stadtwerk-b');
    // Kein null/undefined in der Liste
    expect(result.tenants.every((t) => typeof t === 'string')).toBe(true);

    require('fs').unlinkSync(storageFile);
  });
});

// ─── CYA Proof-of-Concept ────────────────────────────────────────────────────

describe('CYA PoC — tenantNamespace in profile actions', () => {
  test('profile.create mit tenantId → Namespace enthält tenantId-Präfix', async () => {
    const mockCtx = {
      meta: { tenantId: 'stadtwerk-a' },
      params: {
        profile_id: 'test_profile',
        actor: { role: 'grid_operator' },
        strategic_goals: ['goal1'],
        tone: null,
      },
      call: jest.fn().mockResolvedValue({}),
    };

    const cyaService = require('../services/cya.service');
    const createHandler = cyaService.actions.createProfile.handler;
    const svc = {
      settings: { defaultTone: 'neutral' },
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
    };

    await createHandler.call(svc, mockCtx);

    const putCall = mockCtx.call.mock.calls.find((c) => c[0] === 'object-store.put');
    expect(putCall).toBeDefined();
    expect(putCall[1].namespace).toBe('tenant:stadtwerk-a:cya_profiles');
  });

  test('profile.create ohne tenantId → Namespace ist cya_profiles (default)', async () => {
    const mockCtx = {
      meta: {},
      params: {
        profile_id: 'test_profile_default',
        actor: { role: 'grid_operator' },
        strategic_goals: ['goal1'],
        tone: null,
      },
      call: jest.fn().mockResolvedValue({}),
    };

    const cyaService = require('../services/cya.service');
    const createHandler = cyaService.actions.createProfile.handler;
    const svc = {
      settings: { defaultTone: 'neutral' },
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
    };

    await createHandler.call(svc, mockCtx);

    const putCall = mockCtx.call.mock.calls.find((c) => c[0] === 'object-store.put');
    expect(putCall).toBeDefined();
    expect(putCall[1].namespace).toBe('cya_profiles');
  });
});

// ─── isTenantAllowed ─────────────────────────────────────────────────────────

describe('isTenantAllowed', () => {
  const ORIGINAL_ENV = process.env.CERNION_ALLOWED_TENANTS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.CERNION_ALLOWED_TENANTS;
    } else {
      process.env.CERNION_ALLOWED_TENANTS = ORIGINAL_ENV;
    }
  });

  test('ohne CERNION_ALLOWED_TENANTS → alle erlaubt', () => {
    delete process.env.CERNION_ALLOWED_TENANTS;
    expect(isTenantAllowed('public')).toBe(true);
    expect(isTenantAllowed('default')).toBe(true);
    expect(isTenantAllowed('irgendwas')).toBe(true);
  });

  test('leere CERNION_ALLOWED_TENANTS → alle erlaubt', () => {
    process.env.CERNION_ALLOWED_TENANTS = '';
    expect(isTenantAllowed('public')).toBe(true);
  });

  test('nur Whitespace → alle erlaubt', () => {
    process.env.CERNION_ALLOWED_TENANTS = '   ';
    expect(isTenantAllowed('public')).toBe(true);
  });

  test('Tenant in Liste → erlaubt', () => {
    process.env.CERNION_ALLOWED_TENANTS = 'default,public,agentic-hackathon';
    expect(isTenantAllowed('public')).toBe(true);
    expect(isTenantAllowed('default')).toBe(true);
    expect(isTenantAllowed('agentic-hackathon')).toBe(true);
  });

  test('Tenant NICHT in Liste → nicht erlaubt', () => {
    process.env.CERNION_ALLOWED_TENANTS = 'default,public';
    expect(isTenantAllowed('evil-tenant')).toBe(false);
    expect(isTenantAllowed('agentic-hackathon')).toBe(false);
  });

  test('Case-Insensitivity', () => {
    process.env.CERNION_ALLOWED_TENANTS = 'Default,Public';
    expect(isTenantAllowed('public')).toBe(true);
    expect(isTenantAllowed('DEFAULT')).toBe(true);
  });

  test('null/undefined → erlaubt (Default-Tenant wird separat gehandhabt)', () => {
    process.env.CERNION_ALLOWED_TENANTS = 'default';
    expect(isTenantAllowed(null)).toBe(true);
    expect(isTenantAllowed(undefined)).toBe(true);
  });
});
