'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCHEMA_PATH = path.join(__dirname, 'projection-schema.sql');
const SCHEMA_VERSION = 6;

const PYTHON_STORE = String.raw`
import json, os, sqlite3, sys
request=json.loads(sys.stdin.read())
db=request['database']
os.makedirs(os.path.dirname(os.path.abspath(db)), exist_ok=True)
con=sqlite3.connect(db, timeout=10)
con.row_factory=sqlite3.Row

def migrate():
    version=con.execute('PRAGMA user_version').fetchone()[0]
    if version > request['schemaVersion']:
        raise RuntimeError('database schema is newer than this application')
    if version < request['schemaVersion']:
        statements=[]; pending=''
        for line in request['schema'].splitlines(True):
            pending += line
            if sqlite3.complete_statement(pending):
                if pending.strip(): statements.append(pending)
                pending=''
        con.execute('BEGIN IMMEDIATE')
        try:
            for statement in statements:
                try: con.execute(statement)
                except sqlite3.OperationalError as error:
                    if 'duplicate column name:' not in str(error): raise
            con.commit()
        except Exception:
            con.rollback(); raise
    return con.execute('PRAGMA user_version').fetchone()[0]

def clean_boards(boards):
    for board in boards:
        objects=con.execute('SELECT object_type,object_id FROM projection_objects WHERE source_board=?', (board,)).fetchall()
        tables={'topic':'management_topics','decision':'governance_decisions','outcome':'outcomes','wakeup':'wakeups','digest':'digest_items'}
        ids={'topic':'topic_id','decision':'decision_id','outcome':'outcome_id','wakeup':'wakeup_id','digest':'digest_id'}
        con.execute('DELETE FROM projection_objects WHERE source_board=?', (board,))
        for obj in objects:
            remaining=con.execute('SELECT 1 FROM projection_objects WHERE object_type=? AND object_id=? LIMIT 1', (obj['object_type'],obj['object_id'])).fetchone()
            if remaining is None:
                con.execute('DELETE FROM '+tables[obj['object_type']]+' WHERE '+ids[obj['object_type']]+'=?', (obj['object_id'],))
        con.execute('DELETE FROM projection_boards WHERE board=?', (board,))

def clean_digest_boards(boards):
    for board in boards:
        objects=con.execute("SELECT object_id FROM projection_objects WHERE object_type='digest' AND source_board=?", (board,)).fetchall()
        con.execute("DELETE FROM projection_objects WHERE object_type='digest' AND source_board=?", (board,))
        for obj in objects:
            remaining=con.execute("SELECT 1 FROM projection_objects WHERE object_type='digest' AND object_id=? LIMIT 1", (obj['object_id'],)).fetchone()
            if remaining is None:
                con.execute('DELETE FROM digest_items WHERE digest_id=?', (obj['object_id'],))

def insert_rows(table, rows, conflict='REPLACE'):
    for row in rows:
        keys=list(row.keys())
        sql='INSERT OR '+conflict+' INTO '+table+' ('+','.join(keys)+') VALUES ('+','.join(['?']*len(keys))+')'
        con.execute(sql, [row[key] for key in keys])

action=request['action']
version=migrate()
if action == 'initialize':
    output={'schemaVersion':version}
elif action == 'apply':
    data=request['data']
    con.execute('BEGIN IMMEDIATE')
    try:
        if data.get('replaceBoards'): clean_boards(data['replaceBoards'])
        if data.get('replaceDigestBoards'): clean_digest_boards(data['replaceDigestBoards'])
        if data.get('replaceAgentBriefs'): con.execute('DELETE FROM agent_briefs')
        insert_rows('management_topics', data.get('topics', []))
        insert_rows('governance_decisions', data.get('decisions', []))
        insert_rows('outcomes', data.get('outcomes', []))
        insert_rows('wakeups', data.get('wakeups', []))
        insert_rows('digest_items', data.get('digestItems', []))
        insert_rows('agent_briefs', data.get('agentBriefs', []))
        insert_rows('projection_objects', data.get('objects', []))
        insert_rows('projection_boards', data.get('boards', []))
        con.commit()
    except Exception:
        con.rollback(); raise
    output={'schemaVersion':version,'counts':{key:len(data.get(key, [])) for key in ['topics','decisions','outcomes','wakeups','digestItems','agentBriefs']}}
elif action == 'audit':
    con.execute('BEGIN IMMEDIATE')
    try:
        insert_rows('classification_audit', request.get('rows', []), 'REPLACE')
        con.commit()
    except Exception:
        con.rollback(); raise
    output={'schemaVersion':version,'written':len(request.get('rows', []))}
elif action == 'query':
    output={'schemaVersion':version,'rows':[dict(row) for row in con.execute(request['sql'], request.get('params', [])).fetchall()]}
elif action == 'projection_health':
    con.execute('BEGIN IMMEDIATE')
    try:
        run=request.get('run')
        if run: insert_rows('projection_runs', [run])
        if request.get('replaceSources'): con.execute('DELETE FROM projection_source_health')
        for source in request.get('sources', []): insert_rows('projection_source_health', [source])
        for checkpoint in request.get('checkpoints', []): insert_rows('projection_checkpoint', [checkpoint])
        con.commit()
    except Exception:
        con.rollback(); raise
    output={'schemaVersion':version,'written':True}
else:
    raise RuntimeError('unknown store action')
print(json.dumps(output, ensure_ascii=False))
`;

class ManagementStore {
  constructor(options = {}) {
    if (!options.database) throw new Error('database is required');
    this.database = path.resolve(options.database);
    this.pythonBin = options.pythonBin || 'python3';
    this.schema = options.schema || fs.readFileSync(SCHEMA_PATH, 'utf8');
  }

  execute(action, extra = {}) {
    const request = {
      action,
      database: this.database,
      schema: this.schema,
      schemaVersion: SCHEMA_VERSION,
      ...extra,
    };
    const result = spawnSync(this.pythonBin, ['-c', PYTHON_STORE], {
      input: JSON.stringify(request),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || 'management_store_failed').slice(0, 2000));
    }
    return JSON.parse(result.stdout);
  }

  initialize() {
    return this.execute('initialize');
  }

  applyProjection(data) {
    return this.execute('apply', { data });
  }

  writeClassificationAudit(rows) {
    return this.execute('audit', { rows });
  }

  query(sql, params = []) {
    return this.execute('query', { sql, params }).rows;
  }

  writeProjectionHealth(run, sources = [], checkpoints = [], options = {}) {
    return this.execute('projection_health', {
      run,
      sources,
      checkpoints,
      replaceSources: options.replaceSources === true,
    });
  }
}

module.exports = { ManagementStore, SCHEMA_PATH, SCHEMA_VERSION };
