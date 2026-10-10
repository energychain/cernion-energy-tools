'use strict';

const fs = require('fs');
const path = require('path');
const { Linter } = require('eslint');

// Parse source only: do not instantiate services or open databases during this guard.
function findOwnedDatabaseCloses(source) {
  const linter = new Linter();
  const managed = new Set();
  const stoppedHooks = [];
  const propertyName = (node) => (node.computed ? node.property.value : node.property.name);
  return linter.verify(source, [
    {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs' },
      linterOptions: { reportUnusedDisableDirectives: 'off' },
      plugins: {
        ownership: {
          rules: {
            'single-close': {
              meta: { schema: [] },
              create(context) {
                const sourceCode = context.sourceCode;
                function visit(node) {
                  if (!node || typeof node !== 'object') return;
                  if (
                    node.type === 'CallExpression' &&
                    node.callee.type === 'MemberExpression' &&
                    propertyName(node.callee) === 'close' &&
                    node.callee.object.type === 'MemberExpression' &&
                    node.callee.object.object.type === 'ThisExpression' &&
                    managed.has(propertyName(node.callee.object))
                  ) {
                    context.report({
                      node,
                      message: `stopped() closes mixin-owned database ${propertyName(node.callee.object)}`,
                    });
                  }
                  for (const key of sourceCode.visitorKeys[node.type] || []) {
                    const child = node[key];
                    if (Array.isArray(child)) child.forEach(visit);
                    else visit(child);
                  }
                }
                return {
                  CallExpression(node) {
                    if (node.callee.name !== 'createPouchDbLifecycleMixin') return;
                    const options = node.arguments[0];
                    const custom = options?.properties?.find(
                      (entry) => (entry.key.name || entry.key.value) === 'dbProperty'
                    );
                    managed.add(custom ? custom.value.value : 'db');
                  },
                  Property(node) {
                    if ((node.key.name || node.key.value) === 'stopped') {
                      stoppedHooks.push(node.value);
                    }
                  },
                  MethodDefinition(node) {
                    if ((node.key.name || node.key.value) === 'stopped') {
                      stoppedHooks.push(node.value);
                    }
                  },
                  'Program:exit'() {
                    stoppedHooks.forEach(visit);
                  },
                };
              },
            },
          },
        },
      },
      rules: { 'ownership/single-close': 'error' },
    },
  ]);
}

function assertSingleOwner(source) {
  expect(findOwnedDatabaseCloses(source)).toEqual([]);
}

test('the ownership guard rejects the contaminated custom-property fixture', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'fixtures/pouchdb-lifecycle/double-close.js'),
    'utf8'
  );
  expect(findOwnedDatabaseCloses(source)).toEqual([
    expect.objectContaining({ message: 'stopped() closes mixin-owned database store' }),
  ]);
  expect(() => assertSingleOwner(source)).toThrow();
});

test('the guard rejects the original datapoint regression', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/datapoint.service.js'), 'utf8');
  const contaminated = source.replace(
    'async stopped() {',
    'async stopped() { await this.db.close();'
  );
  expect(() => assertSingleOwner(contaminated)).toThrow();
});

test('an independent database close and a service without the mixin are allowed', () => {
  assertSingleOwner(`module.exports = {
    mixins: [createPouchDbLifecycleMixin({ dbProperty: 'store' })],
    async stopped() { await this.other.close(); }
  };`);
  assertSingleOwner('module.exports = { async stopped() { await this.db.close(); } };');
});

const servicesDirectory = path.join(__dirname, '../services');
for (const filename of fs
  .readdirSync(servicesDirectory)
  .filter((name) => name.endsWith('.service.js'))) {
  test(`${filename} leaves mixin-owned databases to the mixin`, () => {
    assertSingleOwner(fs.readFileSync(path.join(servicesDirectory, filename), 'utf8'));
  });
}
