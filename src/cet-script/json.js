'use strict';
const { fail } = require('./errors');
const { copy } = require('./values');
function nextDepth(character, depth, node) {
  if (character === '[' || character === '{') {
    if (++depth > 100) fail('CONTAINER_VIOLATION', 'JSON nesting limit', node);
  }
  if (character === ']' || character === '}') depth--;
  return depth;
}
function parseText(text, budget, node) {
  budget.bound('valueBytes', text.length * 2, node);
  let depth = 0,
    quoted = false,
    escaped = false,
    entries = 0;
  for (let index = 0; index < text.length; index++) {
    if (index % 32 === 0) budget.tick(node);
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    depth = nextDepth(character, depth, node);
    if (['[', '{', ',', ':'].includes(character)) {
      budget.bound('collectionItems', ++entries, node);
      budget.allocate(128, node);
    }
  }
  return copy(JSON.parse(text), budget);
}
module.exports = { parseText };
