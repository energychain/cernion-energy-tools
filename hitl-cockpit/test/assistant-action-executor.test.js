'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ALLOWED_ACTIONS,
  AssistantActionError,
  createAssistantActionExecutor,
  sourceFingerprint,
} = require('../lib/assistant-action-executor');

function publicTask(overrides = {}) {
  return {
    id: 'task-1',
    board: 'operations',
    title: 'Prepare evidence review',
    body: 'Public-safe fixture',
    assignee: 'Rhajaina',
    priority: 1,
    status: 'blocked',
    comments: [],
    ...overrides,
  };
}

function adapter(initial = publicTask(), apply) {
  let task = structuredClone(initial);
  const calls = [];
  return {
    calls,
    async readTask(source) {
      assert.deepEqual(source, { board: task.board, taskId: task.id });
      return structuredClone(task);
    },
    async applyAction(command) {
      calls.push(structuredClone(command));
      if (apply)
        return apply(
          command,
          () => task,
          (next) => (task = next)
        );
      if (command.action === 'set_owner') task.assignee = command.payload.owner;
      if (command.action === 'set_priority') task.priority = command.payload.priority;
      task.comments.push({ action: command.action, key: command.idempotencyKey });
      return { operationId: `op-${calls.length}` };
    },
  };
}

function request(task, action, payload, idempotencyKey = `${action}-key`) {
  return {
    action,
    source: { board: task.board, taskId: task.id },
    sourceFingerprint: sourceFingerprint(task),
    idempotencyKey,
    payload,
  };
}

const PAYLOADS = {
  ask_question: { question: 'Which evidence is missing?' },
  delegate_followup: { assignee: 'Felix', followup: 'Collect the public evidence.' },
  schedule_wakeup: {
    wakeAt: '2030-01-02T03:04:05Z',
    reason: 'Wait for the review window.',
    nextAction: 'Review the evidence.',
  },
  return_for_completion: { reason: 'Add the missing evidence.' },
};

test('executes only the initial safe actions through the injected adapter with readback receipts', async () => {
  assert.deepEqual(ALLOWED_ACTIONS, [
    'ask_question',
    'delegate_followup',
    'schedule_wakeup',
    'return_for_completion',
    'set_owner',
    'set_priority',
  ]);

  for (const [action, payload] of Object.entries(PAYLOADS)) {
    const task = publicTask();
    const kanban = adapter(task);
    const executor = createAssistantActionExecutor({ kanban });
    const result = await executor.execute(request(task, action, payload));

    assert.equal(result.ok, true);
    assert.equal(result.status, 'applied');
    assert.equal(result.deduplicated, false);
    assert.equal(result.receipt.adapter.operationId, 'op-1');
    assert.equal(result.receipt.readBack.task.comments[0].action, action);
    assert.equal(result.receipt.readBack.fingerprint.length, 64);
    assert.equal(kanban.calls.length, 1);
    assert.equal(kanban.calls[0].sourceFingerprint, sourceFingerprint(task));
  }
});

test('set_owner and set_priority require explicit covered scope', async () => {
  for (const [action, payload] of [
    ['set_owner', { owner: 'Anja' }],
    ['set_priority', { priority: 4 }],
  ]) {
    const task = publicTask();
    const uncovered = adapter(task);
    const denied = createAssistantActionExecutor({
      kanban: uncovered,
      scopeChecker: async () => ({ covered: false }),
    });
    await assert.rejects(
      denied.execute(request(task, action, payload)),
      (error) => error instanceof AssistantActionError && error.code === 'scope_not_covered'
    );
    assert.equal(uncovered.calls.length, 0);

    const covered = adapter(task);
    const checks = [];
    const allowed = createAssistantActionExecutor({
      kanban: covered,
      scopeChecker: async (scope) => {
        checks.push(scope);
        return 'covered';
      },
    });
    const result = await allowed.execute(request(task, action, payload));
    assert.equal(result.status, 'applied');
    assert.equal(checks[0].action, action);
    assert.deepEqual(checks[0].source, { board: 'operations', taskId: 'task-1' });
  }
});

test('rejects unsupported and consequential actions before adapter access', async () => {
  const task = publicTask();
  const kanban = adapter(task);
  const executor = createAssistantActionExecutor({ kanban, scopeChecker: async () => 'covered' });
  const forbidden = [
    'shell',
    'set_price',
    'sign_contract',
    'take_payment',
    'publish',
    'external_send',
    'deploy',
    'delete_task',
    'create_scope',
  ];
  for (const action of forbidden) {
    await assert.rejects(
      executor.execute(request(task, action, {})),
      (error) => error.code === 'action_not_allowed' && error.status === 403
    );
  }
  assert.equal(kanban.calls.length, 0);
});

test('idempotency deduplicates concurrent and later retries and rejects key reuse', async () => {
  const task = publicTask();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const kanban = adapter(task, async (command, getTask, setTask) => {
    await gate;
    const next = structuredClone(getTask());
    next.comments.push({ action: command.action });
    setTask(next);
    return { operationId: 'once' };
  });
  const executor = createAssistantActionExecutor({ kanban });
  const input = request(task, 'ask_question', PAYLOADS.ask_question, 'same-key');
  const first = executor.execute(input);
  const concurrent = executor.execute(input);
  release();
  const [firstResult, concurrentResult] = await Promise.all([first, concurrent]);
  const retryResult = await executor.execute(input);

  assert.equal(kanban.calls.length, 1);
  assert.equal(firstResult.deduplicated, false);
  assert.equal(concurrentResult.deduplicated, true);
  assert.equal(retryResult.deduplicated, true);
  await assert.rejects(
    executor.execute({ ...input, payload: { question: 'A different command?' } }),
    (error) => error.code === 'idempotency_key_conflict' && error.status === 409
  );
});

test('requires an exact current source fingerprint and performs no stale write', async () => {
  const task = publicTask();
  const kanban = adapter(task);
  const executor = createAssistantActionExecutor({ kanban });
  await assert.rejects(
    executor.execute({
      ...request(task, 'ask_question', PAYLOADS.ask_question),
      sourceFingerprint: '0'.repeat(64),
    }),
    (error) => error.code === 'source_fingerprint_mismatch' && error.status === 409
  );
  assert.equal(kanban.calls.length, 0);
});

test('returns a readback-backed ambiguous reconciliation status after write timeout', async () => {
  const task = publicTask();
  const kanban = adapter(task, async () => {
    const error = new Error('operation timed out after dispatch');
    error.code = 'ETIMEDOUT';
    throw error;
  });
  const executor = createAssistantActionExecutor({ kanban });
  const input = request(task, 'return_for_completion', PAYLOADS.return_for_completion);
  const result = await executor.execute(input);
  const retry = await executor.execute(input);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reconciliation.status, 'ambiguous');
  assert.equal(result.reconciliation.reason, 'write_timeout');
  assert.equal(result.reconciliation.readBack.fingerprint, sourceFingerprint(task));
  assert.equal(retry.deduplicated, true);
  assert.equal(kanban.calls.length, 1);
});

test('rejects private and TWL source or payload data before writes', async () => {
  const fixtures = [
    publicTask({ board: 'twl-netze-private' }),
    publicTask({ sensitivity: 'confidential' }),
    publicTask({ private: true }),
    publicTask({ body: 'TWL raw customer context' }),
  ];
  for (const task of fixtures) {
    const kanban = adapter(task);
    const executor = createAssistantActionExecutor({ kanban });
    await assert.rejects(
      executor.execute(request(task, 'ask_question', PAYLOADS.ask_question)),
      (error) => error.code === 'private_source_rejected' && error.status === 403
    );
    assert.equal(kanban.calls.length, 0);
  }

  const task = publicTask();
  const kanban = adapter(task);
  const executor = createAssistantActionExecutor({ kanban });
  await assert.rejects(
    executor.execute(request(task, 'ask_question', { question: 'Inspect TWL private material?' })),
    (error) => error.code === 'private_source_rejected'
  );
  assert.equal(kanban.calls.length, 0);
});

test('validates adapter and action payload contracts fail-closed', async () => {
  assert.throws(() => createAssistantActionExecutor(), /kanban_adapter_required/);
  const task = publicTask();
  const executor = createAssistantActionExecutor({ kanban: adapter(task) });
  await assert.rejects(
    executor.execute(request(task, 'ask_question', { question: '  ' })),
    (error) => error.code === 'question_required'
  );
  await assert.rejects(
    executor.execute(
      request(task, 'schedule_wakeup', { ...PAYLOADS.schedule_wakeup, wakeAt: 'no' })
    ),
    (error) => error.code === 'wakeAt_invalid'
  );
});
