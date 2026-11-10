'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { loadTaskReferences } = require('../lib/kanban-source');

function createBoard(home, board, tasks) {
  const directory = path.join(home, 'kanban', 'boards', board);
  fs.mkdirSync(directory, { recursive: true });
  const database = path.join(directory, 'kanban.db');
  const script = String.raw`
import json, sqlite3, sys
con=sqlite3.connect(sys.argv[1])
con.executescript('''
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,title TEXT,body TEXT,assignee TEXT,status TEXT,priority INTEGER,
  created_by TEXT,created_at INTEGER,started_at INTEGER,completed_at INTEGER,tenant TEXT,
  result TEXT,block_kind TEXT,project_id TEXT
);
CREATE TABLE task_comments (task_id TEXT,author TEXT,body TEXT,created_at INTEGER);
CREATE TABLE task_attachments (
  task_id TEXT,id TEXT,filename TEXT,content_type TEXT,size INTEGER,created_at INTEGER
);
''')
for item in json.loads(sys.argv[2]):
    con.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
      item['id'],item['title'],'body','Rhajaina',item['status'],1,'test',1,None,None,
      'tenant',None,None,None))
    con.execute('INSERT INTO task_comments VALUES (?,?,?,?)',(item['id'],'test','comment',2))
    con.execute('INSERT INTO task_attachments VALUES (?,?,?,?,?,?)',
      (item['id'],'attachment-1','evidence.txt','text/plain',8,3))
con.commit()
`;
  const result = spawnSync('python3', ['-c', script, database, JSON.stringify(tasks)], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

test('loads only exact public task references with comments and attachments', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-reference-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  createBoard(home, 'operations', [
    { id: 't_selected1', title: 'Selected', status: 'ready' },
    { id: 't_ignored1', title: 'Ignored', status: 'blocked' },
  ]);
  createBoard(home, 'twl-netze-private', [{ id: 't_private1', title: 'Private', status: 'ready' }]);

  const result = loadTaskReferences({
    hermesHome: home,
    excludedBoards: ['twl-netze-private'],
    references: [
      { board: 'operations', taskId: 't_selected1' },
      { board: 'twl-netze-private', taskId: 't_private1' },
      { board: '../invalid', taskId: 't_ignored1' },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.items.map((item) => [item.board, item.id, item.status]),
    [['operations', 't_selected1', 'ready']]
  );
  assert.equal(result.items[0].comments[0].body, 'comment');
  assert.equal(result.items[0].attachments[0].filename, 'evidence.txt');
});
