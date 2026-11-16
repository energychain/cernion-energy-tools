'use strict';

// Asynchronous chat turns (DEV-UAT-006, TECH-ASYNC-01). A long turn (attachment transcription,
// understanding, answer) can exceed the read timeout of a proxy in front of the caller: the caller
// saw HTTP 504 while the turn completed later and stayed invisible. With an Idempotency-Key and
// the tenant switch, the turn becomes a job of the shared job store:
// - accepted atomically with an empty assistant placeholder (done=false) under its parent turn;
// - answered synchronously when it completes within the sync window, otherwise HTTP 202 with
//   requestId, jobId and the echoed key, while the turn runs on;
// - a retry with the same key never starts a second turn: it returns the same ids (202 while
//   running, the stored result once completed);
// - status and persisted assistant are readable by job id, for the tenant that created it.
// Off by default; WORKBENCH_ASYNC_TURNS enables it for all tenants ("all") or a tenant list.
// A processing delay can be injected only for tenants in WORKBENCH_TEST_DELAY_TENANTS (isolated
// test tenants, never production) via the X-CET-Test-Delay-Ms header.

const crypto = require('node:crypto');
const jobStore = require('./job-store');

const SERVICE = 'openai-compatible';
const ACTION = 'chatCompletions';
const SYNC_WINDOW_MS = 3000;
const MAX_TEST_DELAY_MS = 60000;
const KEY_PATTERN = /^[\w.:-]{8,200}$/u;

function tenantList(value) {
  const text = String(value || '').trim();
  if (!text) return { all: false, tenants: new Set() };
  if (['all', '1', 'true', 'on'].includes(text.toLowerCase()))
    return { all: true, tenants: new Set() };
  return {
    all: false,
    tenants: new Set(
      text
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  };
}

function enabledFor(tenantId, value) {
  const list = tenantList(value);
  return list.all || list.tenants.has(String(tenantId || ''));
}

const asyncTurnsEnabled = (tenantId, env = process.env) =>
  enabledFor(tenantId, env.WORKBENCH_ASYNC_TURNS);

function header(req, name) {
  const value = req?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

// The caller's key for one logical turn; malformed keys are rejected, not silently ignored.
function idempotencyKeyOf(req) {
  const value = String(header(req, 'idempotency-key') || '').trim();
  if (!value) return '';
  if (!KEY_PATTERN.test(value)) {
    const error = new Error('Invalid Idempotency-Key.');
    error.code = 400;
    error.type = 'IDEMPOTENCY_KEY_INVALID';
    throw error;
  }
  return value;
}

// The parent turn of the answer: the caller's message id, else a digest of the conversation and
// the last user message, so a retry of the same message has the same parent.
function parentOf(req, body = {}) {
  const explicit =
    header(req, 'x-cet-parent-message-id') ||
    body?.metadata?.messageId ||
    body?.metadata?.parentMessageId;
  if (explicit) return String(explicit).slice(0, 200);
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const last = [...messages].reverse().find((message) => message?.role === 'user');
  const conversation =
    body?.metadata?.conversationId || body?.chat_id || header(req, 'x-openwebui-chat-id') || '';
  return `msg-${crypto
    .createHash('sha256')
    .update(JSON.stringify([conversation, last?.content ?? '']))
    .digest('hex')
    .slice(0, 32)}`;
}

function testDelayOf(req, tenantId, env = process.env) {
  const value = Number(header(req, 'x-cet-test-delay-ms') || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!enabledFor(tenantId, env.WORKBENCH_TEST_DELAY_TENANTS)) return 0;
  return Math.min(Math.round(value), MAX_TEST_DELAY_MS);
}

const scopedKey = (tenantId, key) => `chat-turn:${tenantId}:${key}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The fields the caller sees for a job; the key is the caller's, not the scoped storage key.
function descriptor(job) {
  const turn = job.turn || {};
  return {
    status: job.status,
    requestId: turn.requestId,
    jobId: job.jobId,
    idempotencyKey: turn.idempotencyKey,
    ...(job.status === jobStore.JOB_STATUS.COMPLETED
      ? { resultReference: `/v1/chat/jobs/${job.jobId}/message` }
      : {}),
    ...(job.status === jobStore.JOB_STATUS.ERROR ? { error: job.error || 'failed' } : {}),
  };
}

function persisted(job) {
  const assistant = job.turn?.assistant || { done: false, content: '' };
  return {
    jobId: job.jobId,
    parent: job.turn?.parent,
    assistantCount: 1,
    done: assistant.done === true,
    content: assistant.content || '',
  };
}

const running = new Map();

function answerText(response) {
  return String(response?.choices?.[0]?.message?.content || '');
}

/**
 * Runs a chat turn as an idempotent job. `run` performs the turn and resolves to the OpenAI
 * response. Returns { httpStatus, body } where 200 carries the completion (or the stored one) and
 * 202 the running descriptor.
 */
async function runChatTurn({
  tenantId,
  key,
  parent,
  run,
  testDelayMs = 0,
  syncWindowMs = SYNC_WINDOW_MS,
}) {
  const scoped = scopedKey(tenantId, key);
  const existing = jobStore.findJobByIdempotencyKey(SERVICE, ACTION, scoped);
  if (existing?.tenantId === String(tenantId)) return replay(existing);
  if (running.has(scoped)) return replay(jobStore.getJob(running.get(scoped)));

  const t0 = Date.now();
  // The store returns the id of the new job.
  const job = {
    jobId: jobStore.createJob({
      service: SERVICE,
      action: ACTION,
      idempotencyKey: scoped,
      tenantId,
    }),
  };
  running.set(scoped, job.jobId);
  jobStore.updateJob(job.jobId, {
    turn: {
      requestId: crypto.randomUUID(),
      idempotencyKey: key,
      parent,
      assistant: { done: false, content: '' },
    },
  });
  const work = (async () => {
    jobStore.updateJob(job.jobId, { status: jobStore.JOB_STATUS.RUNNING });
    try {
      const response = await run();
      // The injected delay ends at t0 + delay: the commit happens no earlier.
      const wait = t0 + testDelayMs - Date.now();
      if (wait > 0) await sleep(wait);
      const current = jobStore.getJob(job.jobId);
      jobStore.saveResult(job.jobId, response);
      jobStore.updateJob(job.jobId, {
        status: jobStore.JOB_STATUS.COMPLETED,
        completedAt: new Date().toISOString(),
        turn: { ...current.turn, assistant: { done: true, content: answerText(response) } },
      });
      return response;
    } catch (error) {
      jobStore.updateJob(job.jobId, {
        status: jobStore.JOB_STATUS.ERROR,
        error: String(error?.message || 'failed').slice(0, 300),
      });
      throw error;
    } finally {
      running.delete(scoped);
    }
  })();
  const outcome = await Promise.race([
    work.then(
      (response) => ({ settled: true, response }),
      (error) => ({ settled: true, error })
    ),
    sleep(syncWindowMs).then(() => ({ settled: false })),
  ]);
  if (outcome.settled && outcome.error) throw outcome.error;
  // A turn that runs past the window keeps running; its failure stays in the job record.
  if (!outcome.settled) work.catch(() => {});
  return outcome.settled
    ? { httpStatus: 200, body: outcome.response }
    : { httpStatus: 202, body: descriptor(jobStore.getJob(job.jobId)) };
}

// A retry: the stored completion with the job fields once completed, the running descriptor
// while it runs, a terminal error once failed; never a second turn.
function replay(job) {
  if (job.status === jobStore.JOB_STATUS.COMPLETED)
    return { httpStatus: 200, body: { ...jobStore.getResult(job.jobId), ...descriptor(job) } };
  if (job.status === jobStore.JOB_STATUS.ERROR) return { httpStatus: 500, body: descriptor(job) };
  return { httpStatus: 202, body: descriptor(job) };
}

// Job lookups are tenant-scoped: another tenant's job reads as not found.
function ownJob(jobId, tenantId) {
  const job = jobStore.getJob(String(jobId || ''));
  if (job?.service !== SERVICE || job.tenantId !== String(tenantId)) return null;
  return job;
}

module.exports = {
  SYNC_WINDOW_MS,
  asyncTurnsEnabled,
  descriptor,
  idempotencyKeyOf,
  ownJob,
  parentOf,
  persisted,
  runChatTurn,
  testDelayOf,
};
