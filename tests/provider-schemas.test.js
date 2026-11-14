'use strict';

// Schemas sent to the model provider as response schema. Two shapes made the provider reject the
// request with HTTP 400 in production while mocked unit tests passed: an empty enum value
// ("enum[0]: cannot be empty", turn action) and maxItems on the many-field annotation rows
// (schema too complex). The provider is the judge; these rules keep the known rejections out.
const schemas = {
  turnAction: require('../src/workbench-turn-action').SCHEMA,
  annotation: require('../src/workbench-free-answer').ANNOTATION_SCHEMA,
  knowledgeLoopPlan: require('../src/workbench-knowledge-loop').PLAN_SCHEMA,
  memoryScope: require('../src/tenant-memory').SCOPE_CHECK_SCHEMA,
};

function walk(node, visit, path = '$') {
  if (!node || typeof node !== 'object') return;
  visit(node, path);
  for (const [key, value] of Object.entries(node)) walk(value, visit, `${path}.${key}`);
}

test.each(Object.entries(schemas))('%s has no empty enum value', (_name, schema) => {
  const empty = [];
  walk(schema, (node, path) => {
    if (Array.isArray(node.enum) && node.enum.some((value) => value === '')) empty.push(path);
  });
  expect(empty).toEqual([]);
});

test('the annotation rows carry no maxItems (provider schema limit)', () => {
  const bounded = [];
  walk(schemas.annotation, (node, path) => {
    if (Object.hasOwn(node, 'maxItems')) bounded.push(path);
  });
  expect(bounded).toEqual([]);
});

test('every turn-action field is required, so the model fills the parameters', () => {
  const { SCHEMA } = require('../src/workbench-turn-action');
  expect([...SCHEMA.required].sort()).toEqual(Object.keys(SCHEMA.properties).sort());
});

test('"none" in a turn action means the field does not apply', () => {
  const { normalize } = require('../src/workbench-turn-action');
  expect(
    normalize({
      action: 'function',
      target: 'coverage',
      positive: true,
      agentKind: 'none',
      phrase: 'Alpha Review',
      neighborPhrase: '',
      identifier: '',
      description: '',
      preference: 'none',
    }).correction
  ).toEqual({
    type: 'function',
    target: 'coverage',
    correction: { score: 1 },
    phrase: 'Alpha Review',
  });
  expect(
    normalize({ action: 'function', target: 'none', positive: true, agentKind: 'none' }).correction
  ).toBeNull();
});
