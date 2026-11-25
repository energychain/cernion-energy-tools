'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TARGET_STATES,
  parseArgs,
  runExistingTargetMode,
  usage,
} = require('../integrations/budibase/scripts/apply-stadtwerk-mauer-workbench');

const MANIFEST_PATH = path.join(
  __dirname,
  '..',
  'integrations',
  'budibase',
  'manifests',
  'stadtwerk-mauer-workbench.json'
);
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const SENTINELS = {
  password: 'SENTINEL_PASSWORD_9f3a',
  email: 'sentinel-user-7c1d@example.invalid',
  cookie: 'SENTINEL_COOKIE_VALUE_41bb',
  token: 'SENTINEL_TOKEN_e5d2',
  header: 'SENTINEL_HEADER_0a77',
  upstream: 'SENTINEL_UPSTREAM_BODY_c3f9',
};

const RECEIPT_KEYS = [
  'application',
  'expected',
  'manifest',
  'matches',
  'mode',
  'mutationPerformed',
  'nextSafeGate',
  'screenRoute',
  'targetState',
  'workspaceApp',
];

function appEntry(overrides = {}) {
  return {
    appId: 'app_dev_existing_1',
    name: manifest.name,
    url: manifest.url,
    status: 'development',
    tenantToken: SENTINELS.token,
    _rev: `rev-${SENTINELS.upstream}`,
    ...overrides,
  };
}

function workspaceEntry(overrides = {}) {
  return {
    _id: 'workspace_app_existing_1',
    name: manifest.workspaceApp.name,
    url: manifest.workspaceApp.url,
    secretHeader: SENTINELS.header,
    ...overrides,
  };
}

const SELF_PATH = '/api/global/self';

function fakeClientFactory({
  apps,
  workspaceApps,
  failOn,
  loginFails = false,
  self = { _id: 'us_operator_1', email: SENTINELS.email },
} = {}) {
  const calls = [];
  const events = [];
  const factory = ({ cookie }) => ({
    cookie,
    async login() {
      events.push('login');
      if (loginFails) {
        throw new Error(
          `login failed: ${SENTINELS.password} ${SENTINELS.email} set-cookie=${SENTINELS.cookie}`
        );
      }
      this.cookie = `budibase:auth=${SENTINELS.cookie}`;
    },
    async request(method, urlPath, options = {}) {
      calls.push({ method, urlPath, appId: options.appId });
      events.push(`${method} ${urlPath}`);
      if (failOn && failOn(method, urlPath)) {
        const error = new Error(
          `${method} ${urlPath} failed (500): ${SENTINELS.upstream} cookie=${SENTINELS.cookie}`
        );
        error.cause = { headers: { authorization: SENTINELS.header } };
        throw error;
      }
      if (method === 'GET' && urlPath === SELF_PATH) return self;
      if (method === 'GET' && urlPath === '/api/applications?status=all') return apps;
      if (method === 'GET' && urlPath === '/api/workspaceApp') return { workspaceApps };
      if (method === 'GET') return [];
      if (urlPath === '/api/datasources') return { datasource: { _id: 'ds_1', ...options.body } };
      if (urlPath === '/api/queries') {
        return { _id: `query_${calls.length}`, ...options.body };
      }
      if (urlPath === '/api/screens') return { _id: 'screen_1', ...options.body };
      return { _id: `created_${SENTINELS.upstream}` };
    },
  });
  return { factory, calls, events };
}

async function run(mode, fake, { env = {}, manifestPath = MANIFEST_PATH } = {}) {
  const stdout = [];
  const stderr = [];
  const exitCode = await runExistingTargetMode({
    args: {
      manifest: manifestPath,
      preflightExisting: mode === 'preflight',
      requireExisting: mode === 'require',
    },
    env: {
      BUDIBASE_BASE_URL: 'http://budibase.test:10000',
      BUDIBASE_EMAIL: SENTINELS.email,
      BUDIBASE_PASSWORD: SENTINELS.password,
      ...env,
    },
    createClient: fake.factory,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  });
  const out = stdout.join('\n');
  const err = stderr.join('\n');
  return {
    exitCode,
    out,
    err,
    receipt: out ? JSON.parse(out) : null,
    error: err ? JSON.parse(err) : null,
  };
}

function expectNoSecrets(result) {
  const text = `${result.out}\n${result.err}`;
  for (const sentinel of Object.values(SENTINELS)) {
    expect(text).not.toContain(sentinel);
  }
  expect(text).not.toMatch(/stack|cause|set-cookie|authorization/i);
}

function nonGet(calls) {
  return calls.filter((call) => call.method !== 'GET');
}

function createCalls(calls) {
  return calls.filter(
    (call) =>
      call.method !== 'GET' &&
      (call.urlPath.startsWith('/api/applications') || call.urlPath.startsWith('/api/workspaceApp'))
  );
}

const FAILURE_CASES = [
  ['missing_application', { apps: [appEntry({ name: 'Other', url: '/other' })] }],
  ['ambiguous_application', { apps: [appEntry(), appEntry({ appId: 'app_dev_existing_2' })] }],
  ['missing_workspace_app', { apps: [appEntry()], workspaceApps: [] }],
  [
    'ambiguous_workspace_app',
    {
      apps: [appEntry()],
      workspaceApps: [workspaceEntry(), workspaceEntry({ _id: 'workspace_app_existing_2' })],
    },
  ],
  ['manifest_mismatch', { apps: [appEntry({ url: '/drifted-url' })] }],
  [
    'manifest_mismatch',
    { apps: [appEntry()], workspaceApps: [workspaceEntry({ url: '/drifted-workspace' })] },
  ],
];

describe('Budibase existing-target gate (#41, ported from #572)', () => {
  it('parses the explicit modes and rejects combinations', () => {
    expect(parseArgs(['node', 's', '--preflight-existing']).preflightExisting).toBe(true);
    expect(parseArgs(['node', 's', '--require-existing']).requireExisting).toBe(true);
    expect(() => parseArgs(['node', 's', '--dry-run', '--require-existing'])).toThrow(
      /mutually exclusive/
    );
    expect(() => parseArgs(['node', 's', '--preflight-existing', '--require-existing'])).toThrow(
      /mutually exclusive/
    );
    expect(() => parseArgs(['node', 's', '--dry-run', '--preflight-existing'])).toThrow(
      /mutually exclusive/
    );
    expect(() => parseArgs(['node', 's', '--app-id', 'app_x'])).toThrow(/Unknown argument/);
  });

  it('documents both gate modes and marks the no-flag path as explicit First Create', () => {
    const text = usage();
    expect(text).toContain('--preflight-existing');
    expect(text).toContain('--require-existing');
    expect(text).toMatch(/mutually exclusive/);
    expect(text).toMatch(/\(no mode flag\)\s+explicit local First Create/);
    expect(text).toMatch(/never use it for Workbench delivery or acceptance/);
  });

  it('preflight resolves ready_existing with GET-only calls after authentication', async () => {
    const fake = fakeClientFactory({ apps: [appEntry()], workspaceApps: [workspaceEntry()] });
    const result = await run('preflight', fake);

    expect(result.exitCode).toBe(0);
    expect(result.err).toBe('');
    expect(fake.events[0]).toBe('login');
    expect(fake.calls.map((call) => `${call.method} ${call.urlPath}`)).toEqual([
      `GET ${SELF_PATH}`,
      'GET /api/applications?status=all',
      'GET /api/workspaceApp',
    ]);
    expect(fake.calls[2].appId).toBe('app_dev_existing_1');
    expect(Object.keys(result.receipt).sort()).toEqual(RECEIPT_KEYS);
    expect(result.receipt).toMatchObject({
      mode: 'preflight-existing',
      targetState: 'ready_existing',
      mutationPerformed: false,
      nextSafeGate: 'require_existing_apply',
      screenRoute: manifest.screen.route,
      manifest: { path: 'stadtwerk-mauer-workbench.json', name: manifest.name },
      matches: {
        applicationByName: 1,
        applicationByUrl: 1,
        workspaceAppByName: 1,
        workspaceAppByUrl: 1,
      },
    });
    expect(Object.keys(result.receipt.application).sort()).toEqual([
      'appId',
      'name',
      'status',
      'url',
    ]);
    expect(Object.keys(result.receipt.workspaceApp).sort()).toEqual(['id', 'name', 'url']);
    expect(Object.keys(result.receipt.expected).sort()).toEqual([
      'applicationName',
      'applicationUrl',
      'workspaceAppName',
      'workspaceAppUrl',
    ]);
    expectNoSecrets(result);
  });

  it('exposes exactly the documented target states', () => {
    expect(TARGET_STATES).toEqual([
      'ready_existing',
      'missing_application',
      'ambiguous_application',
      'missing_workspace_app',
      'ambiguous_workspace_app',
      'manifest_mismatch',
    ]);
  });

  it.each(FAILURE_CASES)('preflight reports %s read-only and non-zero', async (state, fixture) => {
    const fake = fakeClientFactory(fixture);
    const result = await run('preflight', fake);

    expect(result.exitCode).not.toBe(0);
    expect(result.receipt.targetState).toBe(state);
    expect(result.receipt.application).toBeNull();
    expect(result.receipt.workspaceApp).toBeNull();
    expect(result.receipt.mutationPerformed).toBe(false);
    expect(Object.keys(result.receipt).sort()).toEqual(RECEIPT_KEYS);
    expect(nonGet(fake.calls)).toEqual([]);
    expectNoSecrets(result);
  });

  it('reports exact match counts for duplicates', async () => {
    const fake = fakeClientFactory({
      apps: [appEntry(), appEntry({ appId: 'b' }), appEntry({ appId: 'c' })],
    });
    const result = await run('preflight', fake);
    expect(result.receipt.matches.applicationByName).toBe(3);
    expect(result.receipt.matches.applicationByUrl).toBe(3);
  });

  it.each(FAILURE_CASES)(
    'require-existing stops on %s before any non-GET request',
    async (state, fixture) => {
      const fake = fakeClientFactory(fixture);
      const result = await run('require', fake);

      expect(result.exitCode).not.toBe(0);
      expect(result.receipt.targetState).toBe(state);
      expect(result.receipt.mode).toBe('require-existing');
      expect(result.receipt.mutationPerformed).toBe(false);
      expect(nonGet(fake.calls)).toEqual([]);
      expectNoSecrets(result);
    }
  );

  it('require-existing binds the resolved IDs and never creates an app or workspace app', async () => {
    const fake = fakeClientFactory({ apps: [appEntry()], workspaceApps: [workspaceEntry()] });
    const result = await run('require', fake);

    expect(result.exitCode).toBe(0);
    expect(createCalls(fake.calls)).toEqual([]);
    const writes = nonGet(fake.calls);
    expect(writes.map((call) => call.urlPath)).toEqual([
      '/api/datasources',
      ...manifest.queries.map(() => '/api/queries'),
      '/api/screens',
    ]);
    expect(writes.every((call) => call.appId === 'app_dev_existing_1')).toBe(true);
    // Resolution GETs run before the first write.
    const firstWrite = fake.calls.findIndex((call) => call.method !== 'GET');
    expect(fake.calls.slice(0, 3).map((call) => call.urlPath)).toEqual([
      SELF_PATH,
      '/api/applications?status=all',
      '/api/workspaceApp',
    ]);
    expect(firstWrite).toBeGreaterThan(2);
    expect(result.receipt).toMatchObject({
      mode: 'require-existing',
      targetState: 'ready_existing',
      mutationPerformed: true,
      nextSafeGate: 'visible_presentation_smoke',
      applied: { datasourceId: 'ds_1', queryCount: manifest.queries.length, screenId: 'screen_1' },
    });
    expect(Object.keys(result.receipt).sort()).toEqual([...RECEIPT_KEYS, 'applied'].sort());
    expectNoSecrets(result);
  });

  it('maps login failures to a bounded auth error without leaking credentials', async () => {
    const fake = fakeClientFactory({ loginFails: true });
    const result = await run('preflight', fake);

    expect(result.exitCode).toBe(1);
    expect(fake.calls).toEqual([]);
    expect(result.error.error).toEqual({
      boundary: 'budibase_auth',
      code: 'auth_failed',
      message: 'Budibase authentication failed.',
    });
    expect(Object.keys(result.error).sort()).toEqual([...RECEIPT_KEYS, 'error'].sort());
    expectNoSecrets(result);
  });

  it.each([
    ['an object without _id', {}],
    ['an empty list', []],
    ['null', null],
  ])(
    'treats an unauthenticated session (self is %s) as auth_failed, not missing_application',
    async (_label, self) => {
      // Budibase returns `[]` for the application catalog to an expired cookie.
      const fake = fakeClientFactory({ apps: [], self });
      const result = await run('require', fake);
      expect(result.exitCode).toBe(1);
      expect(fake.calls.map((call) => call.urlPath)).toEqual([SELF_PATH]);
      expect(result.error.error.code).toBe('auth_failed');
      expect(result.error.targetState).toBeNull();
      expect(result.error.mutationPerformed).toBe(false);
      expectNoSecrets(result);
    }
  );

  it('maps a rejected self lookup (expired cookie, 403) to auth_failed', async () => {
    const fake = fakeClientFactory({
      apps: [],
      failOn: (method, urlPath) => urlPath === SELF_PATH,
    });
    const result = await run('preflight', fake);
    expect(result.exitCode).toBe(1);
    expect(result.error.error.code).toBe('auth_failed');
    expect(result.error.mutationPerformed).toBe(false);
    expect(fake.calls.map((call) => call.urlPath)).toEqual([SELF_PATH]);
    expectNoSecrets(result);
  });

  it('maps upstream catalog errors to a bounded error without upstream bodies', async () => {
    const fake = fakeClientFactory({
      failOn: (method, urlPath) => method === 'GET' && urlPath !== SELF_PATH,
    });
    const result = await run('require', fake);

    expect(result.exitCode).toBe(1);
    expect(nonGet(fake.calls)).toEqual([]);
    expect(result.error.error.code).toBe('catalog_unreadable');
    expect(result.error.targetState).toBe('catalog_unreadable');
    expect(result.error.nextSafeGate).toBe('operator_check_budibase_catalog_access');
    expect(result.error.application).toBeNull();
    expect(result.error.workspaceApp).toBeNull();
    expect(result.error.mutationPerformed).toBe(false);
    expectNoSecrets(result);
  });

  it('rejects unexpected catalog shapes', async () => {
    const fake = fakeClientFactory({ apps: { message: SENTINELS.upstream } });
    const result = await run('preflight', fake);
    expect(result.exitCode).toBe(1);
    expect(result.error.error.code).toBe('catalog_unreadable');
    expect(result.error.targetState).toBe('catalog_unreadable');
    expect(result.error.mutationPerformed).toBe(false);
    expect(nonGet(fake.calls)).toEqual([]);
    expectNoSecrets(result);
  });

  it('rejects an unreadable workspace-app catalog after a unique application', async () => {
    const fake = fakeClientFactory({ apps: [appEntry()], workspaceApps: 'not-a-list' });
    const result = await run('preflight', fake);
    expect(result.exitCode).toBe(1);
    expect(result.error.targetState).toBe('catalog_unreadable');
    expect(result.error.mutationPerformed).toBe(false);
    expect(nonGet(fake.calls)).toEqual([]);
    expectNoSecrets(result);
  });

  it('maps apply failures after binding to a bounded error', async () => {
    const fake = fakeClientFactory({
      apps: [appEntry()],
      workspaceApps: [workspaceEntry()],
      failOn: (method, urlPath) => method === 'POST' && urlPath === '/api/queries',
    });
    const result = await run('require', fake);

    expect(result.exitCode).toBe(1);
    expect(createCalls(fake.calls)).toEqual([]);
    expect(result.error.error.code).toBe('apply_failed');
    expect(result.error.mutationPerformed).toBe(true);
    expectNoSecrets(result);
  });

  it('uses the cookie jar without logging in and never prints the cookie', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-gate-'));
    const jar = path.join(dir, 'cookies');
    fs.writeFileSync(
      jar,
      `# Netscape HTTP Cookie File\n#HttpOnly_budibase.test\tFALSE\t/\tFALSE\t0\tbudibase:auth\t${SENTINELS.cookie}\n`
    );
    try {
      const fake = fakeClientFactory({ apps: [appEntry()], workspaceApps: [workspaceEntry()] });
      const result = await run('preflight', fake, { env: { BUDIBASE_COOKIE_FILE: jar } });
      expect(result.exitCode).toBe(0);
      expect(fake.events).not.toContain('login');
      expectNoSecrets(result);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on a manifest without identity fields before authentication', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-gate-'));
    const file = path.join(dir, 'manifest.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ ...manifest, workspaceApp: { token: SENTINELS.token }, extra: SENTINELS })
    );
    try {
      const fake = fakeClientFactory({ apps: [appEntry()] });
      const result = await run('require', fake, { manifestPath: file });
      expect(result.exitCode).toBe(1);
      expect(fake.events).toEqual([]);
      expect(result.error.error).toEqual({
        boundary: 'manifest',
        code: 'manifest_invalid',
        message: 'Manifest lacks bounded identity fields for the existing-target gate.',
      });
      expectNoSecrets(result);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('with the real BudibaseClient over a stubbed fetch', () => {
    const realFetch = global.fetch;
    let requests;

    function jsonResponse(status, body, headers = {}) {
      const lower = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
      );
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => lower[String(name).toLowerCase()] || null },
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      };
    }

    function stubFetch({ catalogStatus = 200, selfStatus = 200 } = {}) {
      requests = [];
      global.fetch = jest.fn(async (url, init = {}) => {
        const { pathname, search } = new URL(url);
        requests.push({ method: init.method || 'GET', path: `${pathname}${search}` });
        if (pathname === '/api/global/auth/default/login') {
          return jsonResponse(
            200,
            {},
            { 'set-cookie': `budibase:auth=${SENTINELS.cookie}; Path=/` }
          );
        }
        if (pathname === SELF_PATH) {
          return selfStatus === 200
            ? jsonResponse(200, { _id: 'us_operator_1' })
            : jsonResponse(selfStatus, `${SENTINELS.upstream} forbidden`);
        }
        if (catalogStatus !== 200) {
          return jsonResponse(catalogStatus, `${SENTINELS.upstream} ${SENTINELS.token}`);
        }
        if (pathname === '/api/applications') return jsonResponse(200, [appEntry()]);
        if (pathname === '/api/workspaceApp') {
          return jsonResponse(200, { workspaceApps: [workspaceEntry()] });
        }
        return jsonResponse(500, SENTINELS.upstream);
      });
    }

    async function runReal(mode) {
      const stdout = [];
      const stderr = [];
      const exitCode = await runExistingTargetMode({
        args: {
          manifest: MANIFEST_PATH,
          preflightExisting: mode === 'preflight',
          requireExisting: mode === 'require',
        },
        env: {
          BUDIBASE_BASE_URL: 'http://budibase.test:10000',
          BUDIBASE_EMAIL: SENTINELS.email,
          BUDIBASE_PASSWORD: SENTINELS.password,
        },
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      });
      return { exitCode, out: stdout.join('\n'), err: stderr.join('\n') };
    }

    afterEach(() => {
      global.fetch = realFetch;
    });

    it('preflight sends only the login POST plus catalog GETs', async () => {
      stubFetch();
      const result = await runReal('preflight');
      expect(result.exitCode).toBe(0);
      expect(requests).toEqual([
        { method: 'POST', path: '/api/global/auth/default/login' },
        { method: 'GET', path: SELF_PATH },
        { method: 'GET', path: '/api/applications?status=all' },
        { method: 'GET', path: '/api/workspaceApp' },
      ]);
      const receipt = JSON.parse(result.out);
      expect(receipt).toMatchObject({ targetState: 'ready_existing', mutationPerformed: false });
      expectNoSecrets(result);
    });

    it('stops after a 403 self lookup and never reads the catalog', async () => {
      stubFetch({ selfStatus: 403 });
      const result = await runReal('preflight');
      expect(result.exitCode).toBe(1);
      expect(requests.map((req) => req.path)).toEqual([
        '/api/global/auth/default/login',
        SELF_PATH,
      ]);
      expect(JSON.parse(result.err)).toMatchObject({
        targetState: null,
        mutationPerformed: false,
        nextSafeGate: 'operator_refresh_budibase_credentials',
        error: { boundary: 'budibase_auth', code: 'auth_failed' },
      });
      expectNoSecrets(result);
    });

    it('maps an upstream 5xx body to catalog_unreadable without echoing it', async () => {
      stubFetch({ catalogStatus: 503 });
      const result = await runReal('require');
      expect(result.exitCode).toBe(1);
      expect(requests.filter((req) => req.method !== 'GET').map((req) => req.path)).toEqual([
        '/api/global/auth/default/login',
      ]);
      const receipt = JSON.parse(result.err);
      expect(receipt).toMatchObject({
        targetState: 'catalog_unreadable',
        mutationPerformed: false,
        error: { code: 'catalog_unreadable' },
      });
      expectNoSecrets(result);
    });
  });
});
