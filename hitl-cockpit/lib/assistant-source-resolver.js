'use strict';

const TERMINAL_STATUSES = new Set([
  'done',
  'completed',
  'closed',
  'resolved',
  'rejected',
  'cancelled',
  'archived',
]);

const OPERATIONS = {
  decision: 'decision',
  outcome: 'outcome',
  risk: 'risk',
  topic: 'topic',
  wakeup: 'wakeup',
};

function sourceKey(source) {
  return `${source.board}\0${source.taskId}`;
}

function normalizeSource(value) {
  if (!value || typeof value !== 'object') return null;
  const board = String(value.board || value.source_board || '');
  const taskId = String(value.taskId || value.task_id || value.source_task_id || '');
  return board && taskId ? { board, taskId } : null;
}

function uniqueSources(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const source = normalizeSource(value);
    if (!source) continue;
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function isOpenTask(task) {
  return Boolean(task) && !TERMINAL_STATUSES.has(String(task.status || '').toLowerCase());
}

function createAssistantSourceResolver(options = {}) {
  if (!options.reader || typeof options.reader.read !== 'function') {
    throw new Error('ManagementReader is required');
  }
  if (typeof options.readTask !== 'function') throw new Error('readTask is required');
  if (typeof options.validBoard !== 'function') throw new Error('validBoard is required');
  if (typeof options.validTask !== 'function') throw new Error('validTask is required');

  const reader = options.reader;
  const readTask = options.readTask;
  const readTasks = typeof options.readTasks === 'function' ? options.readTasks : null;
  const validBoard = options.validBoard;
  const validTask = options.validTask;

  return async function resolveAssistantSource(input = {}) {
    const context = input.context || {};
    const trusted = uniqueSources(context.sourceTasks).filter(
      (source) => validBoard(source.board) && validTask(source.taskId)
    );
    if (trusted.length === 0) return null;

    const trustedKeys = new Set(trusted.map(sourceKey));
    const loaded = new Map();
    if (readTasks) {
      let batch;
      try {
        batch = readTasks(trusted);
      } catch (_) {
        return null;
      }
      for (const task of Array.isArray(batch) ? batch : []) {
        const source = normalizeSource({ board: task?.board, taskId: task?.id });
        if (source && trustedKeys.has(sourceKey(source))) loaded.set(sourceKey(source), task);
      }
    }
    function eligible(source) {
      const normalized = normalizeSource(source);
      if (!normalized || !trustedKeys.has(sourceKey(normalized))) return null;
      const key = sourceKey(normalized);
      if (!loaded.has(key)) loaded.set(key, readTasks ? null : readTask(normalized) || null);
      const task = loaded.get(key);
      return isOpenTask(task) ? { source: normalized, task } : null;
    }

    let row = null;
    const operation = OPERATIONS[context.objectType];
    if (operation && typeof context.objectId === 'string' && context.objectId) {
      try {
        row = reader.read(operation, { id: context.objectId })?.item || null;
      } catch (_) {
        return null;
      }
    }

    // A projection-owned direct source is the strongest writable identity.
    const direct = eligible(row && { board: row.source_board, taskId: row.source_task_id });
    if (direct) return direct;

    // Topic projection order explicitly designates its first member as primary.
    if (context.objectType === 'topic' && Array.isArray(row?.source_task_refs)) {
      const primary = eligible(row.source_task_refs[0]);
      if (primary) return primary;
    }

    // A deduplicated decision may reference several sources. Only one remaining
    // open source is writable; otherwise selecting one would be arbitrary.
    const explicitReferences = uniqueSources(row?.source_refs || []);
    const explicitEligible = explicitReferences.map(eligible).filter(Boolean);
    if (explicitEligible.length === 1) return explicitEligible[0];
    if (explicitEligible.length > 1) return null;

    // Last resort for other projected objects: exactly one trusted open source.
    const openTrusted = trusted.map(eligible).filter(Boolean);
    return openTrusted.length === 1 ? openTrusted[0] : null;
  };
}

module.exports = {
  TERMINAL_STATUSES,
  createAssistantSourceResolver,
  isOpenTask,
  normalizeSource,
  uniqueSources,
};
