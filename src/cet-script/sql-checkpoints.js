'use strict';
const { performance } = require('node:perf_hooks');
const { fail } = require('./errors');
const { lexSql } = require('./sql-lex');
const BRANCHES = new Set(
  'MustBeInt Once If IfNot IsType IfNullRow SeekLT SeekLE SeekGE SeekGT IfNotOpen IfNoHope NoConflict NotFound Found SeekRowid NotExists Last IfSizeBetween SorterSort Sort Rewind IfEmpty SorterNext Prev Next IdxLE IdxGT IdxLT IdxGE RowSetRead RowSetTest IsNull NotNull Ne Eq Gt Le Lt Ge ElseEq IfPos IfNotZero DecrJumpZero Filter SequenceTest SorterCompare'.split(
    ' '
  )
);
const AGGREGATES = new Set(['sum', 'total', 'avg', 'count', 'min', 'max']);
function boundedLike(args, check) {
  const [rawPattern, rawValue, escape] = args;
  if (rawPattern == null || rawValue == null) return null;
  if (args.length < 2 || args.length > 3 || (escape !== undefined && String(escape).length !== 1))
    fail('SQL_REJECTED', 'Invalid LIKE arguments');
  const fold = (value) => String(value).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const pattern = fold(rawPattern),
    value = fold(rawValue),
    tokens = [];
  if (pattern.length > 512) fail('SQL_REJECTED', 'LIKE pattern limit');
  for (let i = 0; i < pattern.length; i++) {
    check();
    if (pattern[i] === escape) {
      if (++i >= pattern.length) return 0;
      tokens.push({ literal: pattern[i] });
    } else tokens.push({ character: pattern[i] });
  }
  let p = 0,
    v = 0,
    star = -1,
    matched = 0;
  while (v < value.length) {
    check();
    const token = tokens[p];
    if (
      token &&
      (token.literal === value[v] ||
        token.character === '_' ||
        (token.character === value[v] && token.character !== '%'))
    ) {
      p++;
      v++;
    } else if (token?.character === '%') {
      star = p++;
      matched = v;
    } else if (star >= 0) {
      p = star + 1;
      v = ++matched;
    } else return 0;
  }
  while (tokens[p]?.character === '%') {
    check();
    p++;
  }
  return Number(p === tokens.length);
}
function installCheckpoints(db, deadline, stepLimit) {
  let steps = 0;
  const check = () => {
    if (performance.now() >= deadline)
      fail('BUDGET_EXCEEDED', 'SQL deadline exceeded', null, { budget: 'runtimeMs' });
    if (++steps > stepLimit)
      fail('BUDGET_EXCEEDED', 'SQL work limit exceeded', null, { budget: 'steps' });
    return 1;
  };
  db.function('cet_script_tick', { varargs: true }, (...args) => {
    check();
    return args.length ? args[0] : 1;
  });
  db.function('like', { varargs: true }, (...args) => boundedLike(args, check));
  return { check, steps: () => steps };
}
function nextInstructions(item, address, stack) {
  if (['InitCoroutine', 'Yield', 'EndCoroutine', 'BeginSubrtn'].includes(item.opcode))
    fail('SQL_REJECTED', 'Coroutine or scalar subquery SQL plan unavailable');
  let next = [];
  if (item.opcode === 'Gosub')
    next = [[item.p2, [...stack, { register: item.p1, address: address + 1 }]]];
  else if (item.opcode === 'Return') {
    const frame = stack.at(-1);
    if (!frame || frame.register !== item.p1) fail('SQL_REJECTED', 'Unverifiable SQL return');
    next = [[frame.address, stack.slice(0, -1)]];
  } else if (['Init', 'Goto'].includes(item.opcode)) next = [[item.p2, stack]];
  else if (item.opcode === 'Jump')
    next = [item.p1, item.p2, item.p3].map((target) => [target, stack]);
  else if (item.opcode !== 'Halt')
    next = (BRANCHES.has(item.opcode) ? [address + 1, item.p2] : [address + 1]).map((target) => [
      target,
      stack,
    ]);
  return next;
}
function checkpointGraph(instructions) {
  const checkpoint = (item) =>
    item.opcode === 'ResultRow' ||
    (['Function', 'PureFunc'].includes(item.opcode) &&
      String(item.p4).startsWith('cet_script_tick('));
  const graph = [],
    states = new Map(),
    queue = [];
  const enqueue = (address, stack) => {
    if (address < 0 || address >= instructions.length) return null;
    const key = `${address}:${stack.map((frame) => `${frame.register}/${frame.address}`).join(',')}`;
    if (states.has(key)) return states.get(key);
    if (states.size >= 100000 || stack.length > 100) fail('SQL_REJECTED', 'SQL control flow limit');
    const index = graph.length;
    states.set(key, index);
    graph.push([]);
    queue.push({ index, address, stack });
    return index;
  };
  enqueue(0, []);
  for (let offset = 0; offset < queue.length; offset++) {
    const { index, address, stack } = queue[offset],
      item = instructions[address];
    const next = nextInstructions(item, address, stack);
    const edges = next
      .map(([target, frames]) => enqueue(target, frames))
      .filter((target) => target !== null);
    if (!checkpoint(item)) graph[index] = edges;
  }
  rejectCycles(graph);
}
function rejectCycles(graph) {
  const colors = new Uint8Array(graph.length);
  for (let start = 0; start < graph.length; start++) {
    if (colors[start]) continue;
    const stack = [[start, false]];
    while (stack.length) {
      const [index, exiting] = stack.pop();
      if (exiting) {
        colors[index] = 2;
        continue;
      }
      if (colors[index] === 1) fail('SQL_REJECTED', 'SQL cycle without a checkpoint');
      if (colors[index] === 2) continue;
      colors[index] = 1;
      stack.push([index, true]);
      for (const next of graph[index]) stack.push([next, false]);
    }
  }
}
// Insert a checkpoint into each result projection and each grouping key.
// SQLite still parses and compiles the transformed statement; ambiguous plans fail closed.
function wrapPredicate(significant, n, sql, edits) {
  const item = significant[n];
  const end = significant
    .slice(n + 1)
    .find(
      (token) =>
        token.depth < item.depth ||
        (token.depth === item.depth &&
          [
            'GROUP',
            'HAVING',
            'ORDER',
            'LIMIT',
            'WINDOW',
            'UNION',
            'INTERSECT',
            'EXCEPT',
            ';',
          ].includes(token.text))
    );
  edits.push(
    { at: item.end, text: ' cet_script_tick(' },
    { at: end?.start ?? sql.length, text: ') ' }
  );
}
function wrapGroup(significant, n, sql, edits) {
  const item = significant[n];
  let start = significant[n + 1].end;
  for (let j = n + 2; j <= significant.length; j++) {
    const current = significant[j];
    const end =
      !current ||
      current.depth < item.depth ||
      (current.depth === item.depth &&
        ['HAVING', 'ORDER', 'LIMIT', 'UNION', 'INTERSECT', 'EXCEPT', ';'].includes(current.text));
    if (end || (current.depth === item.depth && current.text === ',')) {
      edits.push(
        { at: start, text: ' cet_script_tick(' },
        { at: current?.start ?? sql.length, text: ') ' }
      );
      if (end) break;
      start = current.end;
    }
  }
}
function wrapAggregate(tokens, n, sql, edits) {
  const name = tokens[n].text,
    open = tokens[n + 1];
  if (!AGGREGATES.has(name.toLowerCase()) || open?.text !== '(') return;
  const close = tokens.slice(n + 2).find((token) => token.text === ')' && token.depth < open.depth);
  if (!close) return;
  const inner = tokens.slice(n + 2).filter((token) => token.start < close.start);
  if (inner.some((token) => token.text === ',' && token.depth === open.depth)) return;
  const raw = sql.slice(open.end, close.start).trim();
  if (name === 'COUNT' && (raw === '*' || !raw)) {
    edits.push({ at: open.end, delete: close.start - open.end, text: 'cet_script_tick()' });
    return;
  }
  const start = inner[0]?.text === 'DISTINCT' ? inner[0].end : open.end;
  edits.push({ at: start, text: ' cet_script_tick(' }, { at: close.start, text: ') ' });
}
function instrument(sql) {
  const edits = [];
  const significant = lexSql(sql);
  for (let n = 0; n < significant.length; n++) {
    const item = significant[n];
    wrapAggregate(significant, n, sql, edits);
    if (item.text === 'SELECT') {
      const next = significant[n + 1];
      edits.push({
        at: ['DISTINCT', 'ALL'].includes(next?.text) ? next.end : item.end,
        text: ' cet_script_tick() AS __cet_guard, ',
      });
    }
    if (item.text === 'WHERE' || item.text === 'HAVING') wrapPredicate(significant, n, sql, edits);
    if (item.text === 'GROUP' && significant[n + 1]?.text === 'BY')
      wrapGroup(significant, n, sql, edits);
  }
  for (const edit of edits.sort((a, b) => b.at - a.at))
    sql = sql.slice(0, edit.at) + edit.text + sql.slice(edit.at + (edit.delete || 0));
  return sql;
}
module.exports = { installCheckpoints, checkpointGraph, instrument };
