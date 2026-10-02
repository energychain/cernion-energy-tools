'use strict';

const fs = require('fs');
const path = require('path');
const { parseSync, traverse } = require('@babel/core');
const { compareCanonicalStrings } = require('../src/canonical-order');

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function extractStaticEvents(text, ref = '<fixture>') {
  const ast = parseSync(text, { configFile: false, babelrc: false, sourceType: 'unambiguous' });
  const imports = [];
  const emits = new Set();
  const listens = new Set();
  const unresolved = new Set();
  function stringValue(node, scope) {
    if (node?.type === 'StringLiteral') return node.value;
    if (node?.type === 'Identifier') {
      const binding = scope.getBinding(node.name);
      if (binding?.constant && binding.path.node.type === 'VariableDeclarator') {
        const init = binding.path.node.init;
        if (init?.type === 'StringLiteral') return init.value;
      }
    }
    if (node?.type === 'TemplateLiteral' && !node.expressions.length)
      return node.quasis[0].value.cooked;
    return undefined;
  }
  traverse(ast, {
    CallExpression(nodePath) {
      const { node, scope } = nodePath;
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
        const target = stringValue(node.arguments[0], scope);
        if (target?.startsWith('.')) imports.push(target);
      }
      if (node.callee.type !== 'MemberExpression') return;
      const method = node.callee.computed
        ? stringValue(node.callee.property, scope)
        : node.callee.property.name;
      const receiver = node.callee.object;
      const isBroker =
        receiver.type === 'Identifier'
          ? receiver.name === 'broker'
          : receiver.type === 'MemberExpression' && receiver.property.name === 'broker';
      if (isBroker && ['emit', 'broadcast'].includes(method)) {
        const event = stringValue(node.arguments[0], scope);
        if (event) emits.add(event);
        else unresolved.add(`${ref}:${node.loc.start.line}: dynamic emission`);
      }
    },
    ObjectProperty(nodePath) {
      const { node, scope } = nodePath;
      if ((node.key.name || node.key.value) !== 'events' || node.value.type !== 'ObjectExpression')
        return;
      for (const handler of node.value.properties) {
        if (!handler.key) {
          unresolved.add(`${ref}:${handler.loc.start.line}: spread event handlers`);
          continue;
        }
        const event = handler.computed
          ? stringValue(handler.key, scope)
          : handler.key.value || handler.key.name;
        if (event) listens.add(event);
        else unresolved.add(`${ref}:${handler.loc.start.line}: dynamic listener`);
      }
    },
  });
  return {
    emits: [...emits].sort(compareCanonicalStrings),
    listens: [...listens].sort(compareCanonicalStrings),
    unresolved: [...unresolved].sort(compareCanonicalStrings),
    imports,
  };
}

function loadServiceEvents(root) {
  const sources = new Map();
  const parsed = new Map();
  function load(file) {
    if (parsed.has(file)) return parsed.get(file);
    const ref = path.relative(root, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    sources.set(ref, text);
    const result = extractStaticEvents(text, ref);
    parsed.set(file, result);
    return result;
  }
  const events = {};
  for (const filename of fs
    .readdirSync(path.join(root, 'services'))
    .filter((name) => name.endsWith('.service.js'))
    .sort(compareCanonicalStrings)) {
    const file = path.join(root, 'services', filename);
    const visited = new Set();
    const collected = {
      emits: new Set(),
      listens: new Set(),
      unresolved: new Set(),
      sources: new Set(),
    };
    function collect(current) {
      if (visited.has(current)) return;
      visited.add(current);
      const result = load(current);
      const ref = path.relative(root, current).split(path.sep).join('/');
      collected.sources.add(ref);
      for (const kind of ['emits', 'listens', 'unresolved'])
        result[kind].forEach((value) => collected[kind].add(value));
      for (const target of result.imports) {
        const base = path.resolve(path.dirname(current), target);
        const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
        const resolved = candidates.find(
          (candidate) =>
            candidate.startsWith(`${root}${path.sep}`) &&
            candidate.endsWith('.js') &&
            fs.existsSync(candidate) &&
            fs.statSync(candidate).isFile()
        );
        if (resolved) collect(resolved);
      }
    }
    collect(file);
    // Read declared service names without loading modules or starting services.
    const ast = parseSync(sources.get(`services/${filename}`), {
      configFile: false,
      babelrc: false,
    });
    let service = filename.replace('.service.js', '');
    walk(ast, (node) => {
      if (
        node.type === 'AssignmentExpression' &&
        node.left.type === 'MemberExpression' &&
        node.left.object.name === 'module' &&
        node.left.property.name === 'exports' &&
        node.right.type === 'ObjectExpression'
      ) {
        const name = node.right.properties.find((property) => property.key?.name === 'name');
        if (name?.value?.type === 'StringLiteral') service = name.value.value;
      }
    });
    events[service] = Object.fromEntries(
      Object.entries(collected).map(([kind, values]) => [
        kind,
        [...values].sort(compareCanonicalStrings),
      ])
    );
  }
  return { events, sources };
}

module.exports = { extractStaticEvents, loadServiceEvents };
