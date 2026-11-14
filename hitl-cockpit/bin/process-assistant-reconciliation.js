#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AssistantStore } = require('../lib/assistant-store');
const { createAssistantActionExecutor } = require('../lib/assistant-action-executor');
const { createAssistantMatrixHandoffAdapter } = require('../lib/assistant-matrix-handoff');
const { createAssistantMatrixRuntime } = require('../lib/assistant-matrix-runtime');
const { loadAssistantConfig } = require('../lib/assistant-config');
const { ManagementReader } = require('../lib/management-reader');
const { assertFreshForWrite } = require('../lib/projection-health');
const { createAssistantReconciliation } = require('../lib/assistant-reconciliation');

function jsonCommand(args, env) {
  const result = spawnSync(process.env.HERMES_BIN || 'hermes', args, {
    env,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('assistant_kanban_command_failed');
  try {
    return JSON.parse(result.stdout);
  } catch (_) {
    return result.stdout;
  }
}

function createKanbanRuntime(options = {}) {
  const env = { ...process.env, HERMES_HOME: options.hermesHome };
  return {
    async readTask(source) {
      const value = jsonCommand(
        ['kanban', '--board', source.board, 'show', source.taskId, '--json'],
        env
      );
      return value?.task || value;
    },
    async applyAction() {
      // This CLI adapter cannot durably checkpoint the server's multi-step actions.
      // Readback recovery remains available; uncertain writes require the server adapter.
      throw Object.assign(new Error('standalone_kanban_replay_unsupported'), {
        code: 'standalone_kanban_replay_unsupported',
      });
    },
  };
}

async function main(options = {}) {
  const hermesHome = path.resolve(
    options.hermesHome || process.env.HERMES_HOME || path.join(process.env.HOME, '.hermes')
  );
  const database = path.resolve(
    options.database ||
      process.env.ASSISTANT_DATABASE ||
      path.join(hermesHome, 'agent-os', 'assistant-channel.db')
  );
  const config =
    options.config || loadAssistantConfig({ configPath: process.env.ASSISTANT_CONFIG });
  const reader =
    options.reader ||
    new ManagementReader({
      database:
        process.env.MANAGEMENT_DATABASE ||
        path.join(hermesHome, 'agent-os', 'management-projection.db'),
    });
  const mutationGuard = () => {
    if (!config.enabled || !config.writesEnabled) throw new Error('assistant_writes_disabled');
    assertFreshForWrite(reader.read('health'));
  };
  mutationGuard();
  const store = new AssistantStore({ database });
  store.initialize();
  const executor = createAssistantActionExecutor({
    kanban: options.kanban || createKanbanRuntime({ hermesHome }),
    scopeChecker: options.scopeChecker,
  });
  let matrixHandoff = options.matrixHandoff || null;
  if (!matrixHandoff && process.env.ASSISTANT_MATRIX_RECONCILIATION === 'true') {
    matrixHandoff = createAssistantMatrixHandoffAdapter(createAssistantMatrixRuntime());
  }
  const processor = createAssistantReconciliation({
    store,
    executor,
    matrixHandoff,
    mutationGuard,
    publicBoards: options.publicBoards,
  });
  return processor.processDue();
}

if (require.main === module) {
  main()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.code || error.message || 'reconciliation_failed'}\n`);
      process.exitCode = 1;
    });
}

module.exports = { createKanbanRuntime, main };
