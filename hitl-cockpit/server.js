const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');
const { defaultManagementDatabase, loadTasks: loadKanbanTasks } = require('./lib/kanban-source');
const { createManagementApi, decodeId } = require('./lib/management-api');
const { ManagementReader } = require('./lib/management-reader');
const { createSessionAuth, secureHeaders } = require('./lib/session-auth');

const HOST = process.env.HITL_COCKPIT_HOST || '10.0.0.101';
const PORT = Number(process.env.HITL_COCKPIT_PORT || 3927);
const TOKEN = process.env.HITL_COCKPIT_TOKEN || process.env.TOKEN || '';
const HERMES_HOME = process.env.HERMES_HOME || '/home/clawd/.hermes';
const AUTHOR = process.env.HITL_COCKPIT_AUTHOR || 'hitl-cockpit';
const EXCLUDE_BOARDS = new Set(
  String(process.env.HITL_COCKPIT_EXCLUDE_BOARDS || 'twl-netze-private')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const HERMES_BIN = process.env.HERMES_BIN || '/home/clawd/.hermes/hermes-agent/venv/bin/hermes';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MANAGEMENT_COCKPIT_ENABLED =
  String(process.env.MANAGEMENT_COCKPIT_ENABLED || 'false').toLowerCase() === 'true';
const MANAGEMENT_COCKPIT_WRITE_ENABLED =
  String(process.env.MANAGEMENT_COCKPIT_WRITE_ENABLED || 'false').toLowerCase() === 'true';
const MANAGEMENT_COCKPIT_SHADOW_ONLY =
  String(process.env.MANAGEMENT_COCKPIT_SHADOW_ONLY || 'true').toLowerCase() !== 'false';
const MANAGEMENT_COCKPIT_DEFAULT_VIEW =
  process.env.MANAGEMENT_COCKPIT_DEFAULT_VIEW === 'management' ? 'management' : 'legacy';
const MANAGEMENT_DATABASE = path.resolve(
  process.env.MANAGEMENT_COCKPIT_DATABASE || defaultManagementDatabase(HERMES_HOME)
);
const sessionAuth = createSessionAuth({
  staticToken: TOKEN,
  ttlSeconds: process.env.HITL_COCKPIT_SESSION_TTL_SECONDS,
  allowLegacyBearer:
    String(process.env.HITL_COCKPIT_ALLOW_LEGACY_BEARER || 'false').toLowerCase() === 'true',
});
const managementReader = new ManagementReader({ database: MANAGEMENT_DATABASE });
const managementApi = createManagementApi({
  reader: managementReader,
  enabled: MANAGEMENT_COCKPIT_ENABLED,
  writeEnabled: MANAGEMENT_COCKPIT_WRITE_ENABLED,
  shadowOnly: MANAGEMENT_COCKPIT_SHADOW_ONLY,
  defaultView: MANAGEMENT_COCKPIT_DEFAULT_VIEW,
});

function json(res, status, body) {
  res.writeHead(status, {
    ...secureHeaders(),
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body, null, 2));
}
function text(res, status, body, type = 'text/plain') {
  res.writeHead(status, {
    ...secureHeaders({ html: type === 'text/html' }),
    'content-type': type + '; charset=utf-8',
  });
  res.end(body);
}
function redact(s) {
  return String(s || '').replace(/[A-Za-z0-9_=-]{24,}/g, '[REDACTED]');
}
function runHermes(args) {
  const env = {
    ...process.env,
    HERMES_HOME,
    HERMES_PROFILE: process.env.HERMES_PROFILE || 'infrastructure',
  };
  const r = spawnSync(HERMES_BIN, ['kanban', ...args], {
    env,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', ok: r.status === 0 };
}
function getTaskStatus(board, taskId) {
  if (!validBoard(board) || !validTask(taskId)) return null;
  const db = path.join(HERMES_HOME, 'kanban', 'boards', board, 'kanban.db');
  const code =
    'import sqlite3,sys,json; con=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro", uri=True); con.row_factory=sqlite3.Row; r=con.execute("select status, block_kind from tasks where id=?", (sys.argv[2],)).fetchone(); print(json.dumps(dict(r) if r else None))';
  const r = spawnSync('python3', ['-c', code, db, taskId], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 128,
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || 'null');
  } catch (_) {
    return null;
  }
}
function chainResults(results) {
  const failed = results.find((r) => !r.ok);
  return (
    failed || {
      ok: true,
      status: 0,
      stdout: results
        .map((r) => r.stdout || r.stderr || '')
        .filter(Boolean)
        .join('\n'),
      stderr: '',
    }
  );
}
function validBoard(s) {
  return /^[a-z0-9][a-z0-9_.-]{0,80}$/.test(String(s || '')) && !EXCLUDE_BOARDS.has(String(s));
}
function validTask(s) {
  return /^t_[a-z0-9]{6,32}$/.test(String(s || ''));
}
function audit(label, note) {
  const n = note ? `: ${String(note).slice(0, 2000)}` : '';
  return `[HITL-COCKPIT] ${label} durch Thorsten${n}`;
}
async function parseBody(req, limit = 64 * 1024) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error('body_too_large');
  }
  return data ? JSON.parse(data) : {};
}
function loadTasks() {
  return loadKanbanTasks({
    hermesHome: HERMES_HOME,
    excludedBoards: EXCLUDE_BOARDS,
    timeout: 10000,
  });
}

async function handleAction(req, res, board, taskId, action) {
  if (!validBoard(board) || !validTask(taskId))
    return json(res, 400, { ok: false, error: 'invalid_board_or_task' });
  const body = await parseBody(req).catch(() => ({}));
  const note = String(body.comment || body.note || '').trim();
  const status = getTaskStatus(board, taskId);
  if (!status) return json(res, 404, { ok: false, error: 'task_not_found' });
  let label, result;
  if (action === 'approve') {
    label = 'Freigabe';
    result = runHermes(['--board', board, 'unblock', '--reason', audit(label, note), taskId]);
  } else if (action === 'reject') {
    label = 'Ablehnung';
    const a = audit(label, note || 'Bitte überarbeiten.');
    const results = [runHermes(['--board', board, 'comment', '--author', AUTHOR, taskId, a])];
    if (['running', 'ready'].includes(status.status))
      results.push(runHermes(['--board', board, 'block', '--kind', 'needs_input', taskId, a]));
    result = chainResults(results);
  } else if (action === 'question') {
    if (!note) return json(res, 400, { ok: false, error: 'comment_required' });
    label = 'Rückfrage';
    const a = audit(label, note);
    const results = [runHermes(['--board', board, 'comment', '--author', AUTHOR, taskId, a])];
    if (['running', 'ready'].includes(status.status))
      results.push(runHermes(['--board', board, 'block', '--kind', 'needs_input', taskId, a]));
    result = chainResults(results);
  } else if (action === 'close') {
    label = 'Schließen';
    const a = audit(label, note);
    const results = [];
    if (status.status === 'scheduled')
      results.push(runHermes(['--board', board, 'unblock', '--reason', a, taskId]));
    results.push(runHermes(['--board', board, 'complete', '--result', a, '--summary', a, taskId]));
    result = chainResults(results);
  } else {
    return json(res, 404, { ok: false, error: 'unknown_action' });
  }
  if (!result.ok)
    return json(res, 500, {
      ok: false,
      action,
      board,
      taskId,
      status,
      error: redact(result.stderr || result.stdout),
    });
  return json(res, 200, {
    ok: true,
    action,
    board,
    taskId,
    status,
    output: redact(result.stdout || result.stderr),
  });
}
async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const bootstrap = sessionAuth.bootstrap(req, url);
  if (bootstrap) {
    res.writeHead(bootstrap.status, bootstrap.headers);
    return res.end();
  }
  // Static browser assets contain no secrets; protected data is available only via authenticated APIs.
  if (req.method === 'GET' && ['/app.js', '/management.js', '/styles.css'].includes(url.pathname)) {
    const asset = path.basename(url.pathname);
    const type = asset.endsWith('.css') ? 'text/css' : 'application/javascript';
    return text(res, 200, await fsp.readFile(path.join(PUBLIC_DIR, asset), 'utf8'), type);
  }
  if (!sessionAuth.authorize(req).ok) {
    res.writeHead(401, {
      ...secureHeaders(),
      'content-type': 'text/plain; charset=utf-8',
      'www-authenticate': 'Bearer',
    });
    return res.end('Nicht autorisiert. Cockpit-Link erneut öffnen.');
  }
  try {
    if (url.pathname === '/api/health')
      return json(res, 200, {
        ok: true,
        service: 'agentos-hitl-cockpit',
        host: HOST,
        port: PORT,
        hermesHome: HERMES_HOME,
        excludedBoards: Array.from(EXCLUDE_BOARDS),
        time: new Date().toISOString(),
      });
    if (url.pathname === '/api/tasks') return json(res, 200, loadTasks());
    const managementAction = url.pathname.match(
      /^\/api\/management\/decisions\/([^/]+)\/(choose|delegate|question|schedule|reject|return-to-rhajaina)$/
    );
    if (managementAction && req.method === 'POST') {
      const decisionId = decodeId(managementAction[1]);
      if (!decisionId) return json(res, 400, { ok: false, error: 'invalid_management_id' });
      const body = await parseBody(req).catch(() => null);
      if (!body) return json(res, 400, { ok: false, error: 'invalid_json_body' });
      const response = managementApi.handleDecisionAction(decisionId, managementAction[2], body);
      return json(res, response.status, response.body);
    }
    if (url.pathname.startsWith('/api/management/')) {
      const response = managementApi.handle(req, url);
      return json(res, response.status, response.body);
    }
    const m = url.pathname.match(
      /^\/api\/tasks\/([^/]+)\/([^/]+)\/(approve|reject|question|close)$/
    );
    if (m && req.method === 'POST') return handleAction(req, res, m[1], m[2], m[3]);
    if (url.pathname === '/management' && !MANAGEMENT_COCKPIT_ENABLED)
      return json(res, 404, { ok: false, error: 'management_cockpit_disabled' });
    const file =
      url.pathname === '/'
        ? path.join(PUBLIC_DIR, 'index.html')
        : url.pathname === '/management'
          ? path.join(PUBLIC_DIR, 'management.html')
          : path.join(PUBLIC_DIR, path.normalize(url.pathname).replace(/^\/+/, ''));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file))
      return json(res, 404, { ok: false, error: 'not_found' });
    const ext = path.extname(file);
    const type =
      ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/html';
    return text(res, 200, await fsp.readFile(file, 'utf8'), type);
  } catch (err) {
    return json(res, 500, { ok: false, error: redact((err && err.message) || err) });
  }
}
http.createServer(handler).listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      ok: true,
      service: 'agentos-hitl-cockpit',
      host: HOST,
      port: PORT,
      hermesHome: HERMES_HOME,
      excludedBoards: Array.from(EXCLUDE_BOARDS),
    })
  );
});
