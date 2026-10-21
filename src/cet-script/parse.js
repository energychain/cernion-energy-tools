'use strict';
const acorn = require('acorn');
const { inputValidator } = require('./schema');
const { fail } = require('./errors');
const { BLOCKED, record, keyOf } = require('./values');
const GLOBALS = new Set([
  'Math',
  'JSON',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'Map',
  'Set',
  'Promise',
  'undefined',
  'NaN',
  'Infinity',
]);
const FORBIDDEN_NAMES = new Set([
  'require',
  'eval',
  'Function',
  'globalThis',
  'process',
  'Buffer',
  'setTimeout',
  'fetch',
  'arguments',
  'Date',
  'RegExp',
  'Proxy',
  'Reflect',
]);
const TYPES = new Set([
  'Program',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'VariableDeclaration',
  'VariableDeclarator',
  'Identifier',
  'Literal',
  'ObjectExpression',
  'ArrayExpression',
  'Property',
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'BlockStatement',
  'ExpressionStatement',
  'EmptyStatement',
  'IfStatement',
  'ForOfStatement',
  'ForStatement',
  'WhileStatement',
  'DoWhileStatement',
  'BreakStatement',
  'ContinueStatement',
  'SwitchStatement',
  'SwitchCase',
  'ReturnStatement',
  'TryStatement',
  'CatchClause',
  'ThrowStatement',
  'BinaryExpression',
  'LogicalExpression',
  'UnaryExpression',
  'UpdateExpression',
  'AssignmentExpression',
  'ConditionalExpression',
  'TemplateLiteral',
  'TemplateElement',
  'ObjectPattern',
  'ArrayPattern',
  'AssignmentPattern',
  'RestElement',
  'SpreadElement',
  'MemberExpression',
  'ChainExpression',
  'CallExpression',
  'AwaitExpression',
  'TaggedTemplateExpression',
  'NewExpression',
  'SequenceExpression',
]);
const BINARY = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '===',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
  '==',
  '!=',
  '|',
  '&',
  '^',
  '<<',
  '>>',
  '>>>',
]);
const UNARY = new Set(['+', '-', '!', '~', 'typeof', 'void']);
const ASSIGN = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '&&=',
  '||=',
  '??=',
  '|=',
  '&=',
  '^=',
  '<<=',
  '>>=',
  '>>>=',
]);
function children(node) {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === 'loc') return [];
    if (Array.isArray(value)) return value.filter((item) => item?.type);
    return value?.type ? [value] : [];
  });
}
function literal(node, depth = 0) {
  if (!node) fail('FORBIDDEN_SYNTAX', 'Expected static data');
  if (depth > 100) fail('FORBIDDEN_SYNTAX', 'Static data nesting limit', node);
  if (node.type === 'Literal' && !node.regex && !node.bigint) return node.value;
  if (
    node.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number'
  )
    return -node.argument.value;
  if (node.type === 'ArrayExpression') return node.elements.map((item) => literal(item, depth + 1));
  if (node.type === 'ObjectExpression') {
    const result = record();
    for (const property of node.properties) {
      if (
        property.type !== 'Property' ||
        property.computed ||
        property.method ||
        property.kind !== 'init'
      )
        fail('FORBIDDEN_SYNTAX', 'Expected static data', property);
      const key = keyOf(property.key.name ?? property.key.value, property.key);
      result[key] = literal(property.value, depth + 1);
    }
    return result;
  }
  fail('FORBIDDEN_SYNTAX', 'Expected static data', node);
}
function boundNames(node) {
  if (!node) return [];
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'RestElement') return boundNames(node.argument);
  if (node.type === 'AssignmentPattern') return boundNames(node.left);
  if (node.type === 'ObjectPattern')
    return node.properties.flatMap((p) => boundNames(p.value || p.argument));
  if (node.type === 'ArrayPattern') return node.elements.flatMap(boundNames);
  return [];
}
function validateTest(test, validateInput, node) {
  const reject = () => fail('FORBIDDEN_SYNTAX', 'Invalid module test', node);
  if (
    !test ||
    Array.isArray(test) ||
    typeof test !== 'object' ||
    !Object.hasOwn(test, 'input') ||
    !test.expect ||
    Array.isArray(test.expect) ||
    typeof test.expect !== 'object'
  )
    reject();
  if (Object.keys(test).some((key) => !['input', 'expect'].includes(key))) reject();
  if (!validateInput(test.input) && !test.expect.error) reject();
  const validators = {
    rows: (value) => Number.isSafeInteger(value) && value >= 0,
    columns: (value) => Array.isArray(value) && value.every((key) => typeof key === 'string'),
    value: (value) => typeof value === 'number' && Number.isFinite(value),
    tolerance: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    contains: (value) =>
      Array.isArray(value) &&
      value.every((row) => row && typeof row === 'object' && !Array.isArray(row)),
    gap: (value) => typeof value === 'boolean',
    error: (value) => typeof value === 'string' && value.startsWith('CET_SCRIPT_'),
  };
  for (const [key, value] of Object.entries(test.expect))
    if (!Object.hasOwn(validators, key) || !validators[key](value)) reject();
}
function exportsOf(ast, budget) {
  if (ast.body.length !== 3) fail('FORBIDDEN_SYNTAX', 'Exactly three exports required', ast);
  const output = record();
  for (const item of ast.body) {
    if (item.type === 'ExportDefaultDeclaration') {
      const fn = item.declaration;
      if (
        output.skill ||
        fn.type !== 'FunctionDeclaration' ||
        !fn.async ||
        fn.params.length !== 2 ||
        fn.params[0].type !== 'Identifier' ||
        fn.params[1].name !== 'cet'
      )
        fail('FORBIDDEN_SYNTAX', 'Expected default async function (input, cet)', item);
      output.skill = fn;
    } else if (
      item.type === 'ExportNamedDeclaration' &&
      !item.source &&
      item.declaration?.type === 'VariableDeclaration' &&
      item.declaration.kind === 'const' &&
      item.declaration.declarations.length === 1
    ) {
      const declaration = item.declaration.declarations[0];
      const name = declaration.id.name;
      if (!['meta', 'tests'].includes(name) || Object.hasOwn(output, name))
        fail('FORBIDDEN_SYNTAX', 'Invalid export', item);
      output[name] = literal(declaration.init);
    } else fail('FORBIDDEN_SYNTAX', 'Invalid export', item);
  }
  const meta = output.meta;
  if (
    !meta ||
    typeof meta.id !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.id) ||
    !Number.isSafeInteger(meta.version) ||
    meta.version < 1 ||
    meta.language !== 'cet-script/1' ||
    typeof meta.intent !== 'string' ||
    !meta.intent.trim() ||
    !['table', 'figure', 'text', 'mixed'].includes(meta.outputs?.kind) ||
    !Array.isArray(output.tests) ||
    !output.skill
  )
    fail('FORBIDDEN_SYNTAX', 'Invalid module metadata', ast);
  output.validateInput = inputValidator(meta.inputs, ast, budget);
  for (const test of output.tests) validateTest(test, output.validateInput, ast);
  return output;
}
function declarations(nodes, skill) {
  const names = new Set([...GLOBALS, 'cet']);
  const bindings = [];
  for (const node of nodes) {
    if (node.type === 'VariableDeclarator')
      bindings.push(...boundNames(node.id).map((name) => ({ name, node })));
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    ) {
      if (node.id) bindings.push({ name: node.id.name, node });
      bindings.push(...node.params.flatMap(boundNames).map((name) => ({ name, node })));
    }
    if (node.type === 'CatchClause')
      bindings.push(...boundNames(node.param).map((name) => ({ name, node })));
  }
  for (const { name, node } of bindings) {
    if (
      GLOBALS.has(name) ||
      FORBIDDEN_NAMES.has(name) ||
      BLOCKED.has(name) ||
      (name === 'cet' && node !== skill)
    )
      fail('FORBIDDEN_SYNTAX', 'Reserved binding', node);
    names.add(name);
  }
  return names;
}
function addDeclarations(body, names) {
  for (const item of body) {
    if (item.type === 'VariableDeclaration')
      for (const declaration of item.declarations)
        for (const name of boundNames(declaration.id)) names.add(name);
    if (item.type === 'FunctionDeclaration' && item.id) names.add(item.id.name);
  }
}
function scopeFor(node, parent) {
  const scope = { parent, names: new Set() };
  if (node.params)
    for (const parameter of node.params)
      for (const name of boundNames(parameter)) scope.names.add(name);
  if (node.id) scope.names.add(node.id.name);
  if (node.type === 'BlockStatement') addDeclarations(node.body, scope.names);
  if (node.type === 'CatchClause') for (const name of boundNames(node.param)) scope.names.add(name);
  if (node.type === 'SwitchStatement')
    addDeclarations(
      node.cases.flatMap((item) => item.consequent),
      scope.names
    );
  const declaration = node.init || node.left;
  if (declaration?.type === 'VariableDeclaration') addDeclarations([declaration], scope.names);
  return scope;
}
function lexicalNames(ast, module) {
  const root = {
    parent: null,
    names: new Set([
      ...GLOBALS,
      'meta',
      'tests',
      ...(module.skill.id ? [module.skill.id.name] : []),
    ]),
  };
  const result = new Map(),
    queue = [[ast, root]];
  while (queue.length) {
    const [node, parent] = queue.pop();
    let scope = parent;
    if (
      [
        'FunctionDeclaration',
        'FunctionExpression',
        'ArrowFunctionExpression',
        'BlockStatement',
        'CatchClause',
        'ForStatement',
        'ForOfStatement',
        'SwitchStatement',
      ].includes(node.type)
    ) {
      scope = scopeFor(node, parent);
    }
    const captured = scope;
    result.set(node, {
      has(name) {
        for (let current = captured; current; current = current.parent)
          if (current.names.has(name)) return true;
        return false;
      },
    });
    for (const child of children(node)) queue.push([child, scope]);
  }
  return result;
}
function globalMember(node, reject) {
  if (node.type !== 'MemberExpression' || !GLOBALS.has(node.object.name)) return;
  const key = node.computed
    ? node.property.type === 'Literal'
      ? String(node.property.value)
      : null
    : node.property.name;
  if (key === null) return;
  const allowed = {
    Math: Object.getOwnPropertyNames(Math).filter((name) => name !== 'random'),
    JSON: ['parse', 'stringify'],
    Number: [
      'isFinite',
      'isInteger',
      'isNaN',
      'isSafeInteger',
      'parseFloat',
      'parseInt',
      'MAX_SAFE_INTEGER',
      'MIN_SAFE_INTEGER',
      'EPSILON',
      'POSITIVE_INFINITY',
      'NaN',
    ],
    String: [],
    Boolean: [],
    Array: ['isArray', 'from'],
    Object: ['keys', 'values', 'entries', 'fromEntries', 'assign'],
    Map: [],
    Set: [],
    Promise: ['all'],
  };
  if (!allowed[node.object.name]?.includes(key)) reject('Unavailable builtin property');
}
function checkNode(node, parent, names, options) {
  const reject = (message) => fail('FORBIDDEN_SYNTAX', message, node);
  globalMember(node, reject);
  if (!TYPES.has(node.type)) reject(`Unsupported syntax: ${node.type}`);
  if (node.type === 'VariableDeclaration' && !['const', 'let'].includes(node.kind))
    reject('Unsupported declaration');
  if (node.generator || node.regex || node.bigint || node.label || node.await)
    reject('Unsupported syntax modifier');
  if (node.type === 'Property' && (node.kind !== 'init' || node.method))
    reject('Accessors and methods are unavailable');
  checkOperators(node, reject);
  checkConstruction(node, reject);
  checkMember(node, parent, reject);
  checkIdentifier(node, parent, names, reject);
  checkCalls(node, options);
}
function checkOperators(node, reject) {
  if (
    node.type === 'BinaryExpression' &&
    (!BINARY.has(node.operator) ||
      (['==', '!='].includes(node.operator) &&
        ![node.left, node.right].some((item) => item.type === 'Literal' && item.value === null)))
  )
    reject('Unsupported binary operator');
  if (node.type === 'UnaryExpression' && !UNARY.has(node.operator))
    reject('Unsupported unary operator');
  if (node.type === 'AssignmentExpression' && !ASSIGN.has(node.operator))
    reject('Unsupported assignment operator');
  if (
    ['AssignmentExpression', 'UpdateExpression'].includes(node.type) &&
    boundNames(node.left || node.argument).some((name) => name === 'cet' || GLOBALS.has(name))
  )
    reject('Reserved assignment');
}
function checkConstruction(node, reject) {
  if (
    node.type === 'NewExpression' &&
    (node.callee.type !== 'Identifier' || !['Map', 'Set'].includes(node.callee.name))
  )
    reject('Unsupported construction');
  if (
    node.type === 'TaggedTemplateExpression' &&
    !(
      node.tag.type === 'MemberExpression' &&
      node.tag.object.name === 'cet' &&
      !node.tag.computed &&
      node.tag.property.name === 'sql'
    )
  )
    reject('Only cet.sql accepts a template');
}
function checkMember(node, parent, reject) {
  if (node.type === 'MemberExpression') {
    const key = !node.computed
      ? node.property.name
      : node.property.type === 'Literal'
        ? node.property.value
        : null;
    if (BLOCKED.has(String(key))) reject('Blocked property');
    if (
      node.object.name === 'cet' &&
      key === 'sql' &&
      !(parent?.type === 'TaggedTemplateExpression' && parent.tag === node)
    )
      reject('cet.sql requires a tagged template');
  }
}
function checkIdentifier(node, parent, names, reject) {
  if (node.type === 'Identifier') {
    const property =
      (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
      (parent?.type === 'Property' && parent.key === node && !parent.computed);
    if (!property && !names.has(node.name)) reject(`Unknown identifier: ${node.name}`);
  }
}
function checkCalls(node, options) {
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.name === 'cet'
  ) {
    const member = node.callee.computed ? node.callee.property.value : node.callee.property.name;
    const value = node.arguments[0]?.type === 'Literal' ? node.arguments[0].value : undefined;
    if (member === 'table' && typeof value === 'string') options.checkTable?.(value, node);
    if (member === 'op' && typeof value === 'string') options.checkOperation?.(value, node);
  }
}
function parse(source, budget, options = {}) {
  if (typeof source !== 'string') fail('FORBIDDEN_SYNTAX', 'Source must be text');
  budget.bound('sourceBytes', Buffer.byteLength(source));
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true });
  } catch (error) {
    fail('FORBIDDEN_SYNTAX', 'Invalid module syntax', { loc: { start: error.loc } });
  }
  const stack = [[ast, null]];
  const pairs = [];
  while (stack.length) {
    const [node, parent] = stack.pop();
    pairs.push([node, parent]);
    budget.bound('astNodes', pairs.length, node);
    for (const child of children(node)) stack.push([child, node]);
  }
  // Check the complete tree before reading static data.
  for (const [node] of pairs)
    if (!TYPES.has(node.type) || node.regex || node.bigint)
      fail('FORBIDDEN_SYNTAX', 'Unsupported syntax', node);
  const module = exportsOf(ast, budget);
  declarations(
    pairs.map(([node]) => node),
    module.skill
  );
  const scopes = lexicalNames(ast, module);
  for (const [node, parent] of pairs) checkNode(node, parent, scopes.get(node), options);
  return { ast, ...module };
}
module.exports = { parse, GLOBALS, boundNames };
