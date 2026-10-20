'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSkill, parse, Budgets } = require('../src/cet-script');
const { ProjectDatasetPool } = require('../src/project-dataset-pool');
const { executeDatasetQuery } = require('../src/dataset-query');
const {
  commitDerived,
  readDerived,
  operationCaller,
  runProjectSkill,
} = require('../src/cet-script/project');
const { authorize } = require('../src/cet-script/sql-authorizer');
const { copy } = require('../src/cet-script/values');
const asOf = '2025-01-01T00:00:00Z';
const binding = { tenantId: 't1', projectId: 'p1', dataVersion: 'v1' };
const metadata = {
  id: 'sample',
  version: 1,
  language: 'cet-script/1',
  intent: 'Compute grouped values',
  inputs: { type: 'object' },
  outputs: { kind: 'table' },
};
const source = (body, meta = metadata) =>
  `export const meta=${JSON.stringify(meta)};\nexport const tests=[];\nexport default async function skill(input,cet){${body}}`;
const run = (body, options = {}, input = {}) =>
  runSkill(source(body), input, { binding, asOf, ...options });
const value = async (body, options, input) => (await run(body, options, input)).result.value;
let directory, pool, other, foreign, fixture, filename;
const id = 'ds_' + 'a'.repeat(32),
  otherId = 'ds_' + 'b'.repeat(32),
  foreignId = 'ds_' + 'c'.repeat(32);
const columns = [
  { name: 'time', type: 'timestamp' },
  { name: 'key', type: 'string' },
  { name: 'value', type: 'number' },
];
const rows = [
  { time: '2025-01-01T00:00:00Z', key: 'a', value: 10 },
  { time: '2025-01-02T00:00:00Z', key: 'a', value: 20 },
  { time: '2025-02-01T00:00:00Z', key: 'b', value: 30 },
];
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-script-test-'));
  pool = await ProjectDatasetPool.open(directory, 't1', 'p1');
  other = await ProjectDatasetPool.open(directory, 't1', 'p2');
  foreign = await ProjectDatasetPool.open(directory, 't2', 'p1');
  pool.putRows(
    't1',
    id,
    rows,
    columns,
    rows.map((r) => r.time),
    rows.map((r) => r.time.slice(0, 19).replace('T', ' '))
  );
  other.putRows('t1', otherId, rows, columns);
  foreign.putRows('t2', foreignId, rows, columns);
  filename = pool.filename;
  fixture = {
    basePath: directory,
    datasets: [
      {
        id,
        tenantId: 't1',
        title: 'data',
        version: 1,
        hash: 'hash-1',
        provenance: { projectId: 'p1', objectId: 'o1', person: 'user', at: asOf },
        columns,
        quality: { intervalMinutes: null },
        semantic: {
          timeField: 'time',
          timezone: 'Europe/Berlin',
          units: { value: 'kWh' },
          assumptions: [],
        },
      },
    ],
    aliases: { data: id },
    graph: [
      {
        ...binding,
        recordType: 'node',
        nodeId: 'n1',
        kind: 'entity',
        labels: ['key'],
        attributes: {},
        provenance: { objectId: 'o1', hash: 'hash-1' },
      },
      {
        ...binding,
        recordType: 'node',
        nodeId: 'n2',
        kind: 'dataset',
        ref: id,
        labels: ['data'],
        attributes: {},
      },
      {
        ...binding,
        recordType: 'node',
        nodeId: 'nx',
        kind: 'external',
        labels: ['reference'],
        ref: { id: 'external' },
        attributes: { hidden: 42 },
      },
      { ...binding, recordType: 'edge', edgeId: 'e1', from: 'n1', to: 'n2', relation: 'joinsOn' },
    ],
    passages: [
      {
        ...binding,
        passageId: 'passage-1',
        objectId: 'o1',
        hash: 'hash-1',
        text: 'Some clear text',
        location: 'page 1',
      },
    ],
  };
});
afterAll(() => {
  for (const active of [pool, other, foreign])
    for (const connection of active.connections.values()) connection.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
describe('ECMAScript 2022 subset §3.1', () => {
  test.each([
    ['const and let', 'const a=2;let b=3;b+=a;return cet.result.value(b);', 5],
    [
      'function declaration and hoisting',
      'return cet.result.value(f(3));function f(x){return x+1;}',
      4,
    ],
    ['arrow and closure', 'const a=2;const f=x=>x+a;return cet.result.value(f(3));', 5],
    [
      'function expression',
      'const f=function inner(x){return x?inner(x-1)+1:0;};return cet.result.value(f(3));',
      3,
    ],
    ['async and await', 'async function f(x){return x+1;}return cet.result.value(await f(3));', 4],
    ['if else', 'let x=0;if(input.y)x=2;else x=3;return cet.result.value(x);', 3],
    [
      'for of, break, continue',
      'let s=0;for(const n of [1,2,3,4]){if(n===2)continue;if(n===4)break;s+=n;}return cet.result.value(s);',
      4,
    ],
    ['classic for', 'let s=0;for(let i=0;i<3;i++){s+=i;}return cet.result.value(s);', 3],
    ['while', 'let i=0;while(i<3)i++;return cet.result.value(i);', 3],
    ['do while', 'let i=0;do{i++;}while(i<3);return cet.result.value(i);', 3],
    [
      'switch fallthrough',
      'let x=0;switch(2){case 1:x=1;break;case 2:x+=2;default:x+=3;}return cet.result.value(x);',
      5,
    ],
    [
      'try catch finally throw',
      'let x=0;try{throw 3;}catch(e){x=e;}finally{x++;}return cet.result.value(x);',
      4,
    ],
    [
      'conditional arithmetic comparison logic',
      'return cet.result.value((2**3===8&&4>=3||false)?(10%3+8/2-1)*2:0);',
      8,
    ],
    ['null equality', 'return cet.result.value((input.x==null&&input.x!=null===false)?1:0);', 1],
    ['nullish and optional chaining', 'return cet.result.value(input.x?.y??2);', 2],
    ['templates', 'return cet.result.text(`a${2+1}`);', 'a3'],
    [
      'destructuring defaults rest spread computed properties',
      'const {a=2,...rest}={b:3};const [x,...xs]=[a,rest.b];const z={...rest,["c"]:x};return cet.result.value(z.c+xs[0]);',
      5,
    ],
    [
      'parameter destructuring rest',
      'function f({a=2},...xs){return a+xs[0];}return cet.result.value(f({},3));',
      5,
    ],
    ['destructuring assignment', 'let a=0,b=0;[a,b]=[2,3];return cet.result.value(a+b);', 5],
    ['comments', '/* arbitrary */ const x=2; // line\nreturn cet.result.value(x);', 2],
    [
      'per iteration bindings',
      'const fs=[];for(let i=0;i<3;i++)fs.push(()=>i);return cet.result.value(fs[0]()+fs[2]());',
      2,
    ],
  ])('%s', async (_name, body, expected) => expect(await value(body)).toEqual(expected));
  test('Promise.all across cet calls', async () => {
    expect(
      await value(
        'const [a,b]=await Promise.all([cet.graph.nodes(),cet.passages.search("clear")]);return cet.result.value(a.length+b.length);',
        fixture
      )
    ).toBe(4);
  });
});
describe('builtins §3.2', () => {
  test.each([
    ['Math', 'Math.sqrt(9)+Math.abs(-2)+Math.floor(1.9)', 6],
    ['JSON', 'JSON.parse(JSON.stringify({x:3})).x', 3],
    [
      'Number',
      'Number("2")+Number.parseFloat("1.5")+Number.parseInt("2",10)+Number(Number(1.25).toFixed(1))',
      6.8,
    ],
    ['number predicates', 'Number.isFinite(2)&&Number.isInteger(3)?1:0', 1],
    ['String', 'String(3).length+" Abc ".trim().toLowerCase().slice(1).length', 3],
    ['String replace', '"a a".replace("a","b").replaceAll("a","c").length', 3],
    ['Boolean', 'Boolean(1)?1:0', 1],
    [
      'Array.isArray/from',
      'Array.isArray(Array.from(new Set([1,2,2])))?Array.from("ab").length:0',
      2,
    ],
    ['map filter reduce', '[1,2,3].map(x=>x*2).filter(x=>x>2).reduce((a,b)=>a+b,0)', 10],
    ['sort slice flatMap', '[3,1,2].sort((a,b)=>a-b).slice(0,2).flatMap(x=>[x,x]).length', 4],
    [
      'find some every includes join at entries',
      '[1,2].find(x=>x===2)+([1,2].some(x=>x===2)&&[1,2].every(x=>x>0)&&[1,2].includes(2)?1:0)+[1,2].join(",").length+[1,2].at(-1)+Array.from([1,2].entries())[0][0]',
      8,
    ],
    [
      'Object keys values entries fromEntries assign',
      'Object.assign({},Object.fromEntries(Object.entries({a:2,b:3}))).a+Object.keys({a:1}).length+Object.values({a:2})[0]',
      5,
    ],
    ['Map', '(()=>{const m=new Map([["a",2]]);m.set("b",3);return m.get("a")+m.size;})()', 4],
    ['Set', '(()=>{const s=new Set([1,2,2]);s.add(3);return s.has(2)?s.size:0;})()', 3],
  ])('%s', async (_name, expression, expected) =>
    expect(await value(`return cet.result.value(${expression});`)).toBeCloseTo(expected)
  );
  test('time helpers use explicit instants and daylight transitions', async () => {
    const output = await run(
      'return cet.result.table([{parsed:cet.time.parse("2025-01-01T12:00:00"), formatted:cet.time.format("2025-01-01T11:00:00Z"), bucket:cet.time.bucket("2025-01-20T12:30:00Z","P1M"), count:cet.time.range("2025-03-29T00:00:00","2025-04-01T00:00:00","P1D").length, asOf:cet.time.asOf}]);'
    );
    expect(output.result.rows[0]).toEqual({
      parsed: '2025-01-01T11:00:00.000Z',
      formatted: '2025-01-01 12:00:00',
      bucket: '2024-12-31T23:00:00.000Z',
      count: 3,
      asOf,
    });
  });
});
describe('static rejections §3.3 and module contract', () => {
  test.each([
    'import x from "x";',
    'export const extra=1;',
    'require("fs");',
    'eval("1");',
    'Function("return 1");',
    'class X{}',
    'this.x;',
    'super.x;',
    'new Object();',
    'new Date();',
    'globalThis;',
    'process;',
    'Buffer;',
    'setTimeout(()=>{},1);',
    'fetch("x");',
    'console.log(1);',
    'function* f(){yield 1;}',
    'with({}){}',
    'label:while(false){}',
    'delete input.x;',
    '"x" in input;',
    'input instanceof Object;',
    'const a={get x(){return 1;}};',
    'const a={set x(v){}};',
    'arguments;',
    '({}).__proto__;',
    '({}).prototype;',
    '({}).constructor;',
    '({}).__defineGetter__;',
    '/a+/;',
    'new RegExp("a");',
    'cet={};',
    'const Math={};',
    'let JSON={};',
    'const f=(cet)=>1;',
    'const x=cet.sql;',
    'cet.sql("SELECT 1");',
    'String.raw`x`;',
    'var x=1;',
  ])('%s', async (body) =>
    expect(run(body)).rejects.toMatchObject({
      code: 'CET_SCRIPT_FORBIDDEN_SYNTAX',
      line: expect.any(Number),
      column: expect.any(Number),
    })
  );
  test.each([
    '',
    'export default async function x(input,cet){}',
    source('return 1;') + 'export const extra=1;',
    source('return 1;', { ...metadata, language: 'cet-script/2' }),
    source('return 1;', { ...metadata, version: 0 }),
    source('return 1;', {
      ...metadata,
      inputs: { type: 'object', properties: { x: { type: 'string', pattern: '(a+)+$' } } },
    }),
    source('return 1;').replace('"sample"', 'process.env.X'),
  ])('invalid module %s', async (text) =>
    expect(runSkill(text, {}, { binding, asOf })).rejects.toMatchObject({
      code: 'CET_SCRIPT_FORBIDDEN_SYNTAX',
    })
  );
  test('source locations', () => {
    expect(() => parse(source('\nprocess;'), new Budgets())).toThrow(
      expect.objectContaining({ line: 4, column: 0 })
    );
  });
});
describe('escape classes', () => {
  test.each([
    'const k="con"+"structor";return [][k];',
    'const k="__pro"+"to__";return {}[k];',
    'return [].map["con"+"structor"];',
    'return Math.abs["con"+"structor"];',
    'return (x=>x)["con"+"structor"];',
    'return {}.constructor.constructor("return process")();',
    'const x={toString:()=>"x"};return ""+x;',
    'const x={valueOf:()=>1};return x+1;',
    'return input[Symbol.iterator];',
    'cet.graph.nodes=()=>[];',
    'const d=cet.table("data");d.col=()=>"x";',
    'return JSON.parse("{}",()=>process);',
    'return JSON.parse("{}",()=>1);',
    'return Array.from({length:1000000000,0:1});',
    'return Object.assign(cet,{x:1});',
    'return "a".replace("a",()=>"x");',
    'return [2,1].sort();',
    'return await 1;',
    'async function f(){return 1;}return await Promise.all([f()]);',
    'return JSON.parse("{\"__proto__\":{}}");',
  ])('%s', async (body) =>
    expect(run(body, fixture)).rejects.toMatchObject({
      code: expect.stringMatching(
        /^CET_SCRIPT_(?:CONTAINER_VIOLATION|FORBIDDEN_SYNTAX|RUNTIME_ERROR)$/
      ),
    })
  );
  test('getters are rejected without invocation at every external boundary', async () => {
    const getter = jest.fn(() => 1),
      prepared = {};
    Object.defineProperty(prepared, 'x', { enumerable: true, get: getter });
    expect(() => copy(prepared, new Budgets())).toThrow(
      expect.objectContaining({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' })
    );
    await expect(run('return input.x;', {}, prepared)).rejects.toMatchObject({
      code: 'CET_SCRIPT_CONTAINER_VIOLATION',
    });
    const index = {
      operations: [
        {
          operationId: 'read',
          action: 'fixture.read',
          sideEffects: [],
          writesTo: [],
          consequenceLevel: 'none',
        },
      ],
    };
    await expect(
      run('return await cet.op("read",{});', { index, callOperation: async () => prepared })
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
    expect(getter).not.toHaveBeenCalled();
    const symbol = {
      [Symbol.iterator]: function* () {
        yield 1;
      },
    };
    await expect(run('return 1;', {}, symbol)).rejects.toMatchObject({
      code: 'CET_SCRIPT_CONTAINER_VIOLATION',
    });
  });
  test('fatal errors cannot be swallowed or replaced by finally', async () => {
    const commit = jest.fn();
    await expect(
      run(
        'try{try{const k="constructor";input[k];}finally{throw 1;}}catch(e){}await cet.derived.put("x",1);return cet.result.value(1);',
        { ...fixture, commitDerived: commit }
      )
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
    expect(commit).not.toHaveBeenCalled();
  });
});
describe('SQL, isolation, injection and reference equivalence', () => {
  test('tagged table and column handles, grouped SQL and dataset-query reference', async () => {
    const query =
      'const d=cet.table("data");const rows=await cet.sql`SELECT strftime(\'%Y-%m\',${d.col("time")}) AS period,${d.col("key")} AS key,SUM(${d.col("value")}) AS total FROM ${d} WHERE ${d.col("time")} >= ${input.from} AND ${d.col("time")} < ${input.to} GROUP BY period,key ORDER BY period`;return cet.result.table(rows.map(r=>({...r,total:cet.units.convert(r.total,d.unit("value"),"MWh")})));';
    const result = await run(query, fixture, { from: '2025-01-01', to: '2025-03-01' });
    expect(result.result.rows).toEqual([
      { period: '2025-01', key: 'a', total: 0.03 },
      { period: '2025-02', key: 'b', total: 0.03 },
    ]);
    const reference = executeDatasetQuery(pool, fixture.datasets[0], {
      question: 'grouped',
      from: '2025-01-01',
      to: '2025-03-01',
      plan: {
        sources: [{ alias: 'data', sourceId: id }],
        operations: [
          { op: 'timeBucket', field: 'time', interval: 'month', as: 'period' },
          {
            op: 'aggregate',
            groupBy: ['period', 'key'],
            metrics: [{ fn: 'sum', field: 'value', as: 'total' }],
          },
          { op: 'sort', by: [{ field: 'period', direction: 'asc' }] },
        ],
        output: { maxRows: 10 },
      },
    });
    expect(result.result.rows).toEqual(
      reference.result.map((r) => ({ ...r, total: r.total / 1000 }))
    );
    expect(Object.keys(result.provenance)).toHaveLength(2);
    expect(result.provenance['/rows/0/total'].sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ objectId: 'o1', hash: 'hash-1' })])
    );
    expect(result.evidence).toMatchObject({
      evidenceType: 'generic_document',
      sourceType: 'manual_metadata',
    });
  });
  test.each([
    "ATTACH DATABASE '/tmp/x' AS x",
    'DETACH x',
    'PRAGMA table_info(x)',
    'INSERT INTO x VALUES(1)',
    'UPDATE x SET a=1',
    'DELETE FROM x',
    'REPLACE INTO x VALUES(1)',
    'CREATE TABLE x(a)',
    'DROP TABLE x',
    'ALTER TABLE x ADD a',
    'VACUUM',
    'SELECT 1; SELECT 2',
    'SELECT /* hidden */ 1',
    'SELECT 1 --hidden',
    "SELECT load_extension('x')",
    'SELECT * FROM sqlite_schema',
    'SELECT * FROM project_candidates',
    'SELECT random()',
    'SELECT CURRENT_TIMESTAMP',
    "SELECT strftime('%Y')",
    "SELECT strftime('%Y','now')",
    "SELECT * FROM pragma_table_info('x')",
  ])('%s', async (sql) =>
    expect(run('return await cet.sql`' + sql + '`;', fixture)).rejects.toMatchObject({
      code: 'CET_SCRIPT_SQL_REJECTED',
    })
  );
  test.each([otherId, foreignId])('physical table %s is unreachable', async (table) =>
    expect(run(`return await cet.sql\`SELECT * FROM "${table}"\`;`, fixture)).rejects.toMatchObject(
      { code: 'CET_SCRIPT_SQL_REJECTED' }
    )
  );
  test('foreign aliases and node IDs', async () => {
    await expect(run('return cet.table("other");', fixture)).rejects.toMatchObject({
      code: 'CET_SCRIPT_UNKNOWN_TABLE',
    });
    await expect(
      run('return await cet.graph.neighbors("other-node");', fixture)
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
    await expect(
      run('return await cet.passages.get("other-passage");', fixture)
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
    await expect(
      run('return 1;', { ...fixture, graph: [{ tenantId: 't2', projectId: 'p1' }] })
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
  });
  test('parameters cannot inject SQL', async () => {
    expect(
      (
        await run(
          'const d=cet.table("data");return cet.result.table(await cet.sql`SELECT * FROM ${d} WHERE ${d.col("key")}=${input.key}`);',
          fixture,
          { key: "a' OR 1=1; ATTACH DATABASE '/tmp/x' AS x; --" }
        )
      ).result.rows
    ).toHaveLength(0);
  });
  test('sensitive columns rejected by handles and SQLite program', async () => {
    const restricted = {
      ...fixture,
      datasets: [
        {
          ...fixture.datasets[0],
          columns: columns.map((c) => ({ ...c, sensitive: c.name === 'value' })),
        },
      ],
    };
    await expect(
      run('const d=cet.table("data");return d.col("value");', restricted)
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_SQL_REJECTED' });
    await expect(
      run(`return await cet.sql\`SELECT c2 FROM "${id}"\`;`, restricted)
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_SQL_REJECTED' });
    expect(() =>
      authorize(pool.tenant('t1'), `SELECT * FROM "${id}"`, [], restricted.datasets)
    ).toThrow(expect.objectContaining({ code: 'CET_SCRIPT_SQL_REJECTED' }));
  });
});
describe('adapters, deterministic helpers, result and replay', () => {
  test('all API types and delayed atomic storage', async () => {
    const index = {
      packageVersion: '2',
      operations: [
        {
          operationId: 'read',
          action: 'fixture.read',
          sideEffects: [],
          writesTo: [],
          consequenceLevel: 'none',
          agentable: true,
          version: 3,
        },
      ],
    };
    const call = jest.fn(async (_operation, params) => ({ value: 4, tenantId: params.tenantId }));
    const commit = jest.fn(commitDerived(filename, binding));
    const body =
      'const d=cet.table("data");const rows=await cet.sql`SELECT ${d.col("key")} AS key,SUM(${d.col("value")}) AS value FROM ${d} GROUP BY key`;const nodes=await cet.graph.nodes({kind:"entity"});const neighbors=await cet.graph.neighbors(nodes[0].nodeId,{depth:2});const passages=await cet.passages.search("clear");const passage=await cet.passages.get(passages[0].passageId);const op=await cet.op("read",{tenantId:"foreign"});await cet.derived.put("saved",rows,{describes:[nodes[0].nodeId]});cet.log("done",{count:rows.length});const cited=cet.cite(op.value,[passage.passageId]);return cet.result.mixed([cet.result.table(rows),cet.result.value(cited),cet.result.text("value ${x}",{x:op.value}),cet.gap("missing",{needs:["source"]})]);';
    const result = await run(body, {
      ...fixture,
      index,
      callOperation: call,
      commitDerived: commit,
    });
    expect(result.result.items.map((item) => item.kind)).toEqual(['table', 'value', 'text', 'gap']);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'read' }),
      expect.objectContaining({ tenantId: 't1' })
    );
    const derived = readDerived(filename, binding);
    expect(derived).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: 'node',
          attributes: expect.objectContaining({ derived: true }),
        }),
        expect.objectContaining({ relation: 'derivedFrom' }),
        expect.objectContaining({ relation: 'describes', to: 'n1' }),
      ])
    );
    const external = (await run('return await cet.graph.nodes({kind:"external"});', fixture))
      .result[0];
    expect(external).toEqual({ nodeId: 'nx', kind: 'external', ref: { id: 'external' } });
  });
  test('graph attributes resolve linked rows and reject ambiguous values', async () => {
    const unique = { ...fixture, graph: fixture.graph, aliases: fixture.aliases };
    await expect(
      run('return await cet.graph.attribute("key","value");', unique)
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_RUNTIME_ERROR' });
    const db = pool.tenant('t1');
    db.prepare(`UPDATE "${id}" SET c2=10 WHERE c1='a'`).run();
    try {
      const output = await run('return await cet.graph.attribute("key","value");', unique);
      expect(output.result).toEqual({ a: 10, b: 30 });
    } finally {
      db.prepare(`UPDATE "${id}" SET c2=20 WHERE row_number=1`).run();
    }
  });
  test('helpers', async () => {
    const result = await run(
      'return cet.result.table([{sum:cet.stats.sum([1,2,3]),mean:cet.stats.mean([1,2,3]),median:cet.stats.median([1,2,4]),q:cet.stats.quantile([1,2,3],0.5),min:cet.stats.min([1,2]),max:cet.stats.max([1,2]),std:cet.stats.stddev([1,3]),groups:Object.keys(cet.stats.groupBy([{k:"a"},{k:"b"}],"k")).length,pivot:cet.stats.pivot([{r:"a",c:"b",v:2}],"r","c","v")[0].b,tokens:cet.text.tokens("Ab c.").length,normalized:cet.text.normalize(" Ab "),similarity:cet.text.similarity("a b","a b"),includes:cet.text.includes("abc","b")}]);'
    );
    expect(result.result.rows[0]).toEqual({
      sum: 6,
      mean: 2,
      median: 2,
      q: 2,
      min: 1,
      max: 2,
      std: 1,
      groups: 2,
      pivot: 2,
      tokens: 2,
      normalized: 'ab',
      similarity: 1,
      includes: true,
    });
  });
  test('replay hash and result are identical, versions/input/asOf affect hash', async () => {
    const body =
      'const d=cet.table("data");return cet.result.table(await cet.sql`SELECT ${d.col("key")} AS key FROM ${d} ORDER BY key`);';
    const first = await run(body, fixture),
      second = await run(body, fixture);
    expect(second).toEqual(first);
    expect(
      (await run(body, { ...fixture, binding: { ...binding, dataVersion: 'v2' } })).replayHash
    ).not.toBe(first.replayHash);
    expect((await run(body, fixture, { x: 1 })).replayHash).not.toBe(first.replayHash);
    expect((await run(body, { ...fixture, asOf: '2025-01-02T00:00:00Z' })).replayHash).not.toBe(
      first.replayHash
    );
  });
  test('AC-06 fixture index determines static and dynamic eligibility', async () => {
    const operation = {
      operationId: 'read',
      action: 'fixture.read',
      sideEffects: [],
      writesTo: [],
      consequenceLevel: 'none',
    };
    const call = jest.fn(async () => 2);
    expect(
      await value('return cet.result.value(await cet.op("read",{}));', {
        index: { operations: [operation] },
        callOperation: call,
      })
    ).toBe(2);
    for (const patch of [
      { sideEffects: ['writes'] },
      { writesTo: ['x'] },
      { consequenceLevel: 'low' },
      { agentable: false },
      { sideEffects: undefined },
      { writesTo: undefined },
    ]) {
      await expect(
        run('return await cet.op("read",{});', {
          index: { operations: [{ ...operation, ...patch }] },
          callOperation: call,
        })
      ).rejects.toMatchObject({ code: 'CET_SCRIPT_OPERATION_REJECTED' });
      await expect(
        run(
          'return await cet.op(input.id,{});',
          { index: { operations: [{ ...operation, ...patch }] }, callOperation: call },
          { id: 'read' }
        )
      ).rejects.toMatchObject({ code: 'CET_SCRIPT_OPERATION_REJECTED' });
    }
    expect(call).toHaveBeenCalledTimes(1);
  });
});
describe('every configured budget and no partial effects', () => {
  test.each([
    ['steps', 100, 'while(true){}', {}],
    ['steps', 2000, 'while(true){await cet.graph.nodes();}', {}],
    ['runtimeMs', 20, 'await cet.op("read",{});', {}],
    ['sqlQueries', 1, 'await cet.sql`SELECT 1`;await cet.sql`SELECT 1`;', {}],
    ['sqlRowsPerQuery', 1, 'const d=cet.table("data");await cet.sql`SELECT * FROM ${d}`;', {}],
    ['sqlRowsTotal', 2, 'await cet.sql`SELECT 1 UNION ALL SELECT 2`;await cet.sql`SELECT 3`;', {}],
    ['opCalls', 1, 'await cet.op("read",{});await cet.op("read",{});', {}],
    ['graphAccesses', 1, 'await cet.graph.nodes();await cet.graph.nodes();', {}],
    ['recursionDepth', 20, 'function f(){return f();}f();', {}],
    ['resultBytes', 20, 'return cet.result.value(1);', {}],
    ['derivedEntries', 1, 'await cet.derived.put("a",1);await cet.derived.put("b",2);', {}],
    ['derivedEntryBytes', 10, 'await cet.derived.put("a","012345678901");', {}],
    ['sourceBytes', 20, 'return 1;', {}],
    ['astNodes', 10, 'return 1;', {}],
    ['valueBytes', 1000, 'return "x".repeat(10000000);', {}],
    ['collectionItems', 1000, 'const a=[];a.length=100000000;', {}],
  ])('%s', async (name, limit, body, extras) => {
    const commit = jest.fn();
    const index = {
      operations: [
        {
          operationId: 'read',
          action: 'fixture.read',
          sideEffects: [],
          writesTo: [],
          consequenceLevel: 'none',
        },
      ],
    };
    const operation =
      name === 'runtimeMs'
        ? () => new Promise((resolve) => setTimeout(() => resolve(1), 50))
        : async () => 1;
    await expect(
      run(body, {
        ...fixture,
        ...extras,
        index,
        callOperation: operation,
        commitDerived: commit,
        budgets: { [name]: limit },
      })
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_BUDGET_EXCEEDED', details: { budget: name } });
    expect(commit).not.toHaveBeenCalled();
  });
  test('staged writes are discarded on later failure and on ignored read rejection', async () => {
    const commit = jest.fn();
    for (const body of [
      'await cet.derived.put("a",1);while(true){}',
      'await cet.derived.put("a",1);cet.graph.neighbors("foreign");return cet.result.value(1);',
      'await cet.derived.put("a",1);throw "failure";',
    ]) {
      await expect(
        run(body, { ...fixture, commitDerived: commit, budgets: { steps: 10000 } })
      ).rejects.toBeDefined();
    }
    expect(commit).not.toHaveBeenCalled();
  });
  test('SQL worker is interruptible while native aggregate is computing', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(filename);
    db.transaction(() => {
      const insert = db.prepare(`INSERT INTO "${id}" VALUES (?,?,?, ?,?,?)`);
      for (let i = 3; i < 200; i++) insert.run(i, null, null, null, 'a', i);
    })();
    db.close();
    await expect(
      run(
        `return await cet.sql\`SELECT SUM(a.c2*b.c2*c.c2*d.c2) FROM "${id}" a CROSS JOIN "${id}" b CROSS JOIN "${id}" c CROSS JOIN "${id}" d\`;`,
        { ...fixture, budgets: { runtimeMs: 200, memoryBytes: 1000000000000 } }
      )
    ).rejects.toMatchObject({
      code: 'CET_SCRIPT_BUDGET_EXCEEDED',
      details: { budget: 'runtimeMs' },
    });
    pool.tenant('t1').prepare(`DELETE FROM "${id}" WHERE row_number>=3`).run();
  });
});
describe('principal enforcement at internal project entry', () => {
  const auth = { tenantId: 't1', userId: 'user', roles: ['ROLE_ADMIN'], scope: 'read-only' };
  test('operation metadata excludes internal capabilities and enforces tenant/roles/domains', async () => {
    const call = jest.fn(async () => ({ x: 1 }));
    const ctx = {
      meta: { authUser: auth, tenantId: 't1', projectGraph: Symbol('secret') },
      call,
      broker: {
        getLocalService: () => ({
          schema: { actions: { read: { requiredRoles: ['ROLE_ADMIN'] } } },
        }),
      },
    };
    const operation = { action: 'fixture.read', domains: ['generic'] };
    await operationCaller(ctx, { tenantId: 't1', roles: ['ROLE_ADMIN'] })(operation, {
      tenantId: 'other',
    });
    expect(call.mock.calls[0][1].tenantId).toBe('t1');
    expect(call.mock.calls[0][2].meta.projectGraph).toBeUndefined();
    await expect(
      operationCaller(
        { ...ctx, meta: { ...ctx.meta, domainsAllowed: ['other'] } },
        { tenantId: 't1', roles: ['ROLE_ADMIN'] }
      )(operation, {})
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_OPERATION_REJECTED' });
    await expect(
      operationCaller(ctx, { tenantId: 't1', roles: ['ROLE_USER'] })(operation, {})
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_OPERATION_REJECTED' });
  });
  test('internal entry rejects a foreign project before opening sources', async () => {
    const ctx = {
      meta: { authUser: auth },
      broker: { getLocalService: () => ({ basePath: () => directory }) },
      call: jest.fn(async (action, params) =>
        action === 'project-file.ingestMutation'
          ? params.work()
          : { tenantId: 't2', projectId: 'p1' }
      ),
    };
    await expect(
      runProjectSkill(ctx, { projectId: 'p1', source: source('return 1;'), input: {}, asOf })
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
    expect(ctx.call).toHaveBeenCalledTimes(2);
  });
});

describe('additional boundary regressions', () => {
  test.each([
    'Math.random();',
    'Reflect.ownKeys(input);',
    'new Proxy({},{});',
    'Atomics;',
    'ArrayBuffer;',
    'Promise.resolve(1);',
    'function f(){let hidden=1;}return hidden;',
  ])('static rejection: %s', async (body) => {
    await expect(run(body)).rejects.toMatchObject({ code: 'CET_SCRIPT_FORBIDDEN_SYNTAX' });
  });
  test('finally may replace an ordinary thrown value', async () => {
    expect(
      await value('function f(){try{throw 1;}finally{return 2;}}return cet.result.value(f());')
    ).toBe(2);
  });
  test('with-select, escaped identifiers, literal semicolons, LIKE and aggregates', async () => {
    const result = await run(
      'const d=cet.table("data");return cet.result.table(await cet.sql`WITH x AS (SELECT * FROM ${d}) SELECT c1 AS key,COUNT(*) AS count,AVG(c2) AS average,MIN(c2) AS low,MAX(c2) AS high FROM x WHERE c1 LIKE ${"%a%"} GROUP BY c1`);',
      fixture
    );
    expect(result.result.rows).toEqual([{ key: 'a', count: 2, average: 15, low: 10, high: 20 }]);
    expect(
      (await run('return await cet.sql`SELECT ${"\'; -- /* quote"} AS "a\"\"b"`;', fixture)).result
    ).toEqual([{ 'a"b': "'; -- /* quote" }]);
  });
  test('SQL authorization rejects unknown/root/virtual/write instructions before execution', () => {
    const db = pool.tenant('t1');
    expect(() => authorize(db, 'SELECT * FROM sqlite_schema', [], fixture.datasets)).toThrow(
      expect.objectContaining({ code: 'CET_SCRIPT_SQL_REJECTED' })
    );
    expect(() => authorize(db, `DELETE FROM "${id}"`, [], fixture.datasets)).toThrow(
      expect.objectContaining({ code: 'CET_SCRIPT_SQL_REJECTED' })
    );
    expect(() => authorize(db, "SELECT * FROM json_each('[1]')", [], fixture.datasets)).toThrow(
      expect.objectContaining({ code: 'CET_SCRIPT_SQL_REJECTED' })
    );
  });
  test('bytecode checkpoints reject an unguarded native scan and prove cycles', () => {
    const { checkpointGraph, instrument } = require('../src/cet-script/sql-checkpoints');
    const db = pool.tenant('t1');
    expect(() =>
      authorize(db, `SELECT * FROM "${id}" WHERE c1='absent'`, [], fixture.datasets)
    ).toThrow(expect.objectContaining({ code: 'CET_SCRIPT_SQL_REJECTED' }));
    expect(() => checkpointGraph([{ addr: 0, opcode: 'Goto', p2: 0 }])).toThrow(
      expect.objectContaining({ code: 'CET_SCRIPT_SQL_REJECTED' })
    );
    expect(() =>
      checkpointGraph([
        { addr: 0, opcode: 'Function', p4: 'cet_script_tick(0)' },
        { addr: 1, opcode: 'Goto', p2: 0 },
      ])
    ).not.toThrow();
    expect(instrument("SELECT 'SELECT -- /*' AS value")).toContain("'SELECT -- /*'");
  });
  test('native SQL work returns from the query adapter within the deadline', async () => {
    const { query } = require('../src/cet-script/sql');
    const db = pool.tenant('t1');
    const insert = db.prepare(`INSERT INTO "${id}" VALUES (?,?,?,?,?,?)`);
    db.transaction(() => {
      for (let i = 3; i < 100; i++) insert.run(i, null, null, null, 'a', i);
    })();
    const started = performance.now();
    try {
      await expect(
        query({
          filename,
          sql: `SELECT SUM(a.c2*b.c2*c.c2*d.c2) FROM "${id}" a CROSS JOIN "${id}" b CROSS JOIN "${id}" c CROSS JOIN "${id}" d`,
          params: [],
          datasets: fixture.datasets,
          budget: new Budgets({ runtimeMs: 150, memoryBytes: 1000000000000 }),
        })
      ).rejects.toMatchObject({
        code: 'CET_SCRIPT_BUDGET_EXCEEDED',
        details: { budget: 'runtimeMs' },
      });
      expect(performance.now() - started).toBeLessThan(2000);
    } finally {
      db.prepare(`DELETE FROM "${id}" WHERE row_number >= 3`).run();
    }
  });
  test('a transaction that exhausts its budget rolls back every staged node', () => {
    const before = readDerived(filename, binding);
    const check = jest.fn();
    check
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('stop');
      });
    expect(() =>
      commitDerived(filename, binding)(
        [{ key: 'never-written', value: 2, describes: [] }],
        { skillId: 'sample', skillVersion: 1, trace: [], sources: [], replayHash: 'h' },
        { check, tick: () => {}, allocate: () => {}, bound: () => {} }
      )
    ).toThrow('stop');
    expect(readDerived(filename, binding)).toEqual(before);
  });
  test('an operation cannot read another container indirectly', async () => {
    const index = {
      operations: [
        {
          operationId: 'read',
          action: 'fixture.read',
          sideEffects: [],
          writesTo: [],
          consequenceLevel: 'none',
        },
      ],
    };
    const callOperation = jest.fn(async () => ({ projectId: 'other', value: 7 }));
    await expect(
      run('return await cet.op("read",{});', { ...fixture, index, callOperation })
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
    expect(callOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 't1', projectId: 'p1' })
    );
    await expect(
      run(
        'return await cet.op("read",{datasetId:input.id});',
        { ...fixture, index, callOperation },
        { id: otherId }
      )
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
    expect(callOperation).toHaveBeenCalledTimes(1);
  });
  test('parallel completion order does not change the execution trace', async () => {
    const index = {
      operations: [
        {
          operationId: 'read',
          action: 'fixture.read',
          sideEffects: [],
          writesTo: [],
          consequenceLevel: 'none',
        },
      ],
    };
    const body =
      'const values=await Promise.all([cet.op("read",{n:1}),cet.op("read",{n:2})]);return cet.result.table(values);';
    const callOperation = (reverse) => async (_op, params) => {
      await new Promise((resolve) => setTimeout(resolve, (params.n === 1) !== reverse ? 10 : 1));
      return { n: params.n };
    };
    const first = await run(body, { index, callOperation: callOperation(false) });
    const second = await run(body, { index, callOperation: callOperation(true) });
    expect(second).toEqual(first);
  });
  test('hashing uses the original inputs even if the script mutates them', async () => {
    const { contentHash } = require('../src/cet-script');
    const body = 'input.x=9;return cet.result.value(input.x);';
    const result = await run(body, {}, { x: 1 });
    expect(result.replayHash).toBe(
      contentHash([source(body), { input: { x: 1 }, asOf }, binding.dataVersion, []])
    );
  });
  test('the project entry loads only bound sources and never calls a model', async () => {
    const auth = { tenantId: 't1', userId: 'user', roles: ['ROLE_ADMIN'], scope: 'read-only' };
    const document = {
      id: 'doc-1',
      tenantId: 't1',
      provenance: { projectId: 'p1', objectId: 'o1' },
      status: 'active',
      hash: 'h',
      title: 'file',
      name: 'file',
      version: 1,
      person: { name: 'user' },
      at: asOf,
      text: 'Known text.',
    };
    const ctx = {
      meta: { authUser: auth },
      broker: {
        getLocalService: (name) =>
          name === 'project-upload' ? { basePath: () => directory } : null,
      },
    };
    ctx.call = jest.fn(async (action, params) => {
      if (action === 'project-file.ingestMutation') return params.work();
      if (action === 'project-file.get')
        return { tenantId: 't1', projectId: 'p1', lifecycle: 'ready', requiredClearance: [] };
      if (action === 'datapoint.datasetCatalog')
        return [
          ...fixture.datasets,
          { ...fixture.datasets[0], id: otherId, provenance: { projectId: 'p2' } },
        ];
      if (action === 'object-store.projectGraphRecord') return fixture.graph;
      if (action === 'knowledge-rag.documentList')
        return [document, { ...document, id: 'foreign', provenance: { projectId: 'p2' } }];
      if (action === 'knowledge-rag.documentGet' && params.id === document.id) return document;
      throw new Error('Unexpected call: ' + action);
    });
    const result = await runProjectSkill(ctx, {
      projectId: 'p1',
      asOf,
      source: source('return cet.result.table(await cet.passages.search("Known"));'),
      input: {},
    });
    expect(result.result.rows).toHaveLength(1);
    expect(
      ctx.call.mock.calls.filter(([action]) => action === 'knowledge-rag.documentGet')
    ).toHaveLength(1);
    expect(ctx.call.mock.calls.map(([action]) => action)).not.toEqual(
      expect.arrayContaining(['llm.generate', 'knowledge-rag.query'])
    );
  });
  test('input schema validation, strict source values and graph depth fail closed', async () => {
    await expect(
      runSkill(
        source('return 1;', {
          ...metadata,
          inputs: { type: 'object', required: ['x'], properties: { x: { type: 'number' } } },
        }),
        {},
        { binding, asOf }
      )
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_RUNTIME_ERROR' });
    await expect(run('return 1;', {}, new Date(asOf))).rejects.toMatchObject({
      code: 'CET_SCRIPT_CONTAINER_VIOLATION',
    });
    await expect(
      run('return await cet.graph.neighbors("n1",{depth:4});', fixture)
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
    await expect(
      run('await cet.derived.put("a",1,{describes:["other"]});', fixture)
    ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
  });
});

test('retained allocations are bounded before strings or arrays grow', async () => {
  await expect(
    run('const items=[];while(true)items.push("x".repeat(1000000));', {
      budgets: { memoryBytes: 3 * 1024 * 1024 },
    })
  ).rejects.toMatchObject({
    code: 'CET_SCRIPT_BUDGET_EXCEEDED',
    details: { budget: 'memoryBytes' },
  });
  await expect(
    run('const a=[1,2,3];return a.flatMap(()=>a.flatMap(()=>a));', {
      budgets: { collectionItems: 10 },
    })
  ).rejects.toMatchObject({
    code: 'CET_SCRIPT_BUDGET_EXCEEDED',
    details: { budget: 'collectionItems' },
  });
});

test('own iterators, update conversion and callback iteration follow script semantics', async () => {
  const result = await run(
    'let x="1";const old=x++;const it=[4,5].entries();const first=it.next();let sum=0;[1,2].forEach(n=>{sum+=n;});return cet.result.table([{old,x,sum,first:first.value[1],remaining:Array.from(it).length,keys:Object.keys([1,2]).length,type:typeof (()=>1)}]);'
  );
  expect(result.result.rows).toEqual([
    { old: 1, x: 2, sum: 3, first: 4, remaining: 1, keys: 2, type: 'function' },
  ]);
});

test('SQL volume is rejected before an excessive Cartesian result is materialized', async () => {
  await expect(
    run(
      `return await cet.sql\`SELECT a.c0 AS x,b.c0 AS y,c.c0 AS z FROM "${id}" a CROSS JOIN "${id}" b CROSS JOIN "${id}" c CROSS JOIN "${id}" d CROSS JOIN "${id}" e CROSS JOIN "${id}" f CROSS JOIN "${id}" g CROSS JOIN "${id}" h\`;`,
      { ...fixture, budgets: { memoryBytes: 25000 } }
    )
  ).rejects.toMatchObject({
    code: 'CET_SCRIPT_BUDGET_EXCEEDED',
    details: { budget: 'memoryBytes' },
  });
});

test('await loops around own async functions remain bounded', async () => {
  await expect(
    run('async function f(){return 1;}while(true){await f();}', { budgets: { steps: 2000 } })
  ).rejects.toMatchObject({ code: 'CET_SCRIPT_BUDGET_EXCEEDED', details: { budget: 'steps' } });
});

describe('declared test schema', () => {
  test.each([
    { rows: -1 },
    { columns: [1] },
    { tolerance: -1 },
    { contains: [null] },
    { gap: 'yes' },
    { error: 1 },
    { extra: true },
    [],
  ])('rejects malformed expectation %j', async (expectation) => {
    const text = source('return 1;').replace(
      'export const tests=[];',
      `export const tests=[${JSON.stringify({ input: {}, expect: expectation })}];`
    );
    await expect(runSkill(text, {}, { binding, asOf })).rejects.toMatchObject({
      code: 'CET_SCRIPT_FORBIDDEN_SYNTAX',
    });
  });
  test('accepts all declared expectation fields', () => {
    const expectation = {
      rows: 1,
      columns: ['x'],
      value: 2,
      tolerance: 0.01,
      contains: [{ x: 2 }],
      gap: false,
      error: 'CET_SCRIPT_RUNTIME_ERROR',
    };
    const text = source('return 1;').replace(
      'export const tests=[];',
      `export const tests=[${JSON.stringify({ input: {}, expect: expectation })}];`
    );
    expect(parse(text, new Budgets()).tests[0].expect).toEqual(expectation);
  });
});

test('native SQLite aggregation semantics are preserved by argument checkpoints', async () => {
  const db = pool.tenant('t1');
  db.prepare(
    `UPDATE "${id}" SET c2=CASE row_number WHEN 0 THEN 1e16 WHEN 1 THEN 1 ELSE -1e16 END`
  ).run();
  try {
    const expected = db
      .prepare(`SELECT SUM(c2) AS total,COUNT(DISTINCT c1) AS count FROM "${id}"`)
      .all();
    const actual = await run(
      `return await cet.sql\`SELECT SUM(c2) AS total,COUNT(DISTINCT c1) AS count FROM "${id}"\`;`,
      fixture
    );
    expect(actual.result).toEqual(expected);
  } finally {
    db.prepare(`UPDATE "${id}" SET c2=(row_number+1)*10`).run();
  }
});

test.each(['GROUP BY 1', 'ORDER BY 1'])('positional keys fail closed: %s', async (clause) => {
  await expect(
    run(`return await cet.sql\`SELECT c1 AS key FROM "${id}" ${clause}\`;`, fixture)
  ).rejects.toMatchObject({ code: 'CET_SCRIPT_SQL_REJECTED' });
});

test('unreviewed SQLite versions fail before preparation of script SQL', () => {
  const prepare = jest.fn(() => ({ get: () => ({ version: '9.0.0' }) }));
  expect(() => authorize({ prepare }, 'SELECT 1', [], [])).toThrow(
    expect.objectContaining({ code: 'CET_SCRIPT_SQL_REJECTED' })
  );
  expect(prepare).toHaveBeenCalledTimes(1);
});

test('configuration names cannot use inherited object keys', () => {
  expect(() => new Budgets({ constructor: 1 })).toThrow(
    expect.objectContaining({ code: 'CET_SCRIPT_RUNTIME_ERROR' })
  );
});

test('every deterministic CET helper call is recorded without duplicating the complete trace per number', async () => {
  const output = await run(
    'const sum=cet.stats.sum([1,2]);const converted=cet.units.convert(sum,"kWh","MWh");return cet.result.value(converted);'
  );
  expect(output.log.map((entry) => entry.kind)).toEqual([
    'stats.sum',
    'units.convert',
    'result.value',
  ]);
  expect(output.provenance['/value'].traceRef).toBe('/log');
  expect(output.provenance['/value'].trace).toBeUndefined();
});

test('project snapshot loading shares the total execution deadline', async () => {
  const auth = { tenantId: 't1', userId: 'user', roles: ['ROLE_ADMIN'], scope: 'read-only' };
  const ctx = {
    meta: { authUser: auth },
    broker: { getLocalService: () => ({ basePath: () => directory }) },
  };
  ctx.call = jest.fn(async (action, params) => {
    if (action === 'project-file.ingestMutation') return params.work();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { tenantId: 't1', projectId: 'p1', lifecycle: 'ready' };
  });
  await expect(
    runProjectSkill(ctx, {
      projectId: 'p1',
      source: source('return 1;'),
      input: {},
      asOf,
      budgets: { runtimeMs: 10 },
    })
  ).rejects.toMatchObject({ code: 'CET_SCRIPT_BUDGET_EXCEEDED', details: { budget: 'runtimeMs' } });
  expect(ctx.call).toHaveBeenCalledTimes(2);
});

test('derived history iteration uses the caller memory budget', () => {
  expect(() => readDerived(filename, binding, new Budgets({ memoryBytes: 100 }))).toThrow(
    expect.objectContaining({
      code: 'CET_SCRIPT_BUDGET_EXCEEDED',
      details: { budget: 'memoryBytes' },
    })
  );
});

test('derived storage bounds complete records including lineage before commit', async () => {
  const before = readDerived(filename, binding);
  await expect(
    run('await cet.derived.put("full-record-limit",1);return cet.result.value(1);', {
      ...fixture,
      commitDerived: commitDerived(filename, binding),
      budgets: { derivedEntryBytes: 150 },
    })
  ).rejects.toMatchObject({
    code: 'CET_SCRIPT_BUDGET_EXCEEDED',
    details: { budget: 'derivedEntryBytes' },
  });
  expect(readDerived(filename, binding)).toEqual(before);
});

test('retained closure environments are charged when loop bindings are copied', async () => {
  const declarations = Array.from({ length: 50 }, (_, i) => `x${i}=0`).join(',');
  await expect(
    run(`const keep=[];for(let ${declarations};;x0++){keep.push(()=>x0);}`, {
      budgets: { memoryBytes: 30000 },
    })
  ).rejects.toMatchObject({
    code: 'CET_SCRIPT_BUDGET_EXCEEDED',
    details: { budget: 'memoryBytes' },
  });
});

test('JSON nesting is bounded before the native parser allocates the value tree', async () => {
  await expect(
    run('const text="[".repeat(1000)+"0"+"]".repeat(1000);return JSON.parse(text);')
  ).rejects.toMatchObject({ code: 'CET_SCRIPT_CONTAINER_VIOLATION' });
  expect(await value('return cet.result.value(JSON.parse(\'{"x":"[{}]"}\').x.length);')).toBe(4);
});

test('input schema validation performs no dynamic function construction', async () => {
  const spy = jest.spyOn(global, 'Function').mockImplementation(() => {
    throw new Error('Dynamic construction forbidden');
  });
  let output;
  try {
    output = await run('return cet.result.value(1);');
  } finally {
    spy.mockRestore();
  }
  expect(output.result.value).toBe(1);
});

test('date formats reject normalized invalid calendar dates', async () => {
  const text = source('return 1;', {
    ...metadata,
    inputs: { type: 'object', properties: { date: { type: 'string', format: 'date' } } },
  });
  await expect(runSkill(text, { date: '2025-02-30' }, { binding, asOf })).rejects.toMatchObject({
    code: 'CET_SCRIPT_RUNTIME_ERROR',
  });
});

test('input schema evaluates supported bounds, alternatives and object values', async () => {
  const inputs = {
    type: 'object',
    additionalProperties: false,
    required: ['x'],
    properties: {
      x: { type: ['integer', 'null'], enum: [2, null], minimum: 1, maximum: 3 },
      name: { type: 'string', minLength: 1, maxLength: 2 },
      items: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'number' } },
      fixed: { const: { key: 1 } },
    },
  };
  const text = source('return cet.result.value(input.x??0);', { ...metadata, inputs });
  expect(
    (await runSkill(text, { x: 2, name: 'ab', items: [1], fixed: { key: 1 } }, { binding, asOf }))
      .result.value
  ).toBe(2);
  await expect(runSkill(text, { x: 2, name: 'abc' }, { binding, asOf })).rejects.toMatchObject({
    code: 'CET_SCRIPT_RUNTIME_ERROR',
  });
});

test('SQL string amplifiers outside the bounded function set are rejected', async () => {
  await expect(run('return await cet.sql`SELECT char(65,66,67)`;', fixture)).rejects.toMatchObject({
    code: 'CET_SCRIPT_SQL_REJECTED',
  });
});

test.each([
  'const require=x=>x;return require(1);',
  'function Function(){return 1;}return Function();',
  'let process=1;return process;',
])('forbidden host names cannot be reintroduced as bindings: %s', async (body) => {
  await expect(run(body)).rejects.toMatchObject({ code: 'CET_SCRIPT_FORBIDDEN_SYNTAX' });
});
