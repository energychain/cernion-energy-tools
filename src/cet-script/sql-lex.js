'use strict';
const { fail } = require('./errors');
function quotedEnd(sql, start) {
  const quote = sql[start];
  let cursor = start + 1;
  while (cursor < sql.length) {
    if (sql[cursor++] !== quote) continue;
    if (sql[cursor] === quote) {
      cursor++;
      continue;
    }
    return cursor;
  }
  fail('SQL_REJECTED', 'Unterminated SQL text');
}
function lexSql(sql) {
  const output = [];
  let cursor = 0,
    depth = 0;
  while (cursor < sql.length) {
    const start = cursor,
      character = sql[cursor];
    if (/\s/.test(character)) {
      cursor++;
      continue;
    }
    if (sql.startsWith('--', cursor) || sql.startsWith('/*', cursor))
      fail('SQL_REJECTED', 'SQL comments are unavailable');
    if (character === "'" || character === '"') {
      cursor = quotedEnd(sql, cursor);
      output.push({
        text: character === "'" ? 'literal' : 'identifier',
        start,
        end: cursor,
        depth,
      });
      continue;
    }
    if (/[a-z_]/i.test(character)) {
      cursor++;
      while (cursor < sql.length && /[a-z_0-9]/i.test(sql[cursor])) cursor++;
      output.push({ text: sql.slice(start, cursor).toUpperCase(), start, end: cursor, depth });
      continue;
    }
    if (character === '(') depth++;
    if (character === ')') depth--;
    cursor++;
    output.push({ text: character, start, end: cursor, depth });
  }
  return output;
}
module.exports = { lexSql };
