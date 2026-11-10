'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const {
  READ_ONLY_CONTRACT,
  RhajainaClient,
  RhajainaTransportError,
  boundedRecent,
  buildPrompt,
  redact,
} = require('../lib/rhajaina-client');

function spawnStub(result = {}) {
  const calls = [];
  const spawnImpl = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      value: '',
      end(value) {
        this.value += value || '';
      },
    };
    child.kill = (signal) => {
      child.killedWith = signal;
      if (result.closeOnKill !== false) queueMicrotask(() => child.emit('close', null, signal));
      return true;
    };
    calls.push({ executable, args, options, child });
    queueMicrotask(() => {
      if (result.hang) return;
      if (result.error) return child.emit('error', result.error);
      if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout));
      const stderr =
        result.stderr === undefined && (result.code ?? 0) === 0
          ? '\nsession_id: 20261109_182510_c5a695\n'
          : result.stderr;
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', result.code ?? 0, null);
    });
    return child;
  };
  return { calls, spawnImpl };
}

function config(overrides = {}) {
  return {
    enabled: true,
    mode: 'read_only',
    writesEnabled: false,
    matrixHandoffEnabled: false,
    limits: { maxMessageChars: 4000, maxContextChars: 12000, recentMessageCount: 2 },
    transport: {
      type: 'cli',
      safeMode: true,
      executable: '/safe/hermes',
      profile: 'rhajaina',
      toolset: 'bot_room',
      timeoutMs: 1000,
      runBudgetSeconds: 90,
      maxTurns: 1,
      source: 'tool',
      extraArgs: [],
    },
    ...overrides,
  };
}

test('uses explicit profile, named create/continue session, stdin query-file, and argument array', async () => {
  const stub = spawnStub({ stdout: 'Answer\n' });
  const client = new RhajainaClient({ config: config(), spawnImpl: stub.spawnImpl });
  const response = await client.send({
    sessionName: 'assistant-c1',
    createIfMissing: true,
    prompt: 'Question',
    context: { safe: true },
    recentMessages: [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'new' },
    ],
  });
  assert.equal(response.text, 'Answer');
  assert.equal(response.sessionName, 'assistant-c1');
  assert.equal(response.hermesSessionId, '20261109_182510_c5a695');
  assert.equal(stub.calls.length, 1);
  const call = stub.calls[0];
  assert.equal(call.executable, '/safe/hermes');
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.args.slice(0, 8), [
    '-p',
    'rhajaina',
    '-t',
    'bot_room',
    '--safe-mode',
    'chat',
    '--continue',
    'assistant-c1',
  ]);
  for (const required of [
    '--create-if-missing',
    '--query-file',
    '-',
    '--oneshot',
    '-Q',
    '--max-turns',
    '1',
    '--run-budget',
    '90',
    '--source',
    'tool',
  ]) {
    assert.ok(call.args.includes(required), required);
  }
  assert.ok(!call.args.includes('--format'));
  assert.match(call.child.stdin.value, /Do not invoke any tool/i);
  assert.match(call.child.stdin.value, /Do not write|no writes/i);
  assert.match(call.child.stdin.value, /Question/);
});

test('established follow-up resumes immutable session ID and bounded recent window keeps newest messages', async () => {
  const stub = spawnStub({ stdout: 'ok' });
  const client = new RhajainaClient({ config: config(), spawnImpl: stub.spawnImpl });
  await client.send({
    sessionName: 'assistant-c1',
    hermesSessionId: '20261109_182510_c5a695',
    prompt: 'next',
    recentMessages: [
      { role: 'user', content: 'drop-me' },
      { role: 'assistant', content: 'keep-one' },
      { role: 'user', content: 'keep-two' },
    ],
  });
  assert.ok(!stub.calls[0].args.includes('--create-if-missing'));
  assert.ok(!stub.calls[0].args.includes('--continue'));
  assert.deepEqual(stub.calls[0].args.slice(0, 8), [
    '-p',
    'rhajaina',
    '-t',
    'bot_room',
    '--safe-mode',
    'chat',
    '--resume',
    '20261109_182510_c5a695',
  ]);
  assert.doesNotMatch(stub.calls[0].child.stdin.value, /drop-me/);
  assert.match(stub.calls[0].child.stdin.value, /keep-one/);
  assert.match(stub.calls[0].child.stdin.value, /keep-two/);
});

test('returns multiline final prose but rejects diagnostics, JSON/tool records, and private output', async () => {
  const prose = spawnStub({ stdout: 'First paragraph.\n\nSecond paragraph.\n' });
  const client = new RhajainaClient({ config: config(), spawnImpl: prose.spawnImpl });
  assert.equal(
    (await client.send({ sessionName: 'assistant-c1', prompt: 'q' })).text,
    'First paragraph.\n\nSecond paragraph.'
  );
  for (const stdout of [
    'Safe answer\nWarning: diagnostic',
    'INFO transport started\nSafe answer',
    '{"type":"tool_result","content":"x"}',
    'Safe answer\n<tool_call>hidden</tool_call>',
    'TWL private context',
    'private-quarantine/item',
    'BRIDGE_MESSAGE raw',
    'password=super-secret-value',
    '/home/operator/private/config.json',
    'C:\\Users\\Operator\\secret.txt',
    '\u001b[31mERROR hidden diagnostic\u001b[0m',
    'working directory: project checkout',
    'hostname: internal-runner',
    'https://user:password@example.invalid/path',
    '{malformed structured record',
  ]) {
    const stub = spawnStub({ stdout });
    const failing = new RhajainaClient({ config: config(), spawnImpl: stub.spawnImpl });
    await assert.rejects(
      () => failing.send({ sessionName: 'assistant-c1', prompt: 'q' }),
      (error) =>
        error instanceof RhajainaTransportError && error.code === 'transport_output_invalid'
    );
  }
});

test('allows only path and URL references present in the sanitized input context', async () => {
  const artifact = 'hitl-cockpit/config/assistant-policy.json';
  const evidenceUrl = 'https://evidence.example.invalid/items/42';
  const allowed = spawnStub({ stdout: `See ${artifact} and ${evidenceUrl}.` });
  const client = new RhajainaClient({ config: config(), spawnImpl: allowed.spawnImpl });
  const response = await client.send({
    sessionName: 'assistant-c1',
    prompt: 'q',
    context: { artifact, evidenceUrl },
  });
  assert.equal(response.text, `See ${artifact} and ${evidenceUrl}.`);

  for (const reference of [
    'src/private/config.js',
    '/home/operator/private/config.json',
    'file:///tmp/private-artifact.txt',
    'https://private.example.invalid/secret',
  ]) {
    const denied = spawnStub({ stdout: `See ${reference}.` });
    const failing = new RhajainaClient({ config: config(), spawnImpl: denied.spawnImpl });
    await assert.rejects(
      () =>
        failing.send({
          sessionName: 'assistant-c1',
          prompt: 'q',
          context: { safe: true },
        }),
      (error) => error.code === 'transport_output_invalid'
    );
  }
});

test('context-binds tilde, UNC, and arbitrary-scheme URI references', async () => {
  const references = [
    '~/reports/forecast.json',
    '\\\\fileserver\\management\\forecast.csv',
    'ssh://analyst@example.invalid/reports/forecast',
    'custom+ssh.v1-test://example.invalid/reports/forecast',
    'file://fileserver/management/forecast.csv',
  ];
  const allowed = spawnStub({ stdout: `Use ${references.join(', ')}.` });
  const client = new RhajainaClient({ config: config(), spawnImpl: allowed.spawnImpl });
  const response = await client.send({
    sessionName: 'assistant-c1',
    prompt: 'q',
    context: { references },
  });
  assert.equal(response.text, `Use ${references.join(', ')}.`);

  for (const reference of references) {
    const denied = spawnStub({ stdout: `Use ${reference}.` });
    const failing = new RhajainaClient({ config: config(), spawnImpl: denied.spawnImpl });
    await assert.rejects(
      () =>
        failing.send({
          sessionName: 'assistant-c1',
          prompt: 'q',
          context: { safe: true },
        }),
      (error) => error.code === 'transport_output_invalid'
    );
  }
});

test('context-binds non-hierarchical URI references', async () => {
  const references = [
    'mailto:private@example.invalid',
    'urn:private:artifact:42',
    'data:text/plain,private',
    'magnet:?xt=urn:btih:SECRET',
    'custom:private',
    'x:secret',
    'foo:bar',
  ];
  const allowed = spawnStub({ stdout: `Use ${references.join(', ')}.` });
  const client = new RhajainaClient({ config: config(), spawnImpl: allowed.spawnImpl });
  const response = await client.send({
    sessionName: 'assistant-c1',
    prompt: 'q',
    context: { references },
  });
  assert.equal(response.text, `Use ${references.join(', ')}.`);

  for (const reference of references) {
    const denied = spawnStub({ stdout: `Use ${reference}.` });
    const failing = new RhajainaClient({ config: config(), spawnImpl: denied.spawnImpl });
    await assert.rejects(
      () =>
        failing.send({
          sessionName: 'assistant-c1',
          prompt: 'q',
          context: { safe: true },
        }),
      (error) => error.code === 'transport_output_invalid'
    );
  }
});

test('reference extraction does not mistake ordinary prose for paths or URIs', async () => {
  const prose = [
    'Use roughly ~25 percent and compare the server share with the file format.',
    'Hinweis: Bitte die Werte prüfen. Status: offen. Ergebnis: unverändert.',
  ].join('\n');
  const stub = spawnStub({ stdout: prose });
  const client = new RhajainaClient({ config: config(), spawnImpl: stub.spawnImpl });
  assert.equal((await client.send({ sessionName: 'assistant-c1', prompt: 'q' })).text, prose);
});

test('fails closed when a successful CLI call does not expose a verifiable real session ID', async () => {
  const stub = spawnStub({ stdout: 'Answer', stderr: '' });
  const client = new RhajainaClient({ config: config(), spawnImpl: stub.spawnImpl });
  await assert.rejects(
    () => client.send({ sessionName: 'assistant-c1', prompt: 'q' }),
    (error) => error.code === 'transport_identity_invalid'
  );
});

test('uses one attempt, redacts failures, and never returns stderr internals', async () => {
  const stub = spawnStub({
    code: 1,
    stderr: 'token=abcdefghijklmnopqrstuvwxyz /home/clawd/private',
  });
  const client = new RhajainaClient({ config: config(), spawnImpl: stub.spawnImpl });
  await assert.rejects(
    () => client.send({ sessionName: 'assistant-c1', prompt: 'q' }),
    (error) => {
      assert.equal(error.code, 'transport_failed');
      assert.doesNotMatch(error.message, /abcdefghijklmnopqrstuvwxyz|\/home\/clawd/);
      return true;
    }
  );
  assert.equal(stub.calls.length, 1);
});

test('redacts common credential forms and exposes no provider diagnostics', async () => {
  const diagnostic = [
    'password: short-secret',
    'token=token-value',
    'api-key: api-key-value',
    'authorization=Basic abc123',
    'bearer bearer-value',
    'secret: "json-secret"',
    '{"password":"json-password","api_key":"json-key"}',
    'ProviderError: upstream request id provider-42 failed',
  ].join('\n');
  const sanitized = redact(diagnostic);
  for (const secret of [
    'short-secret',
    'token-value',
    'api-key-value',
    'abc123',
    'bearer-value',
    'json-secret',
    'json-password',
    'json-key',
  ]) {
    assert.doesNotMatch(sanitized, new RegExp(secret));
  }

  const stub = spawnStub({ code: 1, stderr: diagnostic });
  const client = new RhajainaClient({ config: config(), spawnImpl: stub.spawnImpl });
  await assert.rejects(
    () => client.send({ sessionName: 'assistant-c1', prompt: 'q' }),
    (error) => error.code === 'transport_failed' && error.message === 'transport_failed'
  );
});

test('redacts extended credentials in headers, JSON, slash forms, and URLs', () => {
  const diagnostic = [
    'access_token=access-value',
    'refresh_token: refresh-value',
    'private_key/-----BEGIN_PRIVATE_KEY-----',
    'Cookie: session_cookie=cookie-value; Path=/',
    'Set-Cookie=refresh=refresh-cookie',
    'session/session-value',
    'session_id=session-id-value',
    'session_token: session-token-value',
    'auth/auth-value',
    'password=password-value',
    'token/token-value',
    'api-key=api-key-value',
    'authorization: Bearer authorization-value',
    'bearer/bearer-value',
    'secret=secret-value',
    '{"access_token":"json-access","private_key":"json-private","session_id":"json-session"}',
    'https://url-user:url-password@example.invalid/path?refresh_token=url-refresh',
  ].join('\n');
  const sanitized = redact(diagnostic);
  for (const secret of [
    'access-value',
    'refresh-value',
    'BEGIN_PRIVATE_KEY',
    'cookie-value',
    'refresh-cookie',
    'session-value',
    'session-id-value',
    'session-token-value',
    'auth-value',
    'password-value',
    'token-value',
    'api-key-value',
    'authorization-value',
    'bearer-value',
    'secret-value',
    'json-access',
    'json-private',
    'json-session',
    'url-user',
    'url-password',
    'url-refresh',
  ]) {
    assert.doesNotMatch(sanitized, new RegExp(secret));
  }
});

test('recent window honors zero count and includes newline separators in its strict budget', () => {
  const zero = config({
    limits: { maxMessageChars: 4000, maxContextChars: 12000, recentMessageCount: 0 },
  });
  assert.equal(boundedRecent([{ role: 'user', content: 'must-not-appear' }], zero, 100), '');

  const limited = config({
    limits: { maxMessageChars: 4000, maxContextChars: 12000, recentMessageCount: 3 },
  });
  const recent = boundedRecent(
    [
      { role: 'user', content: '1234' },
      { role: 'assistant', content: '12' },
      { role: 'user', content: '1' },
    ],
    limited,
    22
  );
  assert.equal(recent, 'assistant: 12\nuser: 1');
  assert.equal(recent.length, 21);
  assert.ok(recent.length <= 22);
});

test('maxContextChars strictly bounds the complete labeled context section', () => {
  const bounded = config({
    limits: { maxMessageChars: 4000, maxContextChars: 100, recentMessageCount: 2 },
  });
  const prompt = buildPrompt(
    {
      prompt: 'user text has its own limit',
      context: { item: '1234567890' },
      recentMessages: [
        { role: 'user', content: 'older message' },
        { role: 'assistant', content: 'newer message' },
      ],
    },
    bounded
  );
  const contextSection = prompt
    .split(`${READ_ONLY_CONTRACT}\n\n`)[1]
    .split('\n\nUSER MESSAGE:\n')[0];
  assert.ok(contextSection.length <= bounded.limits.maxContextChars);
  assert.match(contextSection, /^MANAGEMENT CONTEXT \(JSON\):/);
  assert.match(contextSection, /RECENT WINDOW:/);

  const impossible = config({
    limits: { maxMessageChars: 4000, maxContextChars: 20, recentMessageCount: 0 },
  });
  assert.throws(
    () => buildPrompt({ prompt: 'q', context: {}, recentMessages: [] }, impossible),
    (error) => error instanceof RhajainaTransportError && error.code === 'context_too_large'
  );
});

test('prompt requires one typed directive and resolves explicit delegation against the attached target', () => {
  const prompt = buildPrompt(
    {
      prompt: 'Delegiere dieses Thema an Felix.',
      context: {
        objectType: 'topic',
        objectId: 'topic-42',
        payload: { title: 'Willi-Mako Leads' },
      },
      recentMessages: [],
    },
    config()
  );

  assert.match(prompt, /Every response MUST end with exactly one/i);
  assert.match(prompt, /explicit delegation request MUST use intent "delegate"/i);
  assert.match(prompt, /"objectType":"topic","objectId":"topic-42"/);
  assert.match(prompt, /"delegate":\{"required":\{"assignee":"string"\}/);
  assert.match(prompt, /proposal only and does not execute/i);
  assert.doesNotMatch(prompt, /Do not delegate\./i);
  assert.ok(prompt.indexOf('FINAL OUTPUT CHECK:') > prompt.indexOf('USER MESSAGE:'));
  assert.match(
    prompt.slice(prompt.indexOf('FINAL OUTPUT CHECK:')),
    /For this attached target, an explicit delegation must use intent "delegate"/i
  );
});

test('global prompt forbids proposal intents without an attached target', () => {
  const prompt = buildPrompt(
    { prompt: 'Bitte kümmere dich darum.', context: { objectType: 'global', objectId: null } },
    config()
  );
  assert.match(prompt, /No management object is attached/i);
  assert.match(prompt, /answer_only or request_clarification/i);
});

test('recentMessageCount zero keeps the labeled recent window empty', () => {
  const zero = config({
    limits: { maxMessageChars: 4000, maxContextChars: 100, recentMessageCount: 0 },
  });
  const prompt = buildPrompt(
    {
      prompt: 'q',
      context: {},
      recentMessages: [{ role: 'user', content: 'must-not-appear' }],
    },
    zero
  );
  assert.match(prompt, /RECENT WINDOW: \(empty\)/);
  assert.doesNotMatch(prompt, /must-not-appear/);
});

test('external timeout terminates the process and fails without retry', async () => {
  const stub = spawnStub({ hang: true, closeOnKill: true });
  const client = new RhajainaClient({
    config: config({
      transport: { ...config().transport, timeoutMs: 5 },
    }),
    spawnImpl: stub.spawnImpl,
  });
  await assert.rejects(
    () => client.send({ sessionName: 'assistant-c1', prompt: 'q' }),
    (error) => error.code === 'transport_timeout'
  );
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].child.killedWith, 'SIGTERM');
});

test('POSIX timeout kills the detached process group including descendants', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX process groups are unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhajaina-tree-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pidFile = path.join(root, 'descendant.pid');
  const executable = path.join(root, 'tree-stub.js');
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node\nconst fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);\n`,
    { mode: 0o700 }
  );
  const client = new RhajainaClient({
    config: config({ transport: { ...config().transport, executable, timeoutMs: 100 } }),
  });
  await assert.rejects(
    () => client.send({ sessionName: 'assistant-c1', prompt: 'q' }),
    (error) => error.code === 'transport_timeout'
  );
  const descendantPid = Number(fs.readFileSync(pidFile, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
});

test('stderr output is byte bounded and terminates without retry', async () => {
  const stub = spawnStub({ stderr: Buffer.alloc(1024 * 1024 + 1, 'x'), closeOnKill: true });
  const client = new RhajainaClient({ config: config(), spawnImpl: stub.spawnImpl });
  await assert.rejects(
    () => client.send({ sessionName: 'assistant-c1', prompt: 'q' }),
    (error) => error.code === 'transport_output_limit'
  );
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].child.killedWith, 'SIGTERM');
});

test('stdin error rejects once, terminates the owned process, and never retries', async () => {
  const calls = [];
  let kills = 0;
  const spawnImpl = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () =>
      queueMicrotask(() => child.stdin.emit('error', new Error('stdin closed')));
    child.kill = (signal) => {
      kills += 1;
      child.killedWith = signal;
      queueMicrotask(() => child.emit('close', null, signal));
      return true;
    };
    calls.push({ executable, args, options, child });
    return child;
  };
  const client = new RhajainaClient({ config: config(), spawnImpl });
  let rejections = 0;
  await client.send({ sessionName: 'assistant-c1', prompt: 'q' }).then(
    () => assert.fail('stdin error unexpectedly resolved'),
    (error) => {
      rejections += 1;
      assert.equal(error.code, 'transport_failed');
    }
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rejections, 1);
  assert.equal(calls.length, 1);
  assert.equal(kills, 1);
  assert.equal(calls[0].child.killedWith, 'SIGTERM');
});

test('rejects disabled or unsafe policy and oversized messages before spawning', async () => {
  const stub = spawnStub({ stdout: 'should-not-run' });
  for (const unsafeConfig of [
    config({ enabled: false }),
    config({ mode: 'write' }),
    config({ writesEnabled: true }),
    config({ transport: { ...config().transport, safeMode: false } }),
    config({ transport: { ...config().transport, toolset: 'default' } }),
  ]) {
    const client = new RhajainaClient({ config: unsafeConfig, spawnImpl: stub.spawnImpl });
    await assert.rejects(() => client.send({ sessionName: 'assistant-c1', prompt: 'q' }));
  }
  const client = new RhajainaClient({ config: config(), spawnImpl: stub.spawnImpl });
  await assert.rejects(
    () => client.send({ sessionName: 'assistant-c1', prompt: 'x'.repeat(4001) }),
    /message_too_large/
  );
  assert.equal(stub.calls.length, 0);
});
