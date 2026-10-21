'use strict';
const { primitive, functions, capabilities } = require('./values');
const { fail } = require('./errors');
function binary(operator, left, right, budget, node) {
  if (operator === '===') return left === right;
  if (operator === '!==') return left !== right;
  if (operator === '==' || operator === '!=') {
    if (left != null && right != null)
      fail('FORBIDDEN_SYNTAX', 'Loose equality requires null', node);
    return operator === '==' ? left == right : left != right;
  }
  primitive(left, node);
  primitive(right, node);
  if (operator === '+' && (typeof left === 'string' || typeof right === 'string')) {
    budget.bound('valueBytes', (String(left).length + String(right).length) * 2, node);
    budget.allocate((String(left).length + String(right).length) * 2, node);
    return String(left) + String(right);
  }
  const operators = {
    '+': () => left + right,
    '-': () => left - right,
    '*': () => left * right,
    '/': () => left / right,
    '%': () => left % right,
    '**': () => left ** right,
    '<': () => left < right,
    '<=': () => left <= right,
    '>': () => left > right,
    '>=': () => left >= right,
    '|': () => left | right,
    '&': () => left & right,
    '^': () => left ^ right,
    '<<': () => left << right,
    '>>': () => left >> right,
    '>>>': () => left >>> right,
  };
  if (!operators[operator]) fail('FORBIDDEN_SYNTAX', 'Unsupported operator', node);
  return operators[operator]();
}
function unary(operator, value) {
  if (operator === '!') return !value;
  if (operator === 'typeof')
    return functions.has(value) || capabilities.has(value) ? 'function' : typeof value;
  if (operator === 'void') return undefined;
  primitive(value);
  if (operator === '+') return +value;
  if (operator === '-') return -value;
  return ~value;
}
module.exports = { binary, unary };
