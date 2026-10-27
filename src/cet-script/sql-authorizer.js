'use strict';
const { fail } = require('./errors');
const { checkpointGraph } = require('./sql-checkpoints');
const { lexSql } = require('./sql-lex');
const READ_OPS = new Set(
  `Init Goto Gosub Return Yield EndCoroutine InitCoroutine Noop Explain Transaction AutoCommit Halt Null NullRow Integer Int64 Real String8 String Blob Variable Move Copy SCopy IntCopy ResultRow Once If IfNot IsNull NotNull IfNullRow IfPos IfNotZero DecrJumpZero ZeroOrNull MustBeInt RealAffinity Affinity Cast Add Subtract Multiply Divide Remainder BitAnd BitOr ShiftLeft ShiftRight BitNot Not And Or Eq Ne Lt Le Gt Ge ElseEq Compare Jump IsTrue AddImm CollSeq Permutation OpenRead ReopenIdx OpenEphemeral OpenAutoindex OpenPseudo Close ColumnsUsed Column Rowid IdxRowid SeekRowid NotExists SeekGE SeekGT SeekLE SeekLT SeekScan SeekHit IdxGE IdxGT IdxLE IdxLT Rewind Last Next Prev Count NewRowid Insert IdxInsert Delete ResetSorter SorterOpen SorterInsert SorterSort SorterData SorterNext Sort SorterCompare Sequence SequenceTest MakeRecord Found NotFound NoConflict RowSetAdd RowSetRead RowSetTest DeferredSeek FinishSeek Function PureFunc AggStep AggStep1 AggFinal AggValue AggInverse OffsetLimit IfSmaller IfEmpty Filter FilterAdd BeginSubrtn ReleaseReg Abortable IsType SeekEnd`.split(
    ' '
  )
);
const FUNCTIONS = new Set([
  'abs',
  'avg',
  'sum',
  'total',
  'count',
  'min',
  'max',
  'round',
  'coalesce',
  'ifnull',
  'nullif',
  'iif',
  'length',
  'lower',
  'upper',
  'substr',
  'substring',
  'instr',
  'typeof',
  'unicode',
  'like',
  'strftime',
  'julianday',
  'cet_script_tick',
]);
function rejectOrdinals(tokens) {
  let clauseDepth = null;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.text === 'BY' && ['GROUP', 'ORDER'].includes(tokens[index - 1]?.text))
      clauseDepth = token.depth;
    if (clauseDepth === null) continue;
    if (
      token.depth < clauseDepth ||
      ['HAVING', 'LIMIT', 'UNION', 'INTERSECT', 'EXCEPT'].includes(token.text)
    ) {
      clauseDepth = null;
      continue;
    }
    if (
      token.depth === clauseDepth &&
      ['BY', ','].includes(token.text) &&
      /^\d/.test(tokens[index + 1]?.text || '')
    )
      fail('SQL_REJECTED', 'Positional SQL keys are unavailable');
  }
}
function validateText(sql) {
  const lexed = lexSql(sql);
  rejectOrdinals(lexed);
  const parts = lexed.map((token) => token.text);
  if (!['SELECT', 'WITH'].includes(parts[0])) fail('SQL_REJECTED', 'Expected SELECT');
  const forbidden = new Set([
    'ATTACH',
    'DETACH',
    'PRAGMA',
    'INSERT',
    'UPDATE',
    'DELETE',
    'REPLACE',
    'CREATE',
    'DROP',
    'ALTER',
    'VACUUM',
    'LOAD_EXTENSION',
    'REINDEX',
    'ANALYZE',
    'RECURSIVE',
    'CURRENT_TIME',
    'CURRENT_DATE',
    'CURRENT_TIMESTAMP',
  ]);
  if (parts.some((part) => forbidden.has(part)) || parts.slice(0, -1).includes(';'))
    fail('SQL_REJECTED', 'Unsupported SQL statement');
}
function roots(db, datasets) {
  const allowed = new Map();
  for (const dataset of datasets) {
    const table = db
      .prepare("SELECT rootpage, type FROM sqlite_schema WHERE name = ? AND type = 'table'")
      .get(dataset.id);
    if (!table || table.rootpage < 2) fail('SQL_REJECTED', 'Missing physical dataset');
    const sensitive = new Set(
      dataset.columns.flatMap((column, i) => (column.sensitive ? [i + 3] : []))
    );
    allowed.set(table.rootpage, sensitive);
    const indexes = db
      .prepare("SELECT name, rootpage FROM sqlite_schema WHERE tbl_name = ? AND type = 'index'")
      .all(dataset.id);
    for (const index of indexes) {
      if (!index.rootpage) continue;
      const fields = db.prepare('SELECT seqno, cid FROM pragma_index_xinfo(?)').all(index.name);
      allowed.set(
        index.rootpage,
        new Set(fields.filter((field) => sensitive.has(field.cid)).map((field) => field.seqno))
      );
    }
  }
  return allowed;
}
function checkInstruction({ opcode, p1, p2, p3, p4, p5 }, allowed, cursors) {
  if (opcode === 'Transaction' && (p1 !== 0 || p2 !== 0))
    fail('SQL_REJECTED', 'Foreign or writable database');
  if (opcode === 'OpenRead' || opcode === 'ReopenIdx') {
    if (p3 !== 0 || (p5 & 16) !== 0 || !allowed.has(p2))
      fail('SQL_REJECTED', 'Read outside dataset tables');
    const restrictions = cursors.get(p1) || new Set();
    for (const field of allowed.get(p2)) restrictions.add(field);
    cursors.set(p1, restrictions);
  }
  if (
    ['Function', 'PureFunc', 'AggStep', 'AggStep1', 'AggFinal', 'AggValue', 'AggInverse'].includes(
      opcode
    )
  ) {
    const name = String(p4).split('(')[0].toLowerCase();
    if (!FUNCTIONS.has(name)) fail('SQL_REJECTED', 'SQLite function is unavailable');
  }
}
function authorize(db, sql, params, datasets) {
  if (db.prepare('SELECT sqlite_version() AS version').get().version !== '3.53.4')
    fail('SQL_REJECTED', 'SQLite version requires a reviewed instruction policy');
  validateText(sql);
  const statement = db.prepare(sql);
  if (statement.readonly !== true || !statement.reader)
    fail('SQL_REJECTED', 'Statement is not read-only');
  const allowed = roots(db, datasets);
  const instructions = db.prepare(`EXPLAIN ${sql}`).all(...params);
  const cursors = new Map();
  for (const instruction of instructions) {
    const { opcode } = instruction;
    if (!READ_OPS.has(opcode)) fail('SQL_REJECTED', `Unsupported SQLite instruction: ${opcode}`);
    checkInstruction(instruction, allowed, cursors);
  }
  for (const { opcode, p1, p2 } of instructions) {
    if (opcode === 'Column' && cursors.get(p1)?.has(p2)) fail('SQL_REJECTED', 'Restricted column');
    // Scratch writes are allowed, persistent writes never have an OpenWrite cursor.
    if (['Insert', 'Delete', 'IdxInsert'].includes(opcode) && cursors.has(p1))
      fail('SQL_REJECTED', 'Persistent write instruction');
  }
  checkpointGraph(instructions);
  return statement;
}
function deterministicTime(db) {
  // Durations need day fractions; like strftime, only for an explicit timestamp, never "now".
  db.function('julianday', { deterministic: true, varargs: true }, (...args) => {
    if (args.length !== 1 || typeof args[0] !== 'string' || !/^\d{4}-\d\d-\d\d/.test(args[0]))
      fail('SQL_REJECTED', 'julianday requires an explicit timestamp');
    const date = new Date(
      /(?:Z|[+-]\d\d:\d\d)$/.test(args[0]) ? args[0] : args[0].replace(' ', 'T') + 'Z'
    );
    return Number.isNaN(date.getTime()) ? null : date.getTime() / 86400000 + 2440587.5;
  });
  db.function('strftime', { deterministic: true, varargs: true }, (...args) => {
    if (
      args.length !== 2 ||
      typeof args[0] !== 'string' ||
      typeof args[1] !== 'string' ||
      !/^\d{4}-\d\d-\d\d/.test(args[1])
    )
      fail('SQL_REJECTED', 'strftime requires an explicit timestamp');
    const date = new Date(
      /(?:Z|[+-]\d\d:\d\d)$/.test(args[1]) ? args[1] : args[1].replace(' ', 'T') + 'Z'
    );
    if (Number.isNaN(date.getTime())) return null;
    const iso = date.toISOString();
    const replacements = {
      '%Y': iso.slice(0, 4),
      '%m': iso.slice(5, 7),
      '%d': iso.slice(8, 10),
      '%H': iso.slice(11, 13),
      '%M': iso.slice(14, 16),
      '%S': iso.slice(17, 19),
      '%%': '%',
    };
    return args[0].replace(/%[%YmdHMS]/g, (key) => replacements[key]);
  });
}
module.exports = { authorize, validateText, deterministicTime };
