'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAssistantSourceResolver } = require('../lib/assistant-source-resolver');

function task(id, status = 'blocked', board = 'operations') {
  return { id, board, status, title: id };
}

function harness(rows, tasks) {
  const byKey = new Map(tasks.map((item) => [`${item.board}\0${item.id}`, item]));
  const reads = [];
  const resolver = createAssistantSourceResolver({
    reader: {
      read(operation, input) {
        reads.push({ operation, id: input.id });
        return { item: rows[`${operation}:${input.id}`] || null };
      },
    },
    readTask(source) {
      return byKey.get(`${source.board}\0${source.taskId}`) || null;
    },
    validBoard(board) {
      return board === 'operations';
    },
    validTask(taskId) {
      return /^t_[a-z0-9]+$/.test(taskId);
    },
  });
  return { reads, resolver };
}

function context(objectType, objectId, ids) {
  return {
    objectType,
    objectId,
    sourceTasks: ids.map((taskId) => ({ board: 'operations', taskId })),
  };
}

test('aggregated topic resolves its projection-owned open primary source', async () => {
  const primary = task('t_primary');
  const secondary = task('t_secondary', 'in_progress');
  const h = harness(
    {
      'topic:topic-1': {
        source_task_refs: [
          { board: 'operations', taskId: primary.id },
          { board: 'operations', taskId: secondary.id },
        ],
      },
    },
    [primary, secondary]
  );

  const result = await h.resolver({
    context: context('topic', 'topic-1', [primary.id, secondary.id]),
  });
  assert.deepEqual(result, {
    source: { board: 'operations', taskId: primary.id },
    task: primary,
  });
});

test('closed topic primary falls back only when exactly one trusted source remains open', async () => {
  const primary = task('t_primary', 'completed');
  const open = task('t_open', 'blocked');
  const h = harness(
    {
      'topic:topic-1': {
        source_task_refs: [
          { board: 'operations', taskId: primary.id },
          { board: 'operations', taskId: open.id },
        ],
      },
    },
    [primary, open]
  );

  const result = await h.resolver({
    context: context('topic', 'topic-1', [primary.id, open.id]),
  });
  assert.equal(result.source.taskId, open.id);
});

test('closed topic primary with multiple open candidates remains fail-closed', async () => {
  const tasks = [task('t_primary', 'closed'), task('t_open1'), task('t_open2', 'in_progress')];
  const refs = tasks.map((item) => ({ board: item.board, taskId: item.id }));
  const h = harness({ 'topic:topic-1': { source_task_refs: refs } }, tasks);

  const result = await h.resolver({
    context: context(
      'topic',
      'topic-1',
      tasks.map((item) => item.id)
    ),
  });
  assert.equal(result, null);
});

test('decision direct source outranks other open deduplicated references', async () => {
  const direct = task('t_direct');
  const duplicate = task('t_duplicate', 'in_progress');
  const h = harness(
    {
      'decision:decision-1': {
        source_board: direct.board,
        source_task_id: direct.id,
        source_refs: [
          { board: duplicate.board, taskId: duplicate.id },
          { board: direct.board, taskId: direct.id },
        ],
      },
    },
    [direct, duplicate]
  );

  const result = await h.resolver({
    context: context('decision', 'decision-1', [direct.id, duplicate.id]),
  });
  assert.equal(result.source.taskId, direct.id);
});

test('closed decision primary uses one open explicit reference but rejects ambiguous references', async () => {
  const direct = task('t_direct', 'resolved');
  const open1 = task('t_open1');
  const open2 = task('t_open2', 'in_progress');
  const row = {
    source_board: direct.board,
    source_task_id: direct.id,
    source_refs: [
      { board: direct.board, taskId: direct.id },
      { board: open1.board, taskId: open1.id },
    ],
  };
  const single = harness({ 'decision:decision-1': row }, [direct, open1]);
  const selected = await single.resolver({
    context: context('decision', 'decision-1', [direct.id, open1.id]),
  });
  assert.equal(selected.source.taskId, open1.id);

  const ambiguous = harness(
    {
      'decision:decision-1': {
        ...row,
        source_refs: [...row.source_refs, { board: open2.board, taskId: open2.id }],
      },
    },
    [direct, open1, open2]
  );
  const rejected = await ambiguous.resolver({
    context: context('decision', 'decision-1', [direct.id, open1.id, open2.id]),
  });
  assert.equal(rejected, null);
});

test('projection sources outside the trusted context or allowed board are never selected', async () => {
  const source = task('t_direct');
  const h = harness(
    {
      'decision:decision-1': {
        source_board: source.board,
        source_task_id: source.id,
      },
    },
    [source]
  );
  assert.equal(await h.resolver({ context: context('decision', 'decision-1', ['t_other']) }), null);

  const privateResolver = createAssistantSourceResolver({
    reader: { read: () => ({ item: null }) },
    readTask: () => task('t_private', 'blocked', 'twl-netze-private'),
    validBoard: () => false,
    validTask: () => true,
  });
  assert.equal(
    await privateResolver({
      context: {
        objectType: 'topic',
        objectId: 'topic-1',
        sourceTasks: [{ board: 'twl-netze-private', taskId: 't_private' }],
      },
    }),
    null
  );
});
