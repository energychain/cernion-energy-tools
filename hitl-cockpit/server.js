const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  defaultManagementDatabase,
  loadTaskReferences,
  loadTasks: loadKanbanTasks,
} = require('./lib/kanban-source');
const { createManagementApi, decodeId } = require('./lib/management-api');
const { ManagementReader } = require('./lib/management-reader');
const { ManagementStore } = require('./lib/management-store');
const { assertFreshForWrite } = require('./lib/projection-health');
const { createSessionAuth, secureHeaders } = require('./lib/session-auth');
const { createAssistantApi } = require('./lib/assistant-api');
const { createAssistantActionExecutor } = require('./lib/assistant-action-executor');
const { loadAssistantConfig } = require('./lib/assistant-config');
const { createAssistantContextResolver } = require('./lib/assistant-context');
const { createAssistantMatrixHandoffAdapter } = require('./lib/assistant-matrix-handoff');
const { createAssistantMatrixRuntime } = require('./lib/assistant-matrix-runtime');
const { createMatrixResultSync } = require('./lib/assistant-matrix-result-sync');
const { createMatrixListenerCursor } = require('./lib/matrix-listener-cursor');
const { loadMatrixAgentRooms } = require('./lib/matrix-agent-rooms');
const { createAssistantService } = require('./lib/assistant-service');
const { createAssistantSourceResolver } = require('./lib/assistant-source-resolver');
const { AssistantStore } = require('./lib/assistant-store');
const { buildOperatingStatus, loadProductionContract } = require('./lib/production-contract');
const { RhajainaClient } = require('./lib/rhajaina-client');
const DECISION_ACTIONS = require('./lib/decision-actions');

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
const MANAGEMENT_COCKPIT_DECISION_EXECUTE_ENABLED =
  String(process.env.MANAGEMENT_COCKPIT_DECISION_EXECUTE_ENABLED || 'false').toLowerCase() ===
  'true';
const MANAGEMENT_DATABASE = path.resolve(
  process.env.MANAGEMENT_COCKPIT_DATABASE || defaultManagementDatabase(HERMES_HOME)
);
const sessionAuth = createSessionAuth({
  staticToken: TOKEN,
  ttlSeconds: process.env.HITL_COCKPIT_SESSION_TTL_SECONDS,
  allowLegacyBearer:
    String(process.env.HITL_COCKPIT_ALLOW_LEGACY_BEARER || 'false').toLowerCase() === 'true',
});
if (MANAGEMENT_COCKPIT_ENABLED && fs.existsSync(MANAGEMENT_DATABASE)) {
  new ManagementStore({ database: MANAGEMENT_DATABASE }).initialize();
}
const managementReader = new ManagementReader({ database: MANAGEMENT_DATABASE });
const managementApi = createManagementApi({
  reader: managementReader,
  enabled: MANAGEMENT_COCKPIT_ENABLED,
  writeEnabled: MANAGEMENT_COCKPIT_WRITE_ENABLED,
  shadowOnly: MANAGEMENT_COCKPIT_SHADOW_ONLY,
  defaultView: MANAGEMENT_COCKPIT_DEFAULT_VIEW,
  decisionExecuteEnabled: MANAGEMENT_COCKPIT_DECISION_EXECUTE_ENABLED,
  decisionKanban: MANAGEMENT_COCKPIT_DECISION_EXECUTE_ENABLED
    ? createDecisionKanbanAdapter()
    : null,
  excludedBoards: Array.from(EXCLUDE_BOARDS),
});
const assistantConfig = loadAssistantConfig({
  configPath: process.env.ASSISTANT_CONFIG || process.env.HITL_COCKPIT_ASSISTANT_CONFIG,
});
const assistantPublicBoards = String(process.env.ASSISTANT_PUBLIC_BOARDS || 'operations')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const assistantMatrixAgentSenders = JSON.parse(process.env.ASSISTANT_MATRIX_AGENT_SENDERS || '{}');
const assistantMatrixAgentRooms = assistantConfig.matrixHandoffEnabled
  ? loadMatrixAgentRooms({
      agentsPath: path.join(__dirname, 'config', 'agents.json'),
      roomsPath:
        process.env.ASSISTANT_MATRIX_AGENT_ROOMS ||
        path.join('/home/clawd/.hermes', 'matrix-agent-rooms.json'),
    })
  : {};
const assistantResultAllowedSenders = String(process.env.ASSISTANT_RESULT_ALLOWED_SENDERS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const productionContract = loadProductionContract({
  contractPath: process.env.COCKPIT_PRODUCTION_CONTRACT,
});
const operatingStatus = buildOperatingStatus({
  contract: productionContract,
  management: {
    enabled: MANAGEMENT_COCKPIT_ENABLED,
    decisionWritesEnabled: MANAGEMENT_COCKPIT_WRITE_ENABLED,
    shadowOnly: MANAGEMENT_COCKPIT_SHADOW_ONLY,
    defaultView: MANAGEMENT_COCKPIT_DEFAULT_VIEW,
    decisionExecuteEnabled: MANAGEMENT_COCKPIT_DECISION_EXECUTE_ENABLED,
    decisionExecuteActionClasses: DECISION_ACTIONS.ACTIONS,
    decisionExecuteRequiresProductionSmoke: true,
  },
  assistant: assistantConfig,
});
let assistantService = null;
if (assistantConfig.enabled) {
  const assistantDatabase = path.resolve(
    process.env.ASSISTANT_DATABASE ||
      process.env.HITL_COCKPIT_ASSISTANT_DATABASE ||
      path.join(HERMES_HOME, 'agent-os', 'assistant-channel.db')
  );
  const assistantStore = new AssistantStore({ database: assistantDatabase });
  assistantStore.initialize();
  const assistantContextResolver = createAssistantContextResolver({
    reader: managementReader,
    maxBytes: assistantConfig.limits.maxContextChars,
  });
  const assistantExecutor = assistantConfig.writesEnabled
    ? createAssistantActionExecutor({
        kanban: createServerKanbanAdapter(),
        publicBoards: assistantPublicBoards,
        scopeChecker: assistantScopeChecker,
      })
    : null;
  let assistantMatrixHandoff = null;
  let assistantMatrixRuntime = null;
  if (assistantConfig.matrixHandoffEnabled) {
    try {
      assistantMatrixRuntime = createAssistantMatrixRuntime();
      assistantMatrixHandoff = createAssistantMatrixHandoffAdapter(assistantMatrixRuntime);
    } catch (_) {
      // Required Matrix delivery remains durable as matrix_pending until runtime becomes available.
    }
  }
  assistantService = createAssistantService({
    store: assistantStore,
    contextResolver: assistantContextResolver,
    client: new RhajainaClient({ config: assistantConfig }),
    config: assistantConfig,
    executor: assistantExecutor,
    matrixHandoff: assistantMatrixHandoff,
    sourceResolver: resolveAssistantSource,
    scopeChecker: assistantScopeChecker,
    publicBoards: assistantPublicBoards,
    matrixAgentSenders: assistantMatrixAgentSenders,
    matrixAgentRooms: assistantMatrixAgentRooms,
    freshnessGuard: () => assertFreshForWrite(managementReader.read('health')),
    readResultKanban: readAssistantTask,
    readResultRound: readAssistantResultRound,
    resultRoundIdempotent: true,
    resultAllowedSenders: assistantResultAllowedSenders,
    readResultMatrixEvent: assistantMatrixRuntime?.readback,
    closeResultCase: closeAssistantResultCase,
    createResultRound: createAssistantResultRound,
  });
  assistantService.resumePendingRuns();
  let reconciliationDelay = 5000;
  const matrixResultSync =
    assistantMatrixRuntime?.sync && assistantResultAllowedSenders.length
      ? createMatrixResultSync({
          runtime: assistantMatrixRuntime,
          ingest: (event) => assistantService.ingestAgentResult(event),
          cursor: createMatrixListenerCursor({
            file:
              process.env.ASSISTANT_MATRIX_RESULT_CURSOR_FILE ||
              path.join(HERMES_HOME, 'agent-os', 'matrix-result-listener-cursor.json'),
          }),
        })
      : null;
  const reconcileLoop = async () => {
    try {
      if (matrixResultSync) await matrixResultSync.poll();
      await assistantService.processReconciliations();
      reconciliationDelay = 5000;
    } catch (_) {
      reconciliationDelay = Math.min(60000, reconciliationDelay * 2);
    }
    const timer = setTimeout(reconcileLoop, reconciliationDelay);
    timer.unref();
  };
  reconcileLoop();
}
const assistantApi = createAssistantApi({
  config: assistantConfig,
  service: assistantService,
  freshnessGuard: () => assertFreshForWrite(managementReader.read('health')),
  trustProxy: String(process.env.HITL_COCKPIT_TRUST_PROXY || 'false').toLowerCase() === 'true',
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

function readAssistantTask(source) {
  const result = loadTaskReferences({
    hermesHome: HERMES_HOME,
    excludedBoards: EXCLUDE_BOARDS,
    references: [source],
    timeout: 10000,
  });
  if (result.errors.length) throw new Error('assistant_source_read_failed');
  return (
    result.items.find((item) => item.board === source.board && item.id === source.taskId) || null
  );
}

function readAssistantTasks(sources) {
  const result = loadTaskReferences({
    hermesHome: HERMES_HOME,
    excludedBoards: EXCLUDE_BOARDS,
    references: sources,
    timeout: 10000,
  });
  if (result.errors.length) throw new Error('assistant_source_read_failed');
  return result.items;
}

async function resolveAssistantSource(input = {}) {
  return createAssistantSourceResolver({
    reader: managementReader,
    readTask: readAssistantTask,
    readTasks: readAssistantTasks,
    validBoard,
    validTask,
  })(input);
}

async function assistantScopeChecker() {
  // Scope coverage must come from a dedicated server-side machine-readable approval record.
  return { covered: false };
}

async function closeAssistantResultCase(input) {
  const { board, taskId } = input.source;
  if (!validBoard(board) || !validTask(taskId)) throw new Error('assistant_result_source_invalid');
  const result = runHermes([
    '--board',
    board,
    'complete',
    '--result',
    input.resultText,
    '--summary',
    input.resultText,
    taskId,
  ]);
  if (!result.ok) throw new Error('assistant_result_close_failed');
  const task = readAssistantTask({ board, taskId });
  return { task };
}

async function readAssistantResultRound(input) {
  const loaded = loadTasks();
  if (loaded.errors?.length) throw new Error('assistant_result_round_lookup_failed');
  const matches = (loaded.boards || [])
    .flatMap((item) => item.items || [])
    .filter(
      (task) =>
        task.board === input.source.board &&
        String(task.body || '')
          .split('\n')
          .includes(`RESULT_OPERATION_ID: ${input.operationId}`)
    );
  if (matches.length > 1) throw new Error('assistant_result_round_ambiguous');
  if (!matches.length) return null;
  return { task: readAssistantTask({ board: input.source.board, taskId: matches[0].id }) };
}

async function createAssistantResultRound(input) {
  const { board, taskId } = input.source;
  if (!validBoard(board) || !validTask(taskId)) throw new Error('assistant_result_source_invalid');
  const title =
    `${input.action === 'correct' ? 'Korrektur' : 'Fortsetzung'}: ${input.result.statement}`.slice(
      0,
      180
    );
  const body = [
    `RESULT_OPERATION_ID: ${input.operationId}`,
    `PARENT_RESULT_ID: ${input.result.id}`,
    `SOURCE_TASK_ID: ${taskId}`,
    input.instruction,
  ].join('\n');
  const created = runHermes([
    '--board',
    board,
    'create',
    '--body',
    body,
    '--assignee',
    input.result.responsibleAgent,
    '--parent',
    taskId,
    '--idempotency-key',
    input.idempotencyKey,
    '--created-by',
    AUTHOR,
    '--json',
    title,
  ]);
  if (!created.ok) throw new Error('assistant_result_round_failed');
  let payload;
  try {
    payload = JSON.parse(created.stdout);
  } catch (_) {
    throw new Error('assistant_result_round_readback_missing');
  }
  const linkedTaskId = payload.id || payload.task_id || payload.taskId;
  if (!validTask(linkedTaskId)) throw new Error('assistant_result_round_readback_missing');
  const task = readAssistantTask({ board, taskId: linkedTaskId });
  if (!task) throw new Error('assistant_result_round_readback_missing');
  return { task };
}

function createDecisionKanbanAdapter() {
  return {
    readTask: readAssistantTask,
    async recordDecision(command) {
      const { board, taskId } = command.source;
      const { action, payload, decisionId, idempotencyKey } = command;
      const outcome = {
        choose: `Entscheidung ${decisionId}: Option "${payload.option}" gewählt.${payload.note ? ' ' + payload.note : ''}`,
        delegate: `Entscheidung ${decisionId}: delegiert an ${payload.assignee}.${payload.note ? ' ' + payload.note : ''}`,
        question: `Entscheidung ${decisionId}: Rückfrage — ${payload.question}`,
        schedule: `Entscheidung ${decisionId}: Wiedervorlage ${payload.wakeAt} — ${payload.reason}; ${payload.nextAction}`,
        reject: `Entscheidung ${decisionId}: abgelehnt — ${payload.reason}`,
        'return-to-rhajaina': `Entscheidung ${decisionId}: an Rhajaina zurückgegeben.${payload.reason ? ' ' + payload.reason : ''}`,
      }[action];
      const auditText = `[MANAGEMENT-COCKPIT-DECISION] ${outcome} · ACTION_ID: ${idempotencyKey}`;
      const results = [runHermes(['--board', board, 'comment', '--author', AUTHOR, taskId, auditText])];
      if (action === 'delegate') {
        const assignee = String(payload.assignee || '')
          .trim()
          .toLowerCase();
        if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(assignee)) {
          results.push(runHermes(['--board', board, 'assign', taskId, assignee]));
        }
      }
      if (action === 'schedule') {
        results.push(
          runHermes([
            '--board',
            board,
            'block',
            '--kind',
            'scheduled',
            taskId,
            `${payload.wakeAt}: ${payload.reason}; ${payload.nextAction}`,
          ])
        );
      }
      if (results.some((result) => !result.ok)) {
        throw new Error('decision_execute_kanban_write_failed');
      }
      return results.map((result, index) => ({ step: index, ok: result.ok }));
    },
  };
}

function createServerKanbanAdapter() {
  return {
    readTask: readAssistantTask,
    operations(command) {
      const { board, taskId } = command.source;
      const payload = command.payload;
      const step = (id, args, observed) => ({
        id,
        observed,
        async apply() {
          const result = runHermes(['--board', board, ...args]);
          if (!result.ok) throw new Error('assistant_kanban_write_failed');
          return { step: id };
        },
      });
      const contains = (task, value) =>
        JSON.stringify(task).toLowerCase().includes(String(value).toLowerCase());
      const assignedTo = (task, value) =>
        [task.assignee, task.owner].some(
          (assigned) =>
            String(assigned || '')
              .trim()
              .toLowerCase() ===
            String(value || '')
              .trim()
              .toLowerCase()
        );
      if (command.action === 'ask_question') {
        return [
          step('comment', ['comment', '--author', AUTHOR, taskId, payload.question], (task) =>
            contains(task, payload.question)
          ),
        ];
      }
      if (command.action === 'archive_intake_noise') {
        const auditText = `[MANAGEMENT-COCKPIT] Als Intake-Rauschen archiviert · ${payload.reason} · ACTION_ID: ${command.idempotencyKey}`;
        const terminal = (task) =>
          ['done', 'completed', 'closed', 'resolved', 'archived'].includes(
            String(task.status || '').toLowerCase()
          );
        return [
          step('audit-comment', ['comment', '--author', AUTHOR, taskId, auditText], (task) =>
            contains(task, command.idempotencyKey)
          ),
          step(
            'activate-if-scheduled',
            ['unblock', '--reason', auditText, taskId],
            (task) => String(task.status || '').toLowerCase() !== 'scheduled'
          ),
          step(
            'complete',
            ['complete', '--result', auditText, '--summary', auditText, taskId],
            terminal
          ),
        ];
      }
      if (command.action === 'delegate_followup') {
        return [
          step('assign', ['assign', taskId, payload.assignee], (task) =>
            assignedTo(task, payload.assignee)
          ),
          step('comment', ['comment', '--author', AUTHOR, taskId, payload.followup], (task) =>
            contains(task, payload.followup)
          ),
        ];
      }
      if (command.action === 'schedule_wakeup') {
        const reason = `${payload.wakeAt}: ${payload.reason}; ${payload.nextAction}`;
        return [
          step(
            'block',
            ['block', '--kind', 'scheduled', taskId, reason],
            (task) =>
              ['scheduled', 'wakeup'].includes(task.block_kind || task.blockKind || task.status) &&
              contains(task, payload.reason)
          ),
        ];
      }
      if (command.action === 'return_for_completion') {
        return [
          step('comment', ['comment', '--author', AUTHOR, taskId, payload.reason], (task) =>
            contains(task, payload.reason)
          ),
          step('block', ['block', '--kind', 'needs_input', taskId, payload.reason], (task) =>
            ['needs_input', 'blocked'].includes(task.block_kind || task.blockKind || task.status)
          ),
        ];
      }
      if (command.action === 'set_owner')
        return [
          step('assign', ['assign', taskId, payload.owner], (task) =>
            assignedTo(task, payload.owner)
          ),
        ];
      if (command.action === 'set_priority')
        return [
          step(
            'priority',
            ['update', '--priority', String(payload.priority), taskId],
            (task) => String(task.priority) === String(payload.priority)
          ),
        ];
      throw new Error('assistant_action_not_supported');
    },
    async applyAction(command) {
      const { board, taskId } = command.source;
      const payload = command.payload;
      let results;
      if (command.action === 'ask_question') {
        results = [
          runHermes(['--board', board, 'comment', '--author', AUTHOR, taskId, payload.question]),
        ];
      } else if (command.action === 'delegate_followup') {
        const assignee = String(payload.assignee || '')
          .trim()
          .toLowerCase();
        if (
          !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(assignee) ||
          !fs.existsSync(path.join(HERMES_HOME, 'profiles', assignee))
        ) {
          throw new Error('assistant_assignee_profile_not_found');
        }
        results = [
          runHermes(['--board', board, 'assign', taskId, assignee]),
          runHermes(['--board', board, 'comment', '--author', AUTHOR, taskId, payload.followup]),
        ];
      } else if (command.action === 'schedule_wakeup') {
        results = [
          runHermes([
            '--board',
            board,
            'block',
            '--kind',
            'scheduled',
            taskId,
            `${payload.wakeAt}: ${payload.reason}; ${payload.nextAction}`,
          ]),
        ];
      } else if (command.action === 'return_for_completion') {
        results = [
          runHermes(['--board', board, 'comment', '--author', AUTHOR, taskId, payload.reason]),
          runHermes(['--board', board, 'block', '--kind', 'needs_input', taskId, payload.reason]),
        ];
      } else if (command.action === 'set_owner') {
        results = [runHermes(['--board', board, 'assign', taskId, payload.owner])];
      } else if (command.action === 'set_priority') {
        results = [
          runHermes(['--board', board, 'update', '--priority', String(payload.priority), taskId]),
        ];
      } else {
        throw new Error('assistant_action_not_supported');
      }
      const result = chainResults(results);
      if (!result.ok) throw new Error('assistant_kanban_write_failed');
      return { action: command.action, applied: true };
    },
  };
}

function guardLegacyWrite(res) {
  try {
    assertFreshForWrite(managementReader.read('health'));
    return true;
  } catch (error) {
    if (['PROJECTION_STALE', 'PROJECTION_DEGRADED'].includes(error.code)) {
      json(res, 409, { ok: false, error: error.code });
    } else {
      json(res, 503, { ok: false, error: 'management_projection_unavailable' });
    }
    return false;
  }
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
  const authorization = sessionAuth.authorize(req);
  if (!authorization.ok) {
    res.writeHead(401, {
      ...secureHeaders(),
      'content-type': 'text/plain; charset=utf-8',
      'www-authenticate': 'Bearer',
    });
    return res.end('Nicht autorisiert. Cockpit-Link erneut öffnen.');
  }
  req.authIdentity = authorization.identity;
  try {
    if (url.pathname === '/api/health')
      return json(res, 200, {
        ok: true,
        service: 'agentos-hitl-cockpit',
        host: HOST,
        port: PORT,
        hermesHome: HERMES_HOME,
        excludedBoards: Array.from(EXCLUDE_BOARDS),
        operatingStatus,
        time: new Date().toISOString(),
      });
    if (url.pathname === '/api/tasks') return json(res, 200, loadTasks());
    if (url.pathname.startsWith('/api/assistant/')) {
      const response = await assistantApi.handle(req, url);
      return json(res, response.status, response.body);
    }
    const topicArchive = url.pathname.match(/^\/api\/management\/topics\/([^/]+)\/archive$/);
    if (topicArchive && req.method === 'POST') {
      if (!guardLegacyWrite(res)) return;
      const topicId = decodeId(topicArchive[1]);
      if (!topicId) return json(res, 400, { ok: false, error: 'invalid_management_id' });
      try {
        const result = await assistantService.archiveTopic(topicId);
        return json(res, result.pending ? 202 : 200, { ok: true, ...result });
      } catch (error) {
        return json(res, error.status || 500, {
          ok: false,
          error: error.code || 'topic_archive_failed',
        });
      }
    }
    const decisionArchive = url.pathname.match(/^\/api\/management\/decisions\/([^/]+)\/archive$/);
    if (decisionArchive && req.method === 'POST') {
      if (!guardLegacyWrite(res)) return;
      const decisionId = decodeId(decisionArchive[1]);
      if (!decisionId) return json(res, 400, { ok: false, error: 'invalid_management_id' });
      try {
        const result = await assistantService.archiveDecision(decisionId);
        return json(res, result.pending ? 202 : 200, { ok: true, ...result });
      } catch (error) {
        return json(res, error.status || 500, {
          ok: false,
          error: error.code || 'decision_archive_failed',
        });
      }
    }
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
    const managementActionExecute = url.pathname.match(
      /^\/api\/management\/decisions\/([^/]+)\/(choose|delegate|question|schedule|reject|return-to-rhajaina)\/execute$/
    );
    if (managementActionExecute && req.method === 'POST') {
      const decisionId = decodeId(managementActionExecute[1]);
      if (!decisionId) return json(res, 400, { ok: false, error: 'invalid_management_id' });
      const body = await parseBody(req).catch(() => null);
      if (!body) return json(res, 400, { ok: false, error: 'invalid_json_body' });
      const response = await managementApi.handleDecisionExecute(
        decisionId,
        managementActionExecute[2],
        body
      );
      return json(res, response.status, response.body);
    }
    if (url.pathname.startsWith('/api/management/')) {
      const response = managementApi.handle(req, url);
      return json(res, response.status, response.body);
    }
    const m = url.pathname.match(
      /^\/api\/tasks\/([^/]+)\/([^/]+)\/(approve|reject|question|close)$/
    );
    if (m && req.method === 'POST') {
      if (!guardLegacyWrite(res)) return;
      return handleAction(req, res, m[1], m[2], m[3]);
    }
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
