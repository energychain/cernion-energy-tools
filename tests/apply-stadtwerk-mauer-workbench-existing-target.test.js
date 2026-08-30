'use strict';

const {
  resolveExistingTarget,
  runPreflightExisting,
  runRequireExistingApply,
  parseArgs,
} = require('../integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js');

const manifest = {
  name: 'Cernion Stadtwerk Mauer Workbench',
  url: '/cernion-stadtwerk-mauer-workbench',
  workspaceApp: { name: 'Stadtwerk Mauer', url: '/stadtwerk-mauer' },
  screen: { name: 'Stadtwerk Mauer Workbench', route: '/stadtwerk-mauer', roleId: 'BASIC' },
  datasource: {
    name: 'Cernion DevServer REST',
    source: 'REST',
    urlEnv: 'CERNION_BASE_URL',
    defaultUrl: 'http://172.17.0.1:3900',
  },
  queries: [
    {
      name: 'getStadtwerkMauerWorkbenchLanding',
      method: 'GET',
      path: '/api/dashboard/stadtwerk-mauer-workbench-landing',
      schema: { status: { type: 'string' } },
    },
  ],
  sections: [],
  notes: [],
};

const FIXTURE_COOKIE = 'session=super-secret-cookie-value';
const FIXTURE_PASSWORD = 'do-not-leak-password-123';

function fakeApp(overrides = {}) {
  return { appId: 'app_1', name: manifest.name, url: manifest.url, status: 'published', ...overrides };
}

function fakeWorkspaceApp(overrides = {}) {
  return { _id: 'ws_1', name: manifest.workspaceApp.name, url: manifest.workspaceApp.url, ...overrides };
}

class RecordingFakeClient {
  constructor(routes) {
    this.routes = routes;
    this.calls = [];
    this.cookie = FIXTURE_COOKIE;
  }

  async request(method, urlPath, opts = {}) {
    this.calls.push({ method, urlPath, appId: opts.appId, body: opts.body });
    const key = `${method} ${urlPath.split('?')[0]}`;
    const handler = this.routes[key];
    if (!handler) {
      throw new Error(`Unexpected fake request: ${key}`);
    }
    return handler(opts);
  }
}

function nonGetCalls(calls) {
  return calls.filter((call) => call.method !== 'GET');
}

describe('apply-stadtwerk-mauer-workbench existing-target preflight', () => {
  test('exactly one application and one workspace app resolve to ready_existing', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [fakeApp()],
      'GET /api/workspaceApp': async () => ({ workspaceApps: [fakeWorkspaceApp()] }),
    });

    const resolution = await resolveExistingTarget(client, manifest);

    expect(resolution.targetState).toBe('ready_existing');
    expect(resolution.applicationMatchCount).toBe(1);
    expect(resolution.workspaceAppMatchCount).toBe(1);
    expect(resolution.application).toEqual({
      appId: 'app_1',
      name: manifest.name,
      url: manifest.url,
      status: 'published',
    });
    expect(resolution.workspaceApp).toEqual({
      id: 'ws_1',
      name: manifest.workspaceApp.name,
      url: manifest.workspaceApp.url,
    });
    expect(nonGetCalls(client.calls)).toHaveLength(0);
  });

  test('missing application yields missing_application and stops before workspace lookup', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [],
    });

    const resolution = await resolveExistingTarget(client, manifest);

    expect(resolution.targetState).toBe('missing_application');
    expect(resolution.applicationMatchCount).toBe(0);
    expect(resolution.application).toBeNull();
    expect(resolution.workspaceAppMatchCount).toBe(0);
    expect(client.calls.filter((c) => c.urlPath.startsWith('/api/workspaceApp'))).toHaveLength(0);
  });

  test('duplicate application yields ambiguous_application', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [fakeApp({ appId: 'app_1' }), fakeApp({ appId: 'app_2' })],
    });

    const resolution = await resolveExistingTarget(client, manifest);

    expect(resolution.targetState).toBe('ambiguous_application');
    expect(resolution.applicationMatchCount).toBe(2);
    expect(resolution.application).toBeNull();
  });

  test('missing workspace app yields missing_workspace_app', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [fakeApp()],
      'GET /api/workspaceApp': async () => ({ workspaceApps: [] }),
    });

    const resolution = await resolveExistingTarget(client, manifest);

    expect(resolution.targetState).toBe('missing_workspace_app');
    expect(resolution.applicationMatchCount).toBe(1);
    expect(resolution.workspaceAppMatchCount).toBe(0);
    expect(resolution.workspaceApp).toBeNull();
  });

  test('duplicate workspace app yields ambiguous_workspace_app', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [fakeApp()],
      'GET /api/workspaceApp': async () => ({
        workspaceApps: [fakeWorkspaceApp({ _id: 'ws_1' }), fakeWorkspaceApp({ _id: 'ws_2' })],
      }),
    });

    const resolution = await resolveExistingTarget(client, manifest);

    expect(resolution.targetState).toBe('ambiguous_workspace_app');
    expect(resolution.workspaceAppMatchCount).toBe(2);
    expect(resolution.workspaceApp).toBeNull();
  });

  test('application url mismatch yields manifest_mismatch', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [fakeApp({ url: '/some-other-app-url' })],
    });

    const resolution = await resolveExistingTarget(client, manifest);

    expect(resolution.targetState).toBe('manifest_mismatch');
    expect(resolution.application.url).toBe('/some-other-app-url');
    expect(resolution.workspaceAppMatchCount).toBe(0);
  });

  test('workspace app url mismatch yields manifest_mismatch after unique application match', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [fakeApp()],
      'GET /api/workspaceApp': async () => ({
        workspaceApps: [fakeWorkspaceApp({ url: '/some-other-workspace-url' })],
      }),
    });

    const resolution = await resolveExistingTarget(client, manifest);

    expect(resolution.targetState).toBe('manifest_mismatch');
    expect(resolution.applicationMatchCount).toBe(1);
    expect(resolution.workspaceApp.url).toBe('/some-other-workspace-url');
  });

  test('every request performed while resolving is GET', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [fakeApp()],
      'GET /api/workspaceApp': async () => ({ workspaceApps: [fakeWorkspaceApp()] }),
    });

    await resolveExistingTarget(client, manifest);

    expect(client.calls.length).toBeGreaterThan(0);
    expect(client.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  test('preflight receipt is secret-free, mutationPerformed is false, ready state exits via nextSafeGate=require_existing_apply', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [fakeApp()],
      'GET /api/workspaceApp': async () => ({ workspaceApps: [fakeWorkspaceApp()] }),
    });

    const receipt = await runPreflightExisting(client, manifest, 'manifests/stadtwerk-mauer-workbench.json');

    expect(receipt.targetState).toBe('ready_existing');
    expect(receipt.mutationPerformed).toBe(false);
    expect(receipt.nextSafeGate).toBe('require_existing_apply');
    expect(receipt.manifestName).toBe(manifest.name);
    expect(receipt.screenRoute).toBe(manifest.screen.route);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(FIXTURE_COOKIE);
    expect(serialized).not.toContain(FIXTURE_PASSWORD);
    expect(serialized).not.toContain('cookie');
    expect(serialized).not.toContain('authorization');
  });

  test('preflight receipt for every non-ready state sets mutationPerformed=false and human-review gate', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [],
    });

    const receipt = await runPreflightExisting(client, manifest, 'manifests/stadtwerk-mauer-workbench.json');

    expect(receipt.targetState).toBe('missing_application');
    expect(receipt.mutationPerformed).toBe(false);
    expect(receipt.nextSafeGate).toBe('human_review_or_explicit_first_create');
  });
});

describe('apply-stadtwerk-mauer-workbench --require-existing fail-closed gate', () => {
  test('ready target binds to resolved IDs, upserts downstream resources, and never calls create endpoints', async () => {
    const client = new RecordingFakeClient({
      'GET /api/applications': async () => [fakeApp()],
      'GET /api/workspaceApp': async () => ({ workspaceApps: [fakeWorkspaceApp()] }),
      'GET /api/datasources': async () => [],
      'POST /api/datasources': async () => ({
        datasource: { _id: 'ds_1', name: manifest.datasource.name, config: { url: 'http://172.17.0.1:3900' } },
      }),
      'GET /api/queries': async () => [],
      'POST /api/queries': async () => ({
        _id: 'q_1',
        name: manifest.queries[0].name,
        schema: manifest.queries[0].schema,
      }),
      'GET /api/screens': async () => [],
      'POST /api/screens': async () => ({
        _id: 'screen_1',
        _rev: '1-abc',
        name: manifest.screen.name,
        routing: { route: manifest.screen.route },
      }),
    });

    const outcome = await runRequireExistingApply(
      client,
      manifest,
      'manifests/stadtwerk-mauer-workbench.json',
      'http://172.17.0.1:3900'
    );

    expect(outcome.ready).toBe(true);
    expect(outcome.receipt.targetState).toBe('ready_existing');
    expect(outcome.applied.app.appId).toBe('app_1');
    expect(outcome.applied.workspaceApp.id).toBe('ws_1');
    expect(outcome.applied.datasource.id).toBe('ds_1');
    expect(outcome.applied.screen.id).toBe('screen_1');

    const postedPaths = client.calls.filter((c) => c.method === 'POST').map((c) => c.urlPath);
    expect(postedPaths).not.toContain('/api/applications');
    expect(postedPaths).not.toContain('/api/workspaceApp');
    expect(postedPaths).toEqual(
      expect.arrayContaining(['/api/datasources', '/api/queries', '/api/screens'])
    );
  });

  test.each([
    ['missing_application', { 'GET /api/applications': async () => [] }],
    [
      'ambiguous_application',
      { 'GET /api/applications': async () => [fakeApp({ appId: 'a' }), fakeApp({ appId: 'b' })] },
    ],
    [
      'missing_workspace_app',
      {
        'GET /api/applications': async () => [fakeApp()],
        'GET /api/workspaceApp': async () => ({ workspaceApps: [] }),
      },
    ],
    [
      'ambiguous_workspace_app',
      {
        'GET /api/applications': async () => [fakeApp()],
        'GET /api/workspaceApp': async () => ({
          workspaceApps: [fakeWorkspaceApp({ _id: 'w1' }), fakeWorkspaceApp({ _id: 'w2' })],
        }),
      },
    ],
    [
      'manifest_mismatch',
      { 'GET /api/applications': async () => [fakeApp({ url: '/wrong-url' })] },
    ],
  ])('%s aborts before any non-GET request and exits fail-closed', async (expectedState, routes) => {
    const client = new RecordingFakeClient(routes);

    const outcome = await runRequireExistingApply(
      client,
      manifest,
      'manifests/stadtwerk-mauer-workbench.json',
      'http://172.17.0.1:3900'
    );

    expect(outcome.ready).toBe(false);
    expect(outcome.receipt.targetState).toBe(expectedState);
    expect(outcome.receipt.mutationPerformed).toBe(false);
    expect(outcome.receipt.nextSafeGate).toBe('human_review_or_explicit_first_create');
    expect(nonGetCalls(client.calls)).toHaveLength(0);
    const serialized = JSON.stringify(outcome.receipt);
    expect(serialized).not.toContain(FIXTURE_COOKIE);
    expect(serialized).not.toContain(FIXTURE_PASSWORD);
  });

  test('sanitized catalog errors never echo raw response bodies that could contain credentials', async () => {
    const client = {
      cookie: FIXTURE_COOKIE,
      calls: [],
      async request(method, urlPath) {
        this.calls.push({ method, urlPath });
        throw new Error(
          `GET ${urlPath} failed (401): {"cookie":"${FIXTURE_COOKIE}","password":"${FIXTURE_PASSWORD}"}`
        );
      },
    };

    await expect(resolveExistingTarget(client, manifest)).rejects.toThrow(
      /Budibase catalog request failed at application_lookup \(status 401\)/
    );

    try {
      await resolveExistingTarget(client, manifest);
    } catch (error) {
      expect(error.message).not.toContain(FIXTURE_COOKIE);
      expect(error.message).not.toContain(FIXTURE_PASSWORD);
    }
  });
});

describe('apply-stadtwerk-mauer-workbench CLI argument parsing', () => {
  test('parses --preflight-existing and --require-existing as distinct modes', () => {
    expect(parseArgs(['node', 'script.js', '--preflight-existing'])).toMatchObject({
      preflightExisting: true,
      requireExisting: false,
    });
    expect(parseArgs(['node', 'script.js', '--require-existing'])).toMatchObject({
      preflightExisting: false,
      requireExisting: true,
    });
  });

  test('rejects combining --preflight-existing and --require-existing', () => {
    expect(() => parseArgs(['node', 'script.js', '--preflight-existing', '--require-existing'])).toThrow(
      /Cannot combine/
    );
  });
});
