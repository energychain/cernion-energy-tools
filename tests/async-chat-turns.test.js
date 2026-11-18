'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-async-turns-'));
process.env.JOB_STORE_DIR = path.join(root, 'jobs');
const turns = require('../src/async-chat-turns');
const { isChatJobRequest } = require('../src/gateway-request-classifiers');

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const completion = (text) => ({ id: 'chatcmpl-1', choices: [{ message: { content: text } }] });
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('asynchronous chat turns (DEV-UAT-006, TECH-ASYNC-01)', () => {
  test('a turn within the window answers directly; the job keeps the answer', async () => {
    const outcome = await turns.runChatTurn({
      tenantId: 't1',
      key: 'key-fast-0001',
      parent: 'msg-1',
      run: () => later(5, completion('Antwort')),
      syncWindowMs: 200,
    });
    expect(outcome).toMatchObject({ httpStatus: 200, body: { id: 'chatcmpl-1' } });
  });

  test('a long turn answers 202, keeps running, and a retry never starts a second turn', async () => {
    let runs = 0;
    const run = () => {
      runs += 1;
      return later(150, completion('Spätes Ergebnis'));
    };
    const first = await turns.runChatTurn({
      tenantId: 't1',
      key: 'key-slow-0001',
      parent: 'msg-2',
      run,
      syncWindowMs: 30,
    });
    expect(first.httpStatus).toBe(202);
    expect(first.body).toMatchObject({ status: 'running', idempotencyKey: 'key-slow-0001' });
    expect(first.body.requestId).toBeTruthy();
    const { jobId, requestId } = first.body;
    const job = turns.ownJob(jobId, 't1');
    expect(turns.persisted(job)).toEqual({
      jobId,
      parent: 'msg-2',
      assistantCount: 1,
      done: false,
      content: '',
    });
    const retry = await turns.runChatTurn({
      tenantId: 't1',
      key: 'key-slow-0001',
      parent: 'msg-2',
      run,
      syncWindowMs: 30,
    });
    expect(retry).toMatchObject({ httpStatus: 202, body: { jobId, requestId, status: 'running' } });
    await later(200);
    const done = turns.ownJob(jobId, 't1');
    expect(turns.descriptor(done)).toMatchObject({
      status: 'completed',
      jobId,
      requestId,
      idempotencyKey: 'key-slow-0001',
      resultReference: `/v1/chat/jobs/${jobId}/message`,
    });
    expect(turns.persisted(done)).toMatchObject({
      done: true,
      content: 'Spätes Ergebnis',
      parent: 'msg-2',
      assistantCount: 1,
    });
    const after = await turns.runChatTurn({
      tenantId: 't1',
      key: 'key-slow-0001',
      parent: 'msg-2',
      run,
      syncWindowMs: 30,
    });
    expect(after).toMatchObject({
      httpStatus: 200,
      body: { jobId, requestId, status: 'completed', id: 'chatcmpl-1' },
    });
    expect(runs).toBe(1);
  });

  test('the injected delay holds the commit until t0 + delay; jobs are tenant-scoped', async () => {
    const started = Date.now();
    const first = await turns.runChatTurn({
      tenantId: 't2',
      key: 'key-delay-0001',
      parent: 'msg-3',
      run: () => later(5, completion('x')),
      testDelayMs: 600,
      syncWindowMs: 30,
    });
    expect(first.httpStatus).toBe(202);
    // Checkpoints are measured from the start, so a slow runner cannot move them past the delay.
    await later(Math.max(0, started + 300 - Date.now()));
    if (Date.now() - started < 550)
      expect(turns.ownJob(first.body.jobId, 't2').status).not.toBe('completed');
    await later(Math.max(0, started + 800 - Date.now()));
    const job = turns.ownJob(first.body.jobId, 't2');
    expect(job.status).toBe('completed');
    expect(Date.parse(job.completedAt) - started).toBeGreaterThanOrEqual(590);
    expect(turns.ownJob(first.body.jobId, 'other-tenant')).toBeNull();
  });

  test('a failed turn ends in a terminal error, also for a retry', async () => {
    const run = () => later(40).then(() => Promise.reject(new Error('Modell nicht erreichbar')));
    const first = await turns.runChatTurn({
      tenantId: 't3',
      key: 'key-fail-0001',
      parent: 'm',
      run,
      syncWindowMs: 10,
    });
    expect(first.httpStatus).toBe(202);
    await later(80);
    const retry = await turns.runChatTurn({
      tenantId: 't3',
      key: 'key-fail-0001',
      parent: 'm',
      run,
      syncWindowMs: 10,
    });
    expect(retry).toMatchObject({
      httpStatus: 500,
      body: { status: 'error', jobId: first.body.jobId },
    });
  });

  test('switches, keys, parent and the test delay are guarded', () => {
    expect(turns.asyncTurnsEnabled('t', {})).toBe(false);
    expect(turns.asyncTurnsEnabled('t', { WORKBENCH_ASYNC_TURNS: 'a, t' })).toBe(true);
    const req = (headers) => ({ headers });
    expect(turns.idempotencyKeyOf(req({}))).toBe('');
    expect(turns.idempotencyKeyOf(req({ 'idempotency-key': 'turn-0001-a' }))).toBe('turn-0001-a');
    expect(() => turns.idempotencyKeyOf(req({ 'idempotency-key': 'bad key!' }))).toThrow(
      'Invalid Idempotency-Key'
    );
    const body = {
      messages: [{ role: 'user', content: 'Frage' }],
      metadata: { conversationId: 'c1' },
    };
    expect(turns.parentOf(req({}), body)).toBe(turns.parentOf(req({}), body));
    expect(turns.parentOf(req({ 'x-cet-parent-message-id': 'm-7' }), body)).toBe('m-7');
    expect(turns.testDelayOf(req({ 'x-cet-test-delay-ms': '8000' }), 'prod', {})).toBe(0);
    expect(
      turns.testDelayOf(req({ 'x-cet-test-delay-ms': '8000' }), 'uat', {
        WORKBENCH_TEST_DELAY_TENANTS: 'uat',
      })
    ).toBe(8000);
    expect(isChatJobRequest('GET', '/v1/chat/jobs/123e4567-e89b-12d3-a456-426614174000')).toBe(
      true
    );
    expect(
      isChatJobRequest('GET', '/v1/chat/jobs/123e4567-e89b-12d3-a456-426614174000/message')
    ).toBe(true);
    expect(isChatJobRequest('POST', '/v1/chat/jobs/123e4567-e89b-12d3-a456-426614174000')).toBe(
      false
    );
    expect(isChatJobRequest('GET', '/v1/chat/jobs/../admin')).toBe(false);
  });
});
