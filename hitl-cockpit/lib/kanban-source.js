'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_EXCLUDED_BOARDS = ['twl-netze-private'];

const PYTHON_READER = String.raw`
import json, os, sqlite3, sys, time
options=json.loads(sys.argv[1])
home=options['home']
exclude=set(options.get('excludedBoards', []))
mode=options.get('mode', 'legacy')
base=os.path.join(home,'kanban','boards')
items=[]; errors=[]; boards=[]
columns='id,title,body,assignee,status,priority,created_by,created_at,started_at,completed_at,tenant,result,block_kind,project_id'
for board in sorted(os.listdir(base)) if os.path.isdir(base) else []:
    if board in exclude: continue
    db=os.path.join(base, board, 'kanban.db')
    if not os.path.isfile(db): continue
    try:
        con=sqlite3.connect('file:'+db+'?mode=ro', uri=True, timeout=2)
        con.row_factory=sqlite3.Row
        if mode == 'legacy':
            query='select '+columns+" from tasks where status='blocked' or (status='scheduled' and coalesce(block_kind,'')='needs_input') order by priority desc, created_at asc limit 80"
        else:
            query='select '+columns+' from tasks order by created_at asc, id asc'
        rows=con.execute(query).fetchall()
        board_items=[]
        for row in rows:
            item=dict(row); item['board']=board
            item['comments']=[dict(x) for x in con.execute('select author, body, created_at from task_comments where task_id=? order by created_at desc limit 8', (row['id'],)).fetchall()]
            item['attachments']=[dict(x) for x in con.execute('select id, filename, content_type, size, created_at from task_attachments where task_id=? order by created_at desc limit 20', (row['id'],)).fetchall()]
            board_items.append(item); items.append(item)
        boards.append({'board':board,'count':len(board_items),'items':board_items})
        con.close()
    except Exception as error:
        errors.append({'board':board,'error':str(error)[:500]})
result={'ok':True,'generatedAt':int(time.time()),'count':len(items),'excludedBoards':sorted(exclude),'items':items,'errors':errors}
if mode != 'legacy': result['boards']=boards
print(json.dumps(result, ensure_ascii=False))
`;

function normalizeExcludedBoards(value) {
  if (value instanceof Set) return Array.from(value).filter(Boolean).sort();
  if (Array.isArray(value)) return value.filter(Boolean).sort();
  return String(value || DEFAULT_EXCLUDED_BOARDS.join(','))
    .split(',')
    .map((board) => board.trim())
    .filter(Boolean)
    .sort();
}

function readKanban(options = {}) {
  const payload = {
    home: options.hermesHome || process.env.HERMES_HOME || '/home/clawd/.hermes',
    excludedBoards: normalizeExcludedBoards(
      options.excludedBoards ?? process.env.HITL_COCKPIT_EXCLUDE_BOARDS
    ),
    mode: options.mode || 'legacy',
  };
  const result = spawnSync(
    options.pythonBin || 'python3',
    ['-c', PYTHON_READER, JSON.stringify(payload)],
    {
      encoding: 'utf8',
      timeout: options.timeout || 60000,
      maxBuffer: options.maxBuffer || 256 * 1024 * 1024,
    }
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'task_load_failed').slice(0, 1000));
  }
  return JSON.parse(result.stdout);
}

function loadTasks(options = {}) {
  const result = readKanban({ ...options, mode: 'legacy' });
  delete result.boards;
  return result;
}

function loadProjectionSource(options = {}) {
  return readKanban({ ...options, mode: 'projection' });
}

function defaultManagementDatabase(hermesHome) {
  return path.join(
    hermesHome || process.env.HERMES_HOME || '/home/clawd/.hermes',
    'management-cockpit',
    'management.db'
  );
}

module.exports = {
  DEFAULT_EXCLUDED_BOARDS,
  defaultManagementDatabase,
  loadProjectionSource,
  loadTasks,
  normalizeExcludedBoards,
};
