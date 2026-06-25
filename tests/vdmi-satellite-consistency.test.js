const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractVdmiActionNames() {
  const source = read('services/vdmi.service.js');
  const actionBlockStart = source.indexOf('actions: {');
  expect(actionBlockStart).toBeGreaterThanOrEqual(0);

  const actionSource = source.slice(actionBlockStart);
  return new Set(
    [...actionSource.matchAll(/^    ([A-Za-z][A-Za-z0-9_]*): \{/gm)].map((match) => match[1])
  );
}

function extractVdmiCalls(relativePath) {
  const source = read(relativePath);
  return [...source.matchAll(/ctx\.call\(['"]vdmi\.([^'"]+)['"]/g)].map((match) => match[1]);
}

describe('VDMI satellite consistency audit (#290)', () => {
  const expectedMissingCoreActions = ['getTask', 'updateTask', 'getVersion'];

  test('documents the four exposed satellite services and their classification', () => {
    const doc = read('docs/architecture/vdmi-satellite-consistency-audit.md');

    for (const serviceName of [
      'vdmi-evidence',
      'vdmi-spectator',
      'vdmi-human-override',
      'vdmi-findings',
    ]) {
      expect(doc).toContain(`\`${serviceName}\``);
    }

    expect(doc).toContain('incomplete integration requiring follow-up');
    expect(doc).toContain('No new Capability Broker route');
    expect(doc).toContain('Personal-Agent shortcut');
  });

  test('keeps the core VDMI action surface explicit for missing legacy task actions', () => {
    const actionNames = extractVdmiActionNames();

    for (const actionName of ['get', 'update', 'evidence', 'negotiationTrace', 'dossier', 'findings']) {
      expect(actionNames.has(actionName)).toBe(true);
    }

    for (const actionName of expectedMissingCoreActions) {
      expect(actionNames.has(actionName)).toBe(false);
    }
  });

  test('captures every live satellite call to missing core VDMI task/version actions', () => {
    const actionNames = extractVdmiActionNames();
    const satelliteCalls = {
      'services/vdmi-evidence.service.js': extractVdmiCalls('services/vdmi-evidence.service.js'),
      'services/vdmi-spectator.service.js': extractVdmiCalls('services/vdmi-spectator.service.js'),
      'services/vdmi-human-override.service.js': extractVdmiCalls(
        'services/vdmi-human-override.service.js'
      ),
      'services/vdmi-findings.service.js': extractVdmiCalls('services/vdmi-findings.service.js'),
    };

    expect(satelliteCalls['services/vdmi-evidence.service.js']).toEqual([
      'getTask',
      'updateTask',
    ]);
    expect(satelliteCalls['services/vdmi-spectator.service.js']).toEqual([
      'getTask',
      'getTask',
    ]);
    expect(satelliteCalls['services/vdmi-human-override.service.js']).toEqual([
      'get',
      'update',
      'get',
      'getVersion',
      'update',
    ]);
    expect(satelliteCalls['services/vdmi-findings.service.js']).toEqual(['update']);

    const missingCalls = Object.entries(satelliteCalls).flatMap(([file, calls]) =>
      calls.filter((call) => !actionNames.has(call)).map((call) => `${file}:${call}`)
    );

    expect(missingCalls).toEqual([
      'services/vdmi-evidence.service.js:getTask',
      'services/vdmi-evidence.service.js:updateTask',
      'services/vdmi-spectator.service.js:getTask',
      'services/vdmi-spectator.service.js:getTask',
      'services/vdmi-human-override.service.js:getVersion',
    ]);
  });

  test('keeps the legacy satellite API exposure visible', () => {
    const apiService = read('services/api.service.js');

    for (const route of [
      "'PATCH /vdmi/tenants/:tenantId/matrices/:matrixId': 'vdmi-human-override.override'",
      "'POST /vdmi/tenants/:tenantId/matrices/:matrixId/revert': 'vdmi-human-override.revert'",
      "'GET /vdmi/tenants/:tenantId/tasks/:taskId/dossier': 'vdmi-spectator.dossier'",
      "'GET /vdmi/tenants/:tenantId/findings': 'vdmi-findings.list'",
      "'POST /vdmi/tenants/:tenantId/tasks/:taskId/evidence': 'vdmi-evidence.inject'",
    ]) {
      expect(apiService).toContain(route);
    }
  });
});
