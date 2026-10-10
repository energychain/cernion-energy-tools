'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadActionResolution,
  resolveOperationAction,
  actionCoverage,
} = require('../scripts/operation-action-resolution');
const { checkCoverage } = require('../scripts/generate-operation-capability-index');

let root;
let resolution;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'action-resolution-'));
  fs.mkdirSync(path.join(root, 'services'));
  fs.writeFileSync(
    path.join(root, 'services/parts.js'),
    `module.exports = { read: {openapi:{operationId:'custom-read'}, handler() {} } };`
  );
  fs.writeFileSync(
    path.join(root, 'services/fn-a.service.js'),
    `const actions = require('./parts'); module.exports = { name:'fn-a', version:1, actions:{...actions, write:{handler() {}}} };`
  );
  fs.writeFileSync(
    path.join(root, 'services/fn-b.service.js'),
    `module.exports = { name:'fn-b', actions:{read:{openapi:{operationId:'ambiguous'}, handler(){}}, other:{openapi:{operationId:'ambiguous'},handler(){}}} };`
  );
  fs.writeFileSync(
    path.join(root, 'services/api.service.js'),
    `module.exports = {name:'api',settings:{routes:[{path:'/api',aliases:{'GET /public/:id':'v1.fn-a.read','POST /object':{action:'fn-a.write'},'GET /absent':'fn-a.absent','GET /dynamic':()=>{},'GET /conflict':'fn-a.read','GET /conflict-alt':'fn-a.write'}}]}};`
  );
  fs.writeFileSync(
    path.join(root, 'services/fn-c.service.js'),
    `module.exports = (() => { const schema = {name:'fn-c',actions:{'items.list':{handler(){}}}}; return schema; })();`
  );
  resolution = loadActionResolution(root);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const resolve = (operationId, url = '/api/unmapped', aliases = []) =>
  resolveOperationAction({ operationId, method: 'GET', path: url, aliases }, resolution);

test('resolves spread actions and explicit operation ids without executing services', () => {
  expect(resolve('custom-read').action).toBe('fn-a.read');
  expect(resolve('fn-a_write').action).toBe('fn-a.write');
  expect(resolve('fn-c_items_list').action).toBe('fn-c.items.list');
});
test('resolves parameterized and versioned gateway aliases and object targets', () => {
  expect(resolve('custom', '/api/public/{id}').action).toBe('v1.fn-a.read');
  expect(
    resolveOperationAction(
      { operationId: 'custom', method: 'POST', path: '/api/object' },
      resolution
    ).action
  ).toBe('fn-a.write');
});
test('preserves explanations for missing, dynamic, conflicting and ambiguous targets', () => {
  for (const result of [
    resolve('missing'),
    resolve('custom', '/api/absent'),
    resolve('custom', '/api/dynamic'),
    resolve('ambiguous'),
    resolve('custom', '/api/conflict', ['GET /api/conflict-alt']),
  ]) {
    expect(result.action).toBeNull();
    expect(result.actionResolutionReason).toEqual(expect.any(String));
  }
});
test('coverage rejects silent null actions and reports unresolved operations', () => {
  const operation = {
    operationId: 'missing',
    method: 'GET',
    path: '/api/x',
    operationKind: 'data_read',
    agentable: true,
    action: null,
  };
  expect(checkCoverage([operation], 1).join(' ')).toContain('actionResolutionReason');
  const entries = [{ ...operation, ...resolve('missing') }];
  expect(checkCoverage(entries, 1)).toEqual([]);
  expect(actionCoverage(entries)).toMatchObject({
    resolvedActionCount: 0,
    unresolvedActionCount: 1,
    unresolvedActions: [
      { operationId: 'missing', reason: 'no_static_route_or_action_declaration' },
    ],
  });
});
