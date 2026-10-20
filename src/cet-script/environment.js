'use strict';
const { fail } = require('./errors');
class Environment {
  constructor(parent = null, budget = parent?.budget) {
    this.budget = budget;
    budget?.allocate(128);
    this.parent = parent;
    this.bindings = new Map();
  }
  declare(name, value, mutable = false) {
    this.budget?.allocate(128 + name.length * 2);
    if (this.bindings.has(name)) fail('RUNTIME_ERROR', 'Duplicate binding');
    this.bindings.set(name, { value, mutable, ready: true });
  }
  reserve(name, mutable) {
    this.budget?.allocate(128 + name.length * 2);
    if (this.bindings.has(name)) fail('RUNTIME_ERROR', 'Duplicate binding');
    this.bindings.set(name, { value: undefined, mutable, ready: false });
  }
  initialize(name, value) {
    const binding = this.bindings.get(name);
    if (!binding || binding.ready) fail('RUNTIME_ERROR', 'Invalid initialization');
    binding.value = value;
    binding.ready = true;
  }
  binding(name, node) {
    if (this.bindings.has(name)) {
      const binding = this.bindings.get(name);
      if (!binding.ready) fail('RUNTIME_ERROR', 'Binding is not initialized', node);
      return binding;
    }
    if (this.parent) return this.parent.binding(name, node);
    fail('RUNTIME_ERROR', 'Unknown binding', node);
  }
  get(name, node) {
    return this.binding(name, node).value;
  }
  set(name, value, node) {
    const binding = this.binding(name, node);
    if (!binding.mutable || name === 'cet') fail('CONTAINER_VIOLATION', 'Immutable binding', node);
    binding.value = value;
    return value;
  }
  iteration() {
    const next = new Environment(this.parent, this.budget);
    this.budget?.allocate(this.bindings.size * 128);
    for (const [key, binding] of this.bindings) next.bindings.set(key, { ...binding });
    return next;
  }
}
module.exports = { Environment };
