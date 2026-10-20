'use strict';
const { Environment } = require('./environment');
const { boundNames } = require('./parse');
const { ScriptError, fail } = require('./errors');
const v = require('./values');
const { binary, unary } = require('./operators');
const { builtins, getMember, setMember } = require('./builtins');
const OPTIONAL = Symbol('optional');
class Control {
  constructor(kind, value) {
    this.kind = kind;
    this.value = value;
  }
}
class Interpreter {
  constructor(budget, cet, sql) {
    this.budget = budget;
    this.sql = sql;
    this.depth = 0;
    this.failure = null;
    this.pending = [];
    this.root = new Environment(null, budget);
    for (const [name, value] of Object.entries(builtins(this))) this.root.declare(name, value);
    this.root.declare('cet', cet);
  }
  functionValue(node, env) {
    this.budget.allocate(128, node);
    const fn = Object.freeze(v.record());
    v.functions.set(fn, { node, env });
    return fn;
  }
  async run(module, input) {
    this.root.declare('meta', v.copy(module.meta, this.budget));
    this.root.declare('tests', v.copy(module.tests, this.budget));
    const fn = this.functionValue(module.skill, this.root);
    if (module.skill.id) this.root.declare(module.skill.id.name, fn);
    const result = await this.invoke(fn, [input, this.root.get('cet')], module.skill);
    const output = await this.awaitValue(result, module.skill);
    // All started reads must finish successfully before the commit boundary.
    let observed = 0;
    while (observed < this.pending.length) {
      const batch = this.pending.slice(observed);
      observed = this.pending.length;
      await this.budget.wait(Promise.all(batch), module.skill);
    }
    if (this.failure) throw this.failure;
    return output;
  }
  async invoke(fn, args, node) {
    this.budget.tick(node);
    const cap = v.capabilities.get(fn);
    if (cap) {
      if (cap.async)
        return this.defer(
          Promise.resolve().then(() => cap.fn(args, node)),
          'cet'
        );
      return cap.fn(args, node);
    }
    const definition = v.functions.get(fn);
    if (!definition) fail('RUNTIME_ERROR', 'Value is not callable', node);
    if (definition.node.async) return this.defer(this.callFunction(definition, fn, args), 'script');
    return this.callFunction(definition, fn, args);
  }
  defer(promise, origin) {
    this.pending.push(promise);
    this.budget.bound('collectionItems', this.pending.length);
    return v.pending(promise, origin);
  }
  async awaitValue(value, node) {
    const pending = v.deferred.get(value);
    if (!pending) fail('FORBIDDEN_SYNTAX', 'await requires an approved asynchronous call', node);
    return this.budget.wait(pending.promise, node);
  }
  async callFunction({ node, env }, fn, args) {
    this.depth++;
    try {
      this.budget.bound('recursionDepth', this.depth, node);
      const local = new Environment(env);
      if (node.type === 'FunctionExpression' && node.id) local.declare(node.id.name, fn);
      for (let index = 0; index < node.params.length; index++) {
        const pattern = node.params[index];
        await this.bind(
          pattern,
          pattern.type === 'RestElement' ? args.slice(index) : args[index],
          local,
          'let'
        );
      }
      if (node.body.type !== 'BlockStatement') return await this.evaluate(node.body, local);
      const completion = await this.block(node.body.body, local);
      return completion?.kind === 'return' ? completion.value : undefined;
    } finally {
      this.depth--;
    }
  }
  async bind(pattern, value, env, kind, initialize = false) {
    this.budget.tick(pattern);
    if (pattern.type === 'Identifier') {
      if (kind === 'assign') env.set(pattern.name, value, pattern);
      else if (initialize) env.initialize(pattern.name, value);
      else env.declare(pattern.name, value, kind === 'let');
      return;
    }
    if (pattern.type === 'AssignmentPattern')
      return this.bind(
        pattern.left,
        value === undefined ? await this.evaluate(pattern.right, env) : value,
        env,
        kind,
        initialize
      );
    if (pattern.type === 'RestElement')
      return this.bind(pattern.argument, value, env, kind, initialize);
    if (pattern.type === 'MemberExpression' && kind === 'assign') {
      const { object, key } = await this.reference(pattern, env);
      return setMember(object, key, value, this, pattern);
    }
    if (pattern.type === 'ArrayPattern')
      return this.bindArray(pattern, value, env, kind, initialize);
    if (pattern.type === 'ObjectPattern')
      return this.bindObject(pattern, value, env, kind, initialize);
    fail('FORBIDDEN_SYNTAX', 'Invalid binding pattern', pattern);
  }
  async bindArray(pattern, value, env, kind, initialize) {
    const items = [...v.sequence(value, pattern)];
    for (let index = 0; index < pattern.elements.length; index++) {
      const item = pattern.elements[index];
      if (item)
        await this.bind(
          item,
          item.type === 'RestElement' ? [...items].slice(index) : items[index],
          env,
          kind,
          initialize
        );
    }
  }
  async bindObject(pattern, value, env, kind, initialize) {
    if (!value || typeof value !== 'object') fail('RUNTIME_ERROR', 'Expected object', pattern);
    const used = new Set();
    for (const property of pattern.properties) {
      if (property.type === 'RestElement') {
        const rest = v.record();
        for (const key of Object.keys(value))
          if (!used.has(key)) rest[v.keyOf(key)] = getMember(value, key, this, pattern);
        await this.bind(property.argument, rest, env, kind, initialize);
      } else {
        const key = await this.propertyKey(property, env);
        used.add(key);
        await this.bind(
          property.value,
          getMember(value, key, this, pattern),
          env,
          kind,
          initialize
        );
      }
    }
  }
  async propertyKey(node, env) {
    return v.keyOf(
      node.computed ? await this.evaluate(node.key, env) : (node.key.name ?? node.key.value),
      node
    );
  }
  async reference(node, env) {
    const object = await this.evaluate(node.object, env);
    if (object === OPTIONAL || (node.optional && object == null)) return { object: OPTIONAL };
    const key = v.keyOf(
      node.computed ? await this.evaluate(node.property, env) : node.property.name,
      node
    );
    return { object, key };
  }
  async arguments(nodes, env) {
    this.budget.allocate(64);
    const args = [];
    for (const node of nodes) {
      const value = await this.evaluate(node.type === 'SpreadElement' ? node.argument : node, env);
      if (node.type === 'SpreadElement') {
        for (const item of v.sequence(value, node)) {
          this.budget.tick(node);
          this.budget.allocate(16, node);
          args.push(item);
          this.budget.bound('collectionItems', args.length, node);
        }
      } else {
        this.budget.allocate(16, node);
        args.push(value);
      }
    }
    return args;
  }
  async object(node, env) {
    this.budget.allocate(64, node);
    const result = v.record();
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        const source = await this.evaluate(property.argument, env);
        if (source != null)
          for (const key of Object.keys(source)) {
            this.budget.tick(property);
            result[v.keyOf(key)] = getMember(source, key, this, property);
          }
      } else
        result[await this.propertyKey(property, env)] = await this.evaluate(property.value, env);
      this.budget.allocate(64, node);
      this.budget.bound('collectionItems', Object.keys(result).length, node);
    }
    return result;
  }
  async assignment(node, env) {
    const ref =
      node.left.type === 'Identifier'
        ? null
        : node.left.type === 'MemberExpression'
          ? await this.reference(node.left, env)
          : null;
    const read = () =>
      ref ? getMember(ref.object, ref.key, this, node) : env.get(node.left.name, node);
    const previous = node.operator === '=' ? undefined : read();
    if (
      (node.operator === '&&=' && !previous) ||
      (node.operator === '||=' && previous) ||
      (node.operator === '??=' && previous != null)
    )
      return previous;
    const right = await this.evaluate(node.right, env);
    const next = ['=', '&&=', '||=', '??='].includes(node.operator)
      ? right
      : binary(node.operator.slice(0, -1), previous, right, this.budget, node);
    if (ref) setMember(ref.object, ref.key, next, this, node);
    else await this.bind(node.left, next, env, 'assign');
    return next;
  }
  async evaluate(node, env) {
    this.budget.tick(node);
    if (this.failure) throw this.failure;
    try {
      return await this.expression(node, env);
    } catch (error) {
      if (error instanceof ScriptError) {
        if (!error.hasLocation && node.loc) {
          error.line = node.loc.start.line;
          error.column = node.loc.start.column;
          error.hasLocation = true;
        }
        if (error.fatal) this.failure ||= error;
        throw error;
      }
      fail('RUNTIME_ERROR', 'Expression failed', node);
    }
  }
  async expression(node, env) {
    const handlers = {
      Literal: 'exprLiteral',
      Identifier: 'exprIdentifier',
      ArrayExpression: 'exprArrayExpression',
      ObjectExpression: 'exprObjectExpression',
      FunctionExpression: 'exprFunctionExpression',
      ArrowFunctionExpression: 'exprFunctionExpression',
      MemberExpression: 'exprMemberExpression',
      ChainExpression: 'exprChainExpression',
      CallExpression: 'exprCallExpression',
      NewExpression: 'exprNewExpression',
      AwaitExpression: 'exprAwaitExpression',
      TaggedTemplateExpression: 'exprTaggedTemplateExpression',
      TemplateLiteral: 'exprTemplateLiteral',
      BinaryExpression: 'exprBinaryExpression',
      LogicalExpression: 'exprLogicalExpression',
      UnaryExpression: 'exprUnaryExpression',
      ConditionalExpression: 'exprConditionalExpression',
      AssignmentExpression: 'exprAssignmentExpression',
      UpdateExpression: 'exprUpdateExpression',
      SequenceExpression: 'exprSequenceExpression',
    };
    const handler = handlers[node.type];
    if (!handler) fail('FORBIDDEN_SYNTAX', 'Unsupported expression', node);
    return this[handler](node, env);
  }
  async exprLiteral(node, _env) {
    return node.value;
  }
  async exprIdentifier(node, env) {
    return env.get(node.name, node);
  }
  async exprArrayExpression(node, env) {
    return this.arguments(
      node.elements.map((item) => item || { type: 'Identifier', name: 'undefined' }),
      env
    );
  }
  async exprObjectExpression(node, env) {
    return this.object(node, env);
  }
  async exprFunctionExpression(node, env) {
    return this.functionValue(node, env);
  }
  async exprMemberExpression(node, env) {
    const ref = await this.reference(node, env);
    return ref.object === OPTIONAL ? OPTIONAL : getMember(ref.object, ref.key, this, node);
  }
  async exprChainExpression(node, env) {
    const value = await this.evaluate(node.expression, env);
    return value === OPTIONAL ? undefined : value;
  }
  async exprCallExpression(node, env) {
    const fn = await this.evaluate(node.callee, env);
    if (fn === OPTIONAL || (node.optional && fn == null)) return OPTIONAL;
    return this.invoke(fn, await this.arguments(node.arguments, env), node);
  }
  async exprNewExpression(node, env) {
    return this.construct(node.callee.name, await this.arguments(node.arguments, env), node);
  }
  async exprAwaitExpression(node, env) {
    return this.awaitValue(await this.evaluate(node.argument, env), node);
  }
  async exprTaggedTemplateExpression(node, env) {
    const args = await this.arguments(node.quasi.expressions, env);
    return this.defer(
      Promise.resolve().then(() =>
        this.sql(
          node.quasi.quasis.map((item) => item.value.cooked),
          args,
          node
        )
      ),
      'cet'
    );
  }
  async exprTemplateLiteral(node, env) {
    let text = node.quasis[0].value.cooked;
    for (let i = 0; i < node.expressions.length; i++)
      text = binary(
        '+',
        binary(
          '+',
          text,
          v.primitive(await this.evaluate(node.expressions[i], env), node),
          this.budget,
          node
        ),
        node.quasis[i + 1].value.cooked,
        this.budget,
        node
      );
    return text;
  }
  async exprBinaryExpression(node, env) {
    return binary(
      node.operator,
      await this.evaluate(node.left, env),
      await this.evaluate(node.right, env),
      this.budget,
      node
    );
  }
  async exprLogicalExpression(node, env) {
    const left = await this.evaluate(node.left, env);
    if (
      (node.operator === '&&' && !left) ||
      (node.operator === '||' && left) ||
      (node.operator === '??' && left != null)
    )
      return left;
    return this.evaluate(node.right, env);
  }
  async exprUnaryExpression(node, env) {
    return unary(node.operator, await this.evaluate(node.argument, env));
  }
  async exprConditionalExpression(node, env) {
    return this.evaluate(
      (await this.evaluate(node.test, env)) ? node.consequent : node.alternate,
      env
    );
  }
  async exprAssignmentExpression(node, env) {
    return this.assignment(node, env);
  }
  async exprUpdateExpression(node, env) {
    const target = node.argument;
    const ref = target.type === 'MemberExpression' ? await this.reference(target, env) : null;
    const previous = Number(
      v.primitive(
        ref ? getMember(ref.object, ref.key, this, node) : env.get(target.name, node),
        node
      )
    );
    const next = previous + (node.operator === '++' ? 1 : -1);
    if (ref) setMember(ref.object, ref.key, next, this, node);
    else env.set(target.name, next, node);
    return node.prefix ? next : previous;
  }
  async exprSequenceExpression(node, env) {
    let value;
    for (const expression of node.expressions) value = await this.evaluate(expression, env);
    return value;
  }
  construct(name, args, node) {
    const value = Object.freeze(v.record());
    const source = args[0] == null ? [] : v.sequence(args[0], node);
    const data = name === 'Map' ? new Map() : new Set();
    for (const entry of source) {
      this.budget.tick(node);
      if (name === 'Map') {
        if (!Array.isArray(entry) || entry.length < 2)
          fail('RUNTIME_ERROR', 'Expected key/value pair', node);
        data.set(entry[0], entry[1]);
      } else data.add(entry);
      this.budget.bound('collectionItems', data.size, node);
    }
    v.collections.set(value, { type: name, data });
    return value;
  }
  prepare(body, env) {
    for (const node of body) {
      if (node.type === 'FunctionDeclaration')
        env.declare(node.id.name, this.functionValue(node, env));
      if (node.type === 'VariableDeclaration')
        for (const declaration of node.declarations)
          for (const name of boundNames(declaration.id)) env.reserve(name, node.kind === 'let');
    }
  }
  async block(body, env) {
    this.prepare(body, env);
    for (const node of body) {
      const completion = await this.statement(node, env);
      if (completion) return completion;
    }
    return undefined;
  }
  async loop(node, env) {
    let local = new Environment(env);
    if (node.init?.type === 'VariableDeclaration') {
      this.prepare([node.init], local);
      await this.statement(node.init, local);
    } else if (node.init) await this.evaluate(node.init, local);
    let first = true;
    while (true) {
      this.budget.tick(node);
      if (
        (node.type !== 'DoWhileStatement' || !first) &&
        node.test &&
        !(await this.evaluate(node.test, local))
      )
        break;
      first = false;
      const completion = await this.statement(node.body, local);
      if (completion?.kind === 'return') return completion;
      if (completion?.kind === 'break') break;
      local = local.iteration();
      if (node.update) await this.evaluate(node.update, local);
    }
    return undefined;
  }
  async forOf(node, env) {
    const sequence = v.sequence(await this.evaluate(node.right, env), node);
    for (const value of sequence) {
      this.budget.tick(node);
      const local = new Environment(env);
      if (node.left.type === 'VariableDeclaration')
        await this.bind(node.left.declarations[0].id, value, local, node.left.kind);
      else await this.bind(node.left, value, local, 'assign');
      const completion = await this.statement(node.body, local);
      if (completion?.kind === 'return') return completion;
      if (completion?.kind === 'break') break;
    }
    return undefined;
  }
  async capture(work) {
    try {
      return { completion: await work() };
    } catch (error) {
      if (error instanceof ScriptError && error.fatal) {
        this.failure ||= error;
        throw error;
      }
      return { hasThrown: true, thrown: error };
    }
  }
  async catchHandler(handler, env, error) {
    const local = new Environment(env);
    if (handler.param)
      await this.bind(
        handler.param,
        error instanceof ScriptError
          ? v.copy(
              { message: error.message, code: error.code, line: error.line, column: error.column },
              this.budget
            )
          : error,
        local,
        'let'
      );
    return this.statement(handler.body, local);
  }
  async tryStatement(node, env) {
    let outcome = await this.capture(() => this.statement(node.block, env));
    if (outcome.hasThrown && node.handler)
      outcome = await this.capture(() => this.catchHandler(node.handler, env, outcome.thrown));
    this.budget.check(node);
    if (node.finalizer) {
      const final = await this.statement(node.finalizer, env);
      if (final) return final;
    }
    if (outcome.hasThrown) throw outcome.thrown;
    return outcome.completion;
  }
  async switchStatement(node, env) {
    const value = await this.evaluate(node.discriminant, env);
    const local = new Environment(env);
    this.prepare(
      node.cases.flatMap((item) => item.consequent),
      local
    );
    let start = -1,
      fallback = -1;
    for (let i = 0; i < node.cases.length; i++) {
      const item = node.cases[i];
      if (!item.test) fallback = i;
      else if (value === (await this.evaluate(item.test, local))) {
        start = i;
        break;
      }
    }
    if (start < 0) start = fallback;
    if (start < 0) return undefined;
    for (const item of node.cases.slice(start))
      for (const statement of item.consequent) {
        const completion = await this.statement(statement, local);
        if (completion?.kind === 'break') return undefined;
        if (completion) return completion;
      }
    return undefined;
  }
  async statement(node, env) {
    this.budget.tick(node);
    if (this.failure) throw this.failure;
    switch (node.type) {
      case 'EmptyStatement':
      case 'FunctionDeclaration':
        return undefined;
      case 'BlockStatement':
        return this.block(node.body, new Environment(env));
      case 'ExpressionStatement':
        await this.evaluate(node.expression, env);
        return undefined;
      case 'VariableDeclaration':
        for (const declaration of node.declarations)
          await this.bind(
            declaration.id,
            declaration.init ? await this.evaluate(declaration.init, env) : undefined,
            env,
            node.kind,
            true
          );
        return undefined;
      case 'IfStatement': {
        const branch = (await this.evaluate(node.test, env)) ? node.consequent : node.alternate;
        return branch ? this.statement(branch, env) : undefined;
      }
      case 'ReturnStatement':
        return new Control(
          'return',
          node.argument ? await this.evaluate(node.argument, env) : undefined
        );
      case 'BreakStatement':
        return new Control('break');
      case 'ContinueStatement':
        return new Control('continue');
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForStatement':
        return this.loop(node, env);
      case 'ForOfStatement':
        return this.forOf(node, env);
      case 'TryStatement':
        return this.tryStatement(node, env);
      case 'ThrowStatement':
        throw await this.evaluate(node.argument, env);
      case 'SwitchStatement':
        return this.switchStatement(node, env);
      default:
        fail('FORBIDDEN_SYNTAX', 'Unsupported statement', node);
    }
  }
}
module.exports = { Interpreter };
